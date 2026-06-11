export const vertexShader = /* glsl */ `
  uniform float uVel;
  uniform float uOut;
  uniform float uDir;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Lean into the direction of motion and bulge at speed.
    pos.x += pos.y * uVel * 0.55;
    pos.z += sin(uv.x * 3.14159265) * abs(uVel) * 0.32;

    // Collection transition: rigid twist around local Y, pushed into depth.
    float ang = uOut * 1.45 * uDir;
    float c = cos(ang);
    float s = sin(ang);
    pos = vec3(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
    pos.z -= uOut * 1.1;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  uniform vec2 uImageSize;
  uniform vec2 uPlaneSize;
  uniform float uHover;
  uniform float uFocus;
  uniform float uVel;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uScreenX;
  uniform vec3 uRipple;   // xy: pointer uv on plane, z: strength
  uniform float uOut;     // 0 = in place, 1 = dissolved away
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

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

    // Zoom in slightly to leave a sampling margin for the offsets below.
    uv = (uv - 0.5) * 0.88 + 0.5;

    // Inner parallax: the image drifts as its plane crosses the viewport.
    uv.x += uScreenX * 0.03;

    // Breathe in slightly on hover.
    uv = (uv - 0.5) * (1.0 - uHover * 0.04) + 0.5;

    // Cursor ripple: decaying radial wave from the pointer position.
    vec2 rd = vUv - uRipple.xy;
    float rl = max(length(rd), 1e-4);
    float wave = sin(rl * 28.0 - uTime * 7.0) * exp(-rl * 7.0) * uRipple.z;
    uv += (rd / rl) * wave * 0.018;

    // Chromatic split scales with scroll velocity and ripple energy.
    float shift = (uVel * 0.010 + wave * 0.12) * (1.0 + uHover * 0.6);
    vec2 cuv = clamp(uv, 0.002, 0.998);
    float r = texture2D(uMap, clamp(cuv + vec2(shift, 0.0), 0.002, 0.998)).r;
    vec2 gb = texture2D(uMap, clamp(cuv - vec2(shift, 0.0), 0.002, 0.998)).gb;
    vec3 color = vec3(r, gb);

    // Soft frame vignette on each plane.
    float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x)
               * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
    color *= mix(0.94, 1.0, edge);

    // Rack focus: the centered (or hovered) photo is lifted, others recede.
    color *= mix(0.78, 1.0, max(uHover, uFocus));

    // Noise dissolve during collection transitions.
    float n = vnoise(vUv * 7.0 + uTime * 0.05);
    float alpha = uAlpha * (1.0 - smoothstep(n - 0.08, n + 0.08, uOut * 1.16 - 0.08));

    gl_FragColor = vec4(color, alpha);
  }
`;
