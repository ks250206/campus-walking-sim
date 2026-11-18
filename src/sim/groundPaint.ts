import type { AreaData, CampusJson, RoadData } from './types';

export interface PaintRect {
  x0: number;
  z0: number;
  size: number;
}

export interface GroundPaint {
  /** 土地利用ごとの地面の色 (sRGB) */
  macro: HTMLCanvasElement;
  /** R = アスファルト, G = 歩道の舗装, B = 白線, A = 草地らしさ */
  mask: Uint8Array;
  maskSize: number;
}

const VEHICLE = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'secondary',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
]);
const PAVED_WALK = new Set(['footway', 'pedestrian', 'steps', 'cycleway']);
const DIRT = new Set(['track', 'path']);
/** 車道の両側に歩道がある道 */
const WITH_SIDEWALK: Record<string, number> = { trunk: 3.2, primary: 3, secondary: 2.6, tertiary: 2.2 };
/** センターラインを引く道 */
const CENTER_LINE = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified']);

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas が使えません');
  return [canvas, ctx];
}

function tracePolyline(ctx: CanvasRenderingContext2D, p: number[]): void {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
}

function traceArea(ctx: CanvasRenderingContext2D, a: AreaData): void {
  ctx.beginPath();
  for (const ring of [a.r, ...(a.h ?? [])]) {
    ctx.moveTo(ring[0], ring[1]);
    for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
    ctx.closePath();
  }
}

const onGround = (r: RoadData): boolean => !r.br && !r.tn && (r.ly ?? 0) >= 0;

/** 地面に描くもの (道路・土地利用・木陰) をテクスチャ用に塗る */
export function paintGround(json: CampusJson, rect: PaintRect, maskSize: number): GroundPaint {
  const roads = json.roads.filter(onGround);

  // ---- マスク (チャンネルごとにグレースケールで描く)
  const channel = (draw: (ctx: CanvasRenderingContext2D) => void, background = '#000'): Uint8ClampedArray => {
    const [, ctx] = makeCanvas(maskSize);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, maskSize, maskSize);
    const s = maskSize / rect.size;
    ctx.setTransform(s, 0, 0, s, -rect.x0 * s, -rect.z0 * s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    draw(ctx);
    return ctx.getImageData(0, 0, maskSize, maskSize).data;
  };

  const asphalt = channel((ctx) => {
    for (const a of json.areas) {
      if (a.k !== 'parking' && a.k !== 'parking_space') continue;
      traceArea(ctx, a);
      ctx.fill('evenodd');
    }
    for (const r of roads) {
      if (!VEHICLE.has(r.k)) continue;
      ctx.lineWidth = r.w;
      tracePolyline(ctx, r.p);
      ctx.stroke();
    }
  });

  const paved = channel((ctx) => {
    for (const a of json.areas) {
      if (a.k !== 'plaza' && a.k !== 'platform' && a.k !== 'bicycle_parking') continue;
      traceArea(ctx, a);
      ctx.fill('evenodd');
    }
    for (const r of roads) {
      const side = WITH_SIDEWALK[r.k];
      if (side) {
        ctx.lineWidth = r.w + side * 2;
        tracePolyline(ctx, r.p);
        ctx.stroke();
      }
      if (!PAVED_WALK.has(r.k)) continue;
      ctx.lineWidth = r.w;
      tracePolyline(ctx, r.p);
      ctx.stroke();
    }
  });

  const markings = channel((ctx) => {
    ctx.lineCap = 'butt';
    for (const r of roads) {
      if (!CENTER_LINE.has(r.k)) continue;
      // 外側線
      if (r.k !== 'unclassified') {
        ctx.setLineDash([]);
        ctx.lineWidth = 0.28;
        for (const side of [-1, 1]) {
          tracePolyline(ctx, offsetPolyline(r.p, side * (r.w / 2 - 0.45)));
          ctx.stroke();
        }
      }
      // センターライン (破線)
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 0.3;
      tracePolyline(ctx, r.p);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // 横断歩道 (最寄りの車道に直交する縞)
    for (const poi of json.pois) {
      if (poi.k !== 'crossing') continue;
      const hit = nearestRoad(roads, poi.x, poi.z);
      if (!hit || hit.dist > 4) continue;
      const { dirX, dirZ, road } = hit;
      const nx = -dirZ;
      const nz = dirX;
      const stripes = Math.max(3, Math.floor((road.w - 0.6) / 1.1));
      for (let i = 0; i < stripes; i++) {
        const off = (i - (stripes - 1) / 2) * 1.1;
        const cx = poi.x + nx * off;
        const cz = poi.z + nz * off;
        ctx.beginPath();
        ctx.moveTo(cx - dirX * 1.6, cz - dirZ * 1.6);
        ctx.lineTo(cx + dirX * 1.6, cz + dirZ * 1.6);
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
    }
  });

  const grassy = channel((ctx) => {
    ctx.fillStyle = '#404040';
    ctx.strokeStyle = '#404040';
    for (const a of json.areas) {
      if (!['residential', 'commercial', 'farmland', 'school', 'construction', 'cemetery', 'covered_water'].includes(a.k)) continue;
      traceArea(ctx, a);
      ctx.fill('evenodd');
    }
    for (const r of roads) {
      if (!DIRT.has(r.k) && r.k !== 'rail') continue;
      ctx.lineWidth = r.k === 'rail' ? 5 : r.w;
      tracePolyline(ctx, r.p);
      ctx.stroke();
    }
  }, '#fff');

  const mask = new Uint8Array(maskSize * maskSize * 4);
  for (let i = 0; i < maskSize * maskSize; i++) {
    mask[i * 4] = asphalt[i * 4];
    mask[i * 4 + 1] = paved[i * 4];
    mask[i * 4 + 2] = markings[i * 4];
    mask[i * 4 + 3] = grassy[i * 4];
  }

  // ---- 地面の色
  const MACRO = 1024;
  const [macro, ctx] = makeCanvas(MACRO);
  const [layer, lctx] = makeCanvas(MACRO);
  const s = MACRO / rect.size;
  const world = (c: CanvasRenderingContext2D): void => c.setTransform(s, 0, 0, s, -rect.x0 * s, -rect.z0 * s);
  ctx.fillStyle = '#6a7d45';
  ctx.fillRect(0, 0, MACRO, MACRO);

  const AREA_COLOR: Record<string, string> = {
    residential: '#8b877c',
    commercial: '#8a8985',
    school: '#a8956f',
    cemetery: '#8d8c85',
    construction: '#978768',
    farmland: '#7f7250',
    grass: '#6f8a48',
    park: '#6c8647',
    scrub: '#5a6c3b',
    forest: '#505434',
    water: '#3d4b3f',
    covered_water: '#8f8f8a',
  };
  lctx.clearRect(0, 0, MACRO, MACRO);
  world(lctx);
  for (const kind of Object.keys(AREA_COLOR)) {
    lctx.fillStyle = AREA_COLOR[kind];
    for (const a of json.areas) {
      if (a.k !== kind) continue;
      traceArea(lctx, a);
      lctx.fill('evenodd');
    }
  }
  // 未舗装の道と線路の砂利
  lctx.lineCap = 'round';
  lctx.lineJoin = 'round';
  for (const r of roads) {
    if (DIRT.has(r.k)) {
      lctx.strokeStyle = r.sf === 'paved' ? '#77736c' : '#8a7958';
      lctx.lineWidth = r.w + 0.6;
    } else if (r.k === 'rail') {
      lctx.strokeStyle = '#6b655c';
      lctx.lineWidth = 5.2;
    } else continue;
    tracePolyline(lctx, r.p);
    lctx.stroke();
  }
  // 木の下は落ち葉と日陰で暗い土の色になる
  for (let i = 0; i < json.trees.length; i += 4) {
    const x = json.trees[i];
    const z = json.trees[i + 1];
    const radius = json.trees[i + 2] * 0.42 + 1.5;
    const grad = lctx.createRadialGradient(x, z, 0, x, z, radius);
    grad.addColorStop(0, 'rgba(72, 70, 46, 0.55)');
    grad.addColorStop(0.6, 'rgba(72, 72, 46, 0.35)');
    grad.addColorStop(1, 'rgba(72, 74, 46, 0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(x, z, radius, 0, Math.PI * 2);
    lctx.fill();
  }
  // 境目をなじませる (filter に対応していないブラウザではそのまま描く)
  ctx.filter = 'blur(1.6px)';
  ctx.drawImage(layer, 0, 0);
  ctx.filter = 'none';

  return { macro, mask, maskSize };
}

/** 中心線を左右にずらした線 */
function offsetPolyline(p: number[], d: number): number[] {
  const out: number[] = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = p[Math.max(0, i - 1) * 2];
    const az = p[Math.max(0, i - 1) * 2 + 1];
    const bx = p[Math.min(n - 1, i + 1) * 2];
    const bz = p[Math.min(n - 1, i + 1) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    out.push(p[i * 2] - ((bz - az) / len) * d, p[i * 2 + 1] + ((bx - ax) / len) * d);
  }
  return out;
}

function nearestRoad(
  roads: RoadData[],
  x: number,
  z: number,
): { road: RoadData; dist: number; dirX: number; dirZ: number } | null {
  let best: { road: RoadData; dist: number; dirX: number; dirZ: number } | null = null;
  for (const road of roads) {
    if (!VEHICLE.has(road.k)) continue;
    const p = road.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i];
      const dz = p[i + 3] - p[i + 1];
      const l2 = dx * dx + dz * dz;
      if (l2 === 0) continue;
      let t = ((x - p[i]) * dx + (z - p[i + 1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(x - (p[i] + dx * t), z - (p[i + 1] + dz * t));
      if (!best || dist < best.dist) {
        const len = Math.sqrt(l2);
        best = { road, dist, dirX: dx / len, dirZ: dz / len };
      }
    }
  }
  return best;
}
