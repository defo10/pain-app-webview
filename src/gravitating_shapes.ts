import { PainShape } from "./pain_shape";

/** this is a model of the pull towards each other of two shapes. */
export class Connection<T> {
  readonly from: T;
  readonly to: T;
  readonly distanceRatio: number | undefined;

  constructor(from: T, to: T, distanceRatio?: number) {
    this.from = from;
    this.to = to;
    this.distanceRatio = distanceRatio;
  }
}
