import { Program, Shader } from "pixi.js";
import vertex from "./vertex.vert";
import fragment from "./fragment.frag";
import starVertex from "./star.vert";
import starFragment from "./star.frag";
import { Dict } from "@pixi/utils";

export const GradientProgram = new Program(vertex, fragment);
export const gradientShaderFrom = (uniforms: Dict<any>): Shader => Shader.from(vertex, fragment, uniforms);

export const starShaderFrom = (uniforms: Dict<any>): Shader => Shader.from(starVertex, starFragment, uniforms);
