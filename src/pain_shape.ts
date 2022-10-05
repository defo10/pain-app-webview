import gl from "gl-matrix";
import { Point } from "pixi.js";

export class PainShape {
  static dist(a: PainShape, b: PainShape) {
    return Math.sqrt(Math.pow(a.position.x - b.position.x, 2) + Math.pow(a.position.y - b.position.y, 2));
  }

  readonly position: Point;
  readonly radius: number;

  constructor(position: Point, radius: number) {
    this.position = position;
    this.radius = radius;
  }

  get positionAsVec2(): gl.ReadonlyVec2 {
    return [this.position.x, this.position.y];
  }
}
