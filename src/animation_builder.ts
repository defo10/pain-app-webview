import { dist } from "./polygon/utils";
const lerp = require("interpolation").lerp;
const smoothstep = require("interpolation").smoothstep;

export class AnimationBuilder {
  public readonly origin: [number, number];
  public readonly maxDistanceToOrigin;
  private readonly animationType;
  private readonly frequencyHz;
  private readonly lastTime;
  private readonly amplitude;

  constructor(
    normalizedOrigin: [number, number],
    bb: { minX: number; minY: number; maxX: number; maxY: number },
    animationType: string,
    frequencyHz: number,
    lastTime: number,
    amplitude: number
  ) {
    const [xOriginRatio, yOriginRatio] = normalizedOrigin;
    this.origin = [bb.minX + xOriginRatio * bb.maxX, bb.minY + yOriginRatio * bb.maxY];
    this.maxDistanceToOrigin = Math.max(
      ...[
        [bb.minX, bb.minY],
        [bb.maxX, bb.minY],
        [bb.minX, bb.maxY],
        [bb.maxX, bb.maxY],
      ].map((p) => dist(this.origin, p as [number, number]))
    );
    this.animationType = animationType;
    this.frequencyHz = frequencyHz;
    this.lastTime = lastTime;
    this.amplitude = amplitude;
  }

  soft = (t: number): number => {
    const turningPoint = 0.5;
    if (t < turningPoint) return smoothstep(0, turningPoint, t);
    return smoothstep(1, turningPoint, t);
  };

  linearIn = (t: number): number => {
    const turningPoint = 0.9;
    if (t < turningPoint) return smoothstep(0, turningPoint, t);
    return smoothstep(1, turningPoint, t);
  };

  linearOut = (t: number): number => {
    const turningPoints = 0.1;
    if (t < turningPoints) return smoothstep(0, turningPoints, t);
    return smoothstep(1, turningPoints, t);
  };

  private motionFn(t: number): number {
    switch (this.animationType) {
      case "linear-in":
        return this.linearIn(t);
      case "linear-out":
        return this.linearOut(t);
      case "soft":
        return this.soft(t);
      default:
        return 1;
    }
  }

  public t(center: [number, number]): number {
    const distanceToOrigin = dist(center, this.origin);
    const distanceRatio = distanceToOrigin / this.maxDistanceToOrigin;
    const timePerLoop = 1000 / this.frequencyHz;
    const timeShift: number = lerp(0, timePerLoop, distanceRatio);
    const timeSinceStart = (this.lastTime + timeShift) % timePerLoop;
    const t = timeSinceStart / timePerLoop;

    const motion = this.motionFn(t); // 0..1
    const amplitudeClampedMotion = lerp(this.amplitude, 1, motion);
    return amplitudeClampedMotion;
  }
}
