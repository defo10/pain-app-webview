import * as gl from "gl-matrix";
import _ from "lodash";
import { bounds, clamp, insideCircle } from "./utils";
import { DistanceMatrix } from "../distance_matrix";
import { Connection } from "../gravitating_shapes";
import { PainShape } from "../pain_shape";
import Queue from "denque";
import * as clipperLib from "js-angusj-clipper";
import { metaball as metaballConnection } from "./metaball";
import { circlePolygon, SimplePolygon, gravitationPolygon } from "../polygon";
import { Point } from "pixi.js";
import "@pixi/math-extras";
import { CurveInterpolator } from "curve-interpolator";
import { calcMidpoint } from "./polygons";

const lerp = require("interpolation").lerp;
const smoothstep = require("interpolation").smoothstep;

export interface SkeletonNode {
  position: Point;
  radius: number;
}

export function metaballsPaths(
  clipper: clipperLib.ClipperLibWrapper,
  painShapes: PainShape[],
  pm: {
    considerConnectedLowerBound: number;
    gravitationForceVisibleLowerBound: number;
    closeness: number;
  }
): { paths: Map<PainShape, SimplePolygon[]>; skeletonGraph: Array<Connection<SkeletonNode>> } {
  const distanceMatrix = new DistanceMatrix<PainShape>(painShapes, PainShape.dist);
  // we want to find to find all radiusExtendFactors for all distances, thus
  // "dist = radiusExtendFactor * (a.radius + b.radius)" => "radiusExtendFactor = dist / (a.radius + b.radius)"
  const radiusExtendFactorMatrix = new DistanceMatrix<PainShape>(
    painShapes,
    (a, b) => distanceMatrix.between(a, b)! / (a.radius + b.radius)
  );
  // we want that each node is connected to at least one other node (one graph in total) at the highest connectivity
  // To achieve that, we find the biggest radiusExtendFactor necessary for each node, and take
  // the smallest one of those
  // biggestRadiusExtendOfSmallest gives the factor to multiply the radius with such that each node is at least
  // connected to one other node
  const biggestRadiusExtendOfSmallest = _.max(painShapes.map((p) => radiusExtendFactorMatrix.nn(p)!.distance))!;
  // smallestRadiusExtend gives the factor to multiply the radius with such that no two nodes are connected
  // (the smallest radiusExtend * the lower bound ratio)
  const smallestRadiusExtend =
    _.min(painShapes.map((p) => radiusExtendFactorMatrix.nn(p)!.distance))! * pm.gravitationForceVisibleLowerBound;
  const radiusExtendFactor = lerp(smallestRadiusExtend, biggestRadiusExtendOfSmallest, pm.closeness);

  const representativeMap = new Map<PainShape, PainShape>();
  const pathsMap = new Map<PainShape, SimplePolygon[]>();
  const gravitatingShapes = new Set<Connection<PainShape>>();
  const hasVisited = (node: PainShape) => representativeMap.has(node);

  // this consists of lines that form a skeleton graph which is used in the shader
  // to calculate gradients, which has form [x1, y1, radius1, x2, y2, radius2]
  const skeletonGraph: Array<Connection<SkeletonNode>> = [];

  for (const node of painShapes) {
    if (hasVisited(node)) continue;

    const nodesToVisit = new Queue<PainShape>();
    nodesToVisit.push(node);
    while (!nodesToVisit.isEmpty()) {
      const curr = nodesToVisit.shift()!;

      if (!representativeMap.has(curr)) representativeMap.set(curr, node);

      const circle = circlePolygon(curr.position, curr.radius);
      if (pathsMap.has(representativeMap.get(curr)!)) {
        pathsMap.get(representativeMap.get(curr)!)!.push(circle);
      } else {
        pathsMap.set(representativeMap.get(curr)!, [circle]);
      }

      for (const connected of distanceMatrix.knn(curr)) {
        if (
          insideCircle(curr.positionAsVec2, curr.radius, connected.ref.positionAsVec2) ||
          insideCircle(connected.ref.positionAsVec2, connected.ref.radius, curr.positionAsVec2)
        )
          continue;

        // is false when the biggestRadiusExtendFactor we want to support (each node has at least one
        // connection) is already set
        const biggestIsAlreadyFullyConnected =
          (biggestRadiusExtendOfSmallest * (curr.radius + connected.ref.radius)) / connected.distance >=
          pm.considerConnectedLowerBound;
        const distanceRatio = (radiusExtendFactor * (curr.radius + connected.ref.radius)) / connected.distance;

        if (distanceRatio >= pm.considerConnectedLowerBound) {
          // connected
          if (!hasVisited(connected.ref)) {
            representativeMap.set(connected.ref, representativeMap.get(curr)!);
            nodesToVisit.push(connected.ref);
          }

          // [pm.considerConnectedLowerBound, 1.0] => [0, 1]
          const ratio = smoothstep(pm.considerConnectedLowerBound, 1.0, distanceRatio);
          // [0, 1] -> [0, 1]
          const exponentialEaseOut = Math.pow(ratio, 0.2);
          const exponentialEaseIn = Math.pow(ratio, 1 / 0.2);
          // [0, 1] -> [0.5, 1.0]
          const inwardShiftRatio = lerp(0.5, 1.0, ratio);

          // TODO consider case when radii are overlapping, maybe redo metaballpath function?
          if (connected.distance <= curr.radius + connected.ref.radius) {
            // continue;
          }
          pathsMap
            .get(representativeMap.get(curr)!)!
            .push(
              metaballConnection(
                curr.radius,
                connected.ref.radius,
                curr.positionAsVec2 as [number, number],
                connected.ref.positionAsVec2 as [number, number],
                inwardShiftRatio,
                ratio
              )
            );
          skeletonGraph.push(
            new Connection<SkeletonNode>(
              { position: curr.position, radius: curr.radius },
              { position: connected.ref.position, radius: connected.ref.radius }
            )
          );
        } else if (distanceRatio >= pm.gravitationForceVisibleLowerBound && biggestIsAlreadyFullyConnected) {
          // not connected but pulling each other
          // we save them here, because we dont know all represenatives yet
          if (connected.distance <= curr.radius + connected.ref.radius) {
            continue;
          }
          gravitatingShapes.add(new Connection(curr, connected.ref, distanceRatio));
        } // else not connected
      }
    }
  }

  for (const gs of gravitatingShapes) {
    const ratio = smoothstep(pm.gravitationForceVisibleLowerBound, pm.considerConnectedLowerBound, gs.distanceRatio);

    const exponentialEaseIn = Math.pow(ratio, 1 / 0.2);
    const exponentialEaseOut = Math.pow(ratio, 0.2);
    const inwardShiftRatio = lerp(1.0, 0.4, ratio);

    const firstPullPolygon = gravitationPolygon(
      gs.from.positionAsVec2 as [number, number],
      gs.from.radius,
      gs.to.positionAsVec2 as [number, number],
      gs.to.radius,
      ratio,
      inwardShiftRatio
    );
    pathsMap.get(representativeMap.get(gs.from)!)?.push(firstPullPolygon);
    skeletonGraph.push(
      new Connection<SkeletonNode>(
        { position: gs.from.position, radius: gs.from.radius },
        {
          position: new Point(...skeletonConnectionOfGravitationPull(gs.from, firstPullPolygon)),
          radius: gs.from.radius,
        }
      )
    );
  }

  return { paths: pathsMap, skeletonGraph };
}

/** returns something like the center of the pull area, which is used to offset the
 * gradient spread slightly.
 */
function skeletonConnectionOfGravitationPull(circle: PainShape, pull: SimplePolygon): gl.ReadonlyVec2 {
  // assuming that Polygon shape is [left, front, right]
  const frontPull = pull[1];
  const Circle2FrontPullVector = gl.vec2.sub([0, 0], [frontPull.x, frontPull.y], circle.positionAsVec2);
  const uCircle2FrontPullVector = gl.vec2.normalize([0, 0], Circle2FrontPullVector);
  const Circle2FrontPullMinusRadiusVector = gl.vec2.sub(
    [0, 0],
    Circle2FrontPullVector,
    gl.vec2.scale([0, 0], uCircle2FrontPullVector, circle.radius)
  );
  const point = gl.vec2.add([0, 0], circle.positionAsVec2, Circle2FrontPullMinusRadiusVector);
  return point;
}

/** Gives path of connection between two balls, resembling metaballs.
 *
 * scr: https://varun.ca/metaballs/
 *
 * Based on Metaball script by SATO Hiroyuki
 * http://shspage.com/aijs/en/#metaball
 */
export function metaball(
  radius1: number,
  radius2: number,
  center1: readonly [number, number],
  center2: readonly [number, number],
  v = 0.5,
  t = 1.0
): SimplePolygon {
  const { p1, p2, p3, p4 } = bounds(radius1, radius2, center1, center2, v);
  const lowerBound = 0.15;

  // midpoint
  const midpointRatio = radius1 / (radius1 + radius2);
  const C1C2 = gl.vec2.sub([0.0, 0.0], center2, center1);
  const midpoint = calcMidpoint(center1, radius1, center2, radius2);

  const P1P3 = gl.vec2.sub([0.0, 0.0], p3, p1);
  const midpointOnP1P3 = gl.vec2.add([0.0, 0.0], p1, gl.vec2.scale([0.0, 0.0], P1P3, midpointRatio));
  const midpointVectorP1P3 = gl.vec2.sub([0.0, 0.0], midpointOnP1P3, midpoint);
  const midpointToMidpointOnP1P3 = gl.vec2.add(
    [0.0, 0.0],
    midpoint,
    gl.vec2.scale([0.0, 0.0], midpointVectorP1P3, clamp(t, lowerBound, 1.0))
  );

  const P2P4 = gl.vec2.sub([0.0, 0.0], p4, p2);
  const midpointOnP2P4 = gl.vec2.add([0.0, 0.0], p2, gl.vec2.scale([0.0, 0.0], P2P4, midpointRatio));
  const midpointVectorP2P4 = gl.vec2.sub([0.0, 0.0], midpointOnP2P4, midpoint);
  const midpointToMidpointOnP2P4 = gl.vec2.add(
    [0.0, 0.0],
    midpoint,
    gl.vec2.scale([0.0, 0.0], midpointVectorP2P4, clamp(t, lowerBound, 1.0))
  );
  const interpolateP1P3 = new CurveInterpolator([p1, midpointToMidpointOnP1P3 as number[], p3], { tension: 0.0 });
  const interpolateP2P4 = new CurveInterpolator([p4, midpointToMidpointOnP2P4 as number[], p2], { tension: 0.0 });
  const polygon: SimplePolygon = [
    p1,
    ...(interpolateP1P3.getPoints(10) as Array<[number, number]>),
    p3,
    p4,
    ...(interpolateP2P4.getPoints(10) as Array<[number, number]>),
    p2,
  ]
    .map(([x, y]) => new Point(x, y))
    .reverse();
  return polygon;
}
