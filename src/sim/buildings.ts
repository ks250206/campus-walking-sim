import { Container3D, Material3D, Mesh3D } from '@pixi/3d';
import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type { Pair, Polygon } from 'polygon-clipping';
import { MINT_ROOF_COLOR, buildingStyleFor, hasMintRoof, officialFloors } from './buildingStyles';
import type { CollisionWorld } from './collision';
import type { PassageSpec } from './extras';
import { FACADE_STYLES, createFacadeMaterial } from './facade';
import type { FacadeStyle, FacadeStyleId } from './facade';
import type { Heightfield } from './heightfield';
import { pointInPolygon, signedDistanceToPolygon } from './heightfield';
import { MeshBuilder, linearRgb } from './meshBuilder';
import { hash2, mulberry32 } from './rng';
import { surfaceBit } from './shaderBits';
import type { BuildingData, CampusData } from './types';

export interface BuildingsResult {
  node: Container3D;
  /** 外壁マテリアル (夜の窓明かりの更新用) */
  facadeMaterials: Material3D[];
}

const PITCHED_ROOF_COLORS = [0x4d4f55, 0x5b4a40, 0x3f4a59, 0x6b6d70, 0x74483a, 0x34363a, 0x565a52, 0x5f5750];
const ROOF_UNIT_COLORS = [0xb9bcbc, 0xa7a9a6, 0xc6c6c0, 0x9aa0a2];

function shoelace(r: number[]): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

function reversed(r: number[]): number[] {
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i], r[i + 1]);
  return out;
}

/** 外周は (x, z) の符号付き面積が負になる向きにそろえる (辺の進行方向 = 外から見て右向き) */
const asOuter = (r: number[]): number[] => (shoelace(r) > 0 ? reversed(r) : r);
const asHole = (r: number[]): number[] => (shoelace(r) < 0 ? reversed(r) : r);

interface Obb {
  cx: number;
  cz: number;
  /** 長手方向の単位ベクトル */
  ax: number;
  az: number;
  halfLen: number;
  halfWid: number;
  coverage: number;
}

/** いちばん長い辺の向きに合わせた外接長方形 */
function orientedBox(ring: number[], area: number): Obb {
  const n = ring.length / 2;
  let best = 0;
  let ax = 1;
  let az = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j * 2] - ring[i * 2];
    const dz = ring[j * 2 + 1] - ring[i * 2 + 1];
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
    const a = ring[i * 2] * ax + ring[i * 2 + 1] * az;
    const b = -ring[i * 2] * az + ring[i * 2 + 1] * ax;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  }
  let halfLen = (maxA - minA) / 2;
  let halfWid = (maxB - minB) / 2;
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  const cx = ca * ax - cb * az;
  const cz = ca * az + cb * ax;
  if (halfWid > halfLen) {
    [halfLen, halfWid] = [halfWid, halfLen];
    [ax, az] = [-az, ax];
  }
  return { cx, cz, ax, az, halfLen, halfWid, coverage: area / (4 * halfLen * halfWid || 1) };
}

export function buildBuildings(
  data: CampusData,
  hf: Heightfield,
  collision: CollisionWorld,
  passages: PassageSpec[] = [],
): BuildingsResult {
  const node = new Container3D({ label: 'buildings' });
  const walls = new Map<FacadeStyleId, MeshBuilder>();
  const wallBuilder = (id: FacadeStyleId): MeshBuilder => {
    let mb = walls.get(id);
    if (!mb) walls.set(id, (mb = new MeshBuilder({ uvs: true, colors: true, data: true })));
    return mb;
  };
  const roofs = new MeshBuilder({ uvs: true, colors: true });

  for (const b of data.json.buildings) {
    const ring = asOuter(b.r);
    const holes = (b.h ?? []).map(asHole);
    const area = Math.abs(shoelace(ring));
    const height = b.t - b.b;
    const seedInt = hash2(ring[0], ring[1]);
    const rand = mulberry32(seedInt);
    const seed = rand();
    const styleId = buildingStyleFor(b, area, height);
    const style: FacadeStyle = FACADE_STYLES[styleId];
    const mb = wallBuilder(styleId);

    // 屋根の形: 小さな住宅は勾配屋根、それ以外は陸屋根
    const obb = orientedBox(ring, area);
    const pitched = styleId === 'house' && ring.length / 2 <= 8 && obb.coverage > 0.8 && area > 28 && area < 260 && holes.length === 0;
    const rise = pitched ? Math.min(2.4, obb.halfWid * 0.5) : 0;
    const wallTop = pitched ? b.t - rise * 0.5 : b.t;
    const bottom = Math.min(b.b, b.g[0]) - 1.2;

    // 階数が分かっている棟は、その階数がちょうど収まるように外壁の縦の目盛りを伸縮する
    // (シェーダは「1 階の階高 + 基準階の階高 × n」で窓を並べる)
    const floors = officialFloors(b, height);
    let vScale = 1;
    if (floors) {
      const groundFloors = style.groundH > 0 ? Math.max(1, Math.round(style.groundH / style.floorH)) : 0;
      const upper = Math.max(0, floors - groundFloors);
      const target = style.groundH + upper * style.floorH + style.parapet + style.floorH * 0.12;
      vScale = Math.min(1.8, Math.max(0.6, target / Math.max(1, wallTop - b.b)));
    }
    /** 高さ y (地盤から) に最も近い、階の境目の高さ */
    const floorLineNear = (y: number): number => {
      if (!floors) return y;
      const v = y * vScale;
      const k = Math.max(0, Math.round((v - style.groundH) / style.floorH));
      const line = (style.groundH + k * style.floorH) / vScale;
      return Math.abs(line - y) < 1.5 ? line : y;
    };

    const wallBase = style.walls[Math.floor(rand() * style.walls.length)];
    const tone = 0.93 + rand() * 0.12;
    const [wr, wg, wbl] = linearRgb(wallBase);
    const wallColor = [wr * tone, wg * tone, wbl * tone];

    // 下を通り抜けられる建物は、通路の部分だけ上階を残して切り欠く
    const passage = b.c && b.n ? passages.find((p) => p.building.test(b.n ?? '')) : undefined;
    const parts = passage ? splitByPassage(ring, holes, passage.zone) : null;
    const split = parts && parts.over.length > 0 ? parts : null;
    const grounded: Part[] = split ? split.ground : [{ ring, holes }];
    const isCut = (x: number, z: number): boolean =>
      Boolean(split && passage && Math.abs(signedDistanceToPolygon(x, z, passage.zone)) < 0.02);

    /** 1 つの部分 (外周 + 穴) の外壁を、高さ from 〜 wallTop に立てる */
    const addWalls = (part: Part, from: number, lifted: boolean): void => {
      mb.color(wallColor[0], wallColor[1], wallColor[2], 1);
      for (const r of [part.ring, ...part.holes]) {
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const x0 = r[i * 2];
          const z0 = r[i * 2 + 1];
          const x1 = r[j * 2];
          const z1 = r[j * 2 + 1];
          const len = Math.hypot(x1 - x0, z1 - z0);
          if (len < 0.05) continue;
          // 切り口の面: 上階どうしがつながる所なので、持ち上げた側には壁を作らない
          const cut = isCut((x0 + x1) / 2, (z0 + z1) / 2);
          if (cut && lifted) continue;
          const tx = (x1 - x0) / len;
          const tz = (z1 - z0) / len;
          const nx = -tz;
          const nz = tx;
          // 妻側 (建物の短辺方向に走る壁) は、様式によって窓なし・ブレース付きにする
          const across = Math.abs(tx * obb.ax + tz * obb.az) < 0.5;
          const isEnd = style.ends !== 'same' && across && len > 5 && r === part.ring && !cut;
          const plain = len < 1.1 || isEnd || cut;
          const flag = isEnd && style.ends === 'brace' && len > 12 ? 2 : plain ? 1 : 0;
          const bays = plain ? 1 : Math.max(1, Math.round(len / style.bayW));
          mb.setData(len / bays, seed, (wallTop - b.b) * vScale, flag);
          const v0 = (from - b.b) * vScale;
          const v1 = (wallTop - b.b) * vScale;
          const a = mb.vertex(x0, from, z0, nx, 0, nz, 0, v0);
          const bb = mb.vertex(x1, from, z1, nx, 0, nz, bays, v0);
          const c = mb.vertex(x1, wallTop, z1, nx, 0, nz, bays, v1);
          const d = mb.vertex(x0, wallTop, z0, nx, 0, nz, 0, v1);
          mb.quad(a, bb, c, d);
        }
      }
    };

    for (const part of grounded) {
      collision.addRing(part.ring);
      for (const h of part.holes) collision.addRing(h);
      addWalls(part, bottom, false);
      if (pitched) {
        addPitchedRoof(roofs, mb, obb, wallTop, rise, rand, seed, b.b);
      } else {
        addFlatRoof(roofs, part.ring, part.holes, b, style, Math.abs(shoelace(part.ring)), height, obb, rand, wallColor, isCut);
      }
    }
    if (split && passage) {
      // 上に載る階の床下は、階の境目にそろえる
      const soffitY = b.b + floorLineNear(passage.clear);
      for (const part of split.over) {
        addWalls(part, soffitY, true);
        addFlatRoof(roofs, part.ring, part.holes, b, style, 0, height, obb, rand, wallColor, isCut);
        addSoffit(roofs, part, soffitY, wallColor);
      }
    }
  }

  const facadeMaterials: Material3D[] = [];
  for (const [id, mb] of walls) {
    const geometry = mb.build();
    if (!geometry) continue;
    const material = createFacadeMaterial(FACADE_STYLES[id]);
    facadeMaterials.push(material);
    node.addChild(new Mesh3D({ label: `walls-${id}`, geometry, material }));
  }
  const roofGeometry = roofs.build();
  if (roofGeometry) {
    node.addChild(
      new Mesh3D({
        label: 'roofs',
        geometry: roofGeometry,
        material: new Material3D({ baseColor: 0xffffff, roughness: 0.88, metallic: 0, vertexColors: true, extraBits: [surfaceBit] }),
      }),
    );
  }
  void hf;
  return { node, facadeMaterials };
}

interface Part {
  ring: number[];
  holes: number[][];
}

const toPairs = (r: number[]): Pair[] => {
  const out: Pair[] = [];
  for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
  out.push([r[0], r[1]]);
  return out;
};

const fromPolygon = (poly: Polygon): Part => {
  const flatten = (ring: Pair[]): number[] => {
    const out: number[] = [];
    // 始点と同じ終点は落とす
    for (let i = 0; i < ring.length - 1; i++) out.push(ring[i][0], ring[i][1]);
    return out;
  };
  return { ring: asOuter(flatten(poly[0])), holes: poly.slice(1).map((h) => asHole(flatten(h))) };
};

/** 建物の外形を、通り抜けの範囲 (over = 上階だけ残す部分) とそれ以外 (ground) に分ける */
function splitByPassage(ring: number[], holes: number[][], zone: number[]): { ground: Part[]; over: Part[] } {
  const subject: Polygon = [toPairs(ring), ...holes.map(toPairs)];
  const clip: Polygon = [toPairs(zone)];
  const keep = (p: Part): boolean => Math.abs(shoelace(p.ring)) > 1;
  return {
    ground: polygonClipping.difference(subject, clip).map(fromPolygon).filter(keep),
    over: polygonClipping.intersection(subject, clip).map(fromPolygon).filter(keep),
  };
}

/** 通り抜けの天井 (上に載る階の床下) */
function addSoffit(roofs: MeshBuilder, part: Part, y: number, wallColor: number[]): void {
  roofs.color(wallColor[0] * 0.78, wallColor[1] * 0.78, wallColor[2] * 0.78, 1);
  const flat: number[] = [...part.ring];
  const holeIndices: number[] = [];
  for (const h of part.holes) {
    holeIndices.push(flat.length / 2);
    flat.push(...h);
  }
  const tris = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
  const base = roofs.vertexCount;
  for (let i = 0; i < flat.length; i += 2) roofs.vertex(flat[i], y, flat[i + 1], 0, -1, 0, flat[i] * 0.25, flat[i + 1] * 0.25);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const b = tris[i + 1];
    const c = tris[i + 2];
    const ux = flat[b * 2] - flat[a * 2];
    const uz = flat[b * 2 + 1] - flat[a * 2 + 1];
    const vx = flat[c * 2] - flat[a * 2];
    const vz = flat[c * 2 + 1] - flat[a * 2 + 1];
    // 下向き (-Y) になる順に並べる
    if (uz * vx - ux * vz > 0) roofs.tri(base + a, base + c, base + b);
    else roofs.tri(base + a, base + b, base + c);
  }
}

function addFlatRoof(
  roofs: MeshBuilder,
  ring: number[],
  holes: number[][],
  b: BuildingData,
  style: FacadeStyle,
  area: number,
  height: number,
  obb: Obb,
  rand: () => number,
  wallColor: number[],
  isCut: (x: number, z: number) => boolean,
): void {
  const parapet = area > 40 || area === 0 ? style.parapet : 0;
  const roofY = b.t - parapet;
  const [rr, rg, rb] = linearRgb(hasMintRoof(b) ? MINT_ROOF_COLOR : style.roof);
  const tone = 0.88 + rand() * 0.2;
  roofs.color(rr * tone, rg * tone, rb * tone, 1);

  // 屋上の床
  const flat: number[] = [...ring];
  const holeIndices: number[] = [];
  for (const h of holes) {
    holeIndices.push(flat.length / 2);
    flat.push(...h);
  }
  const tris = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
  const base = roofs.vertexCount;
  for (let i = 0; i < flat.length; i += 2) roofs.vertex(flat[i], roofY, flat[i + 1], 0, 1, 0, flat[i] * 0.25, flat[i + 1] * 0.25);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const bI = tris[i + 1];
    const c = tris[i + 2];
    const ux = flat[bI * 2] - flat[a * 2];
    const uz = flat[bI * 2 + 1] - flat[a * 2 + 1];
    const vx = flat[c * 2] - flat[a * 2];
    const vz = flat[c * 2 + 1] - flat[a * 2 + 1];
    // 上向き (+Y) になる順に並べる
    if (uz * vx - ux * vz > 0) roofs.tri(base + a, base + bI, base + c);
    else roofs.tri(base + a, base + c, base + bI);
  }

  // パラペットの内側の面
  if (parapet > 0) {
    roofs.color(wallColor[0] * 0.8, wallColor[1] * 0.8, wallColor[2] * 0.8, 1);
    for (const r of [ring, ...holes]) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (isCut((r[i * 2] + r[j * 2]) / 2, (r[i * 2 + 1] + r[j * 2 + 1]) / 2)) continue;
        roofs.quadPoints(
          [r[j * 2], roofY, r[j * 2 + 1]],
          [r[i * 2], roofY, r[i * 2 + 1]],
          [r[i * 2], b.t, r[i * 2 + 1]],
          [r[j * 2], b.t, r[j * 2 + 1]],
          0,
          0,
          1,
          parapet,
        );
      }
    }
  }

  // 屋上の設備 (空調機・塔屋)。大きな建物ほど多い
  if (area < 220 || !(b.c || area > 500)) return;
  const rot = Math.atan2(-obb.az, obb.ax);
  const place = (margin: number): [number, number] | null => {
    for (let tries = 0; tries < 12; tries++) {
      const a = (rand() * 2 - 1) * obb.halfLen;
      const w = (rand() * 2 - 1) * obb.halfWid;
      const x = obb.cx + a * obb.ax - w * obb.az;
      const z = obb.cz + a * obb.az + w * obb.ax;
      if (!pointInPolygon(x, z, ring)) continue;
      if (signedDistanceToPolygon(x, z, ring) > -margin) continue;
      if (holes.some((h) => pointInPolygon(x, z, h))) continue;
      return [x, z];
    }
    return null;
  };
  if (height > 22) {
    // 塔屋 (エレベータ機械室)
    const p = place(5);
    if (p) {
      roofs.color(wallColor[0] * 0.95, wallColor[1] * 0.95, wallColor[2] * 0.95, 1);
      roofs.box(p[0], roofY, p[1], 7 + rand() * 4, 3.4 + rand() * 1.6, 5 + rand() * 2, rot);
    }
  }
  const units = Math.min(9, Math.floor(area / 190));
  for (let i = 0; i < units; i++) {
    const p = place(2.6);
    if (!p) continue;
    const [ur, ug, ub] = linearRgb(ROOF_UNIT_COLORS[Math.floor(rand() * ROOF_UNIT_COLORS.length)]);
    roofs.color(ur, ug, ub, 1);
    roofs.box(p[0], roofY, p[1], 1.6 + rand() * 3.4, 1.1 + rand() * 1.5, 1.2 + rand() * 1.6, rot);
  }
}

/** 切妻または寄棟の屋根。軒は少し張り出す */
function addPitchedRoof(
  roofs: MeshBuilder,
  walls: MeshBuilder,
  obb: Obb,
  eaveY: number,
  rise: number,
  rand: () => number,
  seed: number,
  baseY: number,
): void {
  const over = 0.38;
  const hip = rand() < 0.45 ? Math.min(obb.halfWid, obb.halfLen * 0.8) : 0;
  const L = obb.halfLen + over;
  const W = obb.halfWid + over;
  const ridgeY = eaveY + rise;
  const eave = eaveY - (over / (obb.halfWid || 1)) * rise;
  const pt = (a: number, w: number, y: number): number[] => [obb.cx + a * obb.ax - w * obb.az, y, obb.cz + a * obb.az + w * obb.ax];
  const [r, g, b] = linearRgb(PITCHED_ROOF_COLORS[Math.floor(rand() * PITCHED_ROOF_COLORS.length)]);
  const tone = 0.85 + rand() * 0.25;
  roofs.color(r * tone, g * tone, b * tone, 1);
  const ridgeHalf = Math.max(0, obb.halfLen - hip) + (hip > 0 ? 0 : over);
  const c1 = pt(-L, W, eave);
  const c2 = pt(L, W, eave);
  const c3 = pt(L, -W, eave);
  const c4 = pt(-L, -W, eave);
  const r1 = pt(-ridgeHalf, 0, ridgeY);
  const r2 = pt(ridgeHalf, 0, ridgeY);
  // 2 つの大きな屋根面
  quadFacingUp(roofs, c1, c2, r2, r1);
  quadFacingUp(roofs, c3, c4, r1, r2);
  if (hip > 0) {
    // 寄棟: 妻側も屋根面
    quadFacingUp(roofs, c2, c3, r2, r2);
    quadFacingUp(roofs, c4, c1, r1, r1);
  } else {
    // 切妻: 妻壁の三角形を外壁として足す
    const gable = (sign: number): void => {
      const a = pt(sign * obb.halfLen, sign * obb.halfWid, eaveY);
      const bb = pt(sign * obb.halfLen, -sign * obb.halfWid, eaveY);
      const top = pt(sign * obb.halfLen, 0, ridgeY);
      const nx = sign * obb.ax;
      const nz = sign * obb.az;
      const len = obb.halfWid * 2;
      walls.setData(len, seed, eaveY - baseY, 1);
      const i0 = walls.vertex(a[0], a[1], a[2], nx, 0, nz, 0, eaveY - baseY);
      const i1 = walls.vertex(bb[0], bb[1], bb[2], nx, 0, nz, 1, eaveY - baseY);
      const i2 = walls.vertex(top[0], top[1], top[2], nx, 0, nz, 0.5, ridgeY - baseY);
      walls.tri(i0, i1, i2);
      walls.tri(i0, i2, i1);
    };
    gable(1);
    gable(-1);
  }
}

/** 4 点 (三角形のときは最後の 2 点を同じに) を、上向きの面として追加する */
function quadFacingUp(mb: MeshBuilder, p0: number[], p1: number[], p2: number[], p3: number[]): void {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  const flip = ny < 0;
  if (flip) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const i0 = mb.vertex(p0[0], p0[1], p0[2], nx, ny, nz, p0[0] * 0.5, p0[2] * 0.5);
  const i1 = mb.vertex(p1[0], p1[1], p1[2], nx, ny, nz, p1[0] * 0.5, p1[2] * 0.5);
  const i2 = mb.vertex(p2[0], p2[1], p2[2], nx, ny, nz, p2[0] * 0.5, p2[2] * 0.5);
  const i3 = mb.vertex(p3[0], p3[1], p3[2], nx, ny, nz, p3[0] * 0.5, p3[2] * 0.5);
  if (flip) {
    mb.tri(i0, i2, i1);
    mb.tri(i0, i3, i2);
  } else {
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i3);
  }
}
