import { PainShape } from "./pain_shape";

export interface ShapeParameters {
  considerConnectedLowerBound: number;
  gravitationForceVisibleLowerBound: number;
  closeness: number;
  painShapes: PainShape[];
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
  wings: number;
}

export type Model = StarShapeParameters &
  ColoringParameters &
  ShapeParameters & {
    dissolve: number;
    animationType: "off" | "linear-in" | "linear-out" | "soft";
    /** in hz */
    frequencyHz: number;
    amplitude: number;
    origin: [number, number];
    animationParamter: "radius" | "dissolve" | "innerColorStart" | "alphaFallOutEnd" | "outerOffsetRatio" | "roundness";
    [key: string]: any; // have this here to allow dynamic accessing
  };
