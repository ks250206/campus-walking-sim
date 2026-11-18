// 座標系まわりの共通処理。
// ワールド座標: 原点 = キャンパス中心付近、X = 東、Y = 上、Z = 南 (北が -Z)、単位はメートル。

export const ORIGIN = { lat: 35.5145, lon: 139.4835 };

/** 標高からワールド Y への変換で引く基準標高 (m) */
export const BASE_ELEVATION = 50;

/** 歩行できる詳細エリア (m) */
export const WORLD = { minX: -470, maxX: 450, minZ: -500, maxZ: 480 };

/** 遠景の地形リングの半径 (m) */
export const FAR_RADIUS = 2600;

// GRS80 楕円体での、原点緯度における 1 度あたりのメートル数
const A = 6378137;
const E2 = 0.0066943800229;
const phi = (ORIGIN.lat * Math.PI) / 180;
const W = Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
const M_PER_DEG_LAT = ((A * (1 - E2)) / W ** 3) * (Math.PI / 180);
const M_PER_DEG_LON = (A / W) * Math.cos(phi) * (Math.PI / 180);

/** 緯度経度 → ワールド [x, z] */
export function toWorld(lat, lon) {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
}

/** ワールド [x, z] → 緯度経度 */
export function toLatLon(x, z) {
  return { lat: ORIGIN.lat - z / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}

/** 緯度経度 → Web メルカトルのタイル座標 (小数) */
export function tileXY(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return [x, y];
}

/** ワールド矩形を覆うタイル範囲 */
export function tileRange(bounds, zoom) {
  const nw = toLatLon(bounds.minX, bounds.minZ);
  const se = toLatLon(bounds.maxX, bounds.maxZ);
  const [x0, y0] = tileXY(nw.lat, nw.lon, zoom);
  const [x1, y1] = tileXY(se.lat, se.lon, zoom);
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.floor(x1), y1: Math.floor(y1) };
}

/** ワールド矩形を緯度経度の bbox に (margin はメートル) */
export function latLonBox(bounds, margin = 0) {
  const nw = toLatLon(bounds.minX - margin, bounds.minZ - margin);
  const se = toLatLon(bounds.maxX + margin, bounds.maxZ + margin);
  return { minLat: se.lat, maxLat: nw.lat, minLon: nw.lon, maxLon: se.lon };
}

/** 標準地域メッシュ (3 次メッシュ) コード */
export function meshCode3(lat, lon) {
  const p = Math.floor(lat * 1.5);
  const u = Math.floor(lon - 100);
  const latRem = lat * 1.5 - p;
  const lonRem = lon - 100 - u;
  const q = Math.floor(latRem * 8);
  const v = Math.floor(lonRem * 8);
  const r = Math.floor((latRem * 8 - q) * 10);
  const w = Math.floor((lonRem * 8 - v) * 10);
  return `${p}${u}${q}${v}${r}${w}`;
}

/** bbox と交差する 3 次メッシュコードの一覧 */
export function meshCodesFor(box) {
  const codes = new Set();
  const dLat = 1 / 120;
  const dLon = 1 / 80;
  for (let lat = box.minLat; lat <= box.maxLat + dLat; lat += dLat / 2) {
    for (let lon = box.minLon; lon <= box.maxLon + dLon; lon += dLon / 2) {
      codes.add(meshCode3(Math.min(lat, box.maxLat), Math.min(lon, box.maxLon)));
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b));
}

// ---- 2D ポリゴン関連 ----

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(ring) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToRing(p, ring, closed = true) {
  let d = Infinity;
  const n = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < n; i++) d = Math.min(d, distToSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

/** 始点と終点が同じなら終点を落とし、重複点を除く */
export function cleanRing(ring, eps = 0.02) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop();
  }
  return out;
}

/** ほぼ一直線上の頂点を取り除く */
export function simplifyRing(ring, tol = 0.05) {
  let pts = ring;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (distToSegment(b, a, c) < tol && pts.length - (out.length < i ? i - out.length : 0) > 3) {
        changed = true;
        continue;
      }
      out.push(b);
    }
    if (out.length < 3) break;
    pts = out;
  }
  return pts;
}

export const round = (v, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const flat = (ring, digits = 2) => ring.flatMap(([x, y]) => [round(x, digits), round(y, digits)]);
