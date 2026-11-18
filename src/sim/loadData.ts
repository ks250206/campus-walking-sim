import type { CampusData, CampusJson } from './types';

const base = `${import.meta.env.BASE_URL}data/`;

async function get(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} の読み込みに失敗しました (HTTP ${res.status})`);
  return res;
}

export async function loadCampusData(onProgress?: (label: string) => void): Promise<CampusData> {
  onProgress?.('地図データを読み込み中');
  const json = (await (await get(`${base}campus.json`)).json()) as CampusJson;
  onProgress?.('標高データを読み込み中');
  const [terrainBuf, farBuf] = await Promise.all([
    get(base + json.terrain.file).then((r) => r.arrayBuffer()),
    get(base + json.far.file).then((r) => r.arrayBuffer()),
  ]);
  const farCount = json.far.n * json.far.n;
  return {
    json,
    terrain: new Uint16Array(terrainBuf),
    farHeights: new Uint16Array(farBuf, 0, farCount),
    farColors: new Uint8Array(farBuf, farCount * 2, farCount * 3),
  };
}
