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
import { starshape } from "./polygon/polygons";
import { Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";

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
  width: document.getElementById("animations-canvas")?.clientWidth,
  height: document.getElementById("animations-canvas")?.clientHeight,
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
    amplitude: 0,
  };
};

let model: Model = updatedModel();
let geometryVM: undefined | GeometryViewModel;
const ubo = UniformGroup.uboFrom({
  paths: Float32Array.from([]),
});
const shader = gradientShaderFrom({
  gradientLength: 0,
  innerColorStart: 0,
  alphaFallOutEnd: 0,
  outerColorHSL: [0, 0, 0],
  innerColorHSL: [0, 0, 0],
  paths_ubo: ubo,
  ranges: new Int16Array([0, 1]),
  rangesLen: 1,
});

const starShader = starShaderFrom({
  innerColorStart: 0,
  alphaFallOutEnd: 0,
  outerColorHSL: [0, 0, 0],
  innerColorHSL: [0, 0, 0],
});

const scene = new Container();
let staleMeshes: Container;
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
  scene.addChild(backgroundImage);

  ticker.add(animate);
};

const animate = (time: number): void => {
  model = updatedModel(model);

  if (geometryVM) {
    geometryVM.updateModel(model);
  } else {
    geometryVM = new GeometryViewModel(model, clipper!);
  }

  if (geometryVM.wasUpdated) {
    const polygonsOuterHulls = geometryVM.hullPolygons;
    const ranges = getRanges(polygonsOuterHulls.map((arr) => arr.flat())).flat();
    ubo.uniforms.paths = Float32Array.from(polygonsOuterHulls.flat(2));
    ubo.update();

    shader.uniforms.ranges = new Int32Array(ranges);
    shader.uniforms.rangesLen = Math.floor(ranges.length / 2);
  }

  const gradientLength = (_.max(model.shapeParams.painShapes.map((p) => p.radius)) ?? 0) * 1;
  if (shader.uniforms.gradientLength !== gradientLength) shader.uniforms.gradientLength = gradientLength;

  if (shader.uniforms.innerColorStart !== model.coloringParams.innerColorStart)
    shader.uniforms.innerColorStart = model.coloringParams.innerColorStart;

  if (shader.uniforms.alphaFallOutEnd !== model.coloringParams.alphaFallOutEnd)
    shader.uniforms.alphaFallOutEnd = model.coloringParams.alphaFallOutEnd;

  if (!_.isEqual(shader.uniforms.outerColorHSL, model.coloringParams.outerColorHSL))
    shader.uniforms.outerColorHSL = model.coloringParams.outerColorHSL;

  if (!_.isEqual(shader.uniforms.innerColorHSL, model.coloringParams.innerColorHSL))
    shader.uniforms.innerColorHSL = model.coloringParams.innerColorHSL;

  const meshesContainer = new Container();
  // test star shape
  starShader.uniforms.innerColorStart = model.coloringParams.innerColorStart;
  starShader.uniforms.alphaFallOutEnd = model.coloringParams.alphaFallOutEnd;
  starShader.uniforms.outerColorHSL = model.coloringParams.outerColorHSL;
  starShader.uniforms.innerColorHSL = model.coloringParams.innerColorHSL;

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

    for (const pos of geometryVM.stars.flat()) {
      const sprite = new Sprite(renderTexture);
      sprite.anchor.set(0.5);
      sprite.position.set(...pos.center);
      sprite.scale.set(pos.radius / 10);
      meshesContainer.addChild(sprite);
    }
  }

  if (geometryVM.polygons.length > 0) {
    const graphics = new Graphics();
    graphics.beginFill(0xffffff, 1);
    geometryVM.polygons.forEach((arr) => graphics.drawPolygon(arr.flat()));
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
        painShape.position.x = e.data.global.x;
        painShape.position.y = e.data.global.y;
        model.shapeParams.painShapesDragging[i] = false;
      });
      meshesContainer.addChild(circle);
    }
  }

  renderer.render(scene);
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
init();
