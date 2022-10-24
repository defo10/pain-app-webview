#version 300 es

precision lowp float;
precision lowp int;

in vec2 aVertexPosition;
in float aDistance;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

out float vDistance;
out vec2 vertexPosition;

void main() {
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

    vDistance = aDistance;
    vertexPosition = aVertexPosition;
}