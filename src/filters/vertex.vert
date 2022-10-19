#version 300 es

#define PATHS_MAX_LEN 600
#define RANGES_MAX_LEN 20

precision mediump float;

in vec2 aVertexPosition;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

uniform paths_ubo {
  vec2 paths[PATHS_MAX_LEN];
}; // flattened list of all paths of all polygons
uniform ivec2 ranges[RANGES_MAX_LEN]; // a range of range specifies the slice of paths that forms a closed contour, [range.x, range.y)
uniform int rangesLen; // exclusive, i.e. ranges[rangesLen] is invalid

out float d;
out vec2 vertexPosition;

// Return minimum distance between line segment vw and point p
float minimum_distance(vec2 v, vec2 w, vec2 p) {
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
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

    float dist = 1000000.0;
    for (int n = 0; n < rangesLen; n++) {
      ivec2 range = ranges[n];

      for (int i = range.x; i < range.y - 1; i++) {
        // at range.y - 1, to points to last path
        vec2 from = paths[i];
        vec2 to = paths[i + 1];
        float minDist = minimum_distance(from, to, aVertexPosition);
        dist = min(dist, minDist);
      }

      vec2 last = paths[range.y - 1];
      vec2 first = paths[range.x];
      float minDist = minimum_distance(last, first, aVertexPosition);
      dist = min(dist, minDist);
    }

    d = dist;
    vertexPosition = aVertexPosition;
}