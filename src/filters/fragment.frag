precision mediump float;

uniform float gradientLength;

varying vec2 vShortestDistVector;
varying float d;

void main() {
    //float pct = smoothstep(0.0, gradientLength, length(vShortestDistVector));
    float pct = smoothstep(0.0, gradientLength, d);

    gl_FragColor = vec4(pct, 0., 0., 1.);
}