// 公開データを data/raw/ にダウンロードする。
//   - OpenStreetMap (ODbL)            : 建物名・道路・歩道・水域・土地利用・門など
//   - 国土交通省 Project PLATEAU (CC BY 4.0): 建物の外形と実測の高さ (CityGML LOD1)
//   - 国土地理院 地理院タイル          : 標高タイル (DEM5A / DEM10B)、全国最新写真 (シームレス)
//
// 使い方: pnpm data:fetch   (既にあるファイルは再取得しない。--force で取り直す)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAR_RADIUS, WORLD, latLonBox, meshCodesFor, tileRange } from './lib/geo.mjs';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'raw');
const FORCE = process.argv.includes('--force');
const UA = 'Mozilla/5.0 (compatible; map-data-fetch-script)';

async function exists(file) {
  try {
    return (await fs.stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function download(url, file, { optional = false } = {}) {
  if (!FORCE && (await exists(file))) return true;
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404 && optional) return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return false;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ---- OpenStreetMap ----
const osmBox = latLonBox(WORLD, 120);
console.log('OSM …');
await download(
  `https://api.openstreetmap.org/api/0.6/map?bbox=${osmBox.minLon.toFixed(5)},${osmBox.minLat.toFixed(5)},${osmBox.maxLon.toFixed(5)},${osmBox.maxLat.toFixed(5)}`,
  path.join(RAW, 'osm', 'map.osm'),
);

// ---- PLATEAU (CityGML 建築物モデル) ----
console.log('PLATEAU …');
const codes = meshCodesFor(latLonBox(WORLD, 20));
const catalogFile = path.join(RAW, 'plateau', 'catalog.json');
await download(`https://api.plateauview.mlit.go.jp/datacatalog/citygml/m:${codes.join(',')}`, catalogFile);
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
const gmlJobs = [];
for (const city of catalog.cities ?? []) {
  for (const f of city.files?.bldg ?? []) {
    if (!codes.includes(f.code)) continue;
    gmlJobs.push({ url: f.url, file: path.join(RAW, 'plateau', `${city.cityCode}_${f.code}_bldg.gml`) });
  }
}
await pool(gmlJobs, 3, (j) => download(j.url, j.file));
console.log(`  ${gmlJobs.length} CityGML files (mesh ${codes.join(', ')})`);

// ---- 地理院タイル ----
const GSI = 'https://cyberjapandata.gsi.go.jp/xyz';
const far = { minX: -FAR_RADIUS, maxX: FAR_RADIUS, minZ: -FAR_RADIUS, maxZ: FAR_RADIUS };
const tileJobs = [];
const addTiles = (layer, ext, zoom, bounds, margin, optional = false) => {
  const b = { minX: bounds.minX - margin, maxX: bounds.maxX + margin, minZ: bounds.minZ - margin, maxZ: bounds.maxZ + margin };
  const r = tileRange(b, zoom);
  for (let x = r.x0; x <= r.x1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      tileJobs.push({
        url: `${GSI}/${layer}/${zoom}/${x}/${y}.${ext}`,
        file: path.join(RAW, 'gsi', layer, `${zoom}_${x}_${y}.${ext}`),
        optional,
      });
    }
  }
};
addTiles('dem5a_png', 'png', 15, WORLD, 40, true); // 航空レーザ測量 5m メッシュ
addTiles('dem_png', 'png', 14, WORLD, 40, true); // 10m メッシュ (5m が欠けている場所の穴埋め)
addTiles('dem_png', 'png', 13, far, 100, true); // 遠景用
addTiles('seamlessphoto', 'jpg', 17, WORLD, 20); // 植生の推定用
addTiles('seamlessphoto', 'jpg', 14, far, 100); // 遠景の色
console.log(`地理院タイル … ${tileJobs.length} tiles`);
await pool(tileJobs, 6, (j) => download(j.url, j.file, { optional: j.optional }));

console.log('done →', RAW);
