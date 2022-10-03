import * as PIXI from "pixi.js";
import "@pixi/math-extras";
import { PainShape } from "../pain_shape";
import _ from "lodash";
import * as gl from "gl-matrix";
import { bounds, lerpPoints } from "./utils";

var lerp = require("interpolation").lerp;
var smoothstep = require("interpolation").smoothstep;

export type Polygon = PIXI.Point[];

/** returns polygon of a circle around @param center with @param radius */
export const circlePolygon = (center: PIXI.Point, radius: number): Polygon => {
  const circlePaths = [];
  for (let i = 0; i < 2 * Math.PI; i = i + 0.1) {
    circlePaths.push(new PIXI.Point(center.x + Math.cos(i) * radius, center.y + Math.sin(i) * radius));
  }
  return circlePaths;
};

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
  return [new PIXI.Point(...p1), new PIXI.Point(...gravitationPoint), new PIXI.Point(...p2)];
}
