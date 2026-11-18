// PLATEAU の CityGML (建築物モデル LOD1) から、外形・高さ・地盤高を取り出す。
import fs from 'node:fs';

const toRing = (s) => {
  const v = s.trim().split(/\s+/).map(Number);
  const ring = [];
  for (let i = 0; i + 2 < v.length; i += 3) ring.push([v[i], v[i + 1]]); // lat, lon
  return ring;
};

export function parsePlateauBuildings(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<bldg:Building gml:id="([^"]+)">([\s\S]*?)<\/bldg:Building>/g)) {
    const body = m[2];
    const fp =
      body.match(/<bldg:lod0FootPrint>([\s\S]*?)<\/bldg:lod0FootPrint>/) ??
      body.match(/<bldg:lod0RoofEdge>([\s\S]*?)<\/bldg:lod0RoofEdge>/);
    if (!fp) continue;
    const polygons = [];
    for (const p of fp[1].matchAll(/<gml:Polygon[^>]*>([\s\S]*?)<\/gml:Polygon>/g)) {
      const ext = p[1].match(/<gml:exterior>[\s\S]*?<gml:posList>([^<]+)<\/gml:posList>/);
      if (!ext) continue;
      const holes = [...p[1].matchAll(/<gml:interior>[\s\S]*?<gml:posList>([^<]+)<\/gml:posList>/g)].map((q) => toRing(q[1]));
      polygons.push({ outer: toRing(ext[1]), holes });
    }
    // LOD1 立体の Z 範囲 = 地盤高 〜 屋根の高さ (標高)
    let zMin = Infinity;
    let zMax = -Infinity;
    const solid = body.match(/<bldg:lod1Solid>([\s\S]*?)<\/bldg:lod1Solid>/);
    if (solid) {
      for (const p of solid[1].matchAll(/<gml:posList>([^<]+)<\/gml:posList>/g)) {
        const v = p[1].trim().split(/\s+/);
        for (let i = 2; i < v.length; i += 3) {
          const z = Number(v[i]);
          if (z < zMin) zMin = z;
          if (z > zMax) zMax = z;
        }
      }
    }
    const num = (re) => {
      const r = body.match(re);
      return r ? Number(r[1]) : null;
    };
    const height = num(/<bldg:measuredHeight[^>]*>([^<]+)</);
    out.push({
      id: m[1],
      polygons,
      height: height !== null && height > 0 ? height : null,
      zMin: Number.isFinite(zMin) ? zMin : null,
      zMax: Number.isFinite(zMax) ? zMax : null,
      storeys: num(/<bldg:storeysAboveGround>([^<]+)</),
      usage: num(/<bldg:usage[^>]*>([^<]+)</),
    });
  }
  return out;
}
