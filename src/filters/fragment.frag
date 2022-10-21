#version 300 es

precision lowp float;
precision lowp int;

layout(std140) uniform;

uniform float gradientLength;
uniform float innerColorStart; // the ratio with respect to gradientLength where the outer color is 100 % visible 
uniform float alphaFallOutEnd; // the point where fading out should stop wrt gradient length, [0, 1]
uniform vec3 outerColorHSL;
uniform vec3 innerColorHSL; // HSL color spectrum

uniform vec2 rendererBounds; // [renderer width, renderer height]

uniform vec2 textureBounds; // [bgTexture width, bgTexture height]
uniform sampler2D backgroundTexture;

in float d;
in vec2 vertexPosition;

out vec4 outputColor;

// src https://www.shadertoy.com/view/XljGzV
vec3 hsl2rgb( in vec3 c )
{
    vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );

    return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
}

// src https://www.shadertoy.com/view/XljGzV
vec3 rgb2hsl( in vec3 c ){
  float h = 0.0;
	float s = 0.0;
	float l = 0.0;
	float r = c.r;
	float g = c.g;
	float b = c.b;
	float cMin = min( r, min( g, b ) );
	float cMax = max( r, max( g, b ) );

	l = ( cMax + cMin ) / 2.0;
	if ( cMax > cMin ) {
		float cDelta = cMax - cMin;
        
        //s = l < .05 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) ); Original
		s = l < .0 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) );
        
		if ( r == cMax ) {
			h = ( g - b ) / cDelta;
		} else if ( g == cMax ) {
			h = 2.0 + ( b - r ) / cDelta;
		} else {
			h = 4.0 + ( r - g ) / cDelta;
		}

		if ( h < 0.0) {
			h += 6.0;
		}
		h = h / 6.0;
	}
	return vec3( h, s, l );
}

void main() {
    float pct = smoothstep(0.0, gradientLength, d);

    float colorPct = smoothstep(0.0, gradientLength * innerColorStart, d);
    vec4 innerColor = vec4(hsl2rgb(innerColorHSL), 1.0);
    vec4 outerColor = vec4(hsl2rgb(outerColorHSL), 1.0);
    vec4 colorGradient = mix(outerColor, innerColor, colorPct);
    
	// 0 means background only, 1 means background not shining thorugh
    float backgroundPct = smoothstep(0.0, gradientLength * alphaFallOutEnd * 0.9999, d);

	float yBottomOffset = rendererBounds.y - textureBounds.y;
	float normalizedXCoord = gl_FragCoord.x / textureBounds.x;
	float normalizedYCoord = (gl_FragCoord.y - yBottomOffset) / textureBounds.y;
	bool isBelowPic = normalizedYCoord < 0.0;
	// don't draw render texture if background not visible anyway
	bool noBackgroundVisible = backgroundPct == 1.0;
    vec4 backgroundColor = (isBelowPic || noBackgroundVisible) ? vec4(1.0) : texture(backgroundTexture, vec2(normalizedXCoord, 1.0 - normalizedYCoord));

    outputColor = mix(backgroundColor, colorGradient, backgroundPct);
}