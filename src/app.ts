import _ from "lodash";
import { PainShape } from "./pain_shape";
import * as clipperLib from "js-angusj-clipper";
import * as gl from "gl-matrix";
import { autoDetectRenderer, Container, ENV, Filter, Graphics, Point, settings } from "pixi.js";
import "@pixi/math-extras";
import { metaballsPaths } from "./polygon";

// gl matrix uses float 32 types by default, but array is much faster.
gl.glMatrix.setMatrixArrayType(Array);

settings.PREFER_ENV = ENV.WEBGL2;

const renderer = autoDetectRenderer({
  width: document.getElementById("animations-canvas")?.clientWidth,
  height: document.getElementById("animations-canvas")?.clientHeight,
  view: document.getElementById("animations-canvas") as HTMLCanvasElement,
  antialias: true,
  resolution: 2,
  backgroundAlpha: 1,
  backgroundColor: 0xffffff,
});

const VERT_SRC = `#version 300 es

precision highp float;

in vec2 aVertexPosition;

uniform mat3 projectionMatrix;

out vec2 vTextureCoord;

uniform vec4 inputSize;
uniform vec4 outputFrame;

vec4 filterVertexPosition( void )
{
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;

    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aVertexPosition * (outputFrame.zw * inputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const FRAG_SRC = (polygons: number[][]) => `#version 300 es

precision highp float;

#define TWO_PI 6.28318530718
#define CENTERS_LEN 3
#define SKELETONGRAPH_LEN 6

#define PATHS_LEN ${polygons.reduce((sum, p) => sum + p.length, 0)}
#define RANGES_LEN ${polygons.length}

out vec4 outputColor;

in vec2 vTextureCoord;//The coordinates of the current pixel
uniform sampler2D uSampler;//The image data
uniform vec4 inputSize;
uniform vec4 outputFrame;

uniform vec3 centers[CENTERS_LEN]; // arrays of all painshapes, in form [x, y, radius]
uniform float outerColorStart; // the ratio with respect to the radius where the outer color is 100 % visible 
uniform float alphaFalloutStart; // the ratio with respect to the radius where the shape starts fading out
uniform vec3 outerColorHSL;
uniform vec3 innerColorHSL; // HSL color spectrum
// both work together and form a connection [skeletonGraphFrom[i], skeletonGraphTo[i]]
uniform vec3 skeletonGraphFrom[SKELETONGRAPH_LEN];
uniform vec3 skeletonGraphTo[SKELETONGRAPH_LEN];

uniform vec2 paths[PATHS_LEN];
uniform ivec2 ranges[RANGES_LEN];


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

float minimum_distance(vec2 v, vec2 w, vec2 p) {
  // Return minimum distance between line segment vw and point p
  float l2 = pow(w.x - v.x, 2.0) + pow(w.y - v.y, 2.0);  // i.e. |w-v|^2 -  avoid a sqrt
  // Consider the line extending the segment, parameterized as v + t (w - v).
  // We find projection of point p onto the line. 
  // It falls where t = [(p-v) . (w-v)] / |w-v|^2
  // We clamp t from [0,1] to handle points outside the segment vw.
  float t = clamp(dot(p - v, w - v) / l2, 0., 1.);
  vec2 projection = v + t * (w - v);  // Projection falls on the segment
  return distance(p, projection);
}

void main(void) {
    outputColor = texture(uSampler, vTextureCoord);
    if (outputColor.a == 0.0) return;

    vec2 screenCoord = vTextureCoord * inputSize.xy + outputFrame.xy;

    float dist = 1000000.0;
    for (int n = 0; n < RANGES_LEN; n++) {
      ivec2 range = ranges[n];

      for (int i = range.x; i < range.y - 1; i++) {
        // at range.y - 1, to points to last path
        vec2 from = paths[i];
        vec2 to = paths[i + 1];
        float minDist = minimum_distance(from, to, screenCoord);
        dist = min(dist, minDist);

        if (minDist < 1.0) {
          outputColor = vec4(0., 0., 0., 1.0);
          return;
        }

      }

      vec2 last = paths[range.y - 1];
      vec2 first = paths[range.x];
      float minDist = minimum_distance(last, first, screenCoord);
      dist = min(dist, minDist);

      if (minDist < 2.0) {
        outputColor = vec4(0., 0., 0., 1.0);
        return;
      }
    }

    float pct = smoothstep(0.0, 10.0, dist);
    vec4 innerColor = vec4(hsl2rgb(innerColorHSL), 1.0);
    vec4 outerColor = vec4(hsl2rgb(outerColorHSL), 1.0);
    vec4 colorGradient = mix(innerColor, outerColor, pct);
    
    outputColor = colorGradient;
    // this causes the color to blur out starting from alphaFalloutStart % of radius
    //vec3 colorHsl = rgb2hsl(colorGradient.rgb);
    // -> [0.0, 1.0]
    //float lightnessIncreaseRatio = smoothstep(radius * alphaFalloutStart * 0.9999, radius, minDistance);
    // stays colorHsl.z for all under radius * alphaFallout
    //float lightness = mix(colorHsl.z, 1.0, lightnessIncreaseRatio);
    //vec3 colorHslLighter = vec3(colorHsl.xy, lightness);
    //outputColor = vec4(hsl2rgb(colorHslLighter), 1.0);
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

const getRanges = (arr: number[][]): number[] => {
  const ranges: number[] = [];
  for (const sub of arr) {
    if (ranges.length == 0) {
      ranges.push(0, Math.floor(sub.length / 2));
      continue;
    }
    const last = ranges[ranges.length - 1];
    // order of execution in math formula matters because last was already divided by!
    ranges.push(last, Math.floor(last + sub.length / 2));
  }
  return ranges;
};

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

  clipper
    .then((clipper) => {
      const { paths, skeletonGraph } = metaballsPaths(clipper, model);

      const graphics = new Graphics();
      graphics.geometry.batchable = false;
      graphics.beginFill(0x000000);

      const scalingFactor = 10e8;
      const polygonsUnioned = clipper
        .clipToPaths({
          clipType: clipperLib.ClipType.Union,
          subjectFillType: clipperLib.PolyFillType.NonZero,
          subjectInputs: [...paths.entries()].flatMap(([_, polygons]) =>
            polygons.map((p) => ({
              closed: true,
              data: p.map(({ x, y }) => ({ x: Math.round(x * scalingFactor), y: Math.round(y * scalingFactor) })),
            }))
          ),
        })
        ?.filter((p) => clipper.orientation(p)) // filter out all holes, TODO consider area too
        ?.map((p) => p.map(({ x, y }) => [x / scalingFactor, y / scalingFactor]))!;

      for (const path of polygonsUnioned!) {
        graphics.drawPolygon(
          path.map(([x, y]) => ({
            x: x,
            y: y,
          }))
        );
      }

      graphics.endFill();

      const innerColor = innerColorPicker(checkedRadioBtn("innerColor"), valueFromElement("lightness"));
      const polygonsFlattened = polygonsUnioned.map((path) => path.flat());
      const uniforms = {
        centers: new Float32Array(model.painShapes.map((p) => [p.position.x, p.position.y, p.radius]).flat()),
        outerColorStart: valueFromElement("colorShift"),
        alphaFalloutStart: valueFromElement("alphaRatio"),
        outerColorHSL: outerColorPicker(checkedRadioBtn("outerColor")) ?? innerColor,
        innerColorHSL: innerColor,
        paths: new Float32Array(polygonsFlattened.flat()),
        ranges: new Int32Array(getRanges(polygonsFlattened).flat()),
      };
      debugger;
      const shader = new Filter(VERT_SRC, FRAG_SRC(polygonsFlattened), uniforms);
      shader.resolution = 2;

      graphics.filters = [shader];

      const container = new Container();
      container.addChild(graphics);
      renderer.render(container);

      requestAnimationFrame(animate);
    })
    .catch((err) => console.log(err));
};
animate(performance.now());
