#version 300 es

precision mediump float;
precision mediump int;

#define POINTS_MAX_LEN 200

out vec4 outputColor;

in vec2 vTextureCoord; //The coordinates of the current pixel
uniform sampler2D uSampler; //The image data
uniform vec4 inputSize;
uniform vec4 outputFrame;

uniform float innerColorStart; // the ratio with respect to gradientLength where the outer color is 100 % visible 
uniform float alphaFallOutEnd; // the point where fading out should stop wrt distance, [0, 1]
uniform vec3 outerColorHSL;
uniform vec3 innerColorHSL; // HSL color spectrum

uniform points_ubo {
  vec4 points[POINTS_MAX_LEN];
};
uniform int points_len;
uniform float threshold;
uniform float outerOffsetRatio;

uniform highp float timePerLoop;
uniform highp float timeSinceStart;
uniform float maxDistanceToOrigin;
uniform float amplitude;
uniform int animationParameterFlag;
uniform int motionFnFlag;
uniform vec2 animationOrigin;

float soft(in float t) {
  float turningPoint = 0.5;
  if (t < turningPoint) return smoothstep(0., turningPoint, t);
  return smoothstep(1., turningPoint, t);
}

float linearIn(in float t) {
  float turningPoint = 0.9;
  if (t < turningPoint) return smoothstep(0., turningPoint, t);
  return smoothstep(1., turningPoint, t);
}

float linearOut(in float t) {
  float turningPoint = 0.1;
  if (t < turningPoint) return smoothstep(0., turningPoint, t);
  return smoothstep(1., turningPoint, t);
}

float motionFn(in int flag, in float t) {
  switch(flag) {
    case 0:
      return soft(t);
    case 1:
      return linearIn(t);
    case 2:
      return linearOut(t);
    default: // off
      return 1.0;
  }
}

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

// src: https://link.springer.com/content/pdf/10.1007/BF01900346.pdf
float falloff( in float d, in float radius ) {
  float R = radius * 2.0;
  if (d >= R) {
    return 0.0;
  }
  float first = 2.0 * pow(d / R, 3.0);
  float second = -3.0 * pow(d / R, 2.0);
  return first + second + 1.0;
}

void main(void) {
    outputColor = texture(uSampler, vTextureCoord);
    if (outputColor.a == 0.0) return;

    vec2 screenCoord = vTextureCoord * inputSize.xy + outputFrame.xy;

    float distanceToOrigin = distance(screenCoord, animationOrigin);
    float distanceRatio = distanceToOrigin / maxDistanceToOrigin;
    float timeShift = mix(0., timePerLoop, distanceRatio);
    float t = mod(timeSinceStart + timeShift, timePerLoop) / timePerLoop;
    float motion = motionFn(motionFnFlag, t);
    float amplitudeClampedMotion = mix(amplitude, 1.0, motion);

    // dist \in [0..1], 0 being farthest away
    float df = 0.0;
    for (int n = 0; n < points_len; n++) {
      float d = distance(screenCoord, points[n].xy);
      // float squaredDistance = pow(screenCoord.x - points[n].x, 2.0) + pow(screenCoord.y - points[n], 2.0);
      df += falloff(d, points[n].z);
    }

    float pct = smoothstep(threshold, 1.0, df);

    // pct is 0.0 at edge and 1.0 at center
    float innerColorAnimatedPct = (animationParameterFlag == 0) ? pct * amplitudeClampedMotion : pct;
    float innerColorPct = smoothstep(0., innerColorStart * 2.0, innerColorAnimatedPct);
    vec4 innerColor = vec4(hsl2rgb(innerColorHSL), 1.0);
    vec4 outerColor = vec4(hsl2rgb(outerColorHSL), 1.0);
    vec4 colorGradient = mix(outerColor, innerColor, innerColorPct);
    
    if (outerOffsetRatio > 0.0) {
      outputColor = colorGradient;
      return;
    } else {
      float backgroundAnimatedPct = (animationParameterFlag == 1) ? pct * amplitudeClampedMotion : pct;
      float backgroundPct = smoothstep(0.0, alphaFallOutEnd * 1.5, backgroundAnimatedPct);
      outputColor = vec4(colorGradient.rgb * backgroundPct, backgroundPct);
    }
}