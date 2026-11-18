import { Container3D, Material3D, Mesh3D } from '@pixi/3d';
import type { ShaderBit } from '@pixi/3d';
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import type { CollisionWorld } from './collision';
import type { CampusExtras } from './extras';
import { approachLength, approachPoint } from './gateApproach';
import type { Heightfield } from './heightfield';
import { signedDistanceToPolygon } from './heightfield';
import { MeshBuilder } from './meshBuilder';
import { mulberry32 } from './rng';
import { noiseBit } from './shaderBits';
import type { CampusData } from './types';

const TILE = 512;
const COLS = 3;
const ROWS = 2;
/** アトラス内のタイル: 0,1 = 葉のかたまり, 2 = 針葉樹の全体, 3 = 広葉樹の全体, 4 = 低木, 5 = 無地 (幹用) */
const tileRect = (i: number): [number, number, number, number] => {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  const pad = 6 / TILE;
  return [(c + pad) / COLS, (r + pad) / ROWS, (c + 1 - pad) / COLS, (r + 1 - pad) / ROWS];
};

/** 葉と樹形のテクスチャを手続き的に描く */
function paintAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * COLS;
  canvas.height = TILE * ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas が使えません');
  const rand = mulberry32(977);
  const leaf = (x: number, y: number, size: number, hue: number, light: number, sat = 42): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue + 8}, ${sat}%, ${light + 12}%, 0.55)`;
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(-size * 0.9, 0);
    ctx.lineTo(size * 0.9, 0);
    ctx.stroke();
    ctx.restore();
  };
  const inTile = (i: number, draw: (cx: number, cy: number) => void): void => {
    const ox = (i % COLS) * TILE;
    const oy = Math.floor(i / COLS) * TILE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, TILE, TILE);
    ctx.clip();
    draw(ox + TILE / 2, oy + TILE / 2);
    ctx.restore();
  };

  // 0, 1: 葉のかたまり (丸く、ふちが不規則)
  for (const t of [0, 1]) {
    inTile(t, (cx, cy) => {
      for (let i = 0; i < 26; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * TILE * 0.27;
        ctx.fillStyle = `hsl(${96 + rand() * 18}, 38%, ${15 + rand() * 7}%)`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, TILE * (0.07 + rand() * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 620; i++) {
        const a = rand() * Math.PI * 2;
        const r = rand() ** 0.62 * TILE * 0.455;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.94;
        // 上のほうの葉ほど日が当たって明るい
        const sun = 1 - (y - (cy - TILE * 0.45)) / (TILE * 0.9);
        leaf(x, y, 13 + rand() * 13, 84 + rand() * 34, 17 + sun * 17 + rand() * 12, 34 + rand() * 20);
      }
    });
  }

  // 2: 針葉樹 (スギ) の全体。下に幹、上に向かって細くなる
  inTile(2, (cx, cy) => {
    const top = cy - TILE * 0.47;
    const bottom = cy + TILE * 0.47;
    ctx.fillStyle = '#4a3b2c';
    ctx.fillRect(cx - TILE * 0.022, cy + TILE * 0.1, TILE * 0.044, TILE * 0.38);
    for (let i = 0; i < 1300; i++) {
      const t = rand() ** 0.8; // 0 = 梢, 1 = 裾
      const y = top + t * (bottom - top) * 0.86;
      const half = (0.03 + t * 0.2) * TILE * (0.75 + 0.35 * Math.sin(t * 40));
      const x = cx + (rand() * 2 - 1) * half;
      const edge = Math.abs(x - cx) / half;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((x < cx ? 1 : -1) * (0.5 + rand() * 0.5) + Math.PI / 2);
      ctx.fillStyle = `hsl(${118 + rand() * 22}, ${30 + rand() * 14}%, ${11 + (1 - edge) * 4 + rand() * 11 + (1 - t) * 6}%)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 15 + rand() * 12, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });

  // 3: 広葉樹の全体 (遠くの木を板 2 枚で描く)
  inTile(3, (cx, cy) => {
    ctx.fillStyle = '#51402f';
    ctx.beginPath();
    ctx.moveTo(cx - TILE * 0.03, cy + TILE * 0.49);
    ctx.lineTo(cx + TILE * 0.03, cy + TILE * 0.49);
    ctx.lineTo(cx + TILE * 0.016, cy + TILE * 0.05);
    ctx.lineTo(cx - TILE * 0.016, cy + TILE * 0.05);
    ctx.fill();
    const crownY = cy - TILE * 0.12;
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand());
      ctx.fillStyle = `hsl(${98 + rand() * 16}, 38%, ${14 + rand() * 7}%)`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * TILE * 0.33, crownY + Math.sin(a) * r * TILE * 0.24, TILE * (0.06 + rand() * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 1500; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() ** 0.55;
      const x = cx + Math.cos(a) * r * TILE * 0.44;
      const y = crownY + Math.sin(a) * r * TILE * 0.33;
      const sun = 1 - (y - (crownY - TILE * 0.33)) / (TILE * 0.66);
      leaf(x, y, 8 + rand() * 8, 86 + rand() * 32, 16 + sun * 18 + rand() * 11, 34 + rand() * 20);
    }
  });

  // 4: 低木・生け垣 (ほぼ全面が葉)
  inTile(4, (cx, cy) => {
    ctx.fillStyle = '#263a1c';
    ctx.beginPath();
    ctx.ellipse(cx, cy + TILE * 0.08, TILE * 0.46, TILE * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 1100; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() ** 0.5;
      const x = cx + Math.cos(a) * r * TILE * 0.47;
      const y = cy + TILE * 0.08 + Math.sin(a) * r * TILE * 0.4;
      leaf(x, y, 9 + rand() * 8, 92 + rand() * 30, 18 + rand() * 22 + (1 - (y - cy) / TILE) * 6, 36 + rand() * 18);
    }
  });

  // 5: 無地 (幹・枝)。頂点色で樹皮の色を付ける
  inTile(5, (cx, cy) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - TILE / 2, cy - TILE / 2, TILE, TILE);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.05 + rand() * 0.14})`;
      ctx.fillRect(cx - TILE / 2 + rand() * TILE, cy - TILE / 2 + rand() * TILE, 3 + rand() * 4, 20 + rand() * 60);
    }
  });
  return canvas;
}

/** 葉を風で揺らし、色に少しムラを付ける */
const foliageBit: ShaderBit = {
  name: 'cwFoliage',
  requires: [noiseBit],
  attributes: { aColor1: 'float32x4' },
  gl: {
    vertex: {
      beforeTransform: /* glsl */ `
  {
    float sway = aColor1.x;
    float phase = aColor1.y;
    position.x += (sin(uTime * 1.1 + phase) + sin(uTime * 2.7 + phase * 1.7) * 0.35) * sway;
    position.z += cos(uTime * 0.9 + phase * 1.3) * sway;
  }
`,
    },
    fragment: {
      material: /* glsl */ `
  {
    // 板を真横から見ると 1 枚の面に見えてしまうので、視線に平行な板は消す
    vec3 faceN = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
    float facing = abs(dot(faceN, normalize(uCameraPosition.xyz - vPosition)));
    if (facing < 0.24 && vColor.a < 0.5) discard;
    float n = cwNoise(vPosition.xz * 0.6 + vPosition.y * 0.3);
    albedo *= 0.86 + 0.28 * n;
    alpha /= max(vColor.a, 0.001);
    roughness = 0.8;
  }
`,
    },
  },
};

interface TreeSpec {
  x: number;
  z: number;
  height: number;
  type: number;
}

const CHUNK = 72;

export function buildVegetation(data: CampusData, hf: Heightfield, collision: CollisionWorld, extras: CampusExtras): Container3D {
  const node = new Container3D({ label: 'vegetation' });
  const atlas = new Texture({
    source: new CanvasSource({
      resource: paintAtlas(),
      autoGenerateMipmaps: true,
      scaleMode: 'linear',
      mipmapFilter: 'linear',
      addressMode: 'clamp-to-edge',
      maxAnisotropy: 4,
    }),
    frame: new Rectangle(0, 0, TILE * COLS, TILE * ROWS),
  });
  const material = new Material3D({
    baseColor: 0xffffff,
    baseColorTexture: atlas,
    alphaMode: 'mask',
    alphaCutoff: 0.42,
    roughness: 0.8,
    metallic: 0,
    vertexColors: true,
    extraBits: [foliageBit],
  });

  const boundary = data.json.campusBoundary;
  const campusDistance = (x: number, z: number): number => {
    let d = Infinity;
    for (const ring of boundary) d = Math.min(d, signedDistanceToPolygon(x, z, ring));
    return d;
  };

  // あとから足した通路 (坂・階段など) の上には木を生やさない
  const inClearing = (x: number, z: number): boolean => {
    for (const c of extras.clearings) {
      for (let i = 0; i + 3 < c.p.length; i += 2) {
        const dx = c.p[i + 2] - c.p[i];
        const dz = c.p[i + 3] - c.p[i + 1];
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - c.p[i]) * dx + (z - c.p[i + 1]) * dz) / l2));
        if (Math.hypot(x - (c.p[i] + dx * t), z - (c.p[i + 1] + dz * t)) < c.radius) return true;
      }
    }
    return false;
  };

  const near = new Map<string, MeshBuilder>();
  const far = new Map<string, MeshBuilder>();
  const builderFor = (map: Map<string, MeshBuilder>, x: number, z: number): MeshBuilder => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let mb = map.get(key);
    if (!mb) map.set(key, (mb = new MeshBuilder({ uvs: true, colors: true, data: true })));
    return mb;
  };

  const trees = data.json.trees;
  const rand = mulberry32(4259);
  for (let i = 0; i < trees.length; i += 4) {
    const spec: TreeSpec = { x: trees[i], z: trees[i + 1], height: trees[i + 2], type: trees[i + 3] };
    if (!hf.contains(spec.x, spec.z) || inClearing(spec.x, spec.z)) continue;
    const y = hf.surfaceAt(spec.x, spec.z) - 0.15;
    const detailed = campusDistance(spec.x, spec.z) < 55;
    if (detailed) {
      addDetailedTree(builderFor(near, spec.x, spec.z), spec, y, rand);
      collision.addCircle(spec.x, spec.z, 0.16 + spec.height * 0.014, y + spec.height * 0.4);
    } else {
      addSimpleTree(builderFor(far, spec.x, spec.z), spec, y, rand);
    }
  }

  // 写真7の右手の刈り込み。地面の勾配に合わせて上面と側面の葉を重ねる。
  const hedgeRand = mulberry32(714);
  for (let along = 0.6; along < approachLength - 0.5; along += 0.58) {
    const [x, z] = approachPoint(along, 3.17);
    const y = hf.surfaceAt(x, z);
    const mb = builderFor(near, x, z);
    const h = 1.12 + hedgeRand() * 0.12;
    const shade = 0.77 + hedgeRand() * 0.16;
    mb.color(shade * 1.12, shade, shade * 0.73, 0.25);
    mb.setData(0.014, hedgeRand() * Math.PI * 2, 0, 0);
    const rotation = hedgeRand() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const angle = rotation + (k * Math.PI) / 3;
      addCard(mb, x, y + h / 2, z, Math.cos(angle), 0, Math.sin(angle), 0, h * 0.65, 0, x, y, z, 4, k === 1);
    }
    addCard(mb, x, y + h * 0.89, z, 1, 0, 0, 0, 0.05, 0.95, x, y, z, 4, false);
    collision.addCircle(x, z, 0.77, y + h);
  }
  // 車止めの先、左側の針葉樹のまとまり。
  for (const along of [17, 19, 21, 24]) {
    const [x, z] = approachPoint(along, -4.7 - hedgeRand());
    const y = hf.surfaceAt(x, z);
    addDetailedTree(builderFor(near, x, z), { x, z, height: 3.4 + hedgeRand() * 1.1, type: 1 }, y, hedgeRand);
    collision.addCircle(x, z, 0.16, y + 2);
  }

  for (const [map, shadow] of [
    [near, true],
    [far, false],
  ] as const) {
    for (const mb of map.values()) {
      const geometry = mb.build();
      if (!geometry) continue;
      node.addChild(new Mesh3D({ geometry, material, castShadow: shadow, receiveShadow: true }));
    }
  }
  return node;
}

/** 樹種ごとの葉の色 (線形 RGB の倍率。テクスチャの緑に掛ける) */
function tint(type: number, rand: () => number): [number, number, number] {
  const v = 0.5 + rand() * 0.32;
  if (type === 1) return [0.7 * v, 0.8 * v, 0.72 * v];
  const warm = rand();
  if (type === 2) return [(1.0 + warm * 0.2) * v, 1.0 * v, (0.84 - warm * 0.14) * v];
  return [(0.94 + warm * 0.22) * v, 1.0 * v, (0.8 + warm * 0.06) * v];
}

const BARK: [number, number, number][] = [
  [0.16, 0.125, 0.095],
  [0.2, 0.16, 0.12],
  [0.13, 0.12, 0.11],
];

function addTrunk(
  mb: MeshBuilder,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  type: number,
  rand: () => number,
): void {
  const [u0, v0, u1, v1] = tileRect(5);
  const bark = BARK[type] ?? BARK[0];
  const k = 0.8 + rand() * 0.4;
  mb.color(bark[0] * k, bark[1] * k, bark[2] * k, 1);
  mb.setData(0, 0, 0, 0);
  const sides = 6;
  const base = mb.vertexCount;
  const top = radius * 0.55;
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    const u = u0 + ((u1 - u0) * i) / sides;
    // 根元は少し広がる
    mb.vertex(x + nx * radius * 1.35, y - 0.3, z + nz * radius * 1.35, nx, 0.2, nz, u, v1);
    mb.vertex(x + nx * top, y + height, z + nz * top, nx, 0.1, nz, u, v0);
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i * 2;
    mb.quad(a, a + 2, a + 3, a + 1);
  }
}

/** 中心 c を向いた丸みのある法線で、表裏 2 枚の板を追加する */
function addCard(
  mb: MeshBuilder,
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  tile: number,
  flipU: boolean,
): void {
  const [u0, v0, u1, v1] = tileRect(tile);
  const ua = flipU ? u1 : u0;
  const ub = flipU ? u0 : u1;
  const corners: [number, number, number, number, number][] = [
    [px - ax - bx, py - ay - by, pz - az - bz, ua, v1],
    [px + ax - bx, py + ay - by, pz + az - bz, ub, v1],
    [px + ax + bx, py + ay + by, pz + az + bz, ub, v0],
    [px - ax + bx, py - ay + by, pz - az + bz, ua, v0],
  ];
  const idx: number[] = [];
  for (const [x, y, z, u, v] of corners) {
    let nx = x - cx;
    let ny = y - cy + 0.6;
    let nz = z - cz;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    idx.push(mb.vertex(x, y, z, nx, ny, nz, u, v));
  }
  mb.quad(idx[0], idx[1], idx[2], idx[3]);
  mb.quad(idx[3], idx[2], idx[1], idx[0]);
}

function addDetailedTree(mb: MeshBuilder, t: TreeSpec, y: number, rand: () => number): void {
  const h = t.height;
  const [tr, tg, tb] = tint(t.type, rand);
  const phase = rand() * 6.28;

  if (t.type === 1) {
    // スギ: まっすぐな幹のまわりに、樹形の板を 4 枚交差させる
    const radius = 0.14 + h * 0.012;
    addTrunk(mb, t.x, y, t.z, radius, h * 0.5, 1, rand);
    const half = h * 0.21;
    const rot0 = rand() * Math.PI;
    for (let i = 0; i < 4; i++) {
      const a = rot0 + (i * Math.PI) / 4;
      const k = 0.85 + rand() * 0.3;
      mb.color(tr * k, tg * k, tb * k, 0.25);
      mb.setData(0.05 + h * 0.004, phase, 0, 0);
      addCard(mb, t.x, y + h * 0.53, t.z, Math.cos(a) * half, 0, Math.sin(a) * half, 0, h * 0.5, 0, t.x, y + h * 0.3, t.z, 2, i % 2 === 1);
    }
    return;
  }

  // 広葉樹: 幹 + 楕円体の樹冠に葉のかたまりの板を散らす
  const small = t.type === 2;
  const radius = small ? 0.09 + h * 0.012 : 0.13 + h * 0.016;
  const crownR = h * (small ? 0.36 : 0.3) * (0.88 + rand() * 0.24);
  const crownH = h * (small ? 0.33 : 0.36);
  const cy = y + h - crownH * 0.98;
  addTrunk(mb, t.x, y, t.z, radius, cy - y + crownH * 0.25, small ? 1 : 0, rand);
  const cards = small ? 14 : 22;
  for (let i = 0; i < cards; i++) {
    // 樹冠の表面近くに、外向きに傾けて置く
    const theta = rand() * Math.PI * 2;
    const up = rand() * 1.45 - 0.45; // -0.45 (下) 〜 1 (てっぺん)
    const lat = Math.asin(Math.max(-1, Math.min(1, up)));
    const shell = 0.5 + rand() * 0.42;
    const dx = Math.cos(lat) * Math.cos(theta);
    const dy = Math.sin(lat);
    const dz = Math.cos(lat) * Math.sin(theta);
    const px = t.x + dx * crownR * shell;
    const py = cy + dy * crownH * shell;
    const pz = t.z + dz * crownR * shell;
    const size = crownR * (0.48 + rand() * 0.3);
    // 板の向き: 外向きの法線にランダムな傾きを足す
    let nx = dx + (rand() - 0.5) * 0.9;
    let ny = dy * 0.35 + (rand() - 0.5) * 0.5;
    let nz = dz + (rand() - 0.5) * 0.9;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // 板の中の 2 軸 (a は水平に近い方向)
    let ax = -nz;
    let az = nx;
    const al = Math.hypot(ax, az);
    if (al < 0.05) {
      ax = 1;
      az = 0;
    } else {
      ax /= al;
      az /= al;
    }
    const bx = ny * az;
    const by = nz * ax - nx * az;
    const bz = -ny * ax;
    // 下・内側の葉は暗く
    const shade = (0.62 + 0.38 * Math.max(0, up * 0.7 + 0.3)) * (0.86 + rand() * 0.28);
    mb.color(tr * shade, tg * shade, tb * shade, 0.25);
    mb.setData(0.03 + (py - y) * 0.006, phase + i * 0.7, 0, 0);
    addCard(mb, px, py, pz, ax * size, 0, az * size, bx * size, by * size, bz * size, t.x, cy - crownH * 0.2, t.z, i % 2, rand() < 0.5);
  }
}

/** 遠くの木: 樹形の板を 2 枚交差させるだけ */
function addSimpleTree(mb: MeshBuilder, t: TreeSpec, y: number, rand: () => number): void {
  const h = t.height;
  const [tr, tg, tb] = tint(t.type, rand);
  const conifer = t.type === 1;
  const half = conifer ? h * 0.22 : h * 0.44 * (0.9 + rand() * 0.2);
  const rot0 = rand() * Math.PI;
  const k = 0.8 + rand() * 0.3;
  mb.color(tr * k, tg * k, tb * k, 1);
  mb.setData(0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const a = rot0 + (i * Math.PI) / 2;
    addCard(
      mb,
      t.x,
      y + h * 0.5,
      t.z,
      Math.cos(a) * half,
      0,
      Math.sin(a) * half,
      0,
      h * 0.5,
      0,
      t.x,
      y + h * 0.35,
      t.z,
      conifer ? 2 : 3,
      false,
    );
  }
}
