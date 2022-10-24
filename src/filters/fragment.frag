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

uniform vec2 origin; // point where pain originates from
uniform float time;
uniform float frequencyHz;
// 0: off, 1: linear-in, 2: linear-out, 3: soft
uniform int animationType;

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

float linearIn(float state) {
	if (state > 0.8) {
		return 0.0;
	}
	return smoothstep(0.0, 0.8, state);
}

float linearOut(float state) {
	if (state < 0.2) {
		return 0.0;
	}
	return smoothstep(0.2, 1.0, state); 
}

float soft(float state) {
	return 1. + -1.0 * pow(2.0 * state - 1.0, 2.);
}

void main() {
    float pct = smoothstep(0.0, gradientLength, d);

    float colorPct = smoothstep(0.0, gradientLength * innerColorStart, d);
    vec4 innerColor = vec4(hsl2rgb(innerColorHSL), 1.0);
    vec4 outerColor = vec4(hsl2rgb(outerColorHSL), 1.0);
    vec4 colorGradient = mix(outerColor, innerColor, colorPct);
    
	// 0 means background only, 1 means background not shining thorugh
    float backgroundPct = smoothstep(0.0, gradientLength * alphaFallOutEnd * 0.9999, d);

	// add animation effects:
	float maxDistanceToOrigin = length(textureBounds);
	float distanceOriginCoord = distance(origin, vertexPosition);
	float distanceRatio = distanceOriginCoord / maxDistanceToOrigin;
	
	float timeForOneRepetition = 1000. / frequencyHz;
  	float state = mod(time + distanceRatio * 1000., timeForOneRepetition) / timeForOneRepetition; // -> [0, 1]
	float visibility = 1.0;
	if (animationType == 1) {
		visibility = linearIn(state);
	}
	if (animationType == 2) {
		visibility = linearOut(state);
	}
	if (animationType == 3) {
		visibility = soft(state);
	}

    outputColor = vec4(colorGradient.rgb * backgroundPct, backgroundPct);
}