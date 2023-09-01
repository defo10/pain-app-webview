import _ from "lodash";
import * as gl from "gl-matrix";
import { bounds, clamp, dist, lerpPoints } from "./utils";
import { Point, Polygon as PixiPolygon } from "pixi.js";
import "@pixi/math-extras";
import { CurveInterpolator } from "curve-interpolator";
import { Circle, intersections, Line, Point as EuclidPoint, Polygon as EuclidPolygon } from "@mathigon/euclid";
import offsetPolygon from "offset-polygon";
import { debug, debugPolygon } from "../debug";
import Denque from "denque";
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

function getWingLength(offsetRatio: number, dissolve: number): number {
  return lerp(0, 20, offsetRatio * dissolve);
}

interface Transformation {
  i: number;
  transform: (p: EuclidPoint, uPerpendicular: EuclidPoint) => [number, number];
}

function traversePolygonAtSteps(
  polygon: EuclidPolygon,
  I: Transformation[],
  circumference?: number
): Array<[number, number]> {
  if (I.length === 0) return [];

  const transformedPolygon = [];
  const queue = new Denque(I);

  let iPolygon = 0;
  let nextSmallest = queue.shift();

  for (const e of polygon.edges) {
    // this is the max i in polygon normalized space ([0..1]) of this edge
    const iPolygonOfEdge = e.length / (circumference ?? polygon.circumference);
    while (nextSmallest != null && nextSmallest.i <= iPolygon + iPolygonOfEdge) {
      const iOnEdge = nextSmallest.i - iPolygon;
      const pointAtI = e.at(iOnEdge);

      const delta = 0.0001;
      const pointAhead = e.at(iOnEdge + delta);
      const tangent = new Line(e.at(iOnEdge), pointAhead);
      const perpendicular = tangent.perpendicularVector.unitVector;

      transformedPolygon.push(nextSmallest.transform(pointAtI, perpendicular));
      nextSmallest = queue.shift();
    }
    iPolygon += iPolygonOfEdge;
  }

  return transformedPolygon;
}

/** transforms a polygon to the same polygon shape with wings added to them. If ccw polygon is given, the outer offset inflates the whole, else the wings
 * go inwards.
 */
export function polygon2starshape(
  contourUnsorted: Array<[number, number]>,
  outerOffsetRatio: number,
  roundnessRatio: number,
  wings: number,
  dissolve: number
): Array<[number, number]> {
  const smoothInterpolator = new CurveInterpolator(
    [...contourUnsorted, lerpPoints(contourUnsorted[contourUnsorted.length - 1], contourUnsorted[0], 0.9)],
    { tension: 0.0 }
  );
  const smoothContour = smoothInterpolator.getPoints(100) as Array<[number, number]>;
  const mostRight = _.maxBy(smoothContour, ([x, y]) => x) as [number, number];
  const indexMostRight = smoothContour.findIndex((p) => p === mostRight);
  const contour = [...smoothContour.slice(indexMostRight), ...smoothContour.slice(0, indexMostRight)];
  const polygon = new EuclidPolygon(...contour.map(([x, y]) => new EuclidPoint(x, y)));
  // circumference is calculated each call again, which the flame graph showed had bad performance
  const circumference = polygon.circumference;
  const scaling = clamp(1 - dissolve, 0.5, 1);
  // ratio how much polygon inflates, with 0 being completely inside, and 1 being completely outside
  const outerRatio = clamp(dissolve ** 2, 0.1, 0.9);
  const wingLength = getWingLength(outerOffsetRatio, scaling);
  const wingWidth = clamp(circumference / wings, 2.5, 20);
  const numWings = Math.round(circumference / wingWidth);
  const step = 1.0 / numWings;
  const midDelta = 0.5 * step;

  const offset = (p: EuclidPoint, uPerpendicular: EuclidPoint, offsetScaling: number): [number, number] => {
    const offsetPoint = p.add(uPerpendicular.scale(offsetScaling));
    return [offsetPoint.x, offsetPoint.y];
  };

  const transformations = [];
  for (let i = 0.0; i < 1.0; i += step) {
    const midPointI = i + midDelta;
    // horizontal delta is the horiztonal offset from the outer offset. Smaller values mean spickier wings
    const horizontalDelta: number = lerp(1e-3, midDelta * 0.7, roundnessRatio);
    // this is the ratio applied to outerOffset to change the heights of the points defining
    // the left and right side of the wing
    const verticalOffsetScaling: number = lerp(0.4, 0.8, roundnessRatio);

    // for terminoloy, consider this strip as a horizontal line with innerPoint being on the line,
    // and outerPoint being shifted north by outerOffset, i.e. outerPoint is the wing tip
    // the start (i = 0) is on the right side and goes left/ccw
    const base: Transformation = {
      i,
      transform: (p, u) => offset(p, u, -wingLength * (1 - outerRatio)),
    };
    const outerPointRight: Transformation = {
      i: midPointI - horizontalDelta,
      transform: (p, u) => offset(p, u, wingLength * outerRatio * verticalOffsetScaling),
    };
    const outerPoint: Transformation = {
      i: midPointI,
      transform: (p, u) => offset(p, u, wingLength * outerRatio),
    };
    const outerPointLeft: Transformation = {
      i: midPointI + horizontalDelta,
      transform: (p, u) => offset(p, u, wingLength * outerRatio * verticalOffsetScaling),
    };
    transformations.push(base, outerPointRight, outerPoint, outerPointLeft);
  }

  const starshape = traversePolygonAtSteps(polygon, transformations, circumference);
  const curveInterpolator = new CurveInterpolator(
    [
      ...starshape,
      lerpPoints(starshape[starshape.length - 1] as [number, number], starshape[0] as [number, number], 0.9),
    ],
    { tension: 0.0 }
  );
  let points: Array<[number, number]> = curveInterpolator.getPoints(numWings * 2 * 10); // (1 up + 1 down) * 5 intermediary steps
  points = [...points, points[0]]; // close polygon
  return points;
}

function perpendicularVectorAt(polygon: EuclidPolygon, i: number): EuclidPoint {
  const delta = 0.001;
  // TODO this marches from the polygon start to point three times for every step -> do it in one go?
  const pointAhead = polygon.at(i + delta);
  const pointBehind = polygon.at(i - delta);
  const tangent = new Line(pointBehind, pointAhead);
  return tangent.perpendicularVector.unitVector;
}

/** transforms a polygon to the same polygon shape with wings added to them */
export function circle2starshape(
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
  const numWings = Math.floor(polygon.circumference / wingLength);
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
  const starshape: EuclidPoint[] = [];
  const outerOffset = outerOffsetRatio * innerRadius * 2;
  const contour = circlePolygon(center, innerRadius + outerOffset);
  const polygon = new EuclidPolygon(...contour.map(({ x, y }) => new EuclidPoint(x, y)));
  const numWings = Math.floor(polygon.circumference / wingLength);
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

export function starshape2(
  radius: number,
  outerOffsetRatio: number,
  roundnessRatio: number,
  numWings: number
): Array<[number, number]> {
  const starshape: [number, number][] = [];

  const step = (2 * Math.PI) / numWings;
  for (let tipAngle = 0; tipAngle < 2 * Math.PI * 0.99; tipAngle += step) {
    const nextTipAngle = tipAngle + step;
    const midAngle = (tipAngle + nextTipAngle) / 2;

    const outerOffset = lerp(radius, radius * 2, outerOffsetRatio);
    const innerOffset = lerp(radius, radius * 0.05, outerOffsetRatio);

    const roundnessModifierAngleFirst = lerp(tipAngle * 1.001, lerp(tipAngle, midAngle, 0.8), roundnessRatio);
    const roundnessModifierAngleSecond = lerp(nextTipAngle * 0.999, lerp(nextTipAngle, midAngle, 0.8), roundnessRatio);

    const roundnessModifierOffset = lerp(outerOffset * 0.99, lerp(innerOffset, outerOffset, 0.7), roundnessRatio);

    starshape.push(
      [Math.cos(tipAngle) * outerOffset, Math.sin(tipAngle) * outerOffset],
      [
        Math.cos(roundnessModifierAngleFirst) * roundnessModifierOffset,
        Math.sin(roundnessModifierAngleFirst) * roundnessModifierOffset,
      ],
      [Math.cos(midAngle) * innerOffset, Math.sin(midAngle) * innerOffset],
      [
        Math.cos(roundnessModifierAngleSecond) * roundnessModifierOffset,
        Math.sin(roundnessModifierAngleSecond) * roundnessModifierOffset,
      ]
    );
  }

  const curveInterpolator = new CurveInterpolator([...starshape, [starshape[0][0] * 0.99, starshape[0][1] * 0.99]], {
    tension: 0.0,
  });
  const points = curveInterpolator.getPoints(numWings * 2 * 10);
  return [...points];
}
