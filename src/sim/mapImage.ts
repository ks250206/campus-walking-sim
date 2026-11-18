import type { CampusJson } from './types';

export interface MapImage {
  canvas: HTMLCanvasElement;
  /** 1 m あたりのピクセル数 */
  scale: number;
  x0: number;
  z0: number;
}

const ROAD_COLOR: Record<string, string> = {
  footway: '#e9e2d2',
  pedestrian: '#e9e2d2',
  steps: '#d9b9a0',
  path: '#c9b58f',
  track: '#c9b58f',
  rail: '#55504a',
};

const AREA_COLOR: Record<string, string> = {
  forest: '#5d8a55',
  scrub: '#7a9a62',
  grass: '#a8c98a',
  park: '#a8c98a',
  farmland: '#cdbf95',
  parking: '#9a9da0',
  parking_space: '#a6a9ac',
  water: '#6ea3cf',
  covered_water: '#b3bcc2',
  tennis: '#5fa587',
  pitch: '#5fa587',
  plaza: '#e3dccb',
  residential: '#d9d5cb',
  commercial: '#d2d2ce',
  school: '#ddd3bb',
  cemetery: '#c9c9c3',
  platform: '#bdbdb8',
};

/** ミニマップ・全体図の下地になる地図画像を描く (北が上) */
export function renderMapImage(json: CampusJson, scale = 2): MapImage {
  const b = json.meta.bounds;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((b.maxX - b.minX) * scale);
  canvas.height = Math.round((b.maxZ - b.minZ) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas が使えません');
  ctx.fillStyle = '#c3d3ae';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -b.minX * scale, -b.minZ * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const ring = (r: number[]): void => {
    ctx.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
    ctx.closePath();
  };

  for (const a of json.areas) {
    const color = AREA_COLOR[a.k];
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.beginPath();
    ring(a.r);
    for (const h of a.h ?? []) ring(h);
    ctx.fill('evenodd');
  }
  // 樹木
  ctx.fillStyle = 'rgba(64, 120, 62, 0.55)';
  for (let i = 0; i < json.trees.length; i += 4) {
    ctx.beginPath();
    ctx.arc(json.trees[i], json.trees[i + 1], json.trees[i + 2] * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
  // 道路 (縁取り → 中身 の順)
  for (const pass of [0, 1]) {
    for (const r of json.roads) {
      if (r.tn) continue;
      const walk = r.k in ROAD_COLOR;
      ctx.strokeStyle = pass === 0 ? (walk ? '#b7ae9c' : '#8d9093') : (ROAD_COLOR[r.k] ?? '#fdfdfb');
      ctx.lineWidth = Math.max(1.2, r.w) + (pass === 0 ? 1.2 : 0);
      ctx.beginPath();
      ctx.moveTo(r.p[0], r.p[1]);
      for (let i = 2; i < r.p.length; i += 2) ctx.lineTo(r.p[i], r.p[i + 1]);
      ctx.stroke();
    }
  }
  // 建物
  for (const bd of json.buildings) {
    ctx.fillStyle = bd.c ? '#b98d79' : '#b9b5ad';
    ctx.strokeStyle = bd.c ? '#7d5544' : '#8f8b84';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ring(bd.r);
    for (const h of bd.h ?? []) ring(h);
    ctx.fill('evenodd');
    ctx.stroke();
  }
  // キャンパスの敷地境界
  ctx.strokeStyle = 'rgba(200, 40, 60, 0.75)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  for (const r of json.campusBoundary) {
    ctx.beginPath();
    ring(r);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  return { canvas, scale, x0: b.minX, z0: b.minZ };
}
