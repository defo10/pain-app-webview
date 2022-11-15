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
  filters,
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
import { AnimationBuilder } from "./animation_builder";
import "./components/painshapes";
import "./components/areapicker";
import { PainShapes } from "./components/painshapes";
import { AreaPicker } from "./components/areapicker";

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

const canvas: HTMLElement | null = document.getElementById("circleContentContainer");
if (!canvas) throw new Error("no canvas!");
const canvasWidth = canvas.clientWidth * DOWNSCALE_FACTOR;
const canvasHeight = canvas.clientHeight * DOWNSCALE_FACTOR;

const renderer = autoDetectRenderer({
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  resolution: RESOLUTION,
  backgroundColor: 0xf3f3f3,
  antialias: false,
  useContextAlpha: false,
  autoDensity: true,
  width: canvasWidth,
  height: canvasHeight,
});

let ticker: Ticker | undefined;
// async inits
const clipperPromise = clipperLib.loadNativeClipperLibInstanceAsync(
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
);
Assets.addBundle("body", {
  wholeFront: "./assets/whole/front.png",
  wholeBack: "./assets/whole/back.png",
  wholeLeft: "./assets/whole/left.png",
  wholeRight: "./assets/whole/right.png",
  partsArmsLeft: "./assets/parts/arms/arm-left.png",
  partsArmsRight: "./assets/parts/arms/arm-right.png",
  partsArmsHandLeft: "./assets/parts/arms/hand-left.png",
  partsArmsHandRight: "./assets/parts/arms/hand-right.png",
  partsHeadBack: "./assets/parts/head/head-back.png",
  partsHeadFront: "./assets/parts/head/head-front.png",
  partsHeadLeft: "./assets/parts/head/head-left.png",
  partsHeadRight: "./assets/parts/head/head-right.png",
  partsLegsFront: "./assets/parts/legs/legs-front.png",
  partsLegsBack: "./assets/parts/legs/legs-back.png",
  partsLegsFootLeft: "./assets/parts/legs/foot-left.png",
  partsLegsFootRight: "./assets/parts/legs/foot-right.png",
  partsLowerBack: "./assets/parts/lower/back.png",
  partsLowerFront: "./assets/parts/lower/front.png",
  partsUpperBack: "./assets/parts/upper/back.png",
  partsUpperFront: "./assets/parts/upper/front.png",
  partsUpperLeft: "./assets/parts/upper/left.png",
  partsUpperRight: "./assets/parts/upper/right.png",
  leer: "./assets/leer.png",
});
const assetsPromise = Assets.loadBundle("body");

let joystick: any | undefined;

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

const animationParameterToFlag = (param: string): number => {
  switch (param) {
    case "innerColorStart":
      return 0;
    case "alphaFallOutEnd":
      return 1;
    default:
      return -1;
  }
};

const motionFnToFlag = (param: string): number => {
  switch (param) {
    case "soft":
      return 0;
    case "linear-in":
      return 1;
    case "linear-out":
      return 2;
    default: // off
      return -1;
  }
};

const updatedModel = (oldModel?: Model): Model => {
  let painShapes = oldModel ? oldModel.painShapes : [];
  const painShapesElement = document.querySelector("pain-shapes") as PainShapes;
  const items = painShapesElement.items;

  // we update shapes while maintaining the object identity because the drag handlers are linked to them
  const newOnes = items.filter(({ id }) => !painShapes.some((ps) => ps.id === id));
  // remove stale
  painShapes = painShapes.filter((ps) => items.some(({ id }) => ps.id === id));
  // add new
  painShapes = [
    ...painShapes,
    ...newOnes.map(
      ({ id, radius }) => new PainShape(id, new Point(120 + Math.random() * 100, 90 + Math.random() * 100), radius)
    ),
  ];
  // update radii
  painShapes.forEach((p) => {
    const newRadius = items.find(({ id }) => id === p.id)?.radius;
    if (!newRadius) console.log("Radius not set?");
    p.radius = newRadius ?? 0;
    // position is updated automatically by the drag handler
  });

  return {
    considerConnectedLowerBound: 0.75,
    gravitationForceVisibleLowerBound: 0.5,
    painShapes,
    closeness: 0.5,
    dissolve: valueFromSlider("dissolve"),
    innerColorStart: valueFromSlider("colorShift"),
    alphaFallOutEnd: 1 - valueFromSlider("alphaRatio"),
    innerColorHSL: innerColorPicker(checkedRadioBtn("innerColor"), valueFromSlider("lightness")),
    outerColorHSL:
      outerColorPicker(checkedRadioBtn("outerColor")) ??
      innerColorPicker(checkedRadioBtn("innerColor"), valueFromSlider("lightness")),
    outerOffsetRatio: valueFromSlider("outerOffsetRatio"),
    roundness: valueFromSlider("roundness"),
    wings: valueFromSlider("wings"),
    animationType: checkedRadioBtn("animation-curve") as "off" | "linear-in" | "linear-out" | "soft", // 0: off, 1: linear-in, 2: linear-out, 3: soft
    frequencyHz: valueFromSlider("frequencyHz"),
    amplitude: 1 - valueFromSlider("amplitude"),
    origin: cardinalDirectionToBBPoint(joystick?.GetDir() ?? "C"),
    animationParamter: checkedRadioBtn("animation-parameter") as
      | "radius"
      | "dissolve"
      | "innerColorStart"
      | "alphaFallOutEnd"
      | "outerOffsetRatio"
      | "roundness",
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
  animationOrigin: Float32Array.from([]),
  timePerLoop: 0,
  timeSinceStart: 0,
  maxDistanceToOrigin: 0,
  amplitude: 0,
  animationParameterFlag: animationParameterToFlag(model.animationParamter),
  motionFnFlag: motionFnToFlag(model.animationType),
});

const scene = new Container();
let staleMeshes: Container;
let stars: Position[][] = [];
let clipper: clipperLib.ClipperLibWrapper | undefined;

const init = async (assetLocation: string): Promise<void> => {
  const [clipperResolved, assetsResolved]: [clipperLib.ClipperLibWrapper, { [key: string]: Texture }] =
    await Promise.all([clipperPromise, assetsPromise]);
  clipper = clipperResolved;

  // add bg image
  const backgroundImage = new Sprite(assetsResolved[assetLocation]);

  const xToFitRatio = canvasWidth / backgroundImage.width;
  const yToFitRatio = canvasHeight / backgroundImage.height;
  const scaleToContainRatio = Math.min(xToFitRatio, yToFitRatio);
  backgroundImage.scale.x = backgroundImage.scale.y = scaleToContainRatio;

  backgroundImage.interactive = false;
  backgroundImage.interactiveChildren = false;

  scene.removeChildren();
  scene.addChild(backgroundImage);

  if (ticker) ticker.destroy();
  ticker = Ticker.system;
  ticker.maxFPS = 60;
  ticker.add(animate);
};

const animate = (time: number): void => {
  if ((document.getElementById("toggle-animation-parameters") as HTMLElement).style.display !== "none" && !joystick) {
    joystick = new JoyStick("joyDiv", {
      internalFillColor: "#616161",
      internalStrokeColor: "#616161",
      externalStrokeColor: "#616161",
      autoReturnToCenter: false,
    });
  }

  model = updatedModel(model);

  const padding = (_.maxBy(model.painShapes, (ps) => ps.radius)?.radius ?? 1) * 1.3;
  const bb = {
    minX: Math.max(0, (_.minBy(model.painShapes, (ps) => ps.position.x)?.position.x ?? 0) - padding),
    minY: Math.max(0, (_.minBy(model.painShapes, (ps) => ps.position.y)?.position.y ?? 0) - padding),
    maxX: (_.maxBy(model.painShapes, (ps) => ps.position.x)?.position.x ?? 0) + padding,
    maxY: (_.maxBy(model.painShapes, (ps) => ps.position.y)?.position.y ?? 0) + padding,
  };

  const offsetX = bb.minX;
  const offsetY = bb.minY;
  const bbWidth = bb.maxX - bb.minX;
  const bbHeight = bb.maxY - bb.minY;

  interface Shape {
    radius: number;
    center: [number, number];
  }
  const outerShapes: Shape[] = model.painShapes.map((p) => ({
    radius: p.radius,
    center: [p.position.x, p.position.y],
  }));
  const threshold = 1 - model.closeness ?? 0.5;

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
        const positions = new RandomSpaceFilling(euclidPolygon, [4, 8]);
        const stars = positions.getPositions(0.2);

        // 125 is the maximum number of coordinates we can pass to the uniform buffer
        // for for Webkit/Safari
        const starsClamped = stars.slice(0, Math.floor(100 / polygonLowRes.length));
        starsPerPolygon.push(starsClamped);
      }

      // save star as global such that is doesnt change during the dissolve
      stars = starsPerPolygon;
    }
  } else stars = []; // make sure stars are cleared at each new position

  // 3. prepare animation builder, apply size and radius animation
  const animationBuilder = new AnimationBuilder(
    model.origin,
    bb,
    model.animationType,
    model.frequencyHz,
    (ticker as Ticker).lastTime,
    model.amplitude
  );

  const outerShapesDissolved = outerShapes.map(({ center, radius }) => ({
    center,
    radius:
      model.animationType !== "off" && model.animationParamter === "dissolve"
        ? radius * (1 - model.dissolve) * animationBuilder.t(center)
        : radius * (1 - model.dissolve),
  }));
  const starsAnimated = _.cloneDeep(stars);

  if (model.animationType !== "off" && model.animationParamter === "radius") {
    for (const position of [...outerShapesDissolved, ...starsAnimated.flat(1)]) {
      position.radius = position.radius * animationBuilder.t(position.center);
    }
  }

  // update animation uniforms for all cases but radius
  shader.uniforms.animationOrigin = Float32Array.from(animationBuilder.origin);
  shader.uniforms.timePerLoop = 1000 / model.frequencyHz;
  shader.uniforms.timeSinceStart = (ticker as Ticker).lastTime % (1000 / model.frequencyHz);
  shader.uniforms.maxDistanceToOrigin = animationBuilder.maxDistanceToOrigin;
  shader.uniforms.amplitude = model.amplitude;
  shader.uniforms.animationParameterFlag = animationParameterToFlag(model.animationParamter);
  shader.uniforms.motionFnFlag = motionFnToFlag(model.animationType);

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
  if (model.outerOffsetRatio > 0) {
    starShapedPolygons = [];
    for (const contourComplex of polygonsHighRes) {
      const center: [number, number] = [
        (contourComplex[0][0] +
          contourComplex[Math.floor(contourComplex.length / 2)][0] +
          contourComplex[contourComplex.length - 1][0]) /
          3,
        (contourComplex[0][1] +
          contourComplex[Math.floor(contourComplex.length / 2)][1] +
          contourComplex[contourComplex.length - 1][1]) /
          3,
      ];
      const points = polygon2starshape(
        contourComplex.reverse(), // .reverse(), // reverse because the star shape is drawn ccw
        model.animationType !== "off" && model.animationParamter === "outerOffsetRatio"
          ? model.outerOffsetRatio * animationBuilder.t(center)
          : model.outerOffsetRatio,
        model.animationType !== "off" && model.animationParamter === "roundness"
          ? model.roundness * animationBuilder.t(center)
          : model.roundness,
        model.wings,
        model.dissolve
      );

      if (points.length < 40) {
        starShapedPolygons.push(points);
        continue;
      }

      const scalingFactor = 1e8;
      const starShapeScaled = simplify(
        points.map(([x, y]) => ({ x, y })),
        0.1
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
  shader.uniforms.innerColorStart = model.innerColorStart;
  shader.uniforms.alphaFallOutEnd = model.alphaFallOutEnd;
  shader.uniforms.outerColorHSL = model.outerColorHSL;
  shader.uniforms.innerColorHSL = model.innerColorHSL;
  shader.uniforms.threshold = threshold;
  shader.uniforms.outerOffsetRatio = model.outerOffsetRatio;

  // 5. Render
  const meshesContainer = new Container();
  meshesContainer.zIndex = 1;

  if (polygonsHighRes.length > 0) {
    const filter = gradientShaderFrom(shader.uniforms);
    filter.resolution = RESOLUTION;

    const polygons = starShapedPolygons ?? polygonsHighRes;
    for (const arr of polygons) {
      const graphics = new Graphics();
      graphics.beginFill(0xff0000, 1);
      graphics.drawPolygon(arr.flat());
      graphics.filters = [filter];

      if (model.outerOffsetRatio > 0) {
        const centerAprx = [arr[0], arr[Math.floor(arr.length / 2)], arr[arr.length - 1]].reduce(
          ([xAcc, yAcc], [x, y]) => [xAcc + x / 3, yAcc + y / 3],
          [0, 0]
        );
        graphics.filters.push(
          new filters.BlurFilter(animationBuilder.t(centerAprx) * model.alphaFallOutEnd ** 2 * 8, 4, RESOLUTION)
        );
      }

      graphics.endFill();
      meshesContainer.addChild(graphics);
    }
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
    for (let i = 0; i < model.painShapes.length; i++) {
      const painShape = model.painShapes[i];
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
init("leer");

const areaPicker = document.querySelector("area-picker") as AreaPicker;
areaPicker?.addEventListener("area-chosen", (e) => {
  const assetLocation = areaPicker.assetLocation as string;
  init(assetLocation);
});
