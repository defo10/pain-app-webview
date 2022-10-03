import _ from "lodash";
import * as PIXI from "pixi.js";
import { DistanceMatrix } from "./distance_matrix";
import { GravitatingShape } from "./gravitating_shapes";
import { PainShape } from "./pain_shape";
import Queue from "denque";
import * as clipperLib from "js-angusj-clipper";
import { metaball as metaballConnection } from "./polygon/metaball";
import * as gl from "gl-matrix";
import { circlePolygon, Polygon, gravitationPolygon } from "./polygon";
import { Framebuffer } from "pixi.js";
var lerp = require("interpolation").lerp;
var smoothstep = require("interpolation").smoothstep;

// gl matrix uses float 32 types by default, but array is much faster.
gl.glMatrix.setMatrixArrayType(Array);

const renderer = PIXI.autoDetectRenderer({
  width: document.getElementById("animations-canvas")?.clientWidth,
  height: document.getElementById("animations-canvas")?.clientHeight,
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  antialias: true,
  resolution: 4,
  backgroundAlpha: 1,
  backgroundColor: 0xffffff,
});

const VERT_SRC = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;

varying vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}
`;

const FRAG_SRC = `
precision mediump float;

varying vec2 vTextureCoord;//The coordinates of the current pixel
uniform sampler2D uSampler;//The image data

void main(void) {
   gl_FragColor = texture2D(uSampler, vTextureCoord);
   if (gl_FragColor.r > 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);
   }
}`;

const clipper = clipperLib.loadNativeClipperLibInstanceAsync(
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
);

function metaballsPaths(
  clipper: clipperLib.ClipperLibWrapper,
  pm: {
    considerConnectedLowerBound: number;
    gravitationForceVisibleLowerBound: number;
    painShapes: PainShape[];
    closeness: number;
  }
): Polygon[] {
  const distanceMatrix = new DistanceMatrix<PainShape>(pm.painShapes, PainShape.dist);
  // we want to find to find all radiusExtendFactors for all distances, thus
  // "dist = radiusExtendFactor * (a.radius + b.radius)" => "radiusExtendFactor = dist / (a.radius + b.radius)"
  const radiusExtendFactorMatrix = new DistanceMatrix<PainShape>(
    pm.painShapes,
    (a, b) => distanceMatrix.between(a, b)! / (a.radius + b.radius)
  );
  // we want that each node is connected to at least one other node (one graph in total) at the highest connectivity
  // To achieve that, we find the biggest radiusExtendFactor necessary for each node, and take
  // the smallest one of those
  // biggestRadiusExtendOfSmallest gives the factor to multiply the radius with such that each node is at least
  // connected to one other node
  const biggestRadiusExtendOfSmallest = _.max(pm.painShapes.map((p) => radiusExtendFactorMatrix.nn(p)!.distance))!;
  // smallestRadiusExtend gives the factor to multiply the radius with such that no two nodes are connected
  // (the smallest radiusExtend * the lower bound ratio)
  const smallestRadiusExtend =
    _.min(pm.painShapes.map((p) => radiusExtendFactorMatrix.nn(p)!.distance))! * pm.gravitationForceVisibleLowerBound;
  const radiusExtendFactor = lerp(smallestRadiusExtend, biggestRadiusExtendOfSmallest, pm.closeness);

  const representativeMap = new Map<PainShape, PainShape>();
  const pathsMap = new Map<PainShape, Polygon[]>();
  const gravitatingShapes = new Set<GravitatingShape>();
  const visited = new Set<PainShape>();

  for (const node of pm.painShapes) {
    if (visited.has(node)) continue;

    const nodesToVisit = new Queue<PainShape>();
    nodesToVisit.push(node);
    while (!nodesToVisit.isEmpty()) {
      const curr = nodesToVisit.shift()!;
      visited.add(curr);

      if (!representativeMap.has(curr)) representativeMap.set(curr, node);

      const circle = circlePolygon(curr.position, curr.radius);
      if (pathsMap.get(representativeMap.get(curr)!)) {
        pathsMap.get(representativeMap.get(curr)!)!.push(circle);
      } else {
        pathsMap.set(representativeMap.get(curr)!, [circle]);
      }

      for (const connected of distanceMatrix.knn(curr)) {
        if (!visited.has(connected.ref)) {
          nodesToVisit.push(connected.ref);
        }

        // is false when the biggestRadiusExtendFactor we want to support (each node has at least one
        // connection) is already set
        const biggestIsAlreadyFullyConnected =
          (biggestRadiusExtendOfSmallest! * (curr.radius + connected.ref.radius)) / connected.distance >=
          pm.considerConnectedLowerBound;
        const distanceRatio = (radiusExtendFactor! * (curr.radius + connected.ref.radius)) / connected.distance;
        if (distanceRatio >= pm.considerConnectedLowerBound) {
          // connected
          // [pm.considerConnectedLowerBound, 1.0] => [0, 1]
          const ratio = smoothstep(pm.considerConnectedLowerBound, 1.0, distanceRatio);
          // [0, 1] -> [0, 1]
          const exponentialEaseOut = Math.pow(ratio, 0.2);
          const exponentialEaseIn = Math.pow(ratio, 1 / 0.2);
          // [0, 1] -> [0.5, 1.0]
          const inwardShiftRatio = lerp(0.5, 1.0, ratio);
          pathsMap
            .get(representativeMap.get(curr)!)!
            .push(
              metaballConnection(
                curr.radius,
                connected.ref.radius,
                curr.positionAsVec2 as [number, number],
                connected.ref.positionAsVec2 as [number, number],
                inwardShiftRatio,
                exponentialEaseIn
              )
            );
        } else if (distanceRatio >= pm.gravitationForceVisibleLowerBound && biggestIsAlreadyFullyConnected) {
          // not connected but pulling each other
          // we save them here, because we dont know all represenatives yet
          gravitatingShapes.add(new GravitatingShape(curr, connected.ref, distanceRatio));
        }
      }
    }
  }

  for (const gs of gravitatingShapes) {
    const ratio = smoothstep(pm.gravitationForceVisibleLowerBound, pm.considerConnectedLowerBound, gs.distanceRatio);
    const exponentialEaseIn = Math.pow(ratio, 1 / 0.2);

    pathsMap
      .get(representativeMap.get(gs.from)!)
      ?.push(
        gravitationPolygon(
          gs.from.positionAsVec2 as [number, number],
          gs.from.radius,
          gs.to.positionAsVec2 as [number, number],
          gs.to.radius,
          ratio,
          ratio
        )
      );

    pathsMap
      .get(representativeMap.get(gs.to)!)
      ?.push(
        gravitationPolygon(
          gs.to.positionAsVec2 as [number, number],
          gs.to.radius,
          gs.from.positionAsVec2 as [number, number],
          gs.from.radius,
          ratio,
          ratio
        )
      );
  }

  return [...pathsMap.values()].flat();
}

const valueFromElement = (id: string) => parseFloat((document.getElementById(id) as HTMLInputElement).value);
// draw polygon
const animate = (time: number): void => {
  const model = {
    considerConnectedLowerBound: 0.75,
    gravitationForceVisibleLowerBound: 0.5,
    painShapes: [
      new PainShape(new PIXI.Point(120, 90), valueFromElement("radius")),
      new PainShape(new PIXI.Point(170, 120), valueFromElement("radius")),
      new PainShape(new PIXI.Point(140, 180), valueFromElement("radius")),
    ],
    closeness: valueFromElement("closeness"),
  };

  clipper
    .then((clipper) => {
      const graphics = new PIXI.Graphics();
      graphics.geometry.batchable = false;
      graphics.beginFill(0xc92626, 1);

      for (const polygon of metaballsPaths(clipper, model)) {
        graphics.drawPolygon(polygon);
      }

      graphics.endFill();
      const shader = new PIXI.Filter(VERT_SRC, FRAG_SRC);
      graphics.filters = [shader];

      renderer.render(graphics);
      requestAnimationFrame(animate);
    })
    .catch((err) => console.log(err));
};
animate(performance.now());
