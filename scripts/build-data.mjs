// data/raw/ の公開データを、シミュレータが読む public/data/ のファイルに変換する。
//
//   campus.json  建物 (外形・地盤高・屋根高・名前)、道路、土地利用、樹木、目印
//   terrain.bin  詳細エリアの標高グリッド (Uint16, cm)
//   far.bin      遠景の標高グリッド (Uint16, cm) と地表色 (RGB)
//
// 使い方: pnpm data:build   (先に pnpm data:fetch)
//        --debug <dir> を付けると確認用の SVG / PNG を書き出す

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  BASE_ELEVATION,
  FAR_RADIUS,
  ORIGIN,
  WORLD,
  centroid,
  cleanRing,
  distToRing,
  flat,
  pointInRing,
  round,
  signedArea,
  simplifyRing,
  toLatLon,
  toWorld,
} from './lib/geo.mjs';
import { assembleRings, parseOsm } from './lib/osm.mjs';
import { parsePlateauBuildings } from './lib/plateau.mjs';
import { loadElevation, loadPhoto } from './lib/tiles.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const debugIdx = process.argv.indexOf('--debug');
const DEBUG_DIR = debugIdx >= 0 ? process.argv[debugIdx + 1] : null;

fs.mkdirSync(OUT, { recursive: true });

const CAMPUS_RELATION = '18934747'; // 東京科学大学 横浜キャンパス
const MARGIN = 40; // 詳細エリアの外側にも少しだけ地物を残す
const inBounds = ([x, z], m = MARGIN) => x >= WORLD.minX - m && x <= WORLD.maxX + m && z >= WORLD.minZ - m && z <= WORLD.maxZ + m;

// 決定的な乱数 (ビルドのたびに同じ結果になるように)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ OSM
console.log('OSM を読み込み中 …');
const osm = parseOsm(path.join(RAW, 'osm', 'map.osm'));
const nodeXZ = (id) => {
  const n = osm.nodes.get(id);
  return n ? toWorld(n.lat, n.lon) : null;
};
const wayPts = (way) => way.nd.map(nodeXZ).filter(Boolean);
const isClosed = (way) => way.nd.length >= 4 && way.nd[0] === way.nd[way.nd.length - 1];

// キャンパスの敷地境界
const campusRel = osm.relations.get(CAMPUS_RELATION);
if (!campusRel) throw new Error('OSM にキャンパスのリレーションが見つかりません');
const campusRings = assembleRings(
  campusRel.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => osm.ways.get(m.ref)?.nd ?? []),
).map((ids) => cleanRing(ids.map(nodeXZ).filter(Boolean)));
const inCampus = (p) => campusRings.some((r) => pointInRing(p, r));
const campusDist = (p) => Math.min(...campusRings.map((r) => distToRing(p, r)));

// ------------------------------------------------------------------ 建物
console.log('建物 (PLATEAU + OSM) …');
const osmBuildings = [];
for (const way of osm.ways.values()) {
  if (!way.tags.building || !isClosed(way)) continue;
  const ring = cleanRing(wayPts(way));
  if (ring.length < 3) continue;
  osmBuildings.push({ id: way.id, tags: way.tags, ring, c: centroid(ring), used: false });
}

const buildings = [];
const plateauFiles = fs.readdirSync(path.join(RAW, 'plateau')).filter((f) => f.endsWith('_bldg.gml'));
const seenIds = new Set();
for (const file of plateauFiles) {
  for (const b of parsePlateauBuildings(path.join(RAW, 'plateau', file))) {
    if (seenIds.has(b.id)) continue;
    seenIds.add(b.id);
    for (const poly of b.polygons) {
      let ring = cleanRing(poly.outer.map(([lat, lon]) => toWorld(lat, lon)));
      if (ring.length < 3) continue;
      const c = centroid(ring);
      if (!inBounds(c)) continue;
      const area = Math.abs(signedArea(ring));
      if (area < 6) continue;
      ring = simplifyRing(ring, 0.04);
      const holes = poly.holes
        .map((h) => cleanRing(h.map(([lat, lon]) => toWorld(lat, lon))))
        .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) > 4);
      const height = b.height ?? (b.zMax !== null && b.zMin !== null ? b.zMax - b.zMin : null) ?? 3;
      const base = b.zMin;
      buildings.push({ src: 'plateau', ring, holes, c, area, height: Math.max(2.2, height), base, storeys: b.storeys, names: new Map() });
    }
  }
}

// OSM の建物名を PLATEAU の外形に対応づける (重心と頂点が入っている OSM 建物の多数決)
for (const b of buildings) {
  const samples = [b.c, ...b.ring];
  for (const o of osmBuildings) {
    if (Math.hypot(o.c[0] - b.c[0], o.c[1] - b.c[1]) > 150) continue;
    let hits = 0;
    for (const s of samples) if (pointInRing(s, o.ring)) hits++;
    if (pointInRing(o.c, b.ring)) hits += 2;
    if (hits === 0) continue;
    o.used = true;
    const key = o.tags.name ?? '';
    b.names.set(key, (b.names.get(key) ?? 0) + hits);
    b.osmTags ??= o.tags;
  }
}

// PLATEAU に無い OSM 建物 (駅舎など) を、階数や種別から高さを推定して追加
const guessHeight = (tags, area) => {
  if (tags.height && Number(tags.height) > 0) return Number(tags.height);
  const levels = Number(tags['building:levels']);
  if (levels > 0) return levels * 3.3 + 1;
  switch (tags.building) {
    case 'house':
    case 'detached':
      return 6.5;
    case 'apartments':
      return 12;
    case 'roof':
      return 3.6;
    case 'train_station':
      return 6;
    case 'commercial':
    case 'retail':
      return 7.5;
    case 'industrial':
    case 'warehouse':
      return 8;
    case 'school':
    case 'university':
    case 'kindergarten':
      return 10;
    default:
      return area < 70 ? 4 : area < 200 ? 6.5 : 8;
  }
};
let osmOnly = 0;
for (const o of osmBuildings) {
  if (o.used || !inBounds(o.c)) continue;
  if (buildings.some((b) => b.src === 'plateau' && Math.hypot(b.c[0] - o.c[0], b.c[1] - o.c[1]) < 60 && pointInRing(o.c, b.ring))) continue;
  const area = Math.abs(signedArea(o.ring));
  if (area < 6) continue;
  buildings.push({
    src: 'osm',
    ring: simplifyRing(o.ring, 0.04),
    holes: [],
    c: o.c,
    area,
    height: guessHeight(o.tags, area),
    base: null,
    storeys: Number(o.tags['building:levels']) || null,
    names: new Map(o.tags.name ? [[o.tags.name, 1]] : []),
    osmTags: o.tags,
  });
  osmOnly++;
}
console.log(`  PLATEAU ${buildings.length - osmOnly} 棟 + OSM のみ ${osmOnly} 棟`);

// ------------------------------------------------------------------ 標高
console.log('標高 (地理院 DEM) …');
const dem5 = loadElevation(path.join(RAW, 'gsi', 'dem5a_png'), 15);
const dem10 = loadElevation(path.join(RAW, 'gsi', 'dem_png'), 14);
const demFar = loadElevation(path.join(RAW, 'gsi', 'dem_png'), 13);
if (!dem5 && !dem10) throw new Error('標高タイルがありません (pnpm data:fetch を先に実行)');

const elevationAt = (x, z) => {
  const { lat, lon } = toLatLon(x, z);
  let h = dem5 ? dem5.sample(lat, lon) : NaN;
  if (Number.isNaN(h) && dem10) h = dem10.sample(lat, lon);
  if (Number.isNaN(h) && demFar) h = demFar.sample(lat, lon);
  return h;
};

const STEP = 4;
const T = {
  x0: WORLD.minX - MARGIN,
  z0: WORLD.minZ - MARGIN,
  step: STEP,
  nx: Math.round((WORLD.maxX - WORLD.minX + MARGIN * 2) / STEP) + 1,
  nz: Math.round((WORLD.maxZ - WORLD.minZ + MARGIN * 2) / STEP) + 1,
};
const heights = new Float32Array(T.nx * T.nz);
let hMin = Infinity;
let hMax = -Infinity;
let missing = 0;
for (let j = 0; j < T.nz; j++) {
  for (let i = 0; i < T.nx; i++) {
    let h = elevationAt(T.x0 + i * STEP, T.z0 + j * STEP);
    if (Number.isNaN(h)) {
      missing++;
      h = NaN;
    }
    heights[j * T.nx + i] = h;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
}
// 欠損は近傍から埋める
for (let pass = 0; pass < 50 && missing > 0; pass++) {
  missing = 0;
  for (let j = 0; j < T.nz; j++) {
    for (let i = 0; i < T.nx; i++) {
      if (!Number.isNaN(heights[j * T.nx + i])) continue;
      let s = 0;
      let n = 0;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const v = heights[(j + dj) * T.nx + i + di];
        if (i + di >= 0 && i + di < T.nx && j + dj >= 0 && j + dj < T.nz && !Number.isNaN(v)) {
          s += v;
          n++;
        }
      }
      if (n) heights[j * T.nx + i] = s / n;
      else missing++;
    }
  }
}
console.log(`  ${T.nx}×${T.nz} 点, 標高 ${hMin.toFixed(1)}–${hMax.toFixed(1)} m`);

/** 標高グリッドのバイリニア補間 (標高 m) */
const groundAt = (x, z) => {
  const fx = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / STEP));
  const fz = Math.max(0, Math.min(T.nz - 1.001, (z - T.z0) / STEP));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const a = heights[j * T.nx + i];
  const b = heights[j * T.nx + i + 1];
  const c = heights[(j + 1) * T.nx + i];
  const d = heights[(j + 1) * T.nx + i + 1];
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
};

const terrainBin = new Uint16Array(T.nx * T.nz);
for (let i = 0; i < heights.length; i++) terrainBin[i] = Math.round((heights[i] - hMin) * 100);
fs.writeFileSync(path.join(OUT, 'terrain.bin'), Buffer.from(terrainBin.buffer));

// 建物の地盤高: PLATEAU の値があればそれを、無ければ DEM の外周最小値を使う
for (const b of buildings) {
  let low = Infinity;
  let high = -Infinity;
  for (const p of [b.c, ...b.ring]) {
    const g = groundAt(p[0], p[1]);
    low = Math.min(low, g);
    high = Math.max(high, g);
  }
  b.groundLow = low;
  b.groundHigh = high;
  if (b.base === null) b.base = low;
  b.top = b.base + b.height;
}

// ------------------------------------------------------------------ 道路・線路
console.log('道路・土地利用 …');
const ROAD_WIDTH = {
  motorway: 11,
  motorway_link: 6,
  trunk: 8.5,
  trunk_link: 5.5,
  primary: 8,
  secondary: 7.5,
  tertiary: 6.5,
  tertiary_link: 4.5,
  unclassified: 5,
  residential: 4.6,
  living_street: 4,
  service: 4.2,
  track: 2.8,
  pedestrian: 4.5,
  footway: 2.2,
  path: 1.4,
  steps: 2.4,
  cycleway: 2.2,
  rail: 3.2,
};
const roads = [];
for (const way of osm.ways.values()) {
  const t = way.tags;
  let kind = t.highway;
  if (t.railway === 'rail') kind = 'rail';
  if (!kind || !(kind in ROAD_WIDTH)) continue;
  if (isClosed(way) && (t.area === 'yes' || kind === 'pedestrian')) continue; // 面として扱う (下で処理)
  const pts = wayPts(way);
  if (pts.length < 2 || !pts.some((p) => inBounds(p))) continue;
  let width = ROAD_WIDTH[kind];
  if (t.width && Number(t.width) > 0) width = Number(t.width);
  else if (t.lanes && Number(t.lanes) > 0 && kind !== 'rail') width = Math.max(width, Number(t.lanes) * 3.25 + 0.8);
  if (t.service === 'parking_aisle') width = 5;
  if (t.footway === 'sidewalk') width = 1.8;
  const c = pts[Math.floor(pts.length / 2)];
  roads.push({
    k: kind,
    w: round(width, 1),
    p: flat(pts),
    ...(t.bridge && t.bridge !== 'no' ? { br: 1 } : {}),
    ...(t.tunnel && t.tunnel !== 'no' ? { tn: 1 } : {}),
    ...(t.layer ? { ly: Number(t.layer) } : {}),
    ...(t.name ? { n: t.name } : {}),
    ...(t.surface ? { sf: t.surface } : {}),
    ...(t.service ? { sv: t.service } : {}),
    ...(t.access === 'private' || t.access === 'no' ? { pv: 1 } : {}),
    ...(inCampus(c) ? { c: 1 } : {}),
  });
}

// ------------------------------------------------------------------ 面 (土地利用など)
const areaKind = (t) => {
  if (t.natural === 'water' || t.leisure === 'swimming_pool') return t.covered === 'yes' ? 'covered_water' : 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.natural === 'scrub') return 'scrub';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.leisure === 'park' || t.landuse === 'recreation_ground')
    return t.leisure === 'park' ? 'park' : 'grass';
  if (t.landuse === 'farmland' || t.landuse === 'orchard') return 'farmland';
  if (t.amenity === 'parking') return 'parking';
  if (t.amenity === 'parking_space') return 'parking_space';
  if (t.amenity === 'bicycle_parking') return 'bicycle_parking';
  if (t.leisure === 'pitch') return t.sport === 'tennis' ? 'tennis' : 'pitch';
  if (t.highway === 'pedestrian' || (t.highway === 'footway' && t.area === 'yes')) return 'plaza';
  if (t.landuse === 'residential') return 'residential';
  if (t.landuse === 'industrial' || t.landuse === 'retail' || t.landuse === 'commercial' || t.landuse === 'garages') return 'commercial';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (t.landuse === 'construction') return 'construction';
  if (t.railway === 'platform') return 'platform';
  if (t.amenity === 'school' || t.amenity === 'kindergarten') return 'school';
  if (t.man_made === 'bridge') return 'bridge';
  return null;
};
const areas = [];
const pushArea = (kind, ring, holes, tags) => {
  ring = cleanRing(ring);
  if (ring.length < 3) return;
  if (![ring[0], centroid(ring), ...ring].some((p) => inBounds(p, MARGIN + 60))) return;
  areas.push({
    k: kind,
    r: flat(ring),
    ...(holes.length ? { h: holes.map((h) => flat(cleanRing(h))) } : {}),
    ...(tags.name ? { n: tags.name } : {}),
    ...(tags.capacity ? { cap: Number(tags.capacity) } : {}),
    ...(tags.intermittent === 'yes' ? { dry: 1 } : {}),
  });
};
for (const way of osm.ways.values()) {
  if (!isClosed(way) || way.tags.building) continue;
  const kind = areaKind(way.tags);
  if (!kind) continue;
  if (way.tags.highway && kind === 'plaza' && way.tags.highway === 'footway' && way.tags.area !== 'yes') continue;
  pushArea(kind, wayPts(way), [], way.tags);
}
for (const rel of osm.relations.values()) {
  if (rel.tags.type !== 'multipolygon') continue;
  const kind = areaKind(rel.tags);
  if (!kind) continue;
  const outer = assembleRings(rel.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => osm.ways.get(m.ref)?.nd ?? []));
  const inner = assembleRings(rel.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => osm.ways.get(m.ref)?.nd ?? []));
  const innerRings = inner.map((ids) => ids.map(nodeXZ).filter(Boolean));
  for (const ids of outer) {
    const ring = ids.map(nodeXZ).filter(Boolean);
    pushArea(
      kind,
      ring,
      innerRings.filter((h) => h.length >= 3 && pointInRing(h[0], ring)),
      rel.tags,
    );
  }
}

// 柵・ガードレールなどの線状の障害物
const barriers = [];
for (const way of osm.ways.values()) {
  const b = way.tags.barrier;
  if (!b || way.tags.building) continue;
  const pts = wayPts(way);
  if (pts.length < 2 || !pts.some((p) => inBounds(p))) continue;
  barriers.push({ k: b, p: flat(pts) });
}

// ------------------------------------------------------------------ 目印 (点)
const pois = [];
for (const n of osm.nodes.values()) {
  const t = n.tags;
  let kind = null;
  if (t.barrier === 'gate') kind = 'gate';
  else if (t.barrier === 'bollard') kind = 'bollard';
  else if (t.highway === 'bus_stop') kind = 'bus_stop';
  else if (t.highway === 'traffic_signals') kind = 'signal';
  else if (t.highway === 'crossing') kind = 'crossing';
  else if (t.amenity === 'vending_machine') kind = 'vending';
  else if (t.amenity === 'post_box') kind = 'post_box';
  else if (t.amenity === 'atm') kind = 'atm';
  else if (t.amenity === 'telephone') kind = 'phone';
  else if (t.power === 'tower') kind = 'pylon';
  else if (t.tourism === 'artwork') kind = 'artwork';
  else if (t.natural === 'peak') kind = 'peak';
  else if (t.natural === 'tree') kind = 'tree';
  else if (t.railway === 'station' || t.public_transport === 'station') kind = 'station';
  else if (t.office || t.shop || (t.amenity && t.name)) kind = 'place';
  if (!kind) continue;
  const p = toWorld(n.lat, n.lon);
  if (!inBounds(p)) continue;
  pois.push({
    k: kind,
    x: round(p[0], 1),
    z: round(p[1], 1),
    ...(t.name ? { n: t.name } : {}),
    ...(t['name:en'] ? { en: t['name:en'] } : {}),
  });
}

// ------------------------------------------------------------------ 植生 (空中写真から樹冠を推定)
console.log('植生 (地理院 空中写真から樹冠を推定) …');
const photo = loadPhoto(path.join(RAW, 'gsi', 'seamlessphoto'), 17);
const VEG_STEP = 1; // m
const vw = Math.round((WORLD.maxX - WORLD.minX + MARGIN * 2) / VEG_STEP);
const vh = Math.round((WORLD.maxZ - WORLD.minZ + MARGIN * 2) / VEG_STEP);
const veg = new Uint8Array(vw * vh); // 0 = 樹木なし, 1 = 樹冠
const luma = new Float32Array(vw * vh);
if (photo) {
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const x = WORLD.minX - MARGIN + (i + 0.5) * VEG_STEP;
      const z = WORLD.minZ - MARGIN + (j + 0.5) * VEG_STEP;
      const { lat, lon } = toLatLon(x, z);
      const r = photo.sample(lat, lon, 0);
      const g = photo.sample(lat, lon, 1);
      const b = photo.sample(lat, lon, 2);
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[j * vw + i] = l;
      // 緑が優勢で、芝や畑より暗い → 樹冠とみなす
      const green = g - Math.max(r, b);
      veg[j * vw + i] = green > 4 && g > r * 1.06 && l < 118 && l > 22 ? 1 : 0;
    }
  }
}
// 樹冠らしさ = 半径 3 m の被覆率
const integral = new Float64Array((vw + 1) * (vh + 1));
for (let j = 0; j < vh; j++) {
  let row = 0;
  for (let i = 0; i < vw; i++) {
    row += veg[j * vw + i];
    integral[(j + 1) * (vw + 1) + i + 1] = integral[j * (vw + 1) + i + 1] + row;
  }
}
const coverage = (x, z, radius) => {
  const ci = (x - (WORLD.minX - MARGIN)) / VEG_STEP;
  const cj = (z - (WORLD.minZ - MARGIN)) / VEG_STEP;
  const i0 = Math.max(0, Math.floor(ci - radius));
  const i1 = Math.min(vw, Math.ceil(ci + radius));
  const j0 = Math.max(0, Math.floor(cj - radius));
  const j1 = Math.min(vh, Math.ceil(cj + radius));
  if (i1 <= i0 || j1 <= j0) return 0;
  const s = integral[j1 * (vw + 1) + i1] - integral[j0 * (vw + 1) + i1] - integral[j1 * (vw + 1) + i0] + integral[j0 * (vw + 1) + i0];
  return s / ((i1 - i0) * (j1 - j0));
};

// 木を置けない場所を 1 m グリッドに焼き込む
const blocked = new Uint8Array(vw * vh);
const cellOf = (x, z) => [Math.floor((x - (WORLD.minX - MARGIN)) / VEG_STEP), Math.floor((z - (WORLD.minZ - MARGIN)) / VEG_STEP)];
const stampRing = (ring, grow, value = 1) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const [i0, j0] = cellOf(minX - grow, minZ - grow);
  const [i1, j1] = cellOf(maxX + grow, maxZ + grow);
  for (let j = Math.max(0, j0); j <= Math.min(vh - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(vw - 1, i1); i++) {
      const p = [WORLD.minX - MARGIN + (i + 0.5) * VEG_STEP, WORLD.minZ - MARGIN + (j + 0.5) * VEG_STEP];
      if (pointInRing(p, ring) || (grow > 0 && distToRing(p, ring) < grow)) blocked[j * vw + i] = value;
    }
  }
};
const stampLine = (pts, halfWidth) => {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    const r = Math.ceil(halfWidth);
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps;
      const z = a[1] + ((b[1] - a[1]) * s) / steps;
      const [ci, cj] = cellOf(x, z);
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= vw || j >= vh) continue;
          if (Math.hypot(di, dj) <= halfWidth + 0.3) blocked[j * vw + i] = 1;
        }
      }
    }
  }
};
const unflat = (a) => {
  const r = [];
  for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]);
  return r;
};
for (const b of buildings) stampRing(b.ring, 1.6);
for (const r of roads) stampLine(unflat(r.p), r.w / 2 + (r.k === 'footway' || r.k === 'path' || r.k === 'steps' ? 0.3 : 0.9));
for (const a of areas) {
  if (
    [
      'water',
      'covered_water',
      'parking',
      'parking_space',
      'tennis',
      'pitch',
      'plaza',
      'platform',
      'farmland',
      'bridge',
      'bicycle_parking',
    ].includes(a.k)
  )
    stampRing(unflat(a.r), 0.5);
}

// ジッタ付き格子で候補を作り、樹冠の上にあるものだけ残す
const rand = mulberry32(20260401);
const trees = [];
const SPACING = 5.2;
for (let z = WORLD.minZ - MARGIN + 2; z < WORLD.maxZ + MARGIN - 2; z += SPACING) {
  for (let x = WORLD.minX - MARGIN + 2; x < WORLD.maxX + MARGIN - 2; x += SPACING) {
    const px = x + (rand() - 0.5) * SPACING * 0.9;
    const pz = z + (rand() - 0.5) * SPACING * 0.9;
    const r1 = rand();
    const r2 = rand();
    const r3 = rand();
    const [ci, cj] = cellOf(px, pz);
    if (ci < 0 || cj < 0 || ci >= vw || cj >= vh || blocked[cj * vw + ci]) continue;
    const near = coverage(px, pz, 2.5);
    if (near < 0.62) continue;
    const wide = coverage(px, pz, 9); // 森の奥ほど大きい木
    const dCampus = campusDist([px, pz]);
    const inside = inCampus([px, pz]);
    // 0 = 落葉広葉樹 (雑木林), 1 = 常緑針葉樹 (スギ・ヒノキ), 2 = 植栽の中木
    let type = 0;
    let height;
    if (wide > 0.8) {
      type = r1 < 0.16 ? 1 : 0;
      height = 11 + r2 * 7;
    } else if (wide > 0.5) {
      type = r1 < 0.08 ? 1 : 0;
      height = 8 + r2 * 6;
    } else {
      type = 2;
      height = 4.5 + r2 * 4;
    }
    // キャンパスから遠い森は間引く (遠景は簡易モデルで描く)
    const farFromCampus = !inside && dCampus > 110;
    if (farFromCampus && r3 < 0.35) continue;
    trees.push([round(px, 1), round(pz, 1), round(height, 1), type]);
  }
}
// OSM に個別に登録された木
for (const p of pois.filter((q) => q.k === 'tree')) {
  if (trees.some((t) => Math.hypot(t[0] - p.x, t[1] - p.z) < 3)) continue;
  trees.push([p.x, p.z, round(6 + rand() * 4, 1), 2]);
}
console.log(`  樹木 ${trees.length} 本`);

// ------------------------------------------------------------------ 遠景
console.log('遠景 …');
const FAR_STEP = 40;
const fn = Math.round((FAR_RADIUS * 2) / FAR_STEP) + 1;
const farPhoto = loadPhoto(path.join(RAW, 'gsi', 'seamlessphoto'), 14);
const farH = new Uint16Array(fn * fn);
const farC = new Uint8Array(fn * fn * 3);
let farMin = Infinity;
const farRaw = new Float32Array(fn * fn);
for (let j = 0; j < fn; j++) {
  for (let i = 0; i < fn; i++) {
    const x = -FAR_RADIUS + i * FAR_STEP;
    const z = -FAR_RADIUS + j * FAR_STEP;
    const { lat, lon } = toLatLon(x, z);
    let h = demFar ? demFar.sample(lat, lon) : NaN;
    if (Number.isNaN(h)) h = elevationAt(x, z);
    if (Number.isNaN(h)) h = 40;
    farRaw[j * fn + i] = h;
    farMin = Math.min(farMin, h);
    // 写真は周囲 3×3 点の平均で、屋根や影のノイズをならす
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    if (farPhoto) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const q = toLatLon(x + di * 12, z + dj * 12);
          const rr = farPhoto.sample(q.lat, q.lon, 0);
          if (Number.isNaN(rr)) continue;
          r += rr;
          g += farPhoto.sample(q.lat, q.lon, 1);
          b += farPhoto.sample(q.lat, q.lon, 2);
          n++;
        }
      }
    }
    const o = (j * fn + i) * 3;
    farC[o] = n ? Math.round(r / n) : 70;
    farC[o + 1] = n ? Math.round(g / n) : 90;
    farC[o + 2] = n ? Math.round(b / n) : 60;
  }
}
for (let i = 0; i < farRaw.length; i++) farH[i] = Math.round((farRaw[i] - farMin) * 100);
fs.writeFileSync(path.join(OUT, 'far.bin'), Buffer.concat([Buffer.from(farH.buffer), Buffer.from(farC.buffer)]));

// ------------------------------------------------------------------ 出力
const y = (elev) => round(elev - BASE_ELEVATION, 2);
const outBuildings = buildings
  .sort((a, b) => b.area - a.area)
  .map((b) => {
    const name = [...b.names.entries()].filter(([k]) => k).sort((p, q) => q[1] - p[1])[0]?.[0];
    const campus = inCampus(b.c) || campusDist(b.c) < 4;
    return {
      r: flat(b.ring),
      ...(b.holes.length ? { h: b.holes.map((h) => flat(h)) } : {}),
      b: y(b.base),
      t: y(b.top),
      g: [y(b.groundLow), y(b.groundHigh)],
      ...(name ? { n: name } : {}),
      ...(campus ? { c: 1 } : {}),
      ...(b.storeys ? { lv: b.storeys } : {}),
      ...(b.osmTags?.building && b.osmTags.building !== 'yes' ? { u: b.osmTags.building } : {}),
      ...(b.src === 'osm' ? { est: 1 } : {}),
    };
  });

const campus = {
  meta: {
    name: '東京科学大学 横浜キャンパス',
    nameEn: 'Institute of Science Tokyo – Yokohama Campus',
    origin: ORIGIN,
    baseElevation: BASE_ELEVATION,
    bounds: WORLD,
    sources: [
      {
        name: 'OpenStreetMap',
        license: 'ODbL 1.0',
        credit: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright',
      },
      {
        name: '3D都市モデル Project PLATEAU (横浜市 2024年度, 町田市 2025年度)',
        license: 'CC BY 4.0',
        credit: '国土交通省',
        url: 'https://www.mlit.go.jp/plateau/',
      },
      {
        name: '地理院タイル (標高タイル DEM5A/DEM10B, 全国最新写真シームレス)',
        license: '国土地理院コンテンツ利用規約',
        credit: '国土地理院',
        url: 'https://maps.gsi.go.jp/development/ichiran.html',
      },
    ],
  },
  terrain: { file: 'terrain.bin', x0: T.x0, z0: T.z0, step: STEP, nx: T.nx, nz: T.nz, hMin: y(hMin), unit: 0.01 },
  far: { file: 'far.bin', radius: FAR_RADIUS, step: FAR_STEP, n: fn, hMin: y(farMin), unit: 0.01 },
  campusBoundary: campusRings.map((r) => flat(r)),
  buildings: outBuildings,
  roads,
  areas,
  barriers,
  pois: pois.filter((p) => p.k !== 'tree'),
  trees: trees.flat(),
};
fs.writeFileSync(path.join(OUT, 'campus.json'), JSON.stringify(campus));
const size = (f) => `${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`;
console.log(`出力: campus.json ${size('campus.json')}, terrain.bin ${size('terrain.bin')}, far.bin ${size('far.bin')}`);
console.log(
  `  建物 ${outBuildings.length} (キャンパス内 ${outBuildings.filter((b) => b.c).length}), 道路 ${roads.length}, 面 ${areas.length}, 目印 ${campus.pois.length}`,
);

// ------------------------------------------------------------------ 確認用の出力
if (DEBUG_DIR) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const S = 2; // px / m
  const W = (WORLD.maxX - WORLD.minX + MARGIN * 2) * S;
  const H = (WORLD.maxZ - WORLD.minZ + MARGIN * 2) * S;
  const px = (x) => ((x - (WORLD.minX - MARGIN)) * S).toFixed(1);
  const pz = (z) => ((z - (WORLD.minZ - MARGIN)) * S).toFixed(1);
  const poly = (a) => {
    let s = '';
    for (let i = 0; i < a.length; i += 2) s += `${px(a[i])},${pz(a[i + 1])} `;
    return s;
  };
  const fill = {
    forest: '#2f5d34',
    scrub: '#55783f',
    grass: '#8fbf6a',
    park: '#8fbf6a',
    farmland: '#b9a56b',
    parking: '#777',
    parking_space: '#999',
    water: '#4a86c5',
    covered_water: '#6b8399',
    tennis: '#3b8f6b',
    pitch: '#3b8f6b',
    plaza: '#d8cfc0',
    residential: '#e6e0d6',
    commercial: '#ddd',
    cemetery: '#bbb',
    construction: '#c9b',
    platform: '#aaa',
    school: '#eed',
    bridge: '#999',
    bicycle_parking: '#99a',
  };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#cfd8c0"/>`;
  for (const a of areas) svg += `<polygon points="${poly(a.r)}" fill="${fill[a.k] ?? '#f0f'}" opacity="0.8"/>`;
  for (const r of campusRings)
    svg += `<polygon points="${poly(flat(r))}" fill="none" stroke="#d00" stroke-width="3" stroke-dasharray="10 6"/>`;
  const stroke = { rail: '#333', steps: '#e55', footway: '#fff', path: '#fc9', pedestrian: '#fff', track: '#cb8' };
  for (const r of roads)
    svg += `<polyline points="${poly(r.p)}" fill="none" stroke="${stroke[r.k] ?? '#555'}" stroke-width="${(r.w * S).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${r.tn ? 0.4 : 1}"/>`;
  for (let i = 0; i < campus.trees.length; i += 4)
    svg += `<circle cx="${px(campus.trees[i])}" cy="${pz(campus.trees[i + 1])}" r="${(campus.trees[i + 2] * 0.22 * S).toFixed(1)}" fill="${['#1f7a2e', '#0d4a2a', '#59a84b'][campus.trees[i + 3]]}" opacity="0.75"/>`;
  for (const b of outBuildings) {
    const hgt = b.t - b.b;
    const shade = Math.max(40, 200 - hgt * 2.2);
    svg += `<polygon points="${poly(b.r)}" fill="rgb(${shade},${shade * (b.c ? 0.8 : 1)},${shade * (b.c ? 0.7 : 1)})" stroke="#222" stroke-width="1"/>`;
  }
  for (const b of outBuildings) {
    if (!b.c || !b.n) continue;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < b.r.length; i += 2) {
      cx += b.r[i];
      cz += b.r[i + 1];
    }
    cx /= b.r.length / 2;
    cz /= b.r.length / 2;
    svg += `<text x="${px(cx)}" y="${pz(cz)}" font-size="13" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-family="sans-serif">${b.n} ${(b.t - b.b).toFixed(0)}m</text>`;
  }
  for (const p of campus.pois) {
    if (!['gate', 'bus_stop', 'station', 'peak'].includes(p.k)) continue;
    svg += `<circle cx="${px(p.x)}" cy="${pz(p.z)}" r="6" fill="#f0f"/><text x="${px(p.x)}" y="${pz(p.z) - 8}" font-size="13" text-anchor="middle" fill="#a0a" font-family="sans-serif">${p.n ?? p.k}</text>`;
  }
  svg += '</svg>';
  fs.writeFileSync(path.join(DEBUG_DIR, 'map.svg'), svg);

  // 標高の陰影図
  const png = new PNG({ width: T.nx, height: T.nz });
  for (let j = 0; j < T.nz; j++) {
    for (let i = 0; i < T.nx; i++) {
      const h = heights[j * T.nx + i];
      const hx = heights[j * T.nx + Math.min(T.nx - 1, i + 1)] - heights[j * T.nx + Math.max(0, i - 1)];
      const hz = heights[Math.min(T.nz - 1, j + 1) * T.nx + i] - heights[Math.max(0, j - 1) * T.nx + i];
      const shade = Math.max(0, Math.min(1, 0.6 + (hx - hz) * 0.12));
      const t = (h - hMin) / (hMax - hMin);
      const o = (j * T.nx + i) * 4;
      png.data[o] = 255 * shade * (0.3 + 0.7 * t);
      png.data[o + 1] = 255 * shade * (0.5 + 0.3 * t);
      png.data[o + 2] = 255 * shade * (0.4 - 0.2 * t);
      png.data[o + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(DEBUG_DIR, 'terrain.png'), PNG.sync.write(png));

  // 樹冠マスク
  const vp = new PNG({ width: vw, height: vh });
  for (let i = 0; i < vw * vh; i++) {
    const v = veg[i] ? 255 : 0;
    vp.data[i * 4] = blocked[i] ? 120 : 0;
    vp.data[i * 4 + 1] = v;
    vp.data[i * 4 + 2] = luma[i];
    vp.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(DEBUG_DIR, 'veg.png'), PNG.sync.write(vp));
  console.log('確認用ファイル →', DEBUG_DIR);
}
