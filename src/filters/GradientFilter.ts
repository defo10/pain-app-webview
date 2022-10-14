import { Filter, FilterSystem, FilterState, RenderTexture } from "@pixi/core";
import { DistanceFieldFilter } from "./DistanceFieldFilter";
import { CLEAR_MODES, UniformGroup } from "pixi.js";
import vertex from "./generic.vert";
import fragment from "./gradient.frag";
import { BackdropFilter } from "@pixi/picture";

interface GradientFilterOptions {
  gradientLength: number;
  innerColorStart: number;
  alphaFallOutEnd: number;
  outerColorHSL: [number, number, number];
  innerColorHSL: [number, number, number];
  paths_ubo: UniformGroup;
  ranges: Int32Array;
  rangesLen: number;
}

class GradientFilter extends BackdropFilter {
  private _dfFilter: DistanceFieldFilter;
  protected _resolution: number = 1.0;

  constructor(uniforms: GradientFilterOptions, res: number) {
    super(vertex, fragment, uniforms);

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { paths_ubo, gradientLength, ranges, rangesLen } = uniforms;

    this._dfFilter = new DistanceFieldFilter({
      paths_ubo,
      gradientLength,
      ranges,
      rangesLen,
    });
    this._dfFilter.resolution = res;
    this._resolution = res;
    this.backdropUniformName = "uBackdrop";
    this.padding = 15; // when not using padding, there are black stripe artefacts
  }

  /**
   * Override existing apply method in PIXI.Filter
   *
   * @private
   */
  apply(
    filterManager: FilterSystem,
    input: RenderTexture,
    output: RenderTexture,
    clear: CLEAR_MODES,
    currentState?: FilterState
  ): void {
    // TODO change resoultion here
    const dfTargetTexture = filterManager.getFilterTexture();
    this._dfFilter.apply(filterManager, input, dfTargetTexture, 1, currentState);

    this.uniforms.dfTexture = dfTargetTexture;
    filterManager.applyFilter(this, input, output, clear);

    filterManager.returnFilterTexture(dfTargetTexture);
  }

  get resolution(): number {
    return this._resolution;
  }

  set resolution(value: number) {
    this._resolution = value;

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (this._dfFilter) this._dfFilter.resolution = value;
  }
}

export { GradientFilter };
export type { GradientFilterOptions };
