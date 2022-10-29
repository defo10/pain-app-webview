import { PainShape } from "./pain_shape";

export interface ShapeParameters {
  considerConnectedLowerBound: number;
  gravitationForceVisibleLowerBound: number;
  closeness: number;
  painShapes: PainShape[];
  painShapesDragging: boolean[];
}

export interface ColoringParameters {
  innerColorStart: number;
  alphaFallOutEnd: number;
  outerColorHSL: [number, number, number];
  innerColorHSL: [number, number, number];
}

export interface StarShapeParameters {
  innerOffset: number;
  roundness: number;
  wingLength: number;
}

export interface Model {
  shapeParams: ShapeParameters;
  coloringParams: ColoringParameters;
  dissolve: number;
  starShapeParams: StarShapeParameters;
  /** 0: off, 1: linear-in, 2: linear-out, 3: soft */
  animationType: 0 | 1 | 2 | 3;
  /** in hz */
  frequencyHz: number;
  amplitude: number;
}
