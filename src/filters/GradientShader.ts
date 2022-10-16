import { Shader } from "pixi.js";
import vertex from "./vertex.vert";
import fragment from "./fragment.frag";
import { Dict } from "@pixi/utils";

export const gradientShaderFrom = (uniforms: Dict<any>): Shader => Shader.from(vertex, fragment, uniforms);
