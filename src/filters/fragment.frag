#version 300 es

precision mediump float;

uniform float gradientLength;

in float d;

out vec4 outputColor;

void main() {
    //float pct = smoothstep(0.0, gradientLength, length(vShortestDistVector));
    float pct = smoothstep(0.0, gradientLength, d);

    outputColor = vec4(pct, 0., 0., 1.);
}