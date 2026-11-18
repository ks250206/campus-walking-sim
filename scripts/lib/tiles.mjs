// 地理院タイルを 1 枚のモザイクにまとめて、緯度経度でサンプリングできるようにする。
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { tileXY } from './geo.mjs';

const TILE = 256;

function listTiles(dir, zoom) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => f.match(/^(\d+)_(\d+)_(\d+)\.(png|jpg)$/))
    .filter((m) => m && Number(m[1]) === zoom)
    .map((m) => ({ x: Number(m[2]), y: Number(m[3]), file: path.join(dir, m[0]), ext: m[4] }));
}

function decodeImage(tile) {
  const buf = fs.readFileSync(tile.file);
  if (tile.ext === 'png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: img.width, height: img.height, data: img.data };
}

class Mosaic {
  constructor(zoom, tiles, channels) {
    this.zoom = zoom;
    this.channels = channels;
    this.tx0 = Math.min(...tiles.map((t) => t.x));
    this.ty0 = Math.min(...tiles.map((t) => t.y));
    const tx1 = Math.max(...tiles.map((t) => t.x));
    const ty1 = Math.max(...tiles.map((t) => t.y));
    this.width = (tx1 - this.tx0 + 1) * TILE;
    this.height = (ty1 - this.ty0 + 1) * TILE;
    this.data = new Float32Array(this.width * this.height * channels).fill(NaN);
  }

  /** 緯度経度 → モザイク内のピクセル座標 (小数、ピクセル中心が .5) */
  pixel(lat, lon) {
    const [x, y] = tileXY(lat, lon, this.zoom);
    return [(x - this.tx0) * TILE, (y - this.ty0) * TILE];
  }

  at(ix, iy, c = 0) {
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return NaN;
    return this.data[(iy * this.width + ix) * this.channels + c];
  }

  /** バイリニア補間。欠損 (NaN) は周囲の有効値だけで補間する */
  sample(lat, lon, c = 0) {
    const [px, py] = this.pixel(lat, lon);
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let sum = 0;
    let wsum = 0;
    for (const [dx, dy, w] of [
      [0, 0, (1 - tx) * (1 - ty)],
      [1, 0, tx * (1 - ty)],
      [0, 1, (1 - tx) * ty],
      [1, 1, tx * ty],
    ]) {
      const v = this.at(x0 + dx, y0 + dy, c);
      if (Number.isNaN(v)) continue;
      sum += v * w;
      wsum += w;
    }
    return wsum > 1e-6 ? sum / wsum : NaN;
  }
}

/** 標高タイル (PNG) → 標高 (m) のモザイク */
export function loadElevation(dir, zoom) {
  const tiles = listTiles(dir, zoom);
  if (!tiles.length) return null;
  const mosaic = new Mosaic(zoom, tiles, 1);
  for (const t of tiles) {
    const img = decodeImage(t);
    const ox = (t.x - mosaic.tx0) * TILE;
    const oy = (t.y - mosaic.ty0) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * img.width + x) * 4;
        const v = img.data[i] * 65536 + img.data[i + 1] * 256 + img.data[i + 2];
        if (v === 8388608) continue; // 無効値
        mosaic.data[(oy + y) * mosaic.width + ox + x] = v < 8388608 ? v * 0.01 : (v - 16777216) * 0.01;
      }
    }
  }
  return mosaic;
}

/** 写真タイル (JPEG) → RGB のモザイク */
export function loadPhoto(dir, zoom) {
  const tiles = listTiles(dir, zoom);
  if (!tiles.length) return null;
  const mosaic = new Mosaic(zoom, tiles, 3);
  for (const t of tiles) {
    const img = decodeImage(t);
    const ox = (t.x - mosaic.tx0) * TILE;
    const oy = (t.y - mosaic.ty0) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * img.width + x) * 4;
        const o = ((oy + y) * mosaic.width + ox + x) * 3;
        mosaic.data[o] = img.data[i];
        mosaic.data[o + 1] = img.data[i + 1];
        mosaic.data[o + 2] = img.data[i + 2];
      }
    }
  }
  return mosaic;
}
