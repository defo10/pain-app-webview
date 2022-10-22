import { Point } from "pixi.js";

export class PainShape {
  static dist(a: PainShape, b: PainShape) {
    return Math.sqrt(Math.pow(a.position.x - b.position.x, 2) + Math.pow(a.position.y - b.position.y, 2));
  }

  position: Point;
  radius: number;
  dragging: boolean | undefined;
  hasChanged: boolean | undefined;
  resizing: boolean | undefined;

  constructor(position: Point, radius: number) {
    this.position = position;
    this.radius = radius;
  }

  get positionAsVec2(): [number, number] {
    return [this.position.x, this.position.y];
  }
}
