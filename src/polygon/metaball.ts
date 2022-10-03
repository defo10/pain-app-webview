import * as PIXI from "pixi.js";
import { Polygon } from "./polygons";
import * as gl from "gl-matrix";
import { angle, bounds, dist, getVector } from "./utils";

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
): Polygon {
  const { p1, p2, p3, p4 } = bounds(radius1, radius2, center1, center2, v);

  // midpoint
  const center1ToCenter2 = gl.vec2.sub([0.0, 0.0], center2, center1);
  const midpoint = gl.vec2.add([0.0, 0.0], center1, gl.vec2.scale([0.0, 0.0], center1ToCenter2, 0.5));
  const P1P3 = gl.vec2.sub([0.0, 0.0], p3, p1);
  const midpointOnP1P3 = gl.vec2.add([0.0, 0.0], p1, gl.vec2.scale([0.0, 0.0], center1ToCenter2, 0.5));
  const midpointVector = gl.vec2.sub([0.0, 0.0], midpointOnP1P3, midpoint);
  const midpointToMidpointOnP1P3 = gl.vec2.add([0.0, 0.0], midpoint, gl.vec2.scale([0.0, 0.0], midpointVector, t));
  const midpointToMidpointOnP2P4 = gl.vec2.add([0.0, 0.0], midpoint, gl.vec2.scale([0.0, 0.0], midpointVector, -t));
  const polygon: Polygon = [
    new PIXI.Point(...p1),
    new PIXI.Point(...midpointToMidpointOnP1P3),
    new PIXI.Point(...p3),
    new PIXI.Point(...p4),
    new PIXI.Point(...midpointToMidpointOnP2P4),
    new PIXI.Point(...p2),
  ];
  return polygon;
}
