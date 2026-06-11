export const vertexShader = /* glsl */ `
  uniform float uVel;
  uniform float uReveal;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Lean into the direction of motion and bulge at speed.
    pos.x += pos.y * uVel * 0.55;
    pos.z += sin(uv.x * 3.14159265) * abs(uVel) * 0.32;

    // Entry reveal: unfold from a thin slit.
    pos.y *= mix(0.0, 1.0, uReveal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  uniform vec2 uImageSize;
  uniform vec2 uPlaneSize;
  uniform float uHover;
  uniform float uVel;
  uniform float uAlpha;
  varying vec2 vUv;

  vec2 coverUv(vec2 uv) {
    float rs = uPlaneSize.x / uPlaneSize.y;
    float ri = uImageSize.x / uImageSize.y;
    vec2 scaled = rs < ri ? vec2(uImageSize.x * uPlaneSize.y / uImageSize.y, uPlaneSize.y)
                          : vec2(uPlaneSize.x, uImageSize.y * uPlaneSize.x / uImageSize.x);
    vec2 offset = (rs < ri ? vec2((scaled.x - uPlaneSize.x) * 0.5, 0.0)
                           : vec2(0.0, (scaled.y - uPlaneSize.y) * 0.5)) / scaled;
    return uv * uPlaneSize / scaled + offset;
  }

  void main() {
    vec2 uv = coverUv(vUv);

    // Breathe in slightly on hover.
    uv = (uv - 0.5) * (1.0 - uHover * 0.045) + 0.5;

    // Chromatic split scales with scroll velocity.
    float shift = uVel * 0.010 * (1.0 + uHover * 0.6);
    float r = texture2D(uMap, uv + vec2(shift, 0.0)).r;
    vec2 gb = texture2D(uMap, uv - vec2(shift, 0.0)).gb;
    vec3 color = vec3(r, gb);

    // Soft frame vignette on each plane.
    float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x)
               * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
    color *= mix(0.94, 1.0, edge);

    // Resting state sits slightly dimmed; hover lifts it.
    color *= mix(0.84, 1.0, uHover);

    gl_FragColor = vec4(color, uAlpha);
  }
`;
