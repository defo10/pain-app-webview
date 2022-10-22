import _, { countBy } from "lodash";
import { PainShape } from "./pain_shape";
import * as clipperLib from "js-angusj-clipper";
import * as gl from "gl-matrix";
import {
  autoDetectRenderer,
  BLEND_MODES,
  Bounds,
  Container,
  ENV,
  Geometry,
  Graphics,
  Mesh,
  MIPMAP_MODES,
  Point,
  Polygon,
  PRECISION,
  RenderTexture,
  settings,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";
import { metaballsPaths } from "./polygon";

// extending vanilla pixi
import "@pixi/math-extras";
import { GradientFilter } from "./filters/GradientFilter";
import { Assets } from "@pixi/assets";
import * as poly2tri from "poly2tri";
import { gradientShaderFrom } from "./filters/GradientShader";
import SkeletonBuilder, { List, Vector2d } from "straight-skeleton";
import { bounds } from "./polygon/utils";

// gl matrix uses float 32 types by default, but array is much faster.
gl.glMatrix.setMatrixArrayType(Array);

const RESOLUTION = window.devicePixelRatio;

settings.PREFER_ENV = ENV.WEBGL2;
settings.MIPMAP_TEXTURES = MIPMAP_MODES.OFF; // no zooming so no advantage
const DOWNSCALE_FACTOR = 1.0;
settings.PRECISION_FRAGMENT = PRECISION.LOW;
settings.PRECISION_VERTEX = PRECISION.LOW;

const shaderDebug = Shader.from(
  `
    precision mediump float;
    attribute vec2 aVertexPosition;
    attribute vec3 aColor;
    attribute vec3 aGradient;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;

    varying vec3 vColor;
    varying vec3 vGradient;

    void main() {
        vGradient = aGradient;
        vColor = aColor;
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

    }`,
  `precision mediump float;

    varying vec3 vColor;
    varying vec3 vGradient;

    void main() {
        float delta = 0.1;
        if (vGradient.r < delta || vGradient.g < delta || vGradient.b < delta) {
          gl_FragColor = vec4(0., 0., 0., 1.0);
        }
        //gl_FragColor = vec4(vColor, 1.0);
    }

`
);

const renderer = autoDetectRenderer({
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  resolution: RESOLUTION,
  backgroundColor: 0xffffff,
});

settings.MIPMAP_TEXTURES = MIPMAP_MODES.OFF; // no zooming so no advantage
settings.TARGET_FPMS = 60;

const clipper = clipperLib.loadNativeClipperLibInstanceAsync(
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
);

Assets.addBundle("body", { headLeft: "./assets/head.jpg" });
const assets = Assets.loadBundle("body");

const valueFromElement = (id: string): number => parseFloat((document.getElementById(id) as HTMLInputElement).value);
/** returns HSL! */
const outerColorPicker = (colorCode: string): [number, number, number] | null => {
  switch (colorCode) {
    case "yellow":
      return [55 / 360, 1.0, 0.5];
    case "orange":
      return [38 / 360, 1.0, 0.5];
    case "red":
      return [0.0, 1.0, 0.5];
    default:
      return null;
  }
};

/** returns HSL! */
const innerColorPicker = (colorCode: string, lightness: number): [number, number, number] => {
  switch (colorCode) {
    case "yellow":
      return [55 / 360, 1.0, lightness];
    case "blue":
      return [241 / 360, 1.0, lightness];
    default: // red
      return [0, 1.0, lightness];
  }
};
const checkedRadioBtn = (name: string): string =>
  (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement)?.value;

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

const model = {
  considerConnectedLowerBound: 0.75,
  gravitationForceVisibleLowerBound: 0.5,
  painShapes: [
    new PainShape(new Point(120, 90), valueFromElement("radius1")),
    new PainShape(new Point(170, 120), valueFromElement("radius2")),
    new PainShape(new Point(140, 200), valueFromElement("radius3")),
  ],
  closeness: valueFromElement("closeness"),
};

const samplePolygon = (contour: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
  const steinerPoints = [];
  // TODO bounding box and create grid using _.range()
  const bb = {
    minX: _.minBy(contour, (c) => c.x)?.x ?? 0,
    minY: _.minBy(contour, (c) => c.y)?.y ?? 0,
    maxX: _.maxBy(contour, (c) => c.x)?.x ?? 0,
    maxY: _.maxBy(contour, (c) => c.y)?.y ?? 0,
  };
  const sampleRate = 2;
  const polygon = new Polygon(contour);
  for (let x = bb.minX; x <= bb.maxX; x += sampleRate) {
    for (let y = bb.minY; y <= bb.maxY; y += sampleRate) {
      if (polygon.contains(x, y)) {
        steinerPoints.push({ x, y });
      }
    }
  }
  return steinerPoints;
};

// draw polygon
const animate = (time: number): void => {
  const canvasWidth = (document.getElementById("animations-canvas")?.clientWidth ?? 0) * DOWNSCALE_FACTOR;
  const canvasHeight = (document.getElementById("animations-canvas")?.clientHeight ?? 0) * DOWNSCALE_FACTOR;
  renderer.resize(canvasWidth, canvasHeight);

  model.painShapes.forEach((p, i) => {
    p.radius = valueFromElement(`radius${i + 1}`);
  });
  model.closeness = valueFromElement("closeness");
  model.dissolve = valueFromElement("dissolve");

  Promise.all([clipper, assets])
    .then(([clipper, assets]: [clipperLib.ClipperLibWrapper, { headLeft: Texture }]) => {
      const { paths } = metaballsPaths(clipper, model);

      const scene = new Container();

      const backgroundImage = new Sprite(assets.headLeft);
      const scaleToFitRatio = Math.min(
        (renderer.width * DOWNSCALE_FACTOR) / RESOLUTION / backgroundImage.width,
        (renderer.height * DOWNSCALE_FACTOR) / RESOLUTION / backgroundImage.height
      );
      backgroundImage.scale.x = backgroundImage.scale.y = scaleToFitRatio;

      scene.addChild(backgroundImage);

      const scalingFactor = 10e4;
      const polygonsUnionedUnscaled =
        clipper
          .clipToPaths({
            clipType: clipperLib.ClipType.Union,
            subjectFillType: clipperLib.PolyFillType.NonZero,
            subjectInputs: [...paths.entries()].flatMap(([_, polygons]) =>
              polygons.map((p) => ({
                closed: true,
                data: p.map(({ x, y }) => ({ x: Math.round(x * scalingFactor), y: Math.round(y * scalingFactor) })),
              }))
            ),
            preserveCollinear: false,
          })
          ?.filter((p) => clipper.orientation(p)) ?? []; // filter out all holes, TODO consider area too

      // todo create shapes inside

      polygonsUnionedUnscaled =
        clipper
          .offsetToPaths({
            delta: -scalingFactor * 20 * model.dissolve,
            offsetInputs: polygonsUnionedUnscaled.map((path) => {
              return {
                joinType: clipperLib.JoinType.Square,
                endType: clipperLib.EndType.ClosedPolygon,
                data: path,
              };
            }),
          })
          ?.filter((p) => clipper.orientation(p)) ?? [];
      // ?.filter((p) => clipper.orientation(p)) // filter out all holes, TODO consider area too
      // ?.map((p) => p.map(({ x, y }) => [x / scalingFactor, y / scalingFactor] as [number, number])) ?? [];

      const polygonsUnioned = polygonsUnionedUnscaled.map((p) =>
        p.map(({ x, y }) => [x / scalingFactor, y / scalingFactor] as [number, number])
      );

      const innerColor = innerColorPicker(checkedRadioBtn("innerColor"), valueFromElement("lightness"));
      const polygonsFlattened = polygonsUnioned.map((path) => path.flat());
      const ranges = getRanges(polygonsFlattened).flat();
      const uniforms = {
        gradientLength: _.max(model.painShapes.map((p) => p.radius)) ?? 0 * 2,
        innerColorStart: valueFromElement("colorShift"),
        alphaFallOutEnd: valueFromElement("alphaRatio"),
        outerColorHSL: outerColorPicker(checkedRadioBtn("outerColor")) ?? innerColor,
        innerColorHSL: innerColor,
        paths_ubo: new UniformGroup(
          {
            paths: new Float32Array(polygonsFlattened.flat()),
          },
          false,
          true
        ),
        ranges: new Int16Array(ranges),
        rangesLen: Math.floor(ranges.length / 2),
        backgroundTexture: RenderTexture.from(backgroundImage.texture.baseTexture),
        // width is the css pixel width after the backgroundImage was already scaled to fit bounds of canvas
        // which is multiplied by the resolution to account for hidpi
        textureBounds: new Float32Array([backgroundImage.width * RESOLUTION, backgroundImage.height * RESOLUTION]),
        rendererBounds: new Float32Array([renderer.width, renderer.height]),
      };

      for (const contourUnscaled of polygonsUnionedUnscaled) {
        const contour = contourUnscaled.map(({ x, y }) => ({ x: x / scalingFactor, y: y / scalingFactor }));

        // TODO performance optimization by doing deltas for all shapes at same time
        const steinerPoints: Array<{ x: number; y: number }> = samplePolygon(contour);

        const vertexMesh: Array<[number, number]> = [];
        try {
          const triangulation = new poly2tri.SweepContext(contour);
          triangulation.addPoints(steinerPoints);
          triangulation.triangulate();
          triangulation.getTriangles().forEach((t) => t.getPoints().forEach(({ x, y }) => vertexMesh.push([x, y])));
        } catch (e: unknown) {
          if (e instanceof poly2tri.PointError) {
            // TODO dont update model from previous run once performance optimization complete
          }
        }

        const geometry = new Geometry().addAttribute("aVertexPosition", vertexMesh.flat(), 2);
        /* debug show mesh lines
          .addAttribute(
            "aGradient",
            triangulation
              .getTriangles()
              .map((tri) => [
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1],
              ])
              .flat(2)
          ); */

        const mesh = new Mesh(geometry, gradientShaderFrom(uniforms));
        scene.addChild(mesh);
      }

      for (const painShape of model.painShapes) {
        const circle = new Graphics();
        circle.beginFill(0xffffff, 0.00001);
        circle.drawCircle(painShape.position.x, painShape.position.y, painShape.radius);
        circle.endFill();
        circle.interactive = true;
        circle.buttonMode = true;
        circle.on("pointerdown", (e) => {
          painShape.dragging = true;
        });
        circle.on("pointermove", (e) => {
          if (painShape.dragging ?? false) {
            painShape.position.x = e.data.global.x;
            painShape.position.y = e.data.global.y;
          }
        });
        circle.on("pointerup", (e) => {
          painShape.position.x = e.data.global.x;
          painShape.position.y = e.data.global.y;
          painShape.dragging = false;
        });
        scene.addChild(circle);
      }

      renderer.render(scene, { clear: true });
      requestAnimationFrame(animate);
    })
    .catch((err) => console.log(err));
};
animate(performance.now());
