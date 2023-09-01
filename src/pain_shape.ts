import { Point } from "pixi.js";

type Offspring = {
  /** angle in rad */
  angle: number;
  offset: number;
  radius: number;
};

export class PainShape {
  static dist(a: PainShape, b: PainShape) {
    return Math.sqrt(Math.pow(a.position.x - b.position.x, 2) + Math.pow(a.position.y - b.position.y, 2));
  }

  id: number;
  position: Point;
  _radius: number;

  offsprings: Offspring[];

  dragging: boolean | undefined;
  hasChanged: boolean | undefined;
  resizing: boolean | undefined;

  constructor(id: number, position: Point, radius: number) {
    this.id = id;
    this.position = position;
    this._radius = radius;

    this.offsprings = this.randomizedOffsprings();
  }

  randomizedOffsprings(): Offspring[] {
    const offsprings: Offspring[] = [];

    const maxOffsetsSize = Math.ceil(this.radius);
    for (let counter = 0; counter < maxOffsetsSize; counter++) {
      const angle = Math.random() * Math.PI * 2;
      const offset = Math.random() * this.radius * 1.3;
      const radius = 3 + Math.ceil(Math.random() * 7);
      offsprings.push({ angle, offset, radius });
    }

    return offsprings;
  }

  get positionAsVec2(): [number, number] {
    return [this.position.x, this.position.y];
  }

  get radius(): number {
    return this._radius;
  }

  set radius(newRadius: number) {
    this._radius = newRadius;
    this.offsprings = this.randomizedOffsprings();
  }
}
