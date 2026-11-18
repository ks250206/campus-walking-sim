import { okabeHedge } from './gateApproach';
import type { Heightfield } from './heightfield';
import { pointInPolygon } from './heightfield';
import type { CampusJson, RoadData } from './types';

/**
 * 地図データ (OpenStreetMap / PLATEAU) には載っていないが、大学のバリアフリーマップや写真で
 * 確認できる通路を補う。
 *
 *   - H1 棟と H2 棟をつなぐ 3 階のブリッジ。下は入口から続くメインストリートが通り抜ける
 *   - J2・J3 棟わきの坂 → 加藤山をくぐる歩行者トンネル → 階段 → G2 棟 1 階の通り抜け
 *   - G4 棟をくぐる構内道路 (OSM では建物の下のトンネルとして登録されている)
 *   - すずかけホール (H1・H2 棟) 前のウッドデッキの広場
 *
 * 位置は、建物の外形・道路の端点・標高から読み取って決めている。
 */

/** 建物の下を通り抜けられる部分 */
export interface PassageSpec {
  /** 対象の建物名 */
  building: RegExp;
  /** 通り抜けの平面形 (凸多角形) [x, z, ...] */
  zone: number[];
  /** 地盤面から、上に載る階の床下までの高さ */
  clear: number;
}

/** 箱形の歩行者トンネル */
export interface TunnelSpec {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  /** 内のりの幅の半分 */
  halfWidth: number;
  /** 内のりの高さ */
  height: number;
}

/** 階段 (a が上、b が下) */
export interface StairSpec {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  width: number;
  steps: number;
  /** 上下の踊り場 (コンクリートの床) の長さ */
  landing: number;
  handrails?: boolean;
}

/** 地形とは別に歩ける面 (トンネルの床、階段の斜面) */
export interface WalkStrip {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  halfWidth: number;
}

/** 2 段上がりの板張りの台 (ウッドデッキ) と、まわりの広場の小物 */
export interface WoodDeckSpec {
  /** デッキの外周 (凸多角形) [x, z, ...] */
  ring: number[];
  /** デッキを囲む 1 段目の踏み段の外周 */
  stepRing: number[];
  /** まわりの舗装面の高さ */
  ground: number;
  /** 舗装面からデッキ上面までの高さ */
  height: number;
  /** 板を張る向き (単位ベクトル) */
  dir: [number, number];
  benches: { x: number; z: number; dir: [number, number] }[];
  planters: { x: number; z: number }[];
  /** ルーバー屋根のパーゴラ。w は長手 (dir の向き)、d は奥行き */
  pergola: { x: number; z: number; w: number; d: number; dir: [number, number] };
  /** 広場の木を囲む四角いベンチ */
  treeBench: { x: number; z: number; size: number };
  /** 車止め */
  bollards: { x: number; z: number }[];
}

export interface CampusExtras {
  woodDecks: WoodDeckSpec[];
  passages: PassageSpec[];
  tunnels: TunnelSpec[];
  stairs: StairSpec[];
  strips: WalkStrip[];
  /** 木を生やさない帯 (中心線と半径) */
  clearings: { p: number[]; radius: number }[];
}

/** 線分 a → b を中心線とする幅 width の長方形 */
function rectAround(ax: number, az: number, bx: number, bz: number, width: number): number[] {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = (-(bz - az) / len) * (width / 2);
  const nz = ((bx - ax) / len) * (width / 2);
  return [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz];
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.6;

// ---- H1–H2 ブリッジ: H1 棟の外形のうち、通りをまたいで H2 棟の壁まで伸びる「腕」の部分
const H1_BRIDGE = [8.1, 41.36, 11.42, 45.47, 25.92, 33.03, 18.03, 32.83];

// ---- G2 棟 1 階の通り抜け: 北西面 (階段側) から南東面 (中庭側) へ、棟の北東寄りを横切る
const G2_IN = { x: 92.98, z: 176.19 };
const G2_AXIS = { x: 0.647, z: 0.763 };
const G2_DEPTH = 17.25;
const G2_FLOOR = 14.42;

// ---- 加藤山のトンネル: J2・J3 棟わきの坂を上りきった所から、G4-A 棟わきの道の端まで
const TUNNEL_W = { x: 48.5, z: 141.6, y: 20.2 };
const TUNNEL_E = { x: 68.0, z: 149.2, y: 20.4 };
const TUNNEL_HALF_WIDTH = 1.3;
const TUNNEL_HEIGHT = 2.6;
/** トンネルを出た所 (G4-A 棟へ回る道と、G2 棟へ下りる階段の分かれ目) */
const JUNCTION = { x: 73.57, z: 153.3, y: 20.4 };

// ---- すずかけホール前の広場とウッドデッキ。
// H1–H2 のブリッジを抜けた先はインターロッキング舗装の広場で、その南側 (加藤山の手前) に
// 2 段上がりの板張りの台がある。範囲は、大学の公開写真 (J2・J3 棟からの俯瞰、バリアフリーマップの
// 経路写真) と航空写真 (地理院タイル) の色から読み取った。
const PLAZA_OUTLINE = [12, 44, 20, 40.2, 30.5, 39.6, 41, 43.5, 42.5, 52, 42.5, 63, 39, 72, 37, 79, 24, 79, 19.5, 71.5, 2, 71.5, 0, 66];
const DECK_RING = [26, 57.5, 40.5, 56, 41.5, 63.5, 36.5, 75.5, 29.5, 77, 26, 71];
const DECK_HEIGHT = 0.3;
const DECK_STEP = 0.42;
/** 板の向き */
const DECK_DIR: [number, number] = [0.35, 0.937];
/** パーゴラを沿わせる、デッキの山側の辺の向き */
const DECK_EAST: [number, number] = [0.132, 0.991];
/** 広場に立つ木 (航空写真で樹冠が見える位置。H1 棟へ回る歩道は避ける)。3 本目を四角いベンチで囲む */
const PLAZA_TREES = [27, 45.5, 9.5, 0, 31.5, 43.5, 8.5, 0, 30, 51.5, 10, 0, 34.5, 48.5, 9, 0];

/** 凸多角形を外側へ d だけ広げる */
function offsetConvex(ring: number[], d: number): number[] {
  const n = ring.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  const sign = area > 0 ? 1 : -1;
  // 各辺を外側へずらした直線 (点と向き)
  const lines: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j * 2] - ring[i * 2];
    const dz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    lines.push([ring[i * 2] + ((dz * sign) / len) * d, ring[i * 2 + 1] - ((dx * sign) / len) * d, dx / len, dz / len]);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n];
    const b = lines[i];
    const det = a[2] * b[3] - a[3] * b[2];
    const t = Math.abs(det) < 1e-6 ? 0 : ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / det;
    out.push(a[0] + a[2] * t, a[1] + a[3] * t);
  }
  return out;
}

function buildWoodDeck(json: CampusJson, hf: Heightfield): WoodDeckSpec {
  // 広場はほぼ平らなので、平均の高さにならして舗装する
  let sum = 0;
  let count = 0;
  for (let x = 0; x <= 44; x += 2) {
    for (let z = 38; z <= 80; z += 2) {
      if (!pointInPolygon(x, z, PLAZA_OUTLINE)) continue;
      sum += hf.heightAt(x, z);
      count++;
    }
  }
  const ground = sum / Math.max(1, count);
  hf.flatten(PLAZA_OUTLINE, ground, 3);
  json.areas.push({ k: 'plaza', r: PLAZA_OUTLINE });
  json.trees.push(...PLAZA_TREES);

  // パーゴラはデッキの山側の辺に沿って置き、その下にベンチ、柱の間にプランターを並べる
  const [ex, ez] = DECK_EAST;
  const pergola = { x: 39.1, z: 60, w: 6.6, d: 2.8, dir: DECK_EAST };
  const along = (du: number, dv: number): { x: number; z: number } => ({
    x: pergola.x + ex * du + ez * dv,
    z: pergola.z + ez * du - ex * dv,
  });
  return {
    ring: DECK_RING,
    stepRing: offsetConvex(DECK_RING, DECK_STEP),
    ground,
    height: DECK_HEIGHT,
    dir: DECK_DIR,
    pergola,
    benches: [
      { ...along(-1.7, -0.3), dir: DECK_EAST },
      { ...along(1.7, -0.3), dir: DECK_EAST },
      { x: 31, z: 63.5, dir: DECK_DIR },
      { x: 33, z: 71, dir: [DECK_DIR[1], -DECK_DIR[0]] },
    ],
    planters: [along(-2.7, 0.95), along(0, 0.95), along(2.7, 0.95), { x: 28.3, z: 72.8 }],
    treeBench: { x: PLAZA_TREES[8], z: PLAZA_TREES[9], size: 2.5 },
    bollards: [59, 61.4, 63.8, 66.2].map((z) => ({ x: 24.3, z })),
  };
}

/** 岡部野営場脇。広場の輪郭は航空写真、階段の中心線はOSMの steps に合わせる。 */
function addOkabePlaza(json: CampusJson, hf: Heightfield, strips: WalkStrip[]): StairSpec {
  const [ax, az] = [-77.05, -68.62];
  const [bx, bz] = [-73.34, -64.58];
  const width = 15;
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const point = (d: number, side: number): [number, number] => [ax + ux * d - uz * side, az + uz * d + ux * side];
  // DEMでは階段がなだらかに均されているので、上は広場、下は車道側の高さを採る。
  const ay = hf.heightAt(-79.15, -70.97);
  const by = hf.heightAt(-69.27, -59.94);
  const steps = Math.round((ay - by) / 0.14);
  const landing = 1.4;
  const half = width / 2;

  // 踊り場まで幅広く舗装し、野営場の生け垣と階段脇の植栽の間に通路を残す。
  json.areas.push({
    k: 'plaza',
    n: '岡部野営場前広場',
    noLamps: true,
    r: [
      ...okabeHedge.slice(1),
      [-103.4, -50.3],
      [-96.1, -43.9],
      [-94.4, -45.3],
      [-98.6, -49.8],
      [-97.7, -53.7],
      [-95.3, -59.6],
      [-92, -63.7],
      [-87.5, -67],
      [-84.7, -67.2],
      // 階段と、下の踊り場から車道縁へ抜ける舗装面。
      point(0, half),
      point(11.5, half),
      point(11.5, -half),
      point(0, -half),
      [-73.4, -77.6],
      [-69.5, -84.3],
      [-67.8, -90.2],
      [-68.9, -94.3],
      [-71.3, -96.6],
      [-75.4, -98.2],
      [-83.6, -100.1],
      [-86.9, -103.3],
      [-98, -104.2],
      [-105.7, -104.8],
    ].flat(),
  });
  const road = json.roads.find((r) => r.k === 'steps' && near(r.p[0], ax) && near(r.p[1], az));
  if (road) road.w = width;

  // 踏面の下だけ地形を下げ、歩行面も描画する各段と同じ高さにする。
  const cut = 0.3;
  const strip = (from: number, to: number, y: number): void => {
    const [x0, z0] = point(from, 0);
    const [x1, z1] = point(to, 0);
    strips.push({ ax: x0, az: z0, bx: x1, bz: z1, ay: y, by: y, halfWidth: half });
  };
  // 踊り場の前後は、左右の端も含めて元の地面へなじませる。
  hf.flatten(rectAround(...point(-landing - 1, 0), ax, az, width + 1), ay - 0.035, 2);
  hf.flatten(rectAround(bx, bz, ...point(len + landing + 1, 0), width + 1), by - 0.035, 2);
  hf.shapeCorridor({ ax, az, bx, bz, ay: ay - cut, by: by - cut, halfWidth: half + 0.8, feather: 1.6, flatEnds: true, mode: 'set' });
  strip(-landing, 0, ay);
  for (let i = 0; i < steps; i++) strip((len * i) / steps, (len * (i + 1)) / steps, ay + ((by - ay) * (i + 1)) / steps);
  strip(len, len + landing, by);
  return { ax, az, bx, bz, ay, by, width, steps, landing, handrails: false };
}

export function applyCampusExtras(json: CampusJson, hf: Heightfield): CampusExtras {
  // R3本棟は2つの外形に分かれる。低層棟のLOD1底面は高層棟との接続部の低い地盤にあり、
  // そのままでは道路側で外壁が埋まる。棟高は維持し、1階を搬入口前の地盤に合わせる。
  const lowWing = json.buildings.find((b) => b.c && b.n === 'R3本棟' && pointInPolygon(-60, 6, b.r));
  if (lowWing) {
    const height = lowWing.t - lowWing.b;
    lowWing.b = hf.heightAt(-86, -12);
    lowWing.t = lowWing.b + height;
    lowWing.n = 'R3低層棟';
    lowWing.lv = 1;
    // 搬入車が引き戸へ回り込む舗装と、道路に面した長辺の作業帯。
    json.areas.push({
      k: 'asphalt',
      r: [-77.3, -17.4, -88.08, -8.9, -43.96, 43.51, -47.2, 46.2, -93.9, -9.3, -79.9, -20.5],
    });
  }

  const along = (d: number): [number, number] => [JUNCTION.x + G2_AXIS.x * d, JUNCTION.z + G2_AXIS.z * d];
  const [topX, topZ] = along(9); // 階段の上端
  const [bottomX, bottomZ] = along(25); // 階段の下端
  const outX = G2_IN.x + G2_AXIS.x * G2_DEPTH;
  const outZ = G2_IN.z + G2_AXIS.z * G2_DEPTH;
  const stairTopY = 20.2;

  // 坂: G1 棟の東の角から、芝の斜面を上ってトンネルの入口へ
  const slope = [20.18, 96.3, 22, 112, 26, 126, 36, 138, 45, 140.8, TUNNEL_W.x, TUNNEL_W.z];
  const slopeY: number[] = [];
  for (let i = 0; i < slope.length; i += 2) slopeY.push(hf.heightAt(slope[i], slope[i + 1]));
  slopeY[slopeY.length - 2] = TUNNEL_W.y - 0.05;
  slopeY[slopeY.length - 1] = TUNNEL_W.y;

  // ---- 道路データに通路を足す (地面の舗装・地図・街灯に反映される)
  const add = (k: string, w: number, p: number[], extra: Partial<RoadData> = {}): void => {
    json.roads.push({ k, w, p, c: 1, ...extra });
  };
  add('footway', 2.6, slope);
  add('footway', 2.4, [TUNNEL_W.x, TUNNEL_W.z, TUNNEL_E.x, TUNNEL_E.z], { tn: 1, n: '歩行者トンネル' });
  add('footway', 2.6, [TUNNEL_E.x, TUNNEL_E.z, JUNCTION.x, JUNCTION.z]);
  add('footway', 3.6, [JUNCTION.x, JUNCTION.z, topX, topZ]);
  add('steps', 3.6, [topX, topZ, bottomX, bottomZ]);
  add('footway', 5, [bottomX, bottomZ, G2_IN.x, G2_IN.z, outX, outZ, 114.04, 191.2]);

  // G4 棟の下を抜ける道は、トンネルではなく地上の道として扱う
  for (const r of json.roads) {
    if (r.tn && r.k === 'service' && near(r.p[0], 118.53) && near(r.p[1], 182.36)) delete r.tn;
  }

  // ---- 地形を整える (トンネルの掘り込みは、ほかの整形が済んでから最後に行う)
  for (let i = 0; i + 3 < slope.length; i += 2) {
    hf.shapeCorridor({
      ax: slope[i],
      az: slope[i + 1],
      ay: slopeY[i / 2],
      bx: slope[i + 2],
      bz: slope[i + 3],
      by: slopeY[i / 2 + 1],
      halfWidth: 1.5,
      feather: 2.5,
      mode: 'set',
    });
  }
  hf.shapeCorridor({
    ax: TUNNEL_E.x,
    az: TUNNEL_E.z,
    ay: TUNNEL_E.y,
    bx: JUNCTION.x,
    bz: JUNCTION.z,
    by: JUNCTION.y,
    halfWidth: 1.6,
    feather: 2.5,
    mode: 'set',
  });
  hf.shapeCorridor({
    ax: JUNCTION.x,
    az: JUNCTION.z,
    ay: JUNCTION.y,
    bx: topX,
    bz: topZ,
    by: stairTopY,
    halfWidth: 2.2,
    feather: 2.5,
    mode: 'set',
  });
  // 階段の下の地面は、踏面より少し下に沈めておく (上下の踊り場とは垂直に切り替える)
  hf.shapeCorridor({
    ax: topX,
    az: topZ,
    ay: stairTopY - 0.45,
    bx: bottomX,
    bz: bottomZ,
    by: G2_FLOOR - 0.45,
    halfWidth: 2.3,
    feather: 3,
    mode: 'set',
    flatEnds: true,
  });
  hf.shapeCorridor({
    ax: bottomX,
    az: bottomZ,
    ay: G2_FLOOR,
    bx: G2_IN.x,
    bz: G2_IN.z,
    by: G2_FLOOR,
    halfWidth: 2.8,
    feather: 2.5,
    mode: 'set',
    flatEnds: true,
  });
  const g2Zone = rectAround(G2_IN.x - G2_AXIS.x, G2_IN.z - G2_AXIS.z, outX + G2_AXIS.x, outZ + G2_AXIS.z, 7.5);
  // 床は壁の外側 (建物の下で見えない部分) まで広めに平らにして、壁ぎわが沈まないようにする
  hf.flatten(rectAround(G2_IN.x - G2_AXIS.x * 2, G2_IN.z - G2_AXIS.z * 2, outX + G2_AXIS.x * 2, outZ + G2_AXIS.z * 2, 14), G2_FLOOR, 2);
  const g4Zone = rectAround(117.6, 183.2, 132.1, 170.5, 6.8);
  // 通り抜けの床は、壁から壁まで舗装する
  json.areas.push({ k: 'plaza', r: g2Zone }, { k: 'plaza', r: g4Zone });

  const strips: WalkStrip[] = [];
  const okabeStairs = addOkabePlaza(json, hf, strips);
  const woodDeck = buildWoodDeck(json, hf);

  const ceilingTop = Math.max(TUNNEL_W.y, TUNNEL_E.y) + TUNNEL_HEIGHT + 0.35;
  hf.shapeCorridor({
    ax: TUNNEL_W.x,
    az: TUNNEL_W.z,
    ay: TUNNEL_W.y - 0.7,
    bx: TUNNEL_E.x,
    bz: TUNNEL_E.z,
    by: TUNNEL_E.y - 0.7,
    halfWidth: 4.4,
    feather: 2,
    mode: 'lower',
    cap: true,
    capMin: ceilingTop + 0.12,
    capMinHalfWidth: 3,
  });

  // ---- 歩ける面: トンネルの床 (坑口の前後に少し張り出す) と階段
  const tl = Math.hypot(TUNNEL_E.x - TUNNEL_W.x, TUNNEL_E.z - TUNNEL_W.z);
  const tx = (TUNNEL_E.x - TUNNEL_W.x) / tl;
  const tz = (TUNNEL_E.z - TUNNEL_W.z) / tl;
  const apron = 2.4;
  const LANDING = 2.2;
  const landTop = along(9 - LANDING);
  const landBottom = along(25 + LANDING);
  strips.push(
    {
      ax: TUNNEL_W.x - tx * apron,
      az: TUNNEL_W.z - tz * apron,
      ay: TUNNEL_W.y,
      bx: TUNNEL_E.x + tx * apron,
      bz: TUNNEL_E.z + tz * apron,
      by: TUNNEL_E.y,
      halfWidth: TUNNEL_HALF_WIDTH,
    },
    { ax: topX, az: topZ, ay: stairTopY, bx: bottomX, bz: bottomZ, by: G2_FLOOR, halfWidth: 1.8 },
    // 階段の上下の踊り場
    { ax: landTop[0], az: landTop[1], ay: stairTopY, bx: topX, bz: topZ, by: stairTopY, halfWidth: 1.8 },
    { ax: bottomX, az: bottomZ, ay: G2_FLOOR, bx: landBottom[0], bz: landBottom[1], by: G2_FLOOR, halfWidth: 1.8 },
  );

  return {
    woodDecks: [woodDeck],
    passages: [
      { building: /^H1/, zone: H1_BRIDGE, clear: 8.6 },
      { building: /^G2/, zone: g2Zone, clear: 4.0 },
      { building: /^G4棟/, zone: g4Zone, clear: 4.6 },
    ],
    tunnels: [
      {
        ax: TUNNEL_W.x,
        az: TUNNEL_W.z,
        ay: TUNNEL_W.y,
        bx: TUNNEL_E.x,
        bz: TUNNEL_E.z,
        by: TUNNEL_E.y,
        halfWidth: TUNNEL_HALF_WIDTH,
        height: TUNNEL_HEIGHT,
      },
    ],
    stairs: [
      okabeStairs,
      { ax: topX, az: topZ, ay: stairTopY, bx: bottomX, bz: bottomZ, by: G2_FLOOR, width: 3.6, steps: 36, landing: LANDING },
    ],
    strips,
    clearings: [
      { p: slope, radius: 2.8 },
      { p: [TUNNEL_W.x - tx * 6, TUNNEL_W.z - tz * 6, TUNNEL_W.x, TUNNEL_W.z], radius: 3.2 },
      { p: [TUNNEL_E.x, TUNNEL_E.z, JUNCTION.x, JUNCTION.z, bottomX, bottomZ, G2_IN.x, G2_IN.z], radius: 3.6 },
    ],
  };
}
