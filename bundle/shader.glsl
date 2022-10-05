precision mediump float;

varying vec2 vTextureCoord;//The coordinates of the current pixel
uniform sampler2D uSampler;//The image data
uniform vec4 inputSize;
uniform vec4 outputFrame;

uniform vec2 centers[3]; // change here to dynamic

void main(void) {
    gl_FragColor = texture2D(uSampler, vTextureCoord);
    if (gl_FragColor.a == 0.0) return;

    vec2 screenCoord = vTextureCoord * inputSize.xy + outputFrame.xy;

    vec2 minDistCenter = centers[0];
    float minDistance = distance(minDistCenter, screenCoord);
    for (int i = 1; i < 3; i++) {
      float distanceToCenter = distance(centers[i], screenCoord);

      if (minDistance < distanceToCenter) {
        continue;
      }

      minDistance = distanceToCenter;
      minDistCenter = centers[i];
    }
    float radius = 40.0;
    float alphaFall = smoothstep(radius * 0.95, radius, minDistance);
    float red = smoothstep(radius * 0.95, 0.0, minDistance);
    gl_FragColor = vec4(red, 0.0, 0.0, 1.0);
}