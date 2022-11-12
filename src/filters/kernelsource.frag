
#define POINTS_MAX_LEN 125

layout(std140) uniform data_ubo {
  vec4 points[POINTS_MAX_LEN];
};
uniform mediump int points_len;
uniform mediump float offsetX;
uniform mediump float offsetY;

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
    vec2 uvCoord = bl_UV * vec2(bl_Size);
    vec2 screenCoord = vec2(uvCoord.x + offsetX, uvCoord.y + offsetY);

    // dist \in [0..1], 0 being farthest away
    float df = 0.0;
    for (int n = 0; n < POINTS_MAX_LEN; n++) {
      float d = distance(screenCoord, points[n].xy);
      df += falloff(d, points[n].z);
    }

    outputDistance = uint(df * 100.0);
}