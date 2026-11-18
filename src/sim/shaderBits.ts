import type { ShaderBit } from '@pixi/3d';

/** GLSL: 値ノイズ (頂点・フラグメント両方のステージに入るので微分は使わない) */
export const noiseBit: ShaderBit = {
  name: 'cwNoise',
  gl: {
    header: /* glsl */ `
float cwHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float cwNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cwHash(i), cwHash(i + vec2(1.0, 0.0)), f.x),
             mix(cwHash(i + vec2(0.0, 1.0)), cwHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cwFbm(vec2 p) {
  float v = 0.5 * cwNoise(p);
  v += 0.25 * cwNoise(p * 2.03 + 11.7);
  v += 0.125 * cwNoise(p * 4.01 + 5.3);
  v += 0.0625 * cwNoise(p * 8.11 + 23.1);
  return v / 0.9375;
}
`,
  },
};

/** 屋根やコンクリートなど、無地の面にワールド座標のノイズでムラと汚れを付ける */
export const surfaceBit: ShaderBit = {
  name: 'cwSurface',
  requires: [noiseBit],
  gl: {
    fragment: {
      material: /* glsl */ `
  {
    vec3 wp = vPosition;
    float flatness = abs(normal.y);
    vec2 q = mix(vec2(wp.x + wp.z, wp.y), wp.xz, flatness);
    float n1 = cwFbm(q * 0.27);
    float n2 = cwNoise(q * 3.1);
    albedo *= 0.84 + 0.22 * n1 + 0.10 * (n2 - 0.5);
  }
`,
    },
  },
};
