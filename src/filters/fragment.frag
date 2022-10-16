precision mediump float;

uniform float gradientLength;

varying vec2 vShortestDistVector;

void main() {
    float pct = smoothstep(0.0, gradientLength, length(vShortestDistVector));
    gl_FragColor = vec4(pct, 0., 0., 1.);
}