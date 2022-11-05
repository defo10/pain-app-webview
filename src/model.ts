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
  outerOffsetRatio: number;
  roundness: number;
  wingWidth: number;
}

export interface Model {
  shapeParams: ShapeParameters;
  coloringParams: ColoringParameters;
  dissolve: number;
  starShapeParams: StarShapeParameters;
  animationType: "off" | "linear-in" | "linear-out" | "soft";
  /** in hz */
  frequencyHz: number;
  amplitude: number;
  origin: [number, number];
}
