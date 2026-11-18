import { Container3D, Material3D, Mesh3D } from '@pixi/3d';
import type { ShaderBit } from '@pixi/3d';
import { BufferImageSource, CanvasSource, Texture } from 'pixi.js';
import { paintGround } from './groundPaint';
import type { PaintRect } from './groundPaint';
import { FINE_STEP } from './heightfield';
import type { Heightfield } from './heightfield';
import { MeshBuilder, linearRgb } from './meshBuilder';
import { noiseBit } from './shaderBits';
import type { CampusData } from './types';

/** 地面: 土地利用の色 + ノイズによる細部 + 舗装・白線の重ね描き */
const groundBit: ShaderBit = {
  name: 'cwGround',
  textures: ['macro', 'mask'],
  requires: [noiseBit],
  gl: {
    fragment: {
      material: /* glsl */ `
  {
    vec2 wp = vPosition.xz;
    float dist = length(uCameraPosition.xyz - vPosition);
    float near = 1.0 - smoothstep(8.0, 34.0, dist);
    float mid = 1.0 - smoothstep(40.0, 150.0, dist);

    vec4 mk = sampleMask(vUV);
    vec3 col = sampleMacro(vUV).rgb;

    float nLow = cwFbm(wp * 0.021 + 3.0);
    float nMid = cwFbm(wp * 0.19 + 17.0);
    float nHi = cwFbm(wp * 1.3 + 7.0);
    float nFine = cwFbm(vec2(wp.x * 0.8 - wp.y * 0.6, wp.x * 0.6 + wp.y * 0.8) * 7.0);

    // 草地・土: 大きなムラ + 近くでは細かい粒
    float grassy = mk.a;
    col *= 0.84 + 0.22 * nLow + 0.2 * (nMid - 0.5);
    col *= 1.0 + grassy * (mid * (nHi - 0.5) * 0.34 + near * (nFine - 0.5) * 0.5);
    col = mix(col, col * vec3(1.14, 1.04, 0.74), grassy * smoothstep(0.5, 0.8, nMid) * 0.4);
    col = mix(col, col * vec3(0.86, 0.97, 0.82), grassy * smoothstep(0.55, 0.3, nLow) * 0.5);
    float rough = 0.97;

    // 歩道 (ベージュのインターロッキングブロック)
    float wG = fwidth(mk.g) * 0.75 + 0.012;
    float pavedAmt = smoothstep(0.5 - wG, 0.5 + wG, mk.g);
    vec2 pv = wp / vec2(0.2, 0.1);
    pv.x += floor(pv.y) * 0.5;
    vec2 pf = abs(fract(pv) - 0.5);
    float joint = smoothstep(0.40, 0.5, max(pf.x, pf.y)) * near;
    float blockTone = cwHash(floor(pv)) - 0.5;
    vec3 pavedCol = vec3(0.70, 0.635, 0.545) * (0.93 + 0.14 * blockTone * near + 0.16 * (nMid - 0.5) + 0.08 * (nLow - 0.5));
    pavedCol *= 1.0 - joint * 0.2;
    col = mix(col, pavedCol, pavedAmt);
    rough = mix(rough, 0.9, pavedAmt);

    // 車道 (アスファルト) と縁石
    float wR = fwidth(mk.r) * 0.75 + 0.012;
    float asphaltAmt = smoothstep(0.5 - wR, 0.5 + wR, mk.r);
    float curb = smoothstep(0.16, 0.30, mk.r) * (1.0 - asphaltAmt);
    vec3 asphaltCol = vec3(0.37, 0.365, 0.355) * (0.9 + 0.2 * (nMid - 0.5) + 0.12 * (nLow - 0.5) + near * (nFine - 0.5) * 0.3);
    // タイヤが通るところは少し黒ずみ、路肩は白っぽい
    asphaltCol *= mix(1.08, 0.94, smoothstep(0.6, 1.0, mk.r));
    col = mix(col, vec3(0.66, 0.65, 0.62) * (0.92 + 0.16 * nHi), curb * 0.92);
    col = mix(col, asphaltCol, asphaltAmt);
    rough = mix(rough, 0.84, asphaltAmt);

    // 路面標示
    float wB = fwidth(mk.b) * 0.75 + 0.03;
    float paint = smoothstep(0.42 - wB, 0.42 + wB, mk.b) * (0.72 + 0.28 * nHi);
    col = mix(col, vec3(0.88, 0.88, 0.84), paint * max(asphaltAmt, pavedAmt));

    albedo = decodeColor(clamp(col, 0.0, 1.0));
    roughness = rough;
    metallic = 0.0;
    fresnelF0 = vec3(0.04);
  }
`,
    },
  },
};

export interface TerrainResult {
  node: Container3D;
  paintRect: PaintRect;
  macro: HTMLCanvasElement;
}

const CHUNK = 64;

export function buildTerrain(data: CampusData, hf: Heightfield, maskSize: number): TerrainResult {
  const node = new Container3D({ label: 'terrain' });
  const size = Math.max(hf.width, hf.depth);
  const paintRect: PaintRect = { x0: hf.x0 - (size - hf.width) / 2, z0: hf.z0 - (size - hf.depth) / 2, size };
  const paint = paintGround(data.json, paintRect, maskSize);

  const macroTexture = new Texture({
    source: new CanvasSource({
      resource: paint.macro,
      autoGenerateMipmaps: true,
      scaleMode: 'linear',
      mipmapFilter: 'linear',
      addressMode: 'clamp-to-edge',
    }),
  });
  const maskTexture = new Texture({
    source: new BufferImageSource({
      resource: paint.mask,
      width: paint.maskSize,
      height: paint.maskSize,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      autoGenerateMipmaps: true,
      scaleMode: 'linear',
      mipmapFilter: 'linear',
      addressMode: 'clamp-to-edge',
      maxAnisotropy: 8,
    }),
  });

  const material = new Material3D({
    baseColor: 0xffffff,
    roughness: 0.96,
    metallic: 0,
    extraBits: [groundBit],
    textures: { macro: macroTexture, mask: maskTexture },
  });

  const normal: [number, number, number] = [0, 1, 0];
  for (let cj = 0; cj < hf.nz - 1; cj += CHUNK) {
    for (let ci = 0; ci < hf.nx - 1; ci += CHUNK) {
      const w = Math.min(CHUNK, hf.nx - 1 - ci);
      const d = Math.min(CHUNK, hf.nz - 1 - cj);
      const mb = new MeshBuilder({ uvs: true });
      for (let j = 0; j <= d; j++) {
        for (let i = 0; i <= w; i++) {
          const x = hf.x0 + (ci + i) * FINE_STEP;
          const z = hf.z0 + (cj + j) * FINE_STEP;
          hf.normalAt(x, z, normal);
          mb.vertex(
            x,
            hf.heights[(cj + j) * hf.nx + ci + i],
            z,
            normal[0],
            normal[1],
            normal[2],
            (x - paintRect.x0) / size,
            (z - paintRect.z0) / size,
          );
        }
      }
      for (let j = 0; j < d; j++) {
        for (let i = 0; i < w; i++) {
          const a = j * (w + 1) + i;
          const b = a + w + 1;
          mb.tri(a, b, a + 1);
          mb.tri(a + 1, b, b + 1);
        }
      }
      const geometry = mb.build();
      if (!geometry) continue;
      node.addChild(new Mesh3D({ geometry, material, castShadow: false, receiveShadow: true }));
    }
  }

  // トンネルの上: 掘り込む前の地表を「ふた」としてかぶせる (影を落として、中を暗くする)
  if (hf.surface && hf.capCells) {
    const mb = new MeshBuilder({ uvs: true });
    const cellsX = hf.nx - 1;
    for (let j = 0; j < hf.nz - 1; j++) {
      for (let i = 0; i < cellsX; i++) {
        if (!hf.capCells[j * cellsX + i]) continue;
        const corner = (di: number, dj: number): number => {
          const x = hf.x0 + (i + di) * FINE_STEP;
          const z = hf.z0 + (j + dj) * FINE_STEP;
          hf.capNormalAt(x, z, normal);
          return mb.vertex(
            x,
            hf.surface![(j + dj) * hf.nx + i + di],
            z,
            normal[0],
            normal[1],
            normal[2],
            (x - paintRect.x0) / size,
            (z - paintRect.z0) / size,
          );
        };
        const a = corner(0, 0);
        const b = corner(0, 1);
        const c = corner(1, 0);
        const d = corner(1, 1);
        mb.tri(a, b, c);
        mb.tri(c, b, d);
      }
    }
    const geometry = mb.build();
    if (geometry) node.addChild(new Mesh3D({ label: 'tunnel-cap', geometry, material, castShadow: true, receiveShadow: true }));
  }

  node.addChild(buildFarTerrain(data, hf));
  return { node, paintRect, macro: paint.macro };
}

/** 遠景: 粗い標高メッシュに空中写真の平均色を頂点色として載せる */
function buildFarTerrain(data: CampusData, hf: Heightfield): Mesh3D {
  const { far } = data.json;
  const n = far.n;
  const mb = new MeshBuilder({ uvs: false, colors: true });
  const inner = { x0: hf.x0, x1: hf.x0 + hf.width, z0: hf.z0, z1: hf.z0 + hf.depth };
  const inside = (x: number, z: number, m: number): boolean => x > inner.x0 + m && x < inner.x1 - m && z > inner.z0 + m && z < inner.z1 - m;
  const h = (i: number, j: number): number => far.hMin + data.farHeights[j * n + i] * far.unit;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -far.radius + i * far.step;
      const z = -far.radius + j * far.step;
      // 詳細な地形の下に潜り込む部分は少し下げて、隙間もちらつきも出ないようにする
      let y = h(i, j);
      if (inside(x, z, 0)) y = Math.min(y, hf.heightAt(x, z)) - 2.5;
      else if (inside(x, z, -far.step)) y -= 0.6;
      const il = Math.max(0, i - 1);
      const ir = Math.min(n - 1, i + 1);
      const ju = Math.max(0, j - 1);
      const jd = Math.min(n - 1, j + 1);
      const nx = -(h(ir, j) - h(il, j)) / ((ir - il) * far.step);
      const nz = -(h(i, jd) - h(i, ju)) / ((jd - ju) * far.step);
      const len = Math.hypot(nx, 1, nz);
      const o = (j * n + i) * 3;
      const [r, g, b] = linearRgb((data.farColors[o] << 16) | (data.farColors[o + 1] << 8) | data.farColors[o + 2]);
      // 写真は日なたの色なので、ライティングで明るくなりすぎない程度に落とす
      mb.color(r * 0.9, g * 0.9, b * 0.9, 1);
      mb.vertex(x, y, z, nx / len, 1 / len, nz / len);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x = -far.radius + i * far.step;
      const z = -far.radius + j * far.step;
      // 詳細エリアに完全に隠れるセルは描かない
      if (inside(x, z, far.step) && inside(x + far.step, z + far.step, far.step)) continue;
      const a = j * n + i;
      const b = a + n;
      mb.tri(a, b, a + 1);
      mb.tri(a + 1, b, b + 1);
    }
  }
  const geometry = mb.build();
  if (!geometry) throw new Error('遠景メッシュが空です');
  return new Mesh3D({
    label: 'far-terrain',
    geometry,
    material: new Material3D({ baseColor: 0xffffff, roughness: 1, metallic: 0, vertexColors: true }),
    castShadow: false,
    receiveShadow: false,
  });
}
