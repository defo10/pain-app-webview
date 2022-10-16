#define PATHS_MAX_LEN 400
#define RANGES_MAX_LEN 20

precision mediump float;
precision mediump int;

varying vec2 vTextureCoord; //The coordinates of the current pixel
uniform sampler2D uSampler; //The image data
uniform vec4 inputSize;
uniform vec4 outputFrame;

uniform float gradientLength;

vec2 paths[PATHS_MAX_LEN]; // flattened list of all paths of all polygons
uniform ivec2 ranges[RANGES_MAX_LEN]; // a range of range specifies the slice of paths that forms a closed contour, [range.x, range.y)
uniform int rangesLen; // exclusive, i.e. ranges[rangesLen] is invalid


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


void main() {
    vec4 color = texture2D(uSampler, vTextureCoord);
    if (color.a == 0.0) return;

    vec2 screenCoord = vTextureCoord * inputSize.xy + outputFrame.xy;

    float dist = 1000000.0;
    for (int n = 0; n < RANGES_MAX_LEN; n++) {
      if (n >= rangesLen) {
        continue;
      }
      ivec2 range = ranges[n];

      for (int i = 0; i < PATHS_MAX_LEN; i++) {
        if (i < range.x || range.y <= i) {
          continue;
        }
        // at range.y - 1, to points to last path
        vec2 from = paths[i];
        vec2 to = paths[i + 1];
        float minDist = minimum_distance(from, to, screenCoord);
        dist = min(dist, minDist);
      }
    }

    float pct = smoothstep(0.0, gradientLength, dist);
    gl_FragColor = vec4(pct, 0.0, 0.0, 1.0);
}