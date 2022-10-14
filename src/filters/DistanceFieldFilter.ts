import { Filter } from "pixi.js";
import vertex from "./generic.vert";
import dfFragment from "./distance-field.frag";
import { Dict } from "@pixi/utils";

/** passes a distance field texture buffer to succeeding filters
 *
 * uses webgl 2.0. Exposes distance field as uniform sampler2D uDistanceField
 */
export class DistanceFieldFilter extends Filter {
  constructor(uniforms: Dict<any>) {
    super(vertex, dfFragment, uniforms);
  }
}
