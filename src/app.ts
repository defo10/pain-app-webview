/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import _ from "lodash";
import { PainShape } from "./pain_shape";
import * as clipperLib from "js-angusj-clipper";
import * as gl from "gl-matrix";
import {
  autoDetectRenderer,
  Container,
  ENV,
  generateUniformBufferSync,
  Graphics,
  Mesh,
  MIPMAP_MODES,
  Point,
  PRECISION,
  RenderTexture,
  settings,
  Buffer,
  Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";
import { metaballsPaths } from "./polygon";
import simplify from "simplify-js";
import "@pixi/math-extras";
import { Assets } from "@pixi/assets";
import { valueFromSlider, innerColorPicker, checkedRadioBtn, outerColorPicker } from "./ui";
import { GeometryViewModel } from "./viewmodel";
import { Model } from "./model";
import { gradientShaderFrom } from "./filters/GradientShader";
import { simplify2d } from "curve-interpolator";
import { SimplePolygon } from "./polygon/polygons";

// gl matrix uses float 32 types by default, but array is much faster.
gl.glMatrix.setMatrixArrayType(Array);

const RESOLUTION = window.devicePixelRatio;

settings.PREFER_ENV = ENV.WEBGL2;
settings.MIPMAP_TEXTURES = MIPMAP_MODES.OFF; // no zooming so no advantage
const DOWNSCALE_FACTOR = 1.0;
settings.PRECISION_FRAGMENT = PRECISION.LOW;
settings.PRECISION_VERTEX = PRECISION.LOW;
settings.TARGET_FPMS = 60;

const renderer = autoDetectRenderer({
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  resolution: RESOLUTION,
  backgroundColor: 0xffffff,
});

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
  };
};

let model: Model = updatedModel();
let geometry: undefined | GeometryViewModel;
const ubo = UniformGroup.uboFrom({
  paths: [],
});
const shader = gradientShaderFrom({
  backgroundTexture: null,
  // width is the css pixel width after the backgroundImage was already scaled to fit bounds of canvas
  // which is multiplied by the resolution to account for hidpi
  textureBounds: null,
  rendererBounds: null,
  gradientLength: 0,
  innerColorStart: 0,
  alphaFallOutEnd: 0,
  outerColorHSL: [0, 0, 0],
  innerColorHSL: [0, 0, 0],
  paths_ubo: ubo,
  ranges: new Int16Array([0, 1]),
  rangesLen: 1,
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

  shader.uniforms.backgroundTexture = RenderTexture.from(backgroundImage.texture.baseTexture);
  // width is the css pixel width after the backgroundImage was already scaled to fit bounds of canvas
  // which is multiplied by the resolution to account for hidpi
  shader.uniforms.textureBounds = new Float32Array([
    backgroundImage.width * RESOLUTION,
    backgroundImage.height * RESOLUTION,
  ]);
  shader.uniforms.rendererBounds = new Float32Array([renderer.width, renderer.height]);

  animate(performance.now());
};

const animate = (time: number): void => {
  model = updatedModel(model);

  if (geometry) {
    geometry.updateModel(model.shapeParams, model.dissolve);
  } else {
    geometry = new GeometryViewModel(model.shapeParams, model.dissolve, clipper!);
  }

  if (geometry.wasUpdated) {
    const polygons = geometry.polygons;
    const simplePolygon = polygons
      .map((polygon) => polygon.map(([x, y]) => ({ x, y })))
      .map((polygon) => simplify(polygon, 1))
      .map((polygon) => polygon.map(({ x, y }: { x: number; y: number }) => [x, y]));

    const ranges = getRanges(simplePolygon.map((arr) => arr.flat())).flat();
    ubo.uniforms.paths = simplePolygon.flat(2);
    ubo.update();

    shader.uniforms.ranges = new Int16Array(ranges);
    shader.uniforms.rangesLen = Math.floor(ranges.length / 2);
  }

  const gradientLength = _.max(model.shapeParams.painShapes.map((p) => p.radius)) ?? 0 * 2;
  if (shader.uniforms.gradientLength !== gradientLength) shader.uniforms.gradientLength = gradientLength;

  if (shader.uniforms.innerColorStart !== model.coloringParams.innerColorStart)
    shader.uniforms.innerColorStart = model.coloringParams.innerColorStart;

  if (shader.uniforms.alphaFallOutEnd !== model.coloringParams.alphaFallOutEnd)
    shader.uniforms.alphaFallOutEnd = model.coloringParams.alphaFallOutEnd;

  if (!_.isEqual(shader.uniforms.outerColorHSL, model.coloringParams.outerColorHSL))
    shader.uniforms.outerColorHSL = model.coloringParams.outerColorHSL;

  if (!_.isEqual(shader.uniforms.innerColorHSL, model.coloringParams.innerColorHSL))
    shader.uniforms.innerColorHSL = model.coloringParams.innerColorHSL;

  const meshes = new Container();
  geometry.geometry.forEach((geo) => meshes.addChild(new Mesh(geo, shader)));
  if (staleMeshes) {
    scene.removeChild(staleMeshes);
  }
  scene.addChild(meshes);
  staleMeshes = meshes;

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
    meshes.addChild(circle);
  }

  renderer.render(scene);
  requestAnimationFrame(animate);
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
init();
