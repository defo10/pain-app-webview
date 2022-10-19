#version 300 es

precision mediump float;

uniform vec2 bounds; // [renderer width, renderer height]
uniform float gradientLength;
uniform sampler2D backgroundTexture;

in float d;
in vec2 vertexPosition;

out vec4 outputColor;

void main() {
    //float pct = smoothstep(0.0, gradientLength, length(vShortestDistVector));
    float pct = smoothstep(0.0, gradientLength, d);

    //outputColor = vec4(1, 0., 0., pct);
    vec2 normalizedSceenCoord = gl_FragCoord.xy / bounds;
    vec2 backdropFlipY = vec2(normalizedSceenCoord.x, 1.0 - normalizedSceenCoord.y);
    outputColor = texture(backgroundTexture, backdropFlipY);
}