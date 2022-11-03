import _ from "lodash";
import * as gl from "gl-matrix";
import { bounds, clamp, dist, lerpPoints } from "./utils";
import { Point, Polygon as PixiPolygon } from "pixi.js";
import "@pixi/math-extras";
import { CurveInterpolator } from "curve-interpolator";
import { Circle, intersections, Line, Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";
import offsetPolygon from "offset-polygon";
import { debug, debugPolygon } from "../debug";
const lerp = require("interpolation").lerp;
const smoothstep = require("interpolation").smoothstep;

export type SimplePolygon = Point[];

/** returns polygon of a circle around @param center with @param radius */
export const circlePolygon = (center: Point, radius: number, stepSize = 0.15): SimplePolygon => {
  const circlePaths = [];
  for (let i = 0; i < 2 * Math.PI; i = i + stepSize) {
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

/** transforms a polygon to the same polygon shape with wings added to them */
export function polygon2starshape(
  contour: Array<[number, number]>,
  outerOffset: number,
  roundnessRatio: number,
  wingLength: number
): {
  points: Array<[number, number]>;
  outerPoints: Array<[number, number]>;
} {
  const starshape: EuclidPoint[] = [];
  // outerPoints forms the star shape enclosing polygon, which is used for coloring the star shape
  const outerPoints: Array<[number, number]> = [];
  const polygon = new EuclidPolygon(...contour.map(([x, y]) => new EuclidPoint(x, y)));
  const smallness = clamp(smoothstep(0, 200, polygon.circumference), 0, 1);
  const sizeAwareWingLength = clamp(lerp(wingLength / 5, wingLength, smallness), wingLength / 5, wingLength);
  const numWings = Math.floor(polygon.circumference / sizeAwareWingLength);
  if (numWings < 3)
    return {
      points: contour,
      outerPoints: contour,
    };
  const step = 1.0 / numWings;
  for (let i = 0.0; i < 1.0; i += step) {
    const midDelta = 0.5 * step;
    const midPointI = i + midDelta;
    const innerPoint = polygon.at(i);

    // for terminoloy, consider this strip as a horizontal line with innerPoint being on the line,
    // and outerPoint being shifted north by outerOffset, i.e. outerPoint is the wing tip
    // the start (i = 0) is on the right side and goes left/ccw
    const outerPointBaseline = polygon.at(midPointI);
    const uvOuterPoint = perpendicularVectorAt(polygon, midPointI);
    const outerPoint = outerPointBaseline.add(uvOuterPoint.scale(outerOffset));
    const horizontalDelta: number = lerp(1e-3, midDelta * 0.7, roundnessRatio);
    // this is the ratio applied to outerOffset to change the heights of the points defining
    // the left and right side of the wing
    const verticalOffsetRatio: number = lerp(0.6, 0.8, roundnessRatio);

    const outerPointLeftBaseline = polygon.at(midPointI + horizontalDelta);
    const uvOuterPointLeft = perpendicularVectorAt(polygon, midPointI + horizontalDelta);
    const outerPointLeft = outerPointLeftBaseline.add(uvOuterPointLeft.scale(outerOffset * verticalOffsetRatio));

    const outerPointRightBaseline = polygon.at(midPointI - horizontalDelta);
    const uvOuterPointRight = perpendicularVectorAt(polygon, midPointI - horizontalDelta);
    const outerPointRight = outerPointRightBaseline.add(uvOuterPointRight.scale(outerOffset * verticalOffsetRatio));

    starshape.push(innerPoint);
    const maxOffset = 0.5 * outerOffset;
    // do not add outer points if by they are too far away from the outer point. This happens
    // when outer point is close to a corner, which distorts outerPointLeft and outerPointRight
    if (dist([outerPointRight.x, outerPointRight.y], [outerPoint.x, outerPoint.y]) < maxOffset)
      starshape.push(outerPointRight);
    starshape.push(outerPoint);
    if (dist([outerPointLeft.x, outerPointLeft.y], [outerPoint.x, outerPoint.y]) < maxOffset)
      starshape.push(outerPointLeft);

    const hullPoint = outerPointBaseline.add(uvOuterPoint.scale(outerOffset === 0 ? 2 : outerOffset * 1.2));
    outerPoints.push([hullPoint.x, hullPoint.y]);
  }
  const starShapesFlat = starshape.map(({ x, y }) => [x, y]);
  const curveInterpolator = new CurveInterpolator(
    [
      ...starShapesFlat,
      lerpPoints(starShapesFlat.at(-1) as [number, number], starShapesFlat[0] as [number, number], 0.9),
    ],
    { tension: 0.0 }
  );
  let points: Array<[number, number]> = curveInterpolator.getPoints(numWings * 2 * 10);
  points = [...points, points[0]];
  return { points, outerPoints };
}

export function starshape(
  center: Point,
  innerRadius: number,
  outerOffsetRatio: number,
  roundnessRatio: number,
  wingLength: number
): Array<[number, number]> {
  const outerOffset = outerOffsetRatio * innerRadius * 4;
  const contour = circlePolygon(center, innerRadius);
  const points = polygon2starshape(
    contour.map(({ x, y }) => [x, y]),
    outerOffset / 2,
    roundnessRatio,
    wingLength / 2
  );
  return points.points;
}
