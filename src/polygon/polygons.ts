import _ from "lodash";
import * as gl from "gl-matrix";
import { bounds, clamp, lerpPoints } from "./utils";
import { IPoint, Point, Polygon as PixiPolygon } from "pixi.js";
import "@pixi/math-extras";
import { CurveInterpolator } from "curve-interpolator";
import { Circle, intersections, Line, Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";
const smoothstep = require("interpolation").smoothstep;

export type SimplePolygon = Point[];

/** returns polygon of a circle around @param center with @param radius */
export const circlePolygon = (center: Point, radius: number): SimplePolygon => {
  const circlePaths = [];
  for (let i = 0; i < 2 * Math.PI; i = i + 0.15) {
    circlePaths.push(new Point(center.x + Math.cos(i) * radius, center.y + Math.sin(i) * radius));
  }
  return circlePaths;
};

export function calcMidpoint(
  center1: readonly [number, number],
  radius1: number,
  center2: readonly [number, number],
  radius2: number
): gl.vec2 {
  const C1C2 = gl.vec2.sub([0.0, 0.0], center2, center1);
  const midpointRatio = radius1 / (radius1 + radius2);
  const midpoint = gl.vec2.add([0.0, 0.0], center1, gl.vec2.scale([0.0, 0.0], C1C2, midpointRatio));
  return midpoint;
}

/** returns polygon overlapping circle (center1,radius1) towards other circle */
export function gravitationPolygon(
  center1: [number, number],
  radius1: number,
  center2: [number, number],
  radius2: number,
  connectionStrength = 1.0,
  inwardShift = 0.5
): SimplePolygon {
  const mid = calcMidpoint(center1, radius1, center2, radius2);

  const { p1, p2 } = bounds(radius1, radius2, center1, center2, inwardShift);

  const center1ToMidpoint = gl.vec2.sub([0, 0], mid, center1);
  // scaling factor which, applied to center1ToMidpoint, translates center1 onto its outline
  const reachPoint = gl.vec2.scale([0, 0], center1ToMidpoint, radius1 / gl.vec2.length(center1ToMidpoint));
  const outlinePoint = gl.vec2.add([0, 0], center1, reachPoint);
  const gravitationPoint = lerpPoints(outlinePoint as [number, number], mid as [number, number], connectionStrength);

  const curve = new CurveInterpolator([p2, gravitationPoint as number[], p1], { tension: 0.0 });

  const pointsOfCurve = curve.getPoints(20) as Array<[number, number]>;
  return pointsOfCurve.map(([x, y]) => new Point(x, y));
}

/** Gives path of connection between two balls, resembling metaballs.
 *
 * scr: https://varun.ca/metaballs/
 *
 * Based on Metaball script by SATO Hiroyuki
 * http://shspage.com/aijs/en/#metaball
 */
export function overlapClosing(
  radius1: number,
  radius2: number,
  center1: readonly [number, number],
  center2: readonly [number, number],
  t = 1.0
): SimplePolygon {
  const { p1, p2, p3, p4 } = bounds(radius1, radius2, center1, center2, 1.0);

  const [first, second] = intersections(
    new Circle(new EuclidPoint(...center1), radius1),
    new Circle(new EuclidPoint(...center2), radius2)
  );

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!first || !second) {
    console.log("no intersection");
    return [];
  }

  const outerMidpoint1 = new Line(new EuclidPoint(...p1), new EuclidPoint(...p3)).at(0.5);
  const outerMidpoint2 = new Line(new EuclidPoint(...p2), new EuclidPoint(...p4)).at(0.5);

  const midPoint1 = new Line(first, outerMidpoint1).at(clamp(t, 0.15, 1.0));
  const midPoint2 = new Line(second, outerMidpoint2).at(clamp(t, 0.15, 1.0));

  const interpolateP1P3 = new CurveInterpolator([p1, [midPoint1.x, midPoint2.y], p3], { tension: 0.0 });
  const interpolateP2P4 = new CurveInterpolator([p4, [midPoint1.x, midPoint2.y], p2], { tension: 0.0 });
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

export const samplePolygon = (contour: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
  const steinerPoints = [];
  // TODO bounding box and create grid using _.range()
  const bb = {
    minX: _.minBy(contour, (c) => c.x)?.x ?? 0,
    minY: _.minBy(contour, (c) => c.y)?.y ?? 0,
    maxX: _.maxBy(contour, (c) => c.x)?.x ?? 0,
    maxY: _.maxBy(contour, (c) => c.y)?.y ?? 0,
  };
  const sampleRate = 2;
  const polygon = new PixiPolygon(contour);
  for (let x = bb.minX; x <= bb.maxX; x += sampleRate) {
    for (let y = bb.minY; y <= bb.maxY; y += sampleRate) {
      if (polygon.contains(x, y)) {
        steinerPoints.push({ x, y });
      }
    }
  }
  return steinerPoints;
};

function perpendicularVectorAt(polygon: EuclidPolygon, i: number): EuclidPoint {
  const delta = 0.001;
  // TODO this marches from the polygon start to point three times for every step -> do it in one go?
  const pointAhead = polygon.at(i + delta);
  const pointBehind = polygon.at(i - delta);
  const tangent = new Line(pointBehind, pointAhead);
  return tangent.perpendicularVector.unitVector;
}

export function polyon2starshape(
  contour: Array<[number, number]>,
  offset: number, // konzentriert/strahlend
  sharpness: number, // rund/zackig
  length: number // Anzahl Zacken
): Array<[number, number]> {
  const starshape = [];
  const polygon = new EuclidPolygon(...contour.map(([x, y]) => new EuclidPoint(x, y)));
  const number = polygon.circumference / length;
  const step = 1.0 / number;
  for (let i = 0.0; i <= 1.0; i += step) {
    const point = polygon.at(i);
    const perpendicularUV = perpendicularVectorAt(polygon, i);
    const outerPoint = point.add(perpendicularUV.scale(offset));

    const midPointI = i + step / 2;
    const pointAtMidpointI = polygon.at(midPointI);
    const midpointPerpendicularUV = perpendicularVectorAt(polygon, midPointI);
    const innerPoint = pointAtMidpointI.subtract(midpointPerpendicularUV.scale(offset));

    starshape.push(outerPoint, innerPoint);
  }
  const curveInterpolator = new CurveInterpolator(
    starshape.map(({ x, y }) => [x, y]),
    { tension: 0.0 }
  );
  return curveInterpolator.getPoints(number * 2 * 6);
}

export function starshape(
  center: Point,
  innerRadius: number,
  outerOffset: number,
  roundnessRatio: number,
  numWings: number
): Array<[number, number]> {
  const starshape: EuclidPoint[] = [];
  const contour = circlePolygon(center, innerRadius + outerOffset);
  const polygon = new EuclidPolygon(...contour.map(({ x, y }) => new EuclidPoint(x, y)));
  const step = 1.0 / numWings;
  const maxRoundness = Math.min(outerOffset, polygon.circumference * step * 0.25);
  const roundness = Math.max(roundnessRatio * maxRoundness, 0.1);
  for (let i = 0.0; i < 1.0; i += step) {
    const outerPoint = polygon.at(i);

    const outerPointPerpendicular = perpendicularVectorAt(polygon, i); // point outwards
    const scaledOuterPointPerpendicular = outerPointPerpendicular.scale(roundness);
    const wingCenter = outerPoint.subtract(scaledOuterPointPerpendicular);
    starshape.push(
      wingCenter.subtract(scaledOuterPointPerpendicular.rotate(Math.PI / 2)),
      outerPoint,
      wingCenter.add(scaledOuterPointPerpendicular.rotate(Math.PI / 2))
    );

    const midPointI = i + step / 2;
    const pointAtMidpointI = polygon.at(midPointI);
    const midpointPerpendicularUV = perpendicularVectorAt(polygon, midPointI);
    const innerPoint = pointAtMidpointI.subtract(midpointPerpendicularUV.scale(outerOffset));
    starshape.push(innerPoint);
  }
  const curveInterpolator = new CurveInterpolator(
    starshape.map(({ x, y }) => [x, y]),
    { tension: 0.0 }
  );
  const points = curveInterpolator.getPoints(numWings * 2 * 10);
  return [...points, points[0]];
}

export interface MinsDistData {
  projection: Point;
  distance: number;
  line: [number, number, number, number];
}
// return point of minimum distance on VW to P
export const minimumDistancePointOnLine = (v: Point, w: Point, p: Point): MinsDistData => {
  const l2 = Math.pow(w.x - v.x, 2.0) + Math.pow(w.y - v.y, 2.0); // i.e. |w-v|^2 -  avoid a sqrt
  const pMinusV = p.subtract(v);
  const wMinusV = w.subtract(v);
  const t = clamp(pMinusV.dot(wMinusV) / l2, 0, 1);
  const projection = v.add(wMinusV.multiplyScalar(t));
  return {
    projection,
    distance: Math.sqrt(Math.pow(p.x - projection.x, 2.0) + Math.pow(p.y - projection.y, 2.0)),
    line: [v.x, v.y, w.x, w.y],
  };
};

// src: https://stackoverflow.com/questions/13937782/calculating-the-point-of-intersection-of-two-lines
// src: http://paulbourke.net/geometry/pointlineplane/javascript.txt
// line intercept math by Paul Bourke http://paulbourke.net/geometry/pointlineplane/
// Determine the intersection point of two line segments
// Return FALSE if the lines don't intersect
export const lineLineIntersection = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number
): [number, number] | false => {
  // Check if none of the lines are of length 0
  if ((x1 === x2 && y1 === y2) || (x3 === x4 && y3 === y4)) {
    return false;
  }

  const denominator = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);

  // Lines are parallel
  if (denominator === 0) {
    return false;
  }

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;

  // is the intersection along the segments
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) {
    return false;
  }

  // Return a object with the x and y coordinates of the intersection
  const x = x1 + ua * (x2 - x1);
  const y = y1 + ua * (y2 - y1);

  return [x, y];
};
