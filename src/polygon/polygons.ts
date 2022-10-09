import { PainShape } from "../pain_shape";
import _ from "lodash";
import * as gl from "gl-matrix";
import { bounds, clamp, lerpPoints } from "./utils";
import { Point } from "pixi.js";
import "@pixi/math-extras";
import { CurveInterpolator } from "curve-interpolator";
import { Circle, intersections, Line, Point as EuclidPoint } from "@mathigon/euclid";

const lerp = require("interpolation").lerp;
const smoothstep = require("interpolation").smoothstep;

export type Polygon = Point[];

/** returns polygon of a circle around @param center with @param radius */
export const circlePolygon = (center: Point, radius: number): Polygon => {
  const circlePaths = [];
  for (let i = 0; i < 2 * Math.PI; i = i + 0.15) {
    circlePaths.push(new Point(center.x + Math.cos(i) * radius, center.y + Math.sin(i) * radius));
  }
  return circlePaths;
};

/** returns polygon overlapping circle (center1,radius1) towards other circle */
export function gravitationPolygon(
  center1: [number, number],
  radius1: number,
  center2: [number, number],
  radius2: number,
  connectionStrength = 1.0,
  inwardShift = 0.5
): Polygon {
  const midpoint = lerpPoints(center1, center2, 0.5);
  const { p1, p2 } = bounds(radius1, radius2, center1, center2, inwardShift);

  const center1ToMidpoint = gl.vec2.sub([0, 0], midpoint, center1);
  // scaling factor which, applied to center1ToMidpoint, translates center1 onto its outline
  const reachPoint = gl.vec2.scale([0, 0], center1ToMidpoint, radius1 / gl.vec2.length(center1ToMidpoint));
  const outlinePoint = gl.vec2.add([0, 0], center1, reachPoint);
  const gravitationPoint = lerpPoints(outlinePoint as [number, number], midpoint, connectionStrength);

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
): Polygon {
  const { p1, p2, p3, p4 } = bounds(radius1, radius2, center1, center2, 1.0);

  debugger;
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
  const polygon: Polygon = [
    p1,
    ...(interpolateP1P3.getPoints(10) as Array<[number, number]>),
    p3,
    p4,
    ...(interpolateP2P4.getPoints(10) as Array<[number, number]>),
    p2,
  ]
    .map(([x, y]) => new Point(x, y))
    .reverse();
  debugger;
  return polygon;
}
