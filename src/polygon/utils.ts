import * as gl from "gl-matrix";
import { Point } from "pixi.js";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lerp = require("interpolation").lerp;

export function lerpPoints([x1, y1]: [number, number], [x2, y2]: [number, number], t: number): [number, number] {
  return [lerp(x1, x2, t), lerp(y1, y2, t)];
}

export function dist([x1, y1]: readonly [number, number], [x2, y2]: readonly [number, number]): number {
  return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5;
}

export function angle([x1, y1]: readonly [number, number], [x2, y2]: readonly [number, number]): number {
  return Math.atan2(y1 - y2, x1 - x2);
}

export function getVector(c: readonly [number, number], a: number, r: number): readonly [number, number] {
  return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
}

/** returns the points crossing the leftmost and rightmost lines touching both circles, starting
 * with the left point (p1), then right point (p2) looking from @param center1 to @param center2,
 * then left point (p3), then right point (p4)
 * 
 *           p2                                      p4
          +----------------------------------------+
    XXXXXXXXX                                    XXXXXXXXX
  XX        XXX                                 XX        XX
 XX           XX                              XXX          X
 X             X                            XXX            XX
XX             XX                           X               X
X   center1     X                           X               X
X               X                           X   center2     X
X               X                           X              XX
XX              X                           X             XX
 X             X                            X            XX
  XXXXXXXXXXXXXX                             XXX      XXXX
     XX                                        XXXXXXXX
      +--------------------------------------------+
      p1                                           p3

 *
 * scr: https://varun.ca/metaballs/
 */
export function bounds(
  radius1: number,
  radius2: number,
  center1: readonly [number, number],
  center2: readonly [number, number],
  inwardShift: number
): {
  p1: readonly [number, number];
  p2: readonly [number, number];
  p3: readonly [number, number];
  p4: readonly [number, number];
} {
  const d = dist(center1, center2);
  let u1, u2;

  if (d < radius1 + radius2) {
    u1 = Math.acos((radius1 * radius1 + d * d - radius2 * radius2) / (2 * radius1 * d));
    u2 = Math.acos((radius2 * radius2 + d * d - radius1 * radius1) / (2 * radius2 * d));
  } else {
    u1 = 0;
    u2 = 0;
  }

  // All the angles
  const angleBetweenCenters = angle(center2, center1);
  const maxSpread = Math.acos((radius1 - radius2) / d);

  const angle1 = angleBetweenCenters + u1 + (maxSpread - u1) * inwardShift;
  const angle2 = angleBetweenCenters - u1 - (maxSpread - u1) * inwardShift;
  const angle3 = angleBetweenCenters + Math.PI - u2 - (Math.PI - u2 - maxSpread) * inwardShift;
  const angle4 = angleBetweenCenters - Math.PI + u2 + (Math.PI - u2 - maxSpread) * inwardShift;
  // Points
  const p1 = getVector(center1, angle1, radius1);
  const p2 = getVector(center1, angle2, radius1);
  const p3 = getVector(center2, angle3, radius2);
  const p4 = getVector(center2, angle4, radius2);

  return { p1, p2, p3, p4 };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export const insideCircle = ([x1, y1]: readonly [number, number], radius: number, [x2, y2]: gl.vec2): boolean => {
  return Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2) <= radius * radius;
};

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
