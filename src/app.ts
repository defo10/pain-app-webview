import _ from "lodash";
import { PainShape } from "./pain_shape";
import * as clipperLib from "js-angusj-clipper";
import * as gl from "gl-matrix";
import { autoDetectRenderer, Filter, Graphics, Point } from "pixi.js";
import { metaballsPaths } from "./polygon";

// gl matrix uses float 32 types by default, but array is much faster.
gl.glMatrix.setMatrixArrayType(Array);

const renderer = autoDetectRenderer({
  width: document.getElementById("animations-canvas")?.clientWidth,
  height: document.getElementById("animations-canvas")?.clientHeight,
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  antialias: true,
  resolution: 2,
  backgroundAlpha: 1,
  backgroundColor: 0xffffff,
});

const VERT_SRC = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;

varying vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}
`;

const FRAG_SRC = `
precision mediump float;

#define TWO_PI 6.28318530718

varying vec2 vTextureCoord;//The coordinates of the current pixel
uniform sampler2D uSampler;//The image data
uniform vec4 inputSize;
uniform vec4 outputFrame;

uniform vec3 centers[3]; // arrays of all painshapes, in form [x, y, radius]
uniform float outerColorStart; // the ratio with respect to the radius where the outer color is 100 % visible 
uniform float alphaFalloutStart; // the ratio with respect to the radius where the shape starts fading out
uniform vec3 outerColorHSL;
uniform vec3 innerColorHSL; // HSL color spectrum

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


void main(void) {
    gl_FragColor = texture2D(uSampler, vTextureCoord);
    if (gl_FragColor.a == 0.0) return;

    vec2 screenCoord = vTextureCoord * inputSize.xy + outputFrame.xy;

    vec3 minDistCenter = centers[0];
    float minDistance = distance(minDistCenter.xy, screenCoord);
    for (int i = 1; i < 3; i++) {
      float distanceToCenter = distance(centers[i].xy, screenCoord);

      if (minDistance < distanceToCenter) {
        continue;
      }

      minDistance = distanceToCenter;
      minDistCenter = centers[i];
    }
    float radius = minDistCenter.z;

    // this shifts the gradient 
    float distanceRatio = minDistance / radius;
    // we multiply by 1.4 because we don't want the color to be visible at the edge too prominently
    float pct = smoothstep(0.0, outerColorStart, distanceRatio);
    vec4 innerColor = vec4(hsl2rgb(innerColorHSL), 1.0);
    vec4 outerColor = vec4(hsl2rgb(outerColorHSL), 1.0);
    vec4 colorGradient = mix(innerColor, outerColor, pct);
    
    // this causes the color to blur out starting from alphaFalloutStart % of radius
    vec3 colorHsl = rgb2hsl(colorGradient.rgb);
    // -> [0.0, 1.0]
    float lightnessIncreaseRatio = smoothstep(radius * alphaFalloutStart * 0.9999, radius, minDistance);
    // stays colorHsl.z for all under radius * alphaFallout
    float lightness = mix(colorHsl.z, 1.0, lightnessIncreaseRatio);
    vec3 colorHslLighter = vec3(colorHsl.xy, lightness);
    gl_FragColor = vec4(hsl2rgb(colorHslLighter), 1.0);
}
`;

const clipper = clipperLib.loadNativeClipperLibInstanceAsync(
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
);

const valueFromElement = (id: string) => parseFloat((document.getElementById(id) as HTMLInputElement).value);
/** returns HSL! */
const outerColorPicker = (colorCode: string): [number, number, number] | null => {
  switch (colorCode) {
    case "yellow":
      return [55 / 360, 1.0, 0.5];
    case "orange":
      return [38 / 360, 1.0, 0.5];
    case "red":
      return [0.0, 1.0, 0.5];
    default:
      return null;
  }
};

/** returns HSL! */
const innerColorPicker = (colorCode: string, lightness: number): [number, number, number] => {
  switch (colorCode) {
    case "yellow":
      return [55 / 360, 1.0, lightness];
    case "blue":
      return [241 / 360, 1.0, lightness];
    default: // red
      return [0, 1.0, lightness];
  }
};
const checkedRadioBtn = (name: string) =>
  (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement)?.value;

// draw polygon
const animate = (time: number): void => {
  const model = {
    considerConnectedLowerBound: 0.75,
    gravitationForceVisibleLowerBound: 0.5,
    painShapes: [
      new PainShape(new Point(120, 90), valueFromElement("radius")),
      new PainShape(new Point(170, 120), valueFromElement("radius")),
      new PainShape(new Point(140, 180), valueFromElement("radius")),
    ],
    closeness: valueFromElement("closeness"),
  };

  const innerColor = innerColorPicker(checkedRadioBtn("innerColor"), valueFromElement("lightness"));
  const uniforms = {
    centers: new Float32Array(model.painShapes.map((p) => [p.position.x, p.position.y, p.radius]).flat()),
    outerColorStart: valueFromElement("colorShift"),
    alphaFalloutStart: valueFromElement("alphaRatio"),
    outerColorHSL: outerColorPicker(checkedRadioBtn("outerColor")) ?? innerColor,
    innerColorHSL: innerColor,
  };
  const shader = new Filter(VERT_SRC, FRAG_SRC, uniforms);
  shader.resolution = 2;

  clipper
    .then((clipper) => {
      const graphics = new Graphics();
      graphics.geometry.batchable = false;
      graphics.beginFill(0xc92626, 1);

      for (const polygon of metaballsPaths(clipper, model)) {
        graphics.drawPolygon(polygon);
      }

      graphics.endFill();

      graphics.filters = [shader];

      renderer.render(graphics);
      requestAnimationFrame(animate);
    })
    .catch((err) => console.log(err));
};
animate(performance.now());
