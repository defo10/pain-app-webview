#define PATHS_MAX_LEN 600
#define RANGES_MAX_LEN 20

precision mediump float;

attribute vec2 aVertexPosition;
attribute vec3 aColor;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

uniform float gradientLength;
uniform vec2 paths[PATHS_MAX_LEN]; // flattened list of all paths of all polygons
uniform ivec2 ranges[RANGES_MAX_LEN]; // a range of range specifies the slice of paths that forms a closed contour, [range.x, range.y)
uniform int rangesLen; // exclusive, i.e. ranges[rangesLen] is invalid

varying vec2 vShortestDistVector; // vector to point with shortest distance of ranges
varying float d;

// Return minimum distance between line segment vw and point p
vec2 minimum_distance_point(vec2 v, vec2 w, vec2 p) {
  float l2 = pow(w.x - v.x, 2.0) + pow(w.y - v.y, 2.0);  // i.e. |w-v|^2 -  avoid a sqrt
  // Consider the line extending the segment, parameterized as v + t (w - v).
  // We find projection of point p onto the line. 
  // It falls where t = [(p-v) . (w-v)] / |w-v|^2
  // We clamp t from [0,1] to handle points outside the segment vw.
  float t = clamp(dot(p - v, w - v) / l2, 0., 1.);
  vec2 projection = v + t * (w - v);  // Projection falls on the segment
  return projection;
}


void main() {
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

    float dist = 10000.0;
    vec2 shortestDistanceVector = vec2(0, 0);
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
        vec2 minDistPoint = minimum_distance_point(from, to, aVertexPosition);
        float minDist = distance(aVertexPosition, minDistPoint);
        if (minDist < dist) {
            dist = minDist;
            shortestDistanceVector = minDistPoint - aVertexPosition;
        }
      }
    }

    vShortestDistVector = shortestDistanceVector;
    d = length(shortestDistanceVector);
}