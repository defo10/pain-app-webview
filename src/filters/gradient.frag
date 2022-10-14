#version 300 es

#define TWO_PI 6.28318530718

precision mediump float;
precision mediump int;

out vec4 outputColor;

in vec2 vTextureCoord; //The coordinates of the current pixel
uniform sampler2D uSampler; //The image data
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 filterClamp;

// Backdrop texture with destination colors
uniform sampler2D uBackdrop; 
uniform vec2 uBackdrop_flipY;

uniform float gradientLength;
uniform float innerColorStart; // the ratio with respect to gradientLength where the outer color is 100 % visible 
uniform float alphaFallOutEnd; // the point where fading out should stop wrt gradient length, [0, 1]
uniform vec3 outerColorHSL;
uniform vec3 innerColorHSL; // HSL color spectrum

// distance field texture buffer
uniform sampler2D dfTexture;

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
    float dist = texture(dfTexture, vTextureCoord).r;

    float colorPct = smoothstep(0.0, gradientLength * innerColorStart, dist);
    vec4 innerColor = vec4(hsl2rgb(innerColorHSL), 1.0);
    vec4 outerColor = vec4(hsl2rgb(outerColorHSL), 1.0);
    vec4 colorGradient = mix(outerColor, innerColor, colorPct);
    
    float backgroundPct = smoothstep(0.0, gradientLength * alphaFallOutEnd * 0.9999, dist);

    vec2 backdropCoord = vec2(vTextureCoord.x, uBackdrop_flipY.x + uBackdrop_flipY.y * vTextureCoord.y);
    vec4 backgroundColor = texture(uBackdrop, backdropCoord);

    outputColor = mix(backgroundColor, colorGradient, backgroundPct);
}