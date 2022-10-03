import { PainShape } from "./pain_shape";

export class GravitatingShape {
  readonly from: PainShape;
  readonly to: PainShape;
  readonly distanceRatio: number;

  constructor(from: PainShape, to: PainShape, distanceRatio: number) {
    this.from = from;
    this.to = to;
    this.distanceRatio = distanceRatio;
  }
}
