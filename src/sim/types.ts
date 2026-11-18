// public/data/campus.json の形 (scripts/build-data.mjs が生成する)

export interface SourceCredit {
  name: string;
  license: string;
  credit: string;
  url: string;
}

export interface BuildingData {
  /** 外形 [x, z, x, z, ...] */
  r: number[];
  /** 中庭などの穴 */
  h?: number[][];
  /** 地盤面の高さ (ワールド Y) */
  b: number;
  /** 屋根の高さ (ワールド Y) */
  t: number;
  /** 外周の地形の最低・最高 (ワールド Y) */
  g: [number, number];
  /** 名前 (OSM) */
  n?: string;
  /** キャンパス内の建物 */
  c?: 1;
  /** 地上階数 */
  lv?: number;
  /** OSM の building=* */
  u?: string;
  /** 高さが推定値 */
  est?: 1;
}

export interface RoadData {
  /** OSM の highway=* (線路は "rail") */
  k: string;
  /** 幅 (m) */
  w: number;
  /** 中心線 [x, z, ...] */
  p: number[];
  br?: 1;
  tn?: 1;
  ly?: number;
  n?: string;
  sf?: string;
  sv?: string;
  /** 一般の人は通れない */
  pv?: 1;
  /** キャンパス内 */
  c?: 1;
}

export interface AreaData {
  k: string;
  r: number[];
  h?: number[][];
  n?: string;
  cap?: number;
  dry?: 1;
}

export interface PoiData {
  k: string;
  x: number;
  z: number;
  n?: string;
  en?: string;
}

export interface CampusJson {
  meta: {
    name: string;
    nameEn: string;
    origin: { lat: number; lon: number };
    baseElevation: number;
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    sources: SourceCredit[];
  };
  terrain: { file: string; x0: number; z0: number; step: number; nx: number; nz: number; hMin: number; unit: number };
  far: { file: string; radius: number; step: number; n: number; hMin: number; unit: number };
  campusBoundary: number[][];
  buildings: BuildingData[];
  roads: RoadData[];
  areas: AreaData[];
  barriers: { k: string; p: number[] }[];
  pois: PoiData[];
  /** [x, z, 高さ, 種類] の繰り返し */
  trees: number[];
}

export interface CampusData {
  json: CampusJson;
  terrain: Uint16Array;
  farHeights: Uint16Array;
  farColors: Uint8Array;
}

export type Vec2 = [number, number];

export interface Landmark {
  name: string;
  x: number;
  z: number;
  ring: number[];
}
