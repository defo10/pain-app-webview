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
} from "pixi.js";
import "@pixi/math-extras";
import { Assets } from "@pixi/assets";
import { valueFromSlider, innerColorPicker, checkedRadioBtn, outerColorPicker } from "./ui";
import { GeometryViewModel } from "./viewmodel";
import { Model } from "./model";
import { gradientShaderFrom, starShaderFrom } from "./filters/GradientShader";
import { polygon2starshape, starshape } from "./polygon/polygons";
import { Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";
import { clamp, dist, lerpPoints, minimumDistancePointOnLine } from "./polygon/utils";
import { Position, RandomSpaceFilling } from "./polygon/space_filling";
import simplify from "simplify-js";
import { isoLines } from "marchingsquares";
import { debug, debugPolygon } from "./debug";
import { CurveInterpolator } from "curve-interpolator";
import mcf from "marching-cubes-fast";
import offsetPolygon from "offset-polygon";
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

const getRanges = (arr: number[][]): number[] => {
  const ranges: number[] = [];
  for (const sub of arr) {
    if (ranges.length === 0) {
      ranges.push(0, Math.floor(sub.length / 2));
      continue;
    }
    const last = ranges[ranges.length - 1];
    // order of execution in math formula matters because last was already divided by!
    ranges.push(last, Math.floor(last + sub.length / 2));
  }
  return ranges;
};

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
      wingLength: valueFromSlider("wingLength"),
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
let outerPolygons: Array<Array<[number, number]>> | undefined;
let stars: Position[][] | undefined;

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
  const oldModel = model;
  model = updatedModel(model);

  const meshesContainer = new Container();
  meshesContainer.zIndex = 1;

  const sampleRate = 12;
  const projectedHeight = Math.round(renderer.height / sampleRate);
  const projectedWidth = Math.round(renderer.width / sampleRate);
  const threshold = 1 - model.shapeParams.closeness ?? 0.5;

  const distanceMatrix: number[][] = _.range(0, projectedHeight).map((i) => _.range(0, projectedWidth));

  // src: https://link.springer.com/content/pdf/10.1007/BF01900346.pdf
  const falloff = (d: number, radius: number): number => {
    // TODO if using squared distance, do exponent / 2
    const R = radius * 2;
    if (d >= R) return 0;
    const first = -0.44444 * (d ** 6 / R ** 6);
    const second = 1.88889 * (d ** 4 / R ** 4);
    const third = -2.44444 * (d ** 2 / R ** 2);
    return first + second + third + 1;
  };

  const calcSDF = (distanceMatrix: number[][], shapes: Shape[]): void => {
    for (let row = 0; row < distanceMatrix.length; row++) {
      for (let col = 0; col < distanceMatrix[row].length; col++) {
        const distances = shapes.map(({ radius, position }) => {
          const d = dist(position, [col * sampleRate, row * sampleRate]);
          return falloff(d, radius);
        });
        distanceMatrix[row][col] = distances.reduce((acc, curr) => acc + curr, 0);
      }
    }
  };

  interface Shape {
    radius: number;
    position: [number, number];
  }
  const shapes: Shape[] = model.shapeParams.painShapes.map((p) => ({
    radius: p.radius * (1 - model.dissolve),
    position: [p.position.x, p.position.y],
  }));

  if (model.dissolve === 0 && outerPolygons) {
    const starsPerPolygon: Position[][] = [];
    for (const polygon of outerPolygons) {
      const euclidPolygon = new EuclidPolygon(...polygon.map(([x, y]) => new EuclidPoint(x, y)));
      const positions = new RandomSpaceFilling(euclidPolygon, [3, 5]);
      const stars = positions.getPositions(0.2);
      starsPerPolygon.push(stars);
    }

    stars = starsPerPolygon;
  } else {
    const starsShapes =
      stars?.map((stars) => stars.map(({ center, radius }): Shape => ({ radius, position: center })))?.flat(2) ?? [];
    shapes.push(...starsShapes);
  }

  // save the the outer polygon shape to fill it later with stars
  calcSDF(distanceMatrix, shapes);
  const polygonsMinified: Array<Array<[number, number]>> = isoLines(distanceMatrix, threshold, { noFrame: true });
  let polygons = polygonsMinified.map((polygon) =>
    polygon.map(([x, y]) => [x * sampleRate, y * sampleRate] as [number, number])
  );

  if (model.dissolve === 0) {
    outerPolygons = polygons;
  }

  const starShapedPolygonOffset = (): number => {
    return lerp(0, 20, model.starShapeParams.outerOffsetRatio);
  };

  if (model.starShapeParams.outerOffsetRatio !== 0) {
    const starShapedPolygons = [];
    for (const contourComplex of polygons) {
      const contourSimple = contourComplex; // simplify(contourComplex.map(([x, y]) => ({ x, y }))).map(({ x, y }) => [x, y]);
      // simplified polygon leads to softer edges because there are fewer point constraints
      const interpolator = new CurveInterpolator(contourSimple, { tension: 0.0 });
      const contourSmooth: Array<[number, number]> = interpolator.getPoints(Math.min(contourComplex.length, 200));
      const contour = contourSmooth;

      const { points } = polygon2starshape(
        contour,
        starShapedPolygonOffset(),
        model.starShapeParams.roundness,
        model.starShapeParams.wingLength
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
    polygons = starShapedPolygons;
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

  /// ///// UPDATE UNIFORMS
  const points = shapes.flatMap(({ position }) => position);
  const radii = shapes.map(({ radius }) => radius);
  const shapeHasChanged = !(_.isEqual(points, ubo.uniforms.points) && _.isEqual(radii, ubo.uniforms.radii));
  if (shapeHasChanged) {
    ubo.uniforms.points = Float32Array.from(points);
    ubo.uniforms.radii = Float32Array.from(radii);
    shader.uniforms.points_len = radii.length;
    ubo.update();
  }

  if (shader.uniforms.innerColorStart !== model.coloringParams.innerColorStart)
    shader.uniforms.innerColorStart = model.coloringParams.innerColorStart;

  if (shader.uniforms.alphaFallOutEnd !== model.coloringParams.alphaFallOutEnd)
    shader.uniforms.alphaFallOutEnd = model.coloringParams.alphaFallOutEnd;

  if (!_.isEqual(shader.uniforms.outerColorHSL, model.coloringParams.outerColorHSL))
    shader.uniforms.outerColorHSL = model.coloringParams.outerColorHSL;

  if (!_.isEqual(shader.uniforms.innerColorHSL, model.coloringParams.innerColorHSL))
    shader.uniforms.innerColorHSL = model.coloringParams.innerColorHSL;

  shader.uniforms.threshold = threshold;
  shader.uniforms.outerOffsetRatio = model.starShapeParams.outerOffsetRatio;

  /// /// RENDER
  if (polygons.length > 0) {
    const graphics = new Graphics();
    graphics.beginFill(0xff0000, 1);

    polygons.forEach((arr) => {
      const interpolator = new CurveInterpolator(arr, { tension: 0.0 });
      const contourSmooth: Array<[number, number]> = arr.length < 10 ? interpolator.getPoints(20) : arr;
      graphics.drawPolygon(contourSmooth.flat());
    });

    stars?.flat().forEach((star) => {
      graphics.drawCircle(...star.center, star.radius);
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
