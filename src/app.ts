/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import _, { mixin } from "lodash";
import { PainShape } from "./pain_shape";
import * as clipperLib from "js-angusj-clipper";
import * as gl from "gl-matrix";
import {
  autoDetectRenderer,
  Container,
  ENV,
  Graphics,
  Mesh,
  MIPMAP_MODES,
  Point,
  PRECISION,
  settings,
  Sprite,
  Texture,
  UniformGroup,
  Geometry,
  DRAW_MODES,
  Ticker,
  RenderTexture,
  Framebuffer,
  Rectangle,
} from "pixi.js";
import "@pixi/math-extras";
import { Assets } from "@pixi/assets";
import { valueFromSlider, innerColorPicker, checkedRadioBtn, outerColorPicker } from "./ui";
import { Model } from "./model";
import { gradientShaderFrom, starShaderFrom } from "./filters/GradientShader";
import { polygon2starshape, starshape } from "./polygon/polygons";
import { Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";
import { clamp, dist, lerpPoints, minimumDistancePointOnLine } from "./polygon/utils";
import { Position, RandomSpaceFilling } from "./polygon/space_filling";
import { isoLines } from "marchingsquares";
import { CurveInterpolator } from "curve-interpolator";
import { contours } from "d3-contour";
import { debug } from "./debug";
import { Buffer, Kernel, UINT8 } from "./blink";
import KernelSource from "./filters/kernelsource.frag";
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

const updatedModel = (oldModel?: Model): Model => {
  const painShapes = oldModel?.shapeParams.painShapes.map((p, i) => {
    const painShape = new PainShape(p.position, valueFromSlider(`radius${i + 1}`));
    return painShape;
  }) ?? [
    new PainShape(new Point(120, 90), valueFromSlider("radius1")),
    new PainShape(new Point(170, 120), valueFromSlider("radius2")),
    new PainShape(new Point(140, 200), valueFromSlider("radius3")),
  ];
  return {
    shapeParams: {
      considerConnectedLowerBound: 0.75,
      gravitationForceVisibleLowerBound: 0.5,
      painShapes,
      painShapesDragging: oldModel?.shapeParams.painShapesDragging ?? [false, false, false],
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
      wingWidth: valueFromSlider("wingLength"),
    },
    animationType: parseInt(checkedRadioBtn("animation-curve")) as 0 | 1 | 2 | 3, // 0: off, 1: linear-in, 2: linear-out, 3: soft
    frequencyHz: valueFromSlider("frequencyHz"),
    amplitude: 0.7,
    origin: [0, 0],
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
scene.sortableChildren = true;
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

  const padding = 30;
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

  /// 1. create low res polygon of outer shape
  interface Shape {
    radius: number;
    center: [number, number];
  }
  const outerShapes: Shape[] = model.shapeParams.painShapes.map((p) => ({
    radius: p.radius,
    center: [p.position.x, p.position.y],
  }));

  const sampleRate = 10;
  const threshold = 1 - model.shapeParams.closeness ?? 0.5;
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
  for (let m = bb.minY, k = 0; m < bb.maxY; m = m + sampleRate) {
    for (let n = bb.minX; n < bb.maxX; n = n + sampleRate, k++) {
      const distances = outerShapes.map(({ radius, center }) => {
        const d = dist(center, [n + sampleRate * 0.5, m + sampleRate * 0.5]);
        return falloff(d, radius);
      });
      distMatrix[k] = distances.reduce((acc, curr) => acc + curr, 0);
    }
  }

  const calcContour = contours().size([projectedWidth, projectedHeight]).thresholds([threshold]);
  const [polygonsNew] = calcContour(distMatrix);
  const polygonLowRes = polygonsNew.coordinates.map(([coords]) =>
    coords.map(([x, y]) => [x * sampleRate + bb.minX, y * sampleRate + bb.minY] as [number, number])
  );

  // 2. fill out with stars if needed
  if (model.dissolve > 0) {
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
  }
  if (model.dissolve === 0) stars = [];

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

  // TODO RATHER USE FOUR VECTOR WITH ONE PADDED
  // Layout std140 aligns all values on the gpu to 16 bytes, so we need to pad the array to 16 bytes length
  const asPaddedVec4 = ({ center, radius }: Shape): number[] => [...center, radius, 0];
  const outerShapesDissolved = outerShapes.map(({ center, radius }) => ({
    center,
    radius: radius * (1 - model.dissolve),
  }));
  const paddedShapes = [...outerShapesDissolved.map(asPaddedVec4), ...stars.flat(1).map(asPaddedVec4)];
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
  const wingLength = (): number => {
    return lerp(0, 20, model.starShapeParams.outerOffsetRatio);
  };

  let starShapedPolygons: Array<Array<[number, number]>> | undefined;
  if (model.starShapeParams.outerOffsetRatio > 0) {
    starShapedPolygons = [];
    for (const contourComplex of polygonsHighRes) {
      // simplified polygon leads to softer edges because the angles are lower
      const interpolator = new CurveInterpolator(contourComplex, { tension: 0.0 });
      const contourSmooth: Array<[number, number]> = interpolator.getPoints(Math.min(contourComplex.length, 200));
      const contour = contourSmooth;

      const { points } = polygon2starshape(
        contour,
        wingLength(),
        model.starShapeParams.roundness,
        model.starShapeParams.wingWidth
      );

      const scalingFactor = 1e8;
      const starShapeScaled = points.map(([x, y]) => ({
        x: Math.round(x * scalingFactor),
        y: Math.round(y * scalingFactor),
      }));
      const starShapesSimplified =
        clipper
          ?.simplifyPolygon(starShapeScaled, clipperLib.PolyFillType.NonZero)
          .filter((polygon) => polygon.length >= 3)
          .map((polygon) => polygon.map((p) => [p.x / scalingFactor, p.y / scalingFactor] as [number, number])) ?? [];

      starShapedPolygons.push(...starShapesSimplified);
    }
  }

  /*
  // only show underlying star shapes if overlying polygon was shrunk
  // otherwise this leads to random flicker of the underlying star shapes
  // around the edges
  if (model.dissolve > 0) {
    const uStar = starshape(
      new Point(0, 0),
      10,
      valueFromSlider("outerOffsetRatio"),
      valueFromSlider("roundness"),
      valueFromSlider("wingLength")
    );

    const polygon = new EuclidPolygon(...uStar.map(([x, y]) => new EuclidPoint(x, y)));
    const centroid = polygon.centroid;
    const uGeom = new Geometry()
      .addAttribute("aVertexPosition", [centroid.x, centroid.y, ...uStar.flat()], 2)
      .addAttribute("aDistance", [1.0, ...uStar.flat().map((_) => 0)], 1);
    const geometry = uGeom;
    const mesh = new Mesh(geometry, starShader, undefined, DRAW_MODES.TRIANGLE_FAN);
    const renderTexture = renderer.generateTexture(mesh);

    const asString = (arr: [number, number]): string => `${arr[0]},${arr[1]}`;
    const fromString = (str: string): [number, number] => str.split(",").map(parseFloat) as [number, number];
    const nearestNeighbors = new Map<string, string>();
    const samplePointsComplex = geometryVM.skeletonGraph.flatMap(
      (conn) => [conn.from.position, conn.to.position] as [Point, Point]
    );
    const samplePoints = simplify(samplePointsComplex, 1.0).map((p) => new Point(p.x, p.y));
    for (const position of geometryVM.stars.flat()) {
      const shortestDistance = _.minBy(
        geometryVM.skeletonGraph.map((conn) =>
          minimumDistancePointOnLine(conn.from.position, conn.to.position, new Point(...position.center))
        ),
        (data) => data.distance
      );
      if (shortestDistance) {
        nearestNeighbors.set(
          asString(position.center),
          asString([shortestDistance?.projection.x, shortestDistance?.projection.y])
        );
      }
    }

    for (const pos of geometryVM.stars.flat()) {
      const timePerIteration = 1000 / model.frequencyHz;
      const timeSinceStart = ticker.lastTime % timePerIteration;
      const timeRatio = timeSinceStart / timePerIteration;
      const amplitude = model.amplitude;

      const linearMidDrop = (t: number): number => {
        if (t < 0.5) return lerp(0, 1, t * 2);
        return lerp(1, 0, (t - 0.5) * 2);
      };

      const origin = model.origin;
      const distanceToOrigin = Math.sqrt((pos.center[0] - origin[0]) ** 2 + (pos.center[1] - origin[1]) ** 2);
      const maxDistanceToOrigin = 300;
      const scalingFactor = smoothstep(0, 1, distanceToOrigin / maxDistanceToOrigin);

      const sprite = new Sprite(renderTexture);
      sprite.anchor.set(0.5);
      
      const t = clamp(model.dissolve * 2, 0.0, 1.0);
      const nearestNeighbor = nearestNeighbors.get(asString(pos.center)) ?? "";
      const fromPosition = fromString(nearestNeighbor); // lerpPoints(fromString(nearestNeighborNeighbor), fromString(nearestNeighbor), t);
      const toPosition: [number, number] = pos.center;
      sprite.position.set(...lerpPoints(fromPosition, toPosition, t));
      sprite.scale.set((pos.radius / 10) * lerp(model.amplitude, 1, linearMidDrop(timeRatio)));
      meshesContainer.addChild(sprite);
    }
  }
  */

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
  scene.addChild(meshesContainer);
  staleMeshes = meshesContainer;

  if (model.dissolve === 0) {
    for (let i = 0; i < model.shapeParams.painShapes.length; i++) {
      const painShape = model.shapeParams.painShapes[i];
      const circle = new Graphics();
      circle.zIndex = 9000;
      circle.beginFill(0xffffff, 0.00001);
      circle.drawCircle(painShape.position.x, painShape.position.y, painShape.radius);
      circle.endFill();
      circle.interactive = true;
      circle.buttonMode = true;
      circle.on("pointerdown", (e) => {
        model.shapeParams.painShapesDragging[i] = true;
      });
      circle.on("pointermove", (e) => {
        if (model.shapeParams.painShapesDragging[i]) {
          painShape.position.x = e.data.global.x;
          painShape.position.y = e.data.global.y;
        }
      });
      circle.on("pointerup", (e) => {
        model.shapeParams.painShapesDragging[i] = false;
        painShape.position.x = e.data.global.x;
        painShape.position.y = e.data.global.y;
      });
      meshesContainer.addChild(circle);
    }
  }

  renderer.render(scene);
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
init();
