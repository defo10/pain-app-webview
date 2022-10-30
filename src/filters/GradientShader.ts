import { Filter, Program, Shader } from "pixi.js";
import vertex from "./vertex.vert";
import fragment from "./fragment.frag";
import starVertex from "./star.vert";
import starFragment from "./star.frag";
import { Dict } from "@pixi/utils";

export const gradientShaderFrom = (uniforms: Dict<any>): Filter => new Filter(vertex, fragment, uniforms);

export const starShaderFrom = (uniforms: Dict<any>): Shader => Shader.from(starVertex, starFragment, uniforms);
