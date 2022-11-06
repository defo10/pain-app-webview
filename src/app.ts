/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import _ from "lodash";
import { PainShape } from "./pain_shape";
import * as clipperLib from "js-angusj-clipper";
import * as gl from "gl-matrix";
import {
  autoDetectRenderer,
  Container,
  ENV,
  Graphics,
  MIPMAP_MODES,
  Point,
  PRECISION,
  settings,
  Sprite,
  Texture,
  UniformGroup,
  Ticker,
  PointerEvents,
  InteractionEvent,
} from "pixi.js";
import "@pixi/math-extras";
import { Assets } from "@pixi/assets";
import { valueFromSlider, innerColorPicker, checkedRadioBtn, outerColorPicker } from "./ui";
import { Model } from "./model";
import { gradientShaderFrom } from "./filters/GradientShader";
import { polygon2starshape } from "./polygon/polygons";
import { Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";
import { clamp, dist } from "./polygon/utils";
import { Position, RandomSpaceFilling } from "./polygon/space_filling";
import { CurveInterpolator } from "curve-interpolator";
import { contours } from "d3-contour";
import { debug } from "./debug";
import { Buffer, Kernel, UINT8 } from "./blink";
import KernelSource from "./filters/kernelsource.frag";
import { JoyStick } from "./joy";
import simplify from "simplify-js";
const lerp = require("interpolation").lerp;
const smoothstep = require("interpolation").smoothstep;

// gl matrix uses float 32 types by default, but array is much faster.
gl.glMatrix.setMatrixArrayType(Array);

const RESOLUTION = window.devicePixelRatio;

settings.PREFER_ENV = ENV.WEBGL2;
settings.MIPMAP_TEXTURES = MIPMAP_MODES.OFF; // no zooming so no advantage
const DOWNSCALE_FACTOR = 1.0;
settings.PRECISION_FRAGMENT = PRECISION.MEDIUM;
settings.PRECISION_VERTEX = PRECISION.MEDIUM;
settings.TARGET_FPMS = 1 / (30 * 1000);
settings.FAIL_IF_MAJOR_PERFORMANCE_CAVEAT = true;

const renderer = autoDetectRenderer({
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  resolution: RESOLUTION,
  backgroundColor: 0xffffff,
  antialias: false,
  useContextAlpha: false,
});

const ticker = Ticker.system;
ticker.maxFPS = 60;
// async inits
const clipperPromise = clipperLib.loadNativeClipperLibInstanceAsync(
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
);
Assets.addBundle("body", { headLeft: "./assets/head.jpg" });
const assetsPromise = Assets.loadBundle("body");

const joystick = new JoyStick("joyDiv", {
  internalFillColor: "rgba(255, 0, 0, 1)",
  externalStrokeColor: "rgba(0, 0, 255, 1)",
  autoReturnToCenter: false,
});

const cardinalDirectionToBBPoint = (dir: string): [number, number] => {
  switch (dir) {
    case "N":
      return [0.5, 0];
    case "NE":
      return [1, 0];
    case "E":
      return [1, 0.5];
    case "SE":
      return [1, 1];
    case "S":
      return [0.5, 1];
    case "SW":
      return [0, 1];
    case "W":
      return [0, 0.5];
    case "NW":
      return [0, 0];
    default: // and "C" = center
      return [0.5, 0.5];
  }
};

const updatedModel = (oldModel?: Model): Model => {
  let painShapes;
  if (oldModel) {
    oldModel.shapeParams.painShapes.forEach((p, i) => {
      p.radius = valueFromSlider(`radius${i + 1}`);
      // position is updated automatically by the drag handler
    });
    painShapes = oldModel.shapeParams.painShapes;
  } else {
    painShapes = [
      new PainShape(new Point(120, 90), valueFromSlider("radius1")),
      new PainShape(new Point(170, 120), valueFromSlider("radius2")),
      new PainShape(new Point(140, 200), valueFromSlider("radius3")),
    ];
  }
  return {
    shapeParams: {
      considerConnectedLowerBound: 0.75,
      gravitationForceVisibleLowerBound: 0.5,
      painShapes,
      closeness: valueFromSlider("closeness"),
    },
    dissolve: valueFromSlider("dissolve"),
    coloringParams: {
      innerColorStart: valueFromSlider("colorShift"),
      alphaFallOutEnd: valueFromSlider("alphaRatio"),
      innerColorHSL: innerColorPicker(checkedRadioBtn("innerColor"), valueFromSlider("lightness")),
      outerColorHSL:
        outerColorPicker(checkedRadioBtn("outerColor")) ??
        innerColorPicker(checkedRadioBtn("innerColor"), valueFromSlider("lightness")),
    },
    starShapeParams: {
      outerOffsetRatio: valueFromSlider("outerOffsetRatio"),
      roundness: valueFromSlider("roundness"),
      wingWidth: valueFromSlider("wingWidth"),
    },
    animationType: checkedRadioBtn("animation-curve") as "off" | "linear-in" | "linear-out" | "soft", // 0: off, 1: linear-in, 2: linear-out, 3: soft
    frequencyHz: valueFromSlider("frequencyHz"),
    amplitude: 1 - valueFromSlider("amplitude"),
    origin: cardinalDirectionToBBPoint(joystick.GetDir()),
  };
};

let model: Model = updatedModel();
const ubo = UniformGroup.uboFrom({
  points: Float32Array.from([]),
  radii: Float32Array.from([]),
});
const shader = gradientShaderFrom({
  innerColorStart: 0,
  alphaFallOutEnd: 0,
  outerColorHSL: [0, 0, 0],
  innerColorHSL: [0, 0, 0],
  points_ubo: ubo,
  points_len: 0,
  threshold: 0.5,
});

const scene = new Container();
let staleMeshes: Container;
let stars: Position[][] = [];
let clipper: clipperLib.ClipperLibWrapper | undefined;

const init = async (): Promise<void> => {
  const [clipperResolved, assetsResolved]: [clipperLib.ClipperLibWrapper, { headLeft: Texture }] = await Promise.all([
    clipperPromise,
    assetsPromise,
  ]);
  clipper = clipperResolved;

  const canvasWidth = (document.getElementById("animations-canvas")?.clientWidth ?? 0) * DOWNSCALE_FACTOR;
  const canvasHeight = (document.getElementById("animations-canvas")?.clientHeight ?? 0) * DOWNSCALE_FACTOR;
  renderer.resize(canvasWidth, canvasHeight);

  // add bg image
  const backgroundImage = new Sprite(assetsResolved.headLeft);
  const scaleToFitRatio = Math.min(
    (renderer.width * DOWNSCALE_FACTOR) / RESOLUTION / backgroundImage.width,
    (renderer.height * DOWNSCALE_FACTOR) / RESOLUTION / backgroundImage.height
  );
  backgroundImage.scale.x = backgroundImage.scale.y = scaleToFitRatio;
  backgroundImage.interactive = false;
  backgroundImage.interactiveChildren = false;
  scene.addChild(backgroundImage);

  ticker.add(animate);
};

const animate = (time: number): void => {
  model = updatedModel(model);

  const padding = 100;
  const bb = {
    minX: Math.max(
      0,
      (_.minBy(model.shapeParams.painShapes, (ps) => ps.position.x - ps.radius)?.position.x ?? 0) - padding
    ),
    minY: Math.max(
      0,
      (_.minBy(model.shapeParams.painShapes, (ps) => ps.position.y - ps.radius)?.position.y ?? 0) - padding
    ),
    maxX: (_.maxBy(model.shapeParams.painShapes, (ps) => ps.position.x + ps.radius)?.position.x ?? 0) + padding,
    maxY: (_.maxBy(model.shapeParams.painShapes, (ps) => ps.position.y + ps.radius)?.position.y ?? 0) + padding,
  };

  const offsetX = bb.minX;
  const offsetY = bb.minY;
  const bbWidth = bb.maxX - bb.minX;
  const bbHeight = bb.maxY - bb.minY;

  interface Shape {
    radius: number;
    center: [number, number];
  }
  const outerShapes: Shape[] = model.shapeParams.painShapes.map((p) => ({
    radius: p.radius,
    center: [p.position.x, p.position.y],
  }));
  const threshold = 1 - model.shapeParams.closeness ?? 0.5;

  if (model.dissolve > 0) {
    /// 1. create low res polygon of outer shape
    const sampleRate = 10;
    const projectedWidth = Math.round(bbWidth / sampleRate);
    const projectedHeight = Math.round(bbHeight / sampleRate);

    // src: https://link.springer.com/content/pdf/10.1007/BF01900346.pdf
    const falloff = (d: number, radius: number): number => {
      const R = radius * 2.0;
      if (d >= R) {
        return 0.0;
      }
      const first = 2.0 * Math.pow(d / R, 3.0);
      const second = -3.0 * Math.pow(d / R, 2.0);
      return first + second + 1.0;
    };

    const distMatrix: number[] = new Array(projectedWidth * projectedHeight);
    for (let m = 0, k = 0; m < projectedHeight; m++) {
      for (let n = 0; n < projectedWidth; n++, k++) {
        const distances = outerShapes.map(({ radius, center }) => {
          const d = dist(center, [
            bb.minX + n * sampleRate + sampleRate * 0.5,
            bb.minY + m * sampleRate + sampleRate * 0.5,
          ]);
          return falloff(d, radius);
        });
        distMatrix[k] = distances.reduce((acc, curr) => acc + curr, 0);
      }
    }

    const calcContour = contours().size([projectedWidth, projectedHeight]).smooth(false).thresholds([threshold]);
    const [polygonsNew] = calcContour(distMatrix);
    const polygonLowRes = polygonsNew.coordinates.map(([coords]) =>
      coords.map(([x, y]) => [x * sampleRate + bb.minX, y * sampleRate + bb.minY] as [number, number])
    );

    // 2. fill out with stars if needed
    if (stars.length === 0) {
      const starsPerPolygon: Position[][] = [];
      for (const polygon of polygonLowRes) {
        const euclidPolygon = new EuclidPolygon(...polygon.map(([x, y]) => new EuclidPoint(x, y)));
        const positions = new RandomSpaceFilling(euclidPolygon, [2, 5]);
        const stars = positions.getPositions(0.2);
        starsPerPolygon.push(stars);
      }

      // save star as global such that is doesnt change during the dissolve
      stars = starsPerPolygon;
    }
  } else stars = []; // make sure stars are cleared at each new position

  // 3. apply animation based extra dissolve
  const outerShapesDissolved = outerShapes.map(({ center, radius }) => ({
    center,
    radius: radius * (1 - model.dissolve),
  }));
  const starsAnimated = _.cloneDeep(stars);
  const soft = (t: number): number => {
    const turningPoint = 0.5;
    if (t < turningPoint) return smoothstep(0, turningPoint, t);
    return smoothstep(1, turningPoint, t);
  };
  const linearIn = (t: number): number => {
    const turningPoint = 0.9;
    if (t < turningPoint) return smoothstep(0, turningPoint, t);
    return smoothstep(1, turningPoint, t);
  };
  const linearOut = (t: number): number => {
    const turningPoints = 0.1;
    if (t < turningPoints) return smoothstep(0, turningPoints, t);
    return smoothstep(1, turningPoints, t);
  };
  if (model.animationType !== "off") {
    const [xOriginRatio, yOriginRatio] = model.origin;
    const origin: [number, number] = [bb.minX + xOriginRatio * bb.maxX, bb.minY + yOriginRatio * bb.maxY];
    const maxDistanceToOrigin = Math.max(
      ...[
        [bb.minX, bb.minY],
        [bb.maxX, bb.minY],
        [bb.minX, bb.maxY],
        [bb.maxX, bb.maxY],
      ].map((p) => dist(origin, p as [number, number]))
    );

    for (const position of [...outerShapesDissolved, ...starsAnimated.flat(1)]) {
      const distanceToOrigin = dist(position.center, origin);
      const distanceRatio = distanceToOrigin / maxDistanceToOrigin;
      const timePerLoop = 1000 / model.frequencyHz;
      const timeShift: number = lerp(0, timePerLoop, distanceRatio);
      const timeSinceStart = (ticker.lastTime + timeShift) % timePerLoop;
      const t = timeSinceStart / timePerLoop;

      let motionFn: (t: number) => number;
      switch (model.animationType) {
        case "linear-in":
          motionFn = linearIn;
          break;
        case "linear-out":
          motionFn = linearOut;
          break;
        case "soft":
          motionFn = soft;
          break;
      }

      const motion = motionFn(t); // 0..1
      const amplitudeClamped = lerp(model.amplitude, 1, motion);

      position.radius = position.radius * amplitudeClamped;
    }
  }

  // 3. create high res polygon using GPGPU
  /* @ts-expect-error */
  const buffer = new Buffer({
    alloc: bbHeight * bbWidth,
    type: UINT8,
    width: bbWidth,
    height: bbHeight,
  });

  const kernel = new Kernel(
    {
      output: { outputDistance: buffer },
    },
    KernelSource
  );

  // Layout std140 aligns all structs, like uniform buffers, on the gpu to 16 bytes, so we need to pad the array to 16 bytes length
  const asPaddedVec4 = ({ center, radius }: Shape): number[] => [...center, radius, 0];
  const paddedShapes = [...outerShapesDissolved.map(asPaddedVec4), ...starsAnimated.flat(1).map(asPaddedVec4)];
  kernel.exec(
    {
      points_len: paddedShapes.length,
      offsetX,
      offsetY,
    },
    new Float32Array(paddedShapes.flat())
  );
  kernel.delete();

  const generateContour = contours()
    .size([bbWidth, bbHeight])
    .thresholds([threshold * 100]); // threshold is scaled because we use 0-100 values in the shader
  const [sharpPolygons] = generateContour(buffer.data);
  const polygonsHighRes = sharpPolygons.coordinates.map(([coords]) =>
    coords.map(([x, y]) => [x + offsetX, y + offsetY] as [number, number])
  );

  // 4. add spikes to polygons
  let starShapedPolygons: Array<Array<[number, number]>> | undefined;
  if (model.starShapeParams.outerOffsetRatio > 0) {
    starShapedPolygons = [];
    for (const contourComplex of polygonsHighRes) {
      const points = polygon2starshape(
        contourComplex.reverse(), // reverse because the star shape is drawn ccw
        model.starShapeParams.outerOffsetRatio,
        model.starShapeParams.roundness,
        model.starShapeParams.wingWidth,
        model.dissolve
      );

      if (points.length < 40) {
        starShapedPolygons.push(points);
        continue;
      }

      const scalingFactor = 1e8;
      const starShapeScaled = simplify(
        points.map(([x, y]) => ({ x, y })),
        1
      );

      for (const p of starShapeScaled) {
        p.x = Math.round(p.x * scalingFactor);
        p.y = Math.round(p.y * scalingFactor);
      }

      const starShapesSimplified =
        clipper
          ?.simplifyPolygon(starShapeScaled, clipperLib.PolyFillType.NonZero)
          .filter((polygon) => polygon.length >= 3)
          .map((polygon) => polygon.map((p) => [p.x / scalingFactor, p.y / scalingFactor] as [number, number]))
          .map((polygon) =>
            simplify(
              polygon.map(([x, y]) => ({ x, y })),
              0.5
            ).map(({ x, y }) => [x, y] as [number, number])
          ) ?? [];

      starShapedPolygons.push(...starShapesSimplified);
    }
  }

  // 5. UPDATE UNIFORMS
  ubo.uniforms.points = Float32Array.from(paddedShapes.flat());
  ubo.update();

  shader.uniforms.points_len = paddedShapes.length;
  shader.uniforms.innerColorStart = model.coloringParams.innerColorStart;
  shader.uniforms.alphaFallOutEnd = model.coloringParams.alphaFallOutEnd;
  shader.uniforms.outerColorHSL = model.coloringParams.outerColorHSL;
  shader.uniforms.innerColorHSL = model.coloringParams.innerColorHSL;
  shader.uniforms.threshold = threshold;
  shader.uniforms.outerOffsetRatio = model.starShapeParams.outerOffsetRatio;

  // 5. Render
  const meshesContainer = new Container();
  meshesContainer.zIndex = 1;

  if (polygonsHighRes.length > 0) {
    const graphics = new Graphics();
    graphics.beginFill(0xff0000, 1);

    const polygons = starShapedPolygons ?? polygonsHighRes;
    polygons.forEach((arr) => {
      graphics.drawPolygon(arr.flat());
    });

    const filter = gradientShaderFrom(shader.uniforms);
    filter.resolution = RESOLUTION;
    graphics.filters = [filter];
    graphics.endFill();
    meshesContainer.addChild(graphics);
  }

  if (staleMeshes) {
    scene.removeChild(staleMeshes);
    staleMeshes.destroy({
      children: true,
      texture: true,
      baseTexture: true,
    });
  }

  if (model.dissolve === 0) {
    for (let i = 0; i < model.shapeParams.painShapes.length; i++) {
      const painShape = model.shapeParams.painShapes[i];
      const circle = new Graphics();
      circle.beginFill(0xffffff, 0.00001);
      circle.drawCircle(painShape.position.x, painShape.position.y, painShape.radius);
      circle.endFill();
      circle.interactive = true;
      circle.buttonMode = true;
      // @ts-expect-error
      circle.painShape = painShape;
      type ExtendedGraphics = Graphics & { dragging: boolean; painShape: PainShape };
      circle.on("pointerdown", function (this: ExtendedGraphics, event: InteractionEvent) {
        event.stopPropagation();
        this.painShape.dragging = true;
        this.position.x = event.data.global.x;
        this.position.y = event.data.global.y;
        this.painShape.position.x = this.position.x;
        this.painShape.position.y = this.position.y;
      });
      circle.on("pointerup", function (this: ExtendedGraphics, event: InteractionEvent) {
        if (this.painShape.dragging) {
          this.painShape.dragging = false;
          this.position.x = event.data.global.x;
          this.position.y = event.data.global.y;
          this.painShape.position.x = this.position.x;
          this.painShape.position.y = this.position.y;
        }
      });
      circle.on("pointermove", function (this: ExtendedGraphics, event: InteractionEvent) {
        if (this.painShape.dragging) {
          event.stopPropagation();
          this.position.x = event.data.global.x;
          this.position.y = event.data.global.y;
          this.painShape.position.x = this.position.x;
          this.painShape.position.y = this.position.y;
        }
      });
      meshesContainer.addChild(circle);
    }
  }

  scene.addChild(meshesContainer);
  staleMeshes = meshesContainer;

  renderer.render(scene);
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
init();
