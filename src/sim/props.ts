import { Container3D, Material3D, Mesh3D } from '@pixi/3d';
import earcut from 'earcut';
import { CanvasSource, Texture } from 'pixi.js';
import type { CollisionWorld } from './collision';
import type { Decks } from './decks';
import type { Heightfield } from './heightfield';
import { pointInPolygon, signedDistanceToPolygon } from './heightfield';
import { MeshBuilder, linearRgb } from './meshBuilder';
import { hash2, mulberry32 } from './rng';
import { surfaceBit } from './shaderBits';
import type { AreaData, CampusData, CampusJson, RoadData } from './types';

export interface PropsResult {
  node: Container3D;
  /** 街灯の灯具 (夜に光らせる) */
  lampMaterial: Material3D;
}

const CAR_COLORS = [0xf2f2f0, 0xd9dadb, 0x2b2d30, 0x8a8f95, 0x1f3a5f, 0x7a1f1f, 0xb9b3a4, 0x3d4a3f, 0xc8ccd0];
/** 地区ごとの案内サインの色 (大学のサイン計画にならう) */
const AREA_COLORS: Record<string, string> = { B: '#e6b422', S: '#2ba7c9', G: '#2f62b5', H: '#3d9a55', J: '#d03a3a', R: '#c2409a' };

const setHex = (mb: MeshBuilder, hex: number, k = 1): void => {
  const [r, g, b] = linearRgb(hex);
  mb.color(r * k, g * k, b * k, 1);
};

const minOnRing = (hf: Heightfield, r: number[]): number => {
  let m = Infinity;
  for (let i = 0; i < r.length; i += 2) m = Math.min(m, hf.heightAt(r[i], r[i + 1]));
  return m;
};

const meanOnRing = (hf: Heightfield, r: number[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i += 2) s += hf.heightAt(r[i], r[i + 1]);
  return s / (r.length / 2);
};

/** 地形メッシュを作る前に、池の底やコートなどを平らにならす */
export function prepareTerrain(json: CampusJson, hf: Heightfield): void {
  for (const a of json.areas) {
    if (a.k === 'water') hf.flatten(a.r, minOnRing(hf, a.r) - 0.7, 2.5);
    else if (a.k === 'tennis' || a.k === 'pitch') hf.flatten(a.r, meanOnRing(hf, a.r), 3);
  }
}

export function buildProps(data: CampusData, hf: Heightfield, collision: CollisionWorld, decks: Decks): PropsResult {
  const json = data.json;
  const node = new Container3D({ label: 'props' });
  const mb = new MeshBuilder({ uvs: true, colors: true });
  const lamps = new MeshBuilder({ uvs: true, colors: true });
  const signs = new SignAtlas();
  const signMesh = new MeshBuilder({ uvs: true });
  const inBuilding = (x: number, z: number): boolean =>
    json.buildings.some((b) => Math.abs(b.r[0] - x) < 120 && Math.abs(b.r[1] - z) < 120 && pointInPolygon(x, z, b.r));
  const campusRoads = json.roads.filter((r) => r.c && !r.br && !r.tn);

  addBridges(mb, decks, hf, collision);
  addTennisCourts(mb, json, hf, collision);
  addGate(mb, signMesh, signs, json, hf, collision);
  addBuildingSigns(mb, signMesh, signs, json, hf, campusRoads, collision);
  addLamps(mb, lamps, hf, campusRoads, inBuilding, collision);
  addCars(mb, json, hf, collision);
  addSmallProps(mb, json, hf, collision);
  addBarriers(mb, json, hf, collision);
  addPylons(mb, json, hf);

  const propGeometry = mb.build();
  if (propGeometry) {
    node.addChild(
      new Mesh3D({
        label: 'props',
        geometry: propGeometry,
        material: new Material3D({ baseColor: 0xffffff, roughness: 0.78, metallic: 0, vertexColors: true, extraBits: [surfaceBit] }),
      }),
    );
  }

  const lampMaterial = new Material3D({ baseColor: 0xf4f1e6, roughness: 0.4, metallic: 0, emissive: { color: 0xffe2b0, strength: 0 } });
  const lampGeometry = lamps.build();
  if (lampGeometry) node.addChild(new Mesh3D({ label: 'lamps', geometry: lampGeometry, material: lampMaterial, castShadow: false }));

  const signGeometry = signMesh.build();
  if (signGeometry) {
    node.addChild(
      new Mesh3D({
        label: 'signs',
        geometry: signGeometry,
        material: new Material3D({ baseColor: 0xffffff, baseColorTexture: signs.texture(), roughness: 0.55, metallic: 0 }),
        castShadow: false,
      }),
    );
  }

  const water = buildWater(json, hf);
  if (water) node.addChild(water);
  return { node, lampMaterial };
}

// ---------------------------------------------------------------- 文字入りのサイン
/** サインの文字を 1 枚のキャンバスにまとめて描く */
class SignAtlas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private x = 0;
  private y = 0;
  private rowH = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048;
    this.canvas.height = 2048;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas が使えません');
    this.ctx = ctx;
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, 2048, 2048);
  }

  /** w × h ピクセルの領域を確保して描き、UV の矩形 [u0, v0, u1, v1] を返す */
  add(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): [number, number, number, number] {
    if (this.x + w > 2048) {
      this.x = 0;
      this.y += this.rowH + 4;
      this.rowH = 0;
    }
    const { ctx } = this;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    draw(ctx, w, h);
    ctx.restore();
    const rect: [number, number, number, number] = [
      (this.x + 1) / 2048,
      (this.y + 1) / 2048,
      (this.x + w - 1) / 2048,
      (this.y + h - 1) / 2048,
    ];
    this.x += w + 4;
    this.rowH = Math.max(this.rowH, h);
    return rect;
  }

  texture(): Texture {
    return new Texture({
      source: new CanvasSource({
        resource: this.canvas,
        autoGenerateMipmaps: true,
        scaleMode: 'linear',
        mipmapFilter: 'linear',
        maxAnisotropy: 8,
      }),
    });
  }
}

/** 文字の板 (中心 x, y, z、幅 w・高さ h、法線が (nx, nz) を向く) */
function addSignQuad(mb: MeshBuilder, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, uv: number[]): void {
  // 板の右方向 (外から見て) = (nz, -nx) の逆
  const rx = nz;
  const rz = -nx;
  const hw = w / 2;
  const a = mb.vertex(x - rx * hw, y - h / 2, z - rz * hw, nx, 0, nz, uv[0], uv[3]);
  const b = mb.vertex(x + rx * hw, y - h / 2, z + rz * hw, nx, 0, nz, uv[2], uv[3]);
  const c = mb.vertex(x + rx * hw, y + h / 2, z + rz * hw, nx, 0, nz, uv[2], uv[1]);
  const d = mb.vertex(x - rx * hw, y + h / 2, z - rz * hw, nx, 0, nz, uv[0], uv[1]);
  mb.quad(a, b, c, d);
}

// ---------------------------------------------------------------- 橋
function addBridges(mb: MeshBuilder, decks: Decks, hf: Heightfield, collision: CollisionWorld): void {
  for (const span of decks.spans) {
    const road = !['footway', 'path', 'pedestrian', 'cycleway'].includes(span.kind);
    const half = span.width / 2 + (road ? 0.5 : 0.15);
    const depth = road ? 1.5 : 0.45;
    const railH = road ? 0.95 : 1.1;
    const p = span.pts;
    const n = p.length / 2;
    const left: number[][] = [];
    const right: number[][] = [];
    for (let i = 0; i < n; i++) {
      const ax = p[Math.max(0, i - 1) * 2];
      const az = p[Math.max(0, i - 1) * 2 + 1];
      const bx = p[Math.min(n - 1, i + 1) * 2];
      const bz = p[Math.min(n - 1, i + 1) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const ox = (-(bz - az) / len) * half;
      const oz = ((bx - ax) / len) * half;
      left.push([p[i * 2] + ox, span.ys[i], p[i * 2 + 1] + oz]);
      right.push([p[i * 2] - ox, span.ys[i], p[i * 2 + 1] - oz]);
    }
    const lower = (v: number[], dy: number): number[] => [v[0], v[1] + dy, v[2]];
    for (let i = 0; i + 1 < n; i++) {
      const l0 = left[i];
      const l1 = left[i + 1];
      const r0 = right[i];
      const r1 = right[i + 1];
      // 床
      setHex(mb, road ? 0x5c5b59 : 0xb9a98e);
      mb.quadPoints(l0, l1, r1, r0);
      // 桁の側面と裏面
      setHex(mb, 0xbdbbb4);
      mb.quadPoints(lower(l1, -depth), l1, l0, lower(l0, -depth));
      mb.quadPoints(lower(r0, -depth), r0, r1, lower(r1, -depth));
      mb.quadPoints(lower(r0, -depth), lower(r1, -depth), lower(l1, -depth), lower(l0, -depth));
      // 高欄 (車道はコンクリートの壁、歩道橋は手すり)
      for (const [a, b] of [
        [l0, l1],
        [r0, r1],
      ]) {
        if (road) {
          setHex(mb, 0xc9c7c0);
          const cx = (a[0] + b[0]) / 2;
          const cz = (a[2] + b[2]) / 2;
          const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
          const rot = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
          mb.box(cx, Math.min(a[1], b[1]), cz, len, railH + Math.abs(a[1] - b[1]), 0.25, rot);
        } else {
          addRail(mb, a, b, railH, 0xd8dadb);
        }
        collision.addSegment(a[0], a[2], b[0], b[2], Math.max(a[1], b[1]) + railH, Math.min(a[1], b[1]) - depth);
      }
    }
    // 橋脚: 地面からの高さがあるところに立てる
    let run = 0;
    for (let i = 0; i + 1 < n; i++) {
      const segLen = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]);
      for (let d = 12 - run; d < segLen; d += 24) {
        const t = d / segLen;
        const x = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * t;
        const z = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * t;
        const top = span.ys[i] + (span.ys[i + 1] - span.ys[i]) * t - depth;
        const ground = hf.heightAt(x, z);
        if (top - ground < 2.5) continue;
        setHex(mb, 0xb5b3ac);
        const r = road ? 1.1 : 0.3;
        mb.cylinder(x, ground - 0.5, z, r, r, top - ground + 0.5, 10);
        collision.addCircle(x, z, r, top);
      }
      run = (run + segLen) % 24;
    }
  }
}

/** 支柱と横桟だけの手すり */
function addRail(mb: MeshBuilder, a: number[], b: number[], height: number, color: number): void {
  setHex(mb, color);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (len < 0.1) return;
  const posts = Math.max(1, Math.round(len / 1.6));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    mb.box(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 0.05, height, 0.05);
  }
  const ux = (b[0] - a[0]) / len;
  const uz = (b[2] - a[2]) / len;
  const nx = -uz * 0.025;
  const nz = ux * 0.025;
  for (const h of [height, height * 0.55, height * 0.12]) {
    const p0 = [a[0] - nx, a[1] + h, a[2] - nz];
    const p1 = [b[0] - nx, b[1] + h, b[2] - nz];
    const q0 = [a[0] + nx, a[1] + h, a[2] + nz];
    const q1 = [b[0] + nx, b[1] + h, b[2] + nz];
    const up = (v: number[]): number[] => [v[0], v[1] - 0.045, v[2]];
    mb.quadPoints(up(p0), up(p1), p1, p0);
    mb.quadPoints(up(q1), up(q0), q0, q1);
    mb.quadPoints(p0, p1, q1, q0);
  }
}

// ---------------------------------------------------------------- 水面
function buildWater(json: CampusJson, hf: Heightfield): Mesh3D | null {
  const mb = new MeshBuilder({ uvs: true });
  for (const a of json.areas) {
    if (a.k !== 'water') continue;
    const level = minOnRing(hf, a.r) + 0.25;
    const tris = earcut(a.r, undefined, 2);
    const base = mb.vertexCount;
    for (let i = 0; i < a.r.length; i += 2) mb.vertex(a.r[i], level, a.r[i + 1], 0, 1, 0, a.r[i] * 0.1, a.r[i + 1] * 0.1);
    for (let i = 0; i < tris.length; i += 3) {
      const p = tris[i];
      const q = tris[i + 1];
      const r = tris[i + 2];
      const ux = a.r[q * 2] - a.r[p * 2];
      const uz = a.r[q * 2 + 1] - a.r[p * 2 + 1];
      const vx = a.r[r * 2] - a.r[p * 2];
      const vz = a.r[r * 2 + 1] - a.r[p * 2 + 1];
      if (uz * vx - ux * vz > 0) mb.tri(base + p, base + q, base + r);
      else mb.tri(base + p, base + r, base + q);
    }
  }
  const geometry = mb.build();
  if (!geometry) return null;
  return new Mesh3D({
    label: 'water',
    geometry,
    material: new Material3D({ baseColor: 0x2c3d33, roughness: 0.06, metallic: 0.35 }),
    castShadow: false,
  });
}

// ---------------------------------------------------------------- テニスコート
function addTennisCourts(mb: MeshBuilder, json: CampusJson, hf: Heightfield, collision: CollisionWorld): void {
  for (const a of json.areas) {
    if (a.k !== 'tennis') continue;
    const y = meanOnRing(hf, a.r) + 0.03;
    const n = a.r.length / 2;
    if (n < 4) continue;
    // 4 隅 (OSM の四角形) をそのままコートの面にする
    const c = [0, 1, 2, 3].map((i) => [a.r[i * 2], y, a.r[i * 2 + 1]]);
    const orient = (c[1][0] - c[0][0]) * (c[3][2] - c[0][2]) - (c[1][2] - c[0][2]) * (c[3][0] - c[0][0]);
    const q = orient < 0 ? c : [c[0], c[3], c[2], c[1]];
    setHex(mb, 0x3f7f63);
    mb.quadPoints(q[0], q[1], q[2], q[3]);
    const lerp = (p: number[], r: number[], t: number): number[] => [p[0] + (r[0] - p[0]) * t, y + 0.012, p[2] + (r[2] - p[2]) * t];
    const at = (u: number, v: number): number[] => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v);
    const line = (u0: number, v0: number, u1: number, v1: number): void => {
      const p0 = at(u0, v0);
      const p1 = at(u1, v1);
      const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) || 1;
      const ox = (-(p1[2] - p0[2]) / len) * 0.035;
      const oz = ((p1[0] - p0[0]) / len) * 0.035;
      setHex(mb, 0xf0f0ec);
      mb.quadPoints(
        [p0[0] + ox, p0[1], p0[2] + oz],
        [p1[0] + ox, p1[1], p1[2] + oz],
        [p1[0] - ox, p1[1], p1[2] - oz],
        [p0[0] - ox, p0[1], p0[2] - oz],
      );
      mb.quadPoints(
        [p0[0] - ox, p0[1], p0[2] - oz],
        [p1[0] - ox, p1[1], p1[2] - oz],
        [p1[0] + ox, p1[1], p1[2] + oz],
        [p0[0] + ox, p0[1], p0[2] + oz],
      );
    };
    // 外枠・サービスライン・センターライン
    for (const [u0, v0, u1, v1] of [
      [0.12, 0.1, 0.88, 0.1],
      [0.12, 0.9, 0.88, 0.9],
      [0.12, 0.1, 0.12, 0.9],
      [0.88, 0.1, 0.88, 0.9],
      [0.22, 0.1, 0.22, 0.9],
      [0.78, 0.1, 0.78, 0.9],
      [0.22, 0.28, 0.78, 0.28],
      [0.22, 0.72, 0.78, 0.72],
      [0.5, 0.28, 0.5, 0.72],
    ]) {
      line(u0, v0, u1, v1);
    }
    // ネット
    const n0 = at(0.08, 0.5);
    const n1 = at(0.92, 0.5);
    setHex(mb, 0x23272a);
    mb.quadPoints(n0, n1, [n1[0], y + 0.95, n1[2]], [n0[0], y + 0.95, n0[2]]);
    mb.quadPoints(n1, n0, [n0[0], y + 0.95, n0[2]], [n1[0], y + 0.95, n1[2]]);
    collision.addSegment(n0[0], n0[2], n1[0], n1[2], y + 0.95);
    // 緑の防球フェンスの支柱
    for (let i = 0; i < 4; i++) {
      const p = q[i];
      const r = q[(i + 1) % 4];
      addRail(mb, [p[0], y, p[2]], [r[0], y, r[2]], 3, 0x2f6b4c);
    }
  }
}

// ---------------------------------------------------------------- すずかけ門
function addGate(
  mb: MeshBuilder,
  signMesh: MeshBuilder,
  signs: SignAtlas,
  json: CampusJson,
  hf: Heightfield,
  collision: CollisionWorld,
): void {
  const gate = json.pois.find((p) => p.k === 'gate' && p.n === 'すずかけ門');
  if (!gate) return;
  // 門を通る道の向きを調べ、その脇にコンクリートの袖壁と薄い庇を立てる
  const road = nearestRoadPoint(
    json.roads.filter((r) => !r.br && !r.tn && ['footway', 'pedestrian', 'path', 'service'].includes(r.k)),
    gate.x,
    gate.z,
  );
  const dx = road ? road.dx : 1;
  const dz = road ? road.dz : 0;
  const nx = -dz;
  const nz = dx;
  const half = (road?.road.w ?? 4) / 2 + 0.7;
  const y = hf.heightAt(gate.x, gate.z);
  const rot = Math.atan2(-dz, dx);
  for (const side of [-1, 1]) {
    const cx = gate.x + nx * side * (half + 1.6);
    const cz = gate.z + nz * side * (half + 1.6);
    setHex(mb, 0xb5b8b8);
    mb.box(cx, y - 0.4, cz, 0.35, 3.3, 3.2, rot + Math.PI / 2);
    collision.addSegment(cx - nx * 1.6, cz - nz * 1.6, cx + nx * 1.6, cz + nz * 1.6, y + 2.9);
  }
  // 庇 (金属で縁取った薄い屋根)
  setHex(mb, 0x8f9498);
  mb.box(gate.x, y + 2.95, gate.z, 2.6, 0.14, (half + 3.2) * 2, rot + Math.PI / 2, true, true);
  // 銘板
  const plate = signs.add(1024, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#c9cdd0');
    grad.addColorStop(1, '#a9aeb2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#20242a';
    ctx.textBaseline = 'middle';
    ctx.font = '600 58px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Institute of SCIENCE TOKYO', 48, h * 0.34);
    ctx.font = '700 76px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
    ctx.fillText('東京科学大学', 48, h * 0.7);
    ctx.font = '500 34px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
    ctx.fillText('横浜キャンパス', 560, h * 0.74);
  });
  for (const dir of [-1, 1]) {
    const cx = gate.x + nx * (half + 1.6) - dx * dir * 0.19;
    const cz = gate.z + nz * (half + 1.6) - dz * dir * 0.19;
    addSignQuad(signMesh, cx, y + 1.7, cz, 2.4, 0.6, -dx * dir, -dz * dir, plate);
  }
}

function nearestRoadPoint(
  roads: RoadData[],
  x: number,
  z: number,
): { road: RoadData; x: number; z: number; dist: number; dx: number; dz: number } | null {
  let best: { road: RoadData; x: number; z: number; dist: number; dx: number; dz: number } | null = null;
  for (const road of roads) {
    const p = road.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2] - p[i];
      const ez = p[i + 3] - p[i + 1];
      const l2 = ex * ex + ez * ez;
      if (l2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - p[i]) * ex + (z - p[i + 1]) * ez) / l2));
      const qx = p[i] + ex * t;
      const qz = p[i + 1] + ez * t;
      const dist = Math.hypot(x - qx, z - qz);
      if (!best || dist < best.dist) {
        const len = Math.sqrt(l2);
        best = { road, x: qx, z: qz, dist, dx: ex / len, dz: ez / len };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- 棟名サイン
function addBuildingSigns(
  mb: MeshBuilder,
  signMesh: MeshBuilder,
  signs: SignAtlas,
  json: CampusJson,
  hf: Heightfield,
  roads: RoadData[],
  collision: CollisionWorld,
): void {
  const seen = new Set<string>();
  for (const b of json.buildings) {
    if (!b.c || !b.n) continue;
    const code = b.n.replace(/(高層棟|本棟|棟)$/, '');
    if (!/^[A-Z]/.test(code) || seen.has(code)) continue;
    seen.add(code);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < b.r.length; i += 2) {
      cx += b.r[i];
      cz += b.r[i + 1];
    }
    cx /= b.r.length / 2;
    cz /= b.r.length / 2;
    const hit = nearestRoadPoint(roads, cx, cz);
    if (!hit || hit.dist > 70) continue;
    // 道から建物側へ少し入ったところに、道を向けて立てる
    let tx = cx - hit.x;
    let tz = cz - hit.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const off = hit.road.w / 2 + 0.9;
    const x = hit.x + tx * off;
    const z = hit.z + tz * off;
    if (signedDistanceToPolygon(x, z, b.r) < 0.6) continue;
    const y = hf.heightAt(x, z);
    const area = code[0];
    const face = signs.add(160, 512, (ctx, w, h) => {
      ctx.fillStyle = '#d6d8d9';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = AREA_COLORS[area] ?? '#555b61';
      ctx.fillRect(20, 24, w - 40, w - 40);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 84px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(area, w / 2, 24 + (w - 40) / 2 + 4);
      ctx.fillStyle = '#2a2e33';
      const parts = code.split(/[・-]/);
      ctx.font = `700 ${code.length > 3 ? 46 : 68}px "Helvetica Neue", Arial, "Hiragino Sans", sans-serif`;
      if (code.length > 5) {
        ctx.fillText(parts.slice(0, Math.ceil(parts.length / 2)).join('・'), w / 2, 232);
        ctx.fillText(parts.slice(Math.ceil(parts.length / 2)).join('-'), w / 2, 292);
      } else ctx.fillText(code, w / 2, 250);
      ctx.font = '500 26px "Hiragino Sans", "Noto Sans JP", sans-serif';
      ctx.fillStyle = '#4a4f55';
      ctx.fillText('棟', w / 2, code.length > 5 ? 352 : 318);
    });
    const rot = Math.atan2(-hit.dz, hit.dx);
    setHex(mb, 0xc4c6c7);
    mb.box(x, y - 0.2, z, 0.5, 1.9, 0.16, rot);
    addSignQuad(signMesh, x - tx * 0.085, y + 0.9, z - tz * 0.085, 0.46, 1.5, -tx, -tz, face);
    addSignQuad(signMesh, x + tx * 0.085, y + 0.9, z + tz * 0.085, 0.46, 1.5, tx, tz, face);
    collision.addCircle(x, z, 0.3, y + 1.7);
  }
}

// ---------------------------------------------------------------- 街灯
function addLamps(
  mb: MeshBuilder,
  lamps: MeshBuilder,
  hf: Heightfield,
  roads: RoadData[],
  inBuilding: (x: number, z: number) => boolean,
  collision: CollisionWorld,
): void {
  const placed: number[] = [];
  for (const road of roads) {
    if (!['service', 'footway', 'pedestrian', 'unclassified', 'tertiary'].includes(road.k) || road.sv === 'parking_aisle') continue;
    const walk = road.k === 'footway' || road.k === 'pedestrian';
    const spacing = walk ? 22 : 30;
    const p = road.p;
    let dist = spacing * 0.5;
    let side = hash2(p[0], p[1]) % 2 ? 1 : -1;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2] - p[i];
      const ez = p[i + 3] - p[i + 1];
      const len = Math.hypot(ex, ez);
      if (len < 0.01) continue;
      while (dist < len) {
        const t = dist / len;
        const off = road.w / 2 + 0.55;
        const x = p[i] + ex * t + (-ez / len) * off * side;
        const z = p[i + 1] + ez * t + (ex / len) * off * side;
        dist += spacing;
        side = -side;
        if (inBuilding(x, z)) continue;
        let tooClose = false;
        for (let k = 0; k < placed.length; k += 2) {
          if (Math.hypot(placed[k] - x, placed[k + 1] - z) < 9) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        placed.push(x, z);
        const y = hf.heightAt(x, z);
        const h = walk ? 3.6 : 5.2;
        setHex(mb, 0x4b5157);
        mb.cylinder(x, y - 0.2, z, 0.075, 0.055, h + 0.2, 6);
        // 灯具は道の側へ少し張り出す
        const ax = (ez / len) * side;
        const az = (-ex / len) * side;
        const armRot = Math.atan2(-az, ax);
        mb.box(x + ax * 0.3, y + h - 0.06, z + az * 0.3, 0.7, 0.06, 0.07, armRot);
        lamps.color(1, 1, 1, 1);
        lamps.box(x + ax * 0.58, y + h - 0.16, z + az * 0.58, 0.46, 0.1, 0.2, armRot, true, true);
        collision.addCircle(x, z, 0.1, y + h);
      }
      dist -= len;
    }
  }
}

// ---------------------------------------------------------------- 駐車している車
function addCars(mb: MeshBuilder, json: CampusJson, hf: Heightfield, collision: CollisionWorld): void {
  const rand = mulberry32(2026);
  for (const a of json.areas) {
    if (a.k !== 'parking' && a.k !== 'parking_space') continue;
    const box = boundsBox(a);
    if (box.area < 60) continue;
    const { ax, az, cx, cz, halfLen, halfWid } = box;
    // 長手方向の両端の縁に沿って、車室を並べる
    const rows = halfWid > 7.5 ? [-(halfWid - 2.7), halfWid - 2.7] : [0];
    for (const row of rows) {
      for (let s = -halfLen + 1.6; s <= halfLen - 1.6; s += 2.6) {
        if (rand() > (a.k === 'parking' ? 0.52 : 0.4)) continue;
        const x = cx + ax * s - az * row;
        const z = cz + az * s + ax * row;
        if (signedDistanceToPolygon(x, z, a.r) > -2.3) continue;
        const y = hf.heightAt(x, z);
        const facing = Math.atan2(-ax, -az) + (row < 0 ? 0 : Math.PI) + Math.PI / 2;
        addCar(mb, x, y, z, facing, CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)], rand);
        collision.addCircle(x, z, 1.3, y + 1.4);
      }
    }
  }
}

function boundsBox(a: AreaData): { ax: number; az: number; cx: number; cz: number; halfLen: number; halfWid: number; area: number } {
  const r = a.r;
  const n = r.length / 2;
  let best = 0;
  let ax = 1;
  let az = 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r[j * 2] - r[i * 2];
    const dz = r[j * 2 + 1] - r[i * 2 + 1];
    area += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
    const l = Math.hypot(dx, dz);
    if (l > best) {
      best = l;
      ax = dx / l;
      az = dz / l;
    }
  }
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (let i = 0; i < n; i++) {
    const pa = r[i * 2] * ax + r[i * 2 + 1] * az;
    const pb = -r[i * 2] * az + r[i * 2 + 1] * ax;
    minA = Math.min(minA, pa);
    maxA = Math.max(maxA, pa);
    minB = Math.min(minB, pb);
    maxB = Math.max(maxB, pb);
  }
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  return {
    ax,
    az,
    cx: ca * ax - cb * az,
    cz: ca * az + cb * ax,
    halfLen: (maxA - minA) / 2,
    halfWid: (maxB - minB) / 2,
    area: Math.abs(area / 2),
  };
}

/** 箱 2 つとタイヤで作る簡単な乗用車 (全長 4.3 m 前後) */
function addCar(mb: MeshBuilder, x: number, y: number, z: number, rot: number, color: number, rand: () => number): void {
  const len = 3.9 + rand() * 0.8;
  const wid = 1.68 + rand() * 0.14;
  const tall = rand() < 0.35;
  setHex(mb, color);
  mb.box(x, y + 0.28, z, len, tall ? 0.72 : 0.56, wid, rot);
  // キャビン (窓ガラスの色)
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const shift = tall ? 0.1 : -0.15;
  setHex(mb, 0x1c2227);
  mb.box(x + c * shift, y + (tall ? 1.0 : 0.84), z - s * shift, len * (tall ? 0.72 : 0.5), tall ? 0.58 : 0.46, wid * 0.9, rot);
  setHex(mb, color, 0.92);
  mb.box(x + c * shift, y + (tall ? 1.58 : 1.3), z - s * shift, len * (tall ? 0.7 : 0.44), 0.05, wid * 0.88, rot);
  // タイヤ
  setHex(mb, 0x151617);
  for (const fx of [-1, 1]) {
    for (const fz of [-1, 1]) {
      const lx = fx * len * 0.32;
      const lz = fz * (wid / 2 - 0.08);
      mb.box(x + lx * c + lz * s, y, z - lx * s + lz * c, 0.62, 0.62, 0.2, rot);
    }
  }
}

// ---------------------------------------------------------------- 自販機・ポスト・バス停など
function addSmallProps(mb: MeshBuilder, json: CampusJson, hf: Heightfield, collision: CollisionWorld): void {
  const roads = json.roads.filter((r) => !r.br && !r.tn);
  const VENDING = [0xe9eef2, 0xc23b3b, 0x2b62b0, 0xf2f2ee];
  for (const p of json.pois) {
    if (!hf.contains(p.x, p.z)) continue;
    const y = hf.heightAt(p.x, p.z);
    const hit = nearestRoadPoint(roads, p.x, p.z);
    const rot = hit ? Math.atan2(-hit.dz, hit.dx) : 0;
    switch (p.k) {
      case 'vending': {
        setHex(mb, VENDING[hash2(p.x, p.z) % VENDING.length]);
        mb.box(p.x, y, p.z, 1.0, 1.83, 0.72, rot);
        collision.addCircle(p.x, p.z, 0.6, y + 1.8);
        break;
      }
      case 'post_box': {
        setHex(mb, 0xc8102e);
        mb.box(p.x, y + 0.75, p.z, 0.5, 0.62, 0.45, rot);
        mb.cylinder(p.x, y, p.z, 0.09, 0.09, 0.75, 8);
        collision.addCircle(p.x, p.z, 0.35, y + 1.4);
        break;
      }
      case 'bollard': {
        setHex(mb, 0xc9cdd0);
        mb.cylinder(p.x, y, p.z, 0.07, 0.07, 0.8, 8, true);
        collision.addCircle(p.x, p.z, 0.1, y + 0.8);
        break;
      }
      case 'bus_stop': {
        setHex(mb, 0x8a9096);
        mb.cylinder(p.x, y, p.z, 0.04, 0.04, 2.5, 6);
        setHex(mb, 0xe9a23b);
        mb.box(p.x, y + 2.1, p.z, 0.5, 0.5, 0.04, rot);
        setHex(mb, 0xf2f2ee);
        mb.box(p.x, y + 1.25, p.z, 0.42, 0.7, 0.04, rot);
        mb.cylinder(p.x, y, p.z, 0.2, 0.2, 0.12, 10, true);
        collision.addCircle(p.x, p.z, 0.2, y + 2.4);
        break;
      }
      case 'signal': {
        setHex(mb, 0x8d9398);
        mb.cylinder(p.x + 3.2, y, p.z + 3.2, 0.1, 0.08, 5.6, 8);
        setHex(mb, 0x2a2d30);
        mb.box(p.x + 3.2, y + 5.0, p.z + 3.2, 1.25, 0.45, 0.25, rot);
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------- 柵・ガードレール
function addBarriers(mb: MeshBuilder, json: CampusJson, hf: Heightfield, collision: CollisionWorld): void {
  for (const b of json.barriers) {
    const p = b.p;
    if (b.k === 'bollard') {
      for (let i = 0; i < p.length; i += 2) {
        const y = hf.heightAt(p[i], p[i + 1]);
        setHex(mb, 0xc9cdd0);
        mb.cylinder(p[i], y, p[i + 1], 0.07, 0.07, 0.8, 8, true);
        collision.addCircle(p[i], p[i + 1], 0.1, y + 0.8);
      }
      continue;
    }
    const height = b.k === 'guard_rail' ? 0.8 : 1.6;
    const color = b.k === 'guard_rail' ? 0xe6e7e4 : 0x3c4146;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (!hf.contains(p[i], p[i + 1]) || !hf.contains(p[i + 2], p[i + 3])) continue;
      const a = [p[i], hf.heightAt(p[i], p[i + 1]), p[i + 1]];
      const c = [p[i + 2], hf.heightAt(p[i + 2], p[i + 3]), p[i + 3]];
      addRail(mb, a, c, height, color);
      collision.addSegment(a[0], a[2], c[0], c[2], Math.max(a[1], c[1]) + height);
    }
  }
}

// ---------------------------------------------------------------- 送電鉄塔
function addPylons(mb: MeshBuilder, json: CampusJson, hf: Heightfield): void {
  for (const p of json.pois) {
    if (p.k !== 'pylon' || !hf.contains(p.x, p.z)) continue;
    const y = hf.heightAt(p.x, p.z);
    const H = 46;
    const leg = (t: number): number => 4.2 * (1 - t) + 0.7 * t; // 中心から脚までの距離
    setHex(mb, 0xb9bec2);
    const strut = (a: number[], b: number[]): void => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      const w = 0.09;
      // 細い四角柱を 2 枚の交差した板で代用する
      const nx = Math.abs(dy) > len * 0.9 ? 1 : -dz / (Math.hypot(dx, dz) || 1);
      const nz = Math.abs(dy) > len * 0.9 ? 0 : dx / (Math.hypot(dx, dz) || 1);
      for (const [ox, oy, oz] of [
        [nx * w, 0, nz * w],
        [0, w, 0],
      ]) {
        const q0 = [a[0] - ox, a[1] - oy, a[2] - oz];
        const q1 = [b[0] - ox, b[1] - oy, b[2] - oz];
        const q2 = [b[0] + ox, b[1] + oy, b[2] + oz];
        const q3 = [a[0] + ox, a[1] + oy, a[2] + oz];
        mb.quadPoints(q0, q1, q2, q3);
        mb.quadPoints(q3, q2, q1, q0);
      }
    };
    const levels = 9;
    for (let i = 0; i < levels; i++) {
      const t0 = i / levels;
      const t1 = (i + 1) / levels;
      const r0 = leg(t0);
      const r1 = leg(t1);
      const y0 = y + t0 * H;
      const y1 = y + t1 * H;
      const corners = [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ];
      for (let c = 0; c < 4; c++) {
        const [sx, sz] = corners[c];
        const [tx, tz] = corners[(c + 1) % 4];
        strut([p.x + sx * r0, y0, p.z + sz * r0], [p.x + sx * r1, y1, p.z + sz * r1]);
        strut([p.x + sx * r0, y0, p.z + sz * r0], [p.x + tx * r1, y1, p.z + tz * r1]);
        strut([p.x + sx * r1, y1, p.z + sz * r1], [p.x + tx * r1, y1, p.z + tz * r1]);
      }
    }
    // 腕金 (電線を吊る横木)
    for (const [t, span] of [
      [0.74, 9],
      [0.86, 7.5],
      [0.97, 6],
    ]) {
      strut([p.x - span, y + t * H, p.z], [p.x + span, y + t * H, p.z]);
      strut([p.x - span, y + t * H, p.z], [p.x, y + (t + 0.05) * H, p.z]);
      strut([p.x + span, y + t * H, p.z], [p.x, y + (t + 0.05) * H, p.z]);
    }
  }
}
