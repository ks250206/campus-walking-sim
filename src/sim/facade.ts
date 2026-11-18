import { Material3D } from '@pixi/3d';
import type { ShaderBit } from '@pixi/3d';
import { linearRgb } from './meshBuilder';
import { noiseBit } from './shaderBits';

/** 外壁の見た目の定義。寸法はメートル、割合は 0–1 */
export interface FacadeStyle {
  /** 外壁の色 (sRGB)。建物ごとにここから選ぶ */
  walls: number[];
  /** 柱型・スラブ帯の色 */
  accent: number;
  /** サッシの色 */
  frame: number;
  /** ガラスの色味 */
  glass: number;
  /** ガラスの映り込みの強さ */
  reflect: number;
  /** 階高 */
  floorH: number;
  /** 1 階の階高 (0 なら他の階と同じ) */
  groundH: number;
  /** 柱間 (スパン) の目安 */
  bayW: number;
  /** 窓の幅 (スパンに対する割合。1 で連窓) */
  winW: number;
  /** 窓の高さ (階高に対する割合) */
  winH: number;
  /** 窓の下端 (階高に対する割合) */
  sill: number;
  /** サッシの見付け幅 */
  frameT: number;
  /** 窓 1 つを縦に何分割するか */
  mullions: number;
  /** 無目 (横桟) の位置。0 でなし */
  transom: number;
  /** 柱型の幅 (スパンに対する割合) */
  pilaster: number;
  /** スラブ帯の高さ (階高に対する割合) */
  band: number;
  /** タイルの大きさ (幅, 高さ)。0 でタイルなし */
  tile: [number, number];
  /** 目地の濃さ */
  tileStrength: number;
  /** 馬踏み目地にする */
  tileBond: boolean;
  /** 1 部屋が何スパン分か */
  roomBays: number;
  /** 部屋の奥行き */
  roomDepth: number;
  /** パラペットの高さ */
  parapet: number;
  /** 外壁の粗さ */
  roughness: number;
  /** 陸屋根の色 */
  roof: number;
  /** 腰壁 (窓の下) に水平ルーバーを描く強さ。バルコニーの手すりに見える */
  louver: number;
  /** バルコニーの奥に引っ込んだ窓の暗さ */
  recess: number;
  /** 丸窓にする */
  round: boolean;
  /** 妻側 (短辺) の壁を窓なしにする。'brace' なら X 字のブレースを描く */
  ends: 'same' | 'blank' | 'brace';
}

const base: FacadeStyle = {
  walls: [0xcbbfa8],
  accent: 0xb9b3a6,
  frame: 0x4a4f55,
  glass: 0x9fb4bd,
  reflect: 0.45,
  floorH: 3.8,
  groundH: 4.2,
  bayW: 3.6,
  winW: 0.7,
  winH: 0.48,
  sill: 0.26,
  frameT: 0.055,
  mullions: 2,
  transom: 0,
  pilaster: 0,
  band: 0,
  tile: [0.227, 0.06],
  tileStrength: 0.7,
  tileBond: true,
  roomBays: 2,
  roomDepth: 6.5,
  parapet: 0.9,
  roughness: 0.82,
  roof: 0x8d8f8c,
  louver: 0,
  recess: 0,
  round: false,
  ends: 'same',
};

/** 各階にルーバー付きのバルコニーが帯状に回る高層の研究棟 (R1・R2・R3・G1・G2・J1・B1・B2 棟) */
const slab: FacadeStyle = {
  ...base,
  walls: [0xb4b6b8],
  accent: 0x8c9096,
  frame: 0x3f4347,
  glass: 0x7f929b,
  reflect: 0.35,
  floorH: 3.9,
  groundH: 4.6,
  bayW: 3.6,
  winW: 1,
  winH: 0.5,
  sill: 0.4,
  mullions: 3,
  pilaster: 0.07,
  band: 0.1,
  tile: [1.8, 0.9],
  tileStrength: 0.45,
  tileBond: false,
  louver: 1,
  recess: 0.55,
  ends: 'blank',
  parapet: 1.1,
  roughness: 0.88,
  roof: 0x9a9c99,
};

export const FACADE_STYLES = {
  /** 研究棟 (低〜中層): 連窓とスパンドレルの帯 */
  lab: {
    ...base,
    walls: [0xc9c7c0],
    accent: 0xb5b3ac,
    winW: 1,
    winH: 0.46,
    sill: 0.3,
    mullions: 3,
    band: 0.16,
    tile: [0.9, 0.45],
    tileStrength: 0.35,
    tileBond: false,
  },
  /** R1・R2 棟 */
  slabR: { ...slab },
  /** R3低層棟。天井の高い平屋で、窓は壁の下方に1列。妻面は搬入口。 */
  r3Low: {
    ...base,
    walls: [0xbbb8ad],
    accent: 0xb1ada2,
    floorH: 5.5,
    groundH: 0,
    bayW: 5.7,
    winW: 0.82,
    winH: 0.29,
    sill: 0.14,
    mullions: 4,
    pilaster: 0.055,
    tile: [1.8, 0.9],
    tileStrength: 0.24,
    tileBond: false,
    reflect: 0.22,
    parapet: 0.25,
    ends: 'blank',
  },
  /** R3 高層棟: やや暗いグレー */
  slabR3: { ...slab, walls: [0x9b9a9f], accent: 0x7e8187 },
  /** G1 棟: 濃いグレーのルーバー帯と明るい妻壁 */
  slabG1: { ...slab, walls: [0xccc8c6], accent: 0x6b7076 },
  /** G2 棟: コンクリート打放し */
  slabG2: { ...slab, walls: [0xa0a3a6], accent: 0x83878b },
  /** J1 棟 */
  slabJ1: { ...slab, walls: [0xbfbdb8], accent: 0x9d9c98, louver: 0.5 },
  /** B1・B2 棟: グレージュのコンクリートに張り出したバルコニー */
  slabB: { ...slab, walls: [0xa8a29a], accent: 0x8f8a83, floorH: 3.85 },
  /** G3 棟: 淡いスパンドレルの連窓と、全高にわたるロッキング壁 */
  g3: { ...slab, walls: [0xcfd2d6], accent: 0xa9a39c, louver: 0, recess: 0.15, pilaster: 0.2, band: 0.2, sill: 0.34, ends: 'same' },
  /** G5 棟: 小さな四角い窓が規則正しく並ぶ */
  g5: {
    ...base,
    walls: [0xc9c6bf],
    accent: 0xb8b5ae,
    floorH: 3.7,
    groundH: 4.2,
    bayW: 2.7,
    winW: 0.42,
    winH: 0.34,
    sill: 0.34,
    mullions: 1,
    tile: [0.9, 0.45],
    tileStrength: 0.3,
    tileBond: false,
    parapet: 1.1,
  },
  /** J2・J3 棟: 長辺は鋼製バルコニーとルーバー、妻面は X 字の白いブレース */
  j2j3: {
    ...slab,
    walls: [0xb9bdb8],
    accent: 0x9aa0a2,
    frame: 0x55595d,
    glass: 0x7d98a4,
    reflect: 0.6,
    floorH: 4.2,
    groundH: 8.4,
    bayW: 3.3,
    winH: 0.56,
    sill: 0.34,
    louver: 0.8,
    recess: 0.4,
    ends: 'brace',
    parapet: 1.6,
    roof: 0x7d8082,
  },
  /** S1 棟: オフホワイトの塗装に連窓 */
  s1: {
    ...base,
    walls: [0xd8d6cf],
    accent: 0xc6c4bd,
    winW: 1,
    winH: 0.44,
    sill: 0.3,
    mullions: 3,
    band: 0.2,
    floorH: 3.7,
    groundH: 3.9,
    tile: [0, 0],
    tileStrength: 0,
    roof: 0xa9aba6,
  },
  /** S2 棟: 灰褐色の小口タイルに深い庇とフィン */
  s2: {
    ...base,
    walls: [0x7a7466],
    accent: 0x5e584d,
    frame: 0x3a3632,
    winW: 0.74,
    winH: 0.46,
    sill: 0.3,
    mullions: 2,
    pilaster: 0.12,
    band: 0.1,
    recess: 0.35,
    floorH: 4.3,
    groundH: 4.6,
    parapet: 1.2,
  },
  /** S3 棟 (図書館): 明るいグレーの箱に丸窓 */
  s3: {
    ...base,
    walls: [0xc3c8cb],
    accent: 0xb1b6b9,
    frame: 0x6d7275,
    round: true,
    winW: 0.32,
    winH: 0.3,
    sill: 0.42,
    mullions: 1,
    frameT: 0.07,
    floorH: 4.0,
    groundH: 4.0,
    bayW: 3.2,
    tile: [0, 0],
    tileStrength: 0,
    roof: 0xb4b8b6,
  },
  /** S8 棟 (元素キューブ): 白いパネルに細長い縦窓 */
  s8: {
    ...base,
    walls: [0xdce0e2],
    accent: 0xcdd1d3,
    frame: 0x7a7f83,
    winW: 0.3,
    winH: 0.72,
    sill: 0.14,
    mullions: 1,
    floorH: 4.1,
    groundH: 4.4,
    bayW: 2.4,
    tile: [1.2, 4.1],
    tileStrength: 0.4,
    tileBond: false,
    reflect: 0.55,
    parapet: 1.2,
  },
  /** コンクリート打放しの実験棟・付属棟 */
  concrete: {
    ...base,
    walls: [0xb0b0ab, 0xa9a9a4, 0xb8b6ae],
    accent: 0xa09f99,
    floorH: 4.0,
    groundH: 0,
    bayW: 4.2,
    winW: 1,
    winH: 0.3,
    sill: 0.45,
    mullions: 3,
    tile: [1.8, 0.9],
    tileStrength: 0.5,
    tileBond: false,
    reflect: 0.35,
    parapet: 0.5,
    roughness: 0.9,
  },
  /** 白い箱型の小さな棟 (S4・S5・S7・G4-A など) */
  whiteBox: {
    ...base,
    walls: [0xdad9d4, 0xd2d3d1],
    accent: 0xc2c2be,
    floorH: 3.6,
    groundH: 0,
    bayW: 3.4,
    winW: 0.5,
    winH: 0.36,
    sill: 0.36,
    mullions: 2,
    tile: [0.6, 3.6],
    tileStrength: 0.3,
    tileBond: false,
    parapet: 0.4,
  },
  /** グレーの小口タイルにポツ窓 (B1・B2-B / C 棟など) */
  greyTile: {
    ...base,
    walls: [0xbbbcba, 0xb2b3b0],
    accent: 0xa5a6a3,
    winW: 0.5,
    winH: 0.4,
    sill: 0.32,
    mullions: 2,
    floorH: 3.7,
    groundH: 4.0,
  },
  /** H1 棟 (大学会館・食堂): 円形のガラス壁に白い帯 */
  h1: {
    ...base,
    walls: [0xe6e7ec],
    accent: 0xe6e7ec,
    frame: 0xeef0f2,
    glass: 0x3186ab,
    reflect: 0.7,
    floorH: 4.3,
    groundH: 4.5,
    bayW: 1.5,
    winW: 1,
    winH: 0.74,
    sill: 0.08,
    frameT: 0.05,
    mullions: 1,
    transom: 0.7,
    band: 0.18,
    tile: [0, 0],
    tileStrength: 0,
    roomBays: 6,
    roomDepth: 12,
    parapet: 0.6,
    roof: 0xc9ccce,
  },
  /** H2 棟: 白とアルミのパネル */
  h2: {
    ...base,
    walls: [0xe2e3e2],
    accent: 0xb9bdc0,
    frame: 0x70757a,
    floorH: 4.2,
    groundH: 4.4,
    bayW: 2.7,
    winW: 0.8,
    winH: 0.5,
    sill: 0.26,
    mullions: 2,
    band: 0.12,
    tile: [1.35, 4.2],
    tileStrength: 0.4,
    tileBond: false,
    reflect: 0.55,
    roof: 0x9fd9c8,
  },
  /** 守衛所などの小さな付属建物 */
  hut: {
    ...base,
    walls: [0xc9c5bb, 0xbfb8a8, 0xcfcfca],
    floorH: 3.0,
    groundH: 0,
    bayW: 2.2,
    winW: 0.55,
    winH: 0.4,
    sill: 0.32,
    mullions: 2,
    tile: [0, 0],
    tileStrength: 0,
    parapet: 0.25,
    roomBays: 1,
    roomDepth: 3,
  },
  /** 戸建て住宅 */
  house: {
    ...base,
    walls: [0xe6e0d2, 0xd9d2c4, 0xcfc8ba, 0xe9e6de, 0xc9bca6, 0xb8b2a8, 0xd7cdb8, 0xa9a39a],
    accent: 0x8d8478,
    frame: 0x5a5d60,
    glass: 0x8e9fa6,
    reflect: 0.4,
    floorH: 2.8,
    groundH: 0,
    bayW: 3.0,
    winW: 0.44,
    winH: 0.38,
    sill: 0.3,
    frameT: 0.045,
    mullions: 2,
    tile: [0.9, 0.45],
    tileStrength: 0.22,
    tileBond: true,
    roomBays: 1,
    roomDepth: 3.6,
    parapet: 0,
    roughness: 0.9,
    roof: 0x6e6f72,
  },
  /** 集合住宅: バルコニーの帯が並ぶ */
  apartment: {
    ...base,
    walls: [0xddd6c8, 0xcfc9bd, 0xe4dfd6, 0xc6b9a4],
    accent: 0xb4afa5,
    frame: 0x4f5357,
    floorH: 2.95,
    groundH: 0,
    bayW: 3.2,
    winW: 0.62,
    winH: 0.62,
    sill: 0.06,
    mullions: 2,
    band: 0.34,
    tile: [0.227, 0.06],
    tileStrength: 0.4,
    roomBays: 2,
    roomDepth: 5,
    parapet: 0.6,
    reflect: 0.4,
  },
  /** 店舗・事務所 */
  commercial: {
    ...base,
    walls: [0xd4d1ca, 0xc2c0ba, 0xdcd8cf, 0xb7b2a8],
    floorH: 3.6,
    groundH: 4.0,
    bayW: 3.0,
    winW: 0.8,
    winH: 0.5,
    sill: 0.25,
    mullions: 2,
    tile: [0.6, 0.3],
    tileStrength: 0.35,
    tileBond: false,
    parapet: 0.7,
  },
  /** 倉庫・工場: 金属サイディングで窓が少ない */
  warehouse: {
    ...base,
    walls: [0xc5c8c8, 0xb9bdbd, 0xd0cdc4, 0xaeb4b8],
    accent: 0x9da3a6,
    floorH: 5.0,
    groundH: 0,
    bayW: 6.0,
    winW: 0.3,
    winH: 0.2,
    sill: 0.6,
    mullions: 2,
    tile: [0.3, 40],
    tileStrength: 0.5,
    tileBond: false,
    parapet: 0.3,
    roomBays: 1,
    roomDepth: 10,
    roughness: 0.6,
    reflect: 0.3,
  },
} satisfies Record<string, FacadeStyle>;

export type FacadeStyleId = keyof typeof FACADE_STYLES;

/**
 * 外壁のシェーダ。壁の UV (u = スパン数, v = 地盤からの高さ m) から窓・サッシ・タイル目地を描き、
 * 窓の奥には視線に応じて部屋の中が見える (インテリアマッピング)。
 *   aColor  : 外壁の色 (線形 RGB)
 *   aColor1 : x = 実際のスパン幅 (m), y = 建物ごとの乱数, z = 壁の高さ (m), w = 1 なら窓なし
 */
const facadeBit: ShaderBit = {
  name: 'cwFacade',
  requires: [noiseBit],
  attributes: { aColor1: 'float32x4' },
  interStage: { vFacade: 'vec4<f32>' },
  bindings: {
    material: {
      fDims: 'vec4<f32>', // 階高, スパン, 1 階の階高, パラペット
      fWin: 'vec4<f32>', // 窓幅, 窓高, 窓下端, サッシ幅
      fDetail: 'vec4<f32>', // 方立の分割数, 無目の位置, 柱型, スラブ帯
      fTile: 'vec4<f32>', // タイル幅, タイル高, 目地の濃さ, 馬踏み
      fRoom: 'vec4<f32>', // 部屋のスパン数, 奥行き, 夜に灯りがつく割合, 夜の度合い
      fFrame: 'vec4<f32>', // サッシの色
      fGlass: 'vec4<f32>', // ガラスの色, 映り込み
      fAccent: 'vec4<f32>', // 柱型・帯の色, 外壁の粗さ
      fExtra: 'vec4<f32>', // ルーバーの強さ, 窓の引っ込み, 丸窓
    },
  },
  gl: {
    vertex: { end: /* glsl */ `vFacade = aColor1;` },
    fragment: {
      material: /* glsl */ `
  {
    float bayW = max(vFacade.x, 0.4);
    float seed = vFacade.y;
    float wallH = vFacade.z;
    float plain = step(0.5, vFacade.w);
    float braced = step(1.5, vFacade.w);
    vec2 uv = vUV;
    vec3 wallCol = vColor.rgb;

    // 階とスパン
    float fH0 = material.fDims.x;
    float gH = material.fDims.z;
    float isGround = step(uv.y, gH);
    float upper = max(uv.y - gH, 0.0);
    float fIdx = mix(floor(upper / fH0) + 1.0, 0.0, isGround);
    float fH = mix(fH0, max(gH, 0.1), isGround);
    float fBase = mix(gH + (fIdx - 1.0) * fH0, 0.0, isGround);
    float fy = (uv.y - fBase) / fH;
    float bIdx = floor(uv.x);
    float bx = uv.x - bIdx;
    // 最上部に階高ぶんの余裕がなければ窓は作らない。地盤より下は基礎
    float fits = step(fBase + fH * 0.92, wallH - material.fDims.w) * step(0.0, uv.y);
    float aa = max(fwidth(uv.x) * bayW, fwidth(uv.y)) * 0.75 + 0.0005;

    // 窓の中での、枠からの距離 (m)
    vec4 wr = material.fWin;
    float dxm = (wr.x * 0.5 - abs(bx - 0.5)) * bayW;
    float dym = (wr.y * 0.5 - abs(fy - (wr.z + wr.y * 0.5))) * fH;
    float dWin = min(dxm, dym);
    float rWin = min(wr.x * bayW, wr.y * fH) * 0.5;
    float dRound = rWin - length(vec2((bx - 0.5) * bayW, (fy - (wr.z + wr.y * 0.5)) * fH));
    dWin = mix(dWin, dRound, material.fExtra.z);
    float win = smoothstep(-aa, aa, dWin) * fits * (1.0 - plain);

    // サッシ: 外枠・方立・無目
    float ft = wr.w;
    float frameAmt = 1.0 - smoothstep(ft - aa, ft + aa, dWin);
    float wx = (bx - (0.5 - wr.x * 0.5)) / wr.x;
    float wy = clamp((fy - wr.z) / wr.y, 0.0, 1.0);
    float mCount = material.fDetail.x;
    float mDist = abs(fract(wx * mCount + 0.5) - 0.5) / mCount * wr.x * bayW;
    frameAmt = max(frameAmt, (1.0 - smoothstep(ft * 0.5 - aa, ft * 0.5 + aa, mDist)) * step(1.5, mCount));
    float tr = material.fDetail.y;
    float tDist = abs(wy - tr) * wr.y * fH;
    frameAmt = max(frameAmt, (1.0 - smoothstep(ft * 0.5 - aa, ft * 0.5 + aa, tDist)) * step(0.01, tr));
    frameAmt *= win;

    // 外壁: 柱型・スラブ帯
    vec3 col = wallCol;
    float pil = material.fDetail.z;
    float band = material.fDetail.w;
    float pilAmt = (1.0 - smoothstep(pil * 0.5 * bayW - aa, pil * 0.5 * bayW + aa, min(bx, 1.0 - bx) * bayW)) * step(0.001, pil);
    float bandAmt = (1.0 - smoothstep(band * 0.5 * fH - aa, band * 0.5 * fH + aa, min(fy, 1.0 - fy) * fH)) * step(0.001, band);
    float accentAmt = max(pilAmt, bandAmt) * step(0.0, uv.y) * (1.0 - plain);
    col = mix(col, material.fAccent.rgb, accentAmt);

    // 腰壁の水平ルーバー (バルコニーの手すり)。細い影の線を重ねる
    float lv = material.fExtra.x;
    float inSpandrel = step(fy, wr.z) * step(band * 0.5, fy) * fits * (1.0 - plain) * step(0.001, lv);
    float slatC = uv.y / 0.14;
    float slatFade = 1.0 - smoothstep(0.25, 0.7, fwidth(slatC));
    float slatLine = smoothstep(0.55, 0.75, abs(fract(slatC) - 0.5) * 2.0);
    col = mix(col, material.fAccent.rgb * (1.0 - 0.5 * slatLine * slatFade - 0.12 * (1.0 - slatFade)), inSpandrel * lv);
    // バルコニー床の先端
    float slabEdge = (1.0 - smoothstep(0.10, 0.10 + aa, abs(fy - wr.z) * fH)) * fits * (1.0 - plain) * step(0.001, lv);
    col = mix(col, wallCol * 1.06, slabEdge);

    // 妻面の X 字ブレース (4 層ごとに 1 組) と小さな四角窓
    float xm = uv.x * bayW;
    float cellH = fH0 * 4.0;
    float by = fract(max(uv.y - gH, 0.0) / cellH);
    float bxn = uv.x;
    float diag = min(abs(bxn - by), abs(bxn + by - 1.0)) * min(bayW, cellH) * 0.72;
    float braceAmt = (1.0 - smoothstep(0.42 - aa, 0.42 + aa, diag)) * braced * step(gH, uv.y) * step(uv.y, wallH - material.fDims.w);
    float sqx = abs(fract(xm / 3.6) - 0.5) * 3.6;
    float sqy = abs(fy - 0.55) * fH;
    float dSq = 0.55 - max(sqx, sqy);
    float sqWin = smoothstep(-aa, aa, dSq) * braced * fits * (1.0 - braceAmt);
    float sqFrame = (1.0 - smoothstep(0.05 - aa, 0.05 + aa, dSq)) * sqWin;
    col = mix(col, vec3(0.86, 0.86, 0.85), braceAmt);

    // タイル目地 (遠くでは消してモアレを防ぐ)
    vec2 tc = vec2(uv.x * bayW, uv.y) / max(material.fTile.xy, vec2(0.01));
    vec2 tw = fwidth(tc);
    tc.x += floor(tc.y) * 0.5 * material.fTile.w;
    vec2 tf = abs(fract(tc) - 0.5);
    float tFade = (1.0 - smoothstep(0.22, 0.55, max(tw.x, tw.y))) * material.fTile.z * step(0.02, material.fTile.x);
    float grout = max(smoothstep(0.46, 0.5, tf.x), smoothstep(0.43, 0.5, tf.y));
    float tileTone = cwHash(floor(tc) + seed * 19.0) - 0.5;
    col *= 1.0 - grout * 0.22 * tFade * (1.0 - accentAmt);
    col *= 1.0 + tileTone * 0.14 * tFade * (1.0 - accentAmt);

    // 汚れ: 雨だれの縦すじ、上端と足元のくすみ
    float streak = cwNoise(vec2(uv.x * bayW * 0.85 + seed * 37.0, uv.y * 0.11));
    float cloud = cwNoise(vec2(uv.x * bayW, uv.y) * 0.31 + seed * 11.0);
    float topStain = smoothstep(wallH - 3.0, wallH, uv.y);
    col *= 1.0 - 0.10 * streak * (0.35 + 0.65 * topStain) - 0.07 * cloud;
    col *= mix(0.74, 1.0, smoothstep(0.0, 0.45, uv.y));
    // 基礎 (地盤より下に見えている部分)
    col = mix(col, vec3(0.20, 0.195, 0.185) * (0.85 + 0.3 * cloud), step(uv.y, 0.0));
    // 笠木
    float coping = smoothstep(wallH - 0.2, wallH - 0.17, uv.y) * step(0.3, material.fDims.w);
    col = mix(col, col * 0.5 + 0.02, coping);

    // 室内: 壁面を入口にした箱にレイを飛ばす
    vec3 nrm = normalize(vNormal);
    vec3 tng = normalize(vec3(nrm.z, 0.0, -nrm.x) + vec3(1e-5, 0.0, 0.0));
    vec3 ray = normalize(vPosition - uCameraPosition.xyz);
    vec3 d = vec3(dot(ray, tng), ray.y, min(dot(ray, nrm), -0.03));
    d.x += step(abs(d.x), 1e-4) * 2e-4;
    d.y += step(abs(d.y), 1e-4) * 2e-4;
    float roomBays = max(material.fRoom.x, 1.0);
    float depth = material.fRoom.y;
    float rIdx = floor(bIdx / roomBays);
    float roomW = roomBays * bayW;
    vec3 p = vec3((bIdx - rIdx * roomBays + bx) * bayW, fy * fH, 0.0);
    vec3 tt = vec3((step(0.0, d.x) * roomW - p.x) / d.x, (step(0.0, d.y) * fH - p.y) / d.y, -depth / d.z);
    float tHit = min(tt.x, min(tt.y, tt.z));
    vec3 hp = p + d * tHit;
    float rh = cwHash(vec2(rIdx + seed * 91.0, fIdx + seed * 57.0));
    float rh2 = fract(rh * 17.31);
    float isBack = step(tt.z, tHit + 1e-4);
    float isSide = step(tt.x, tHit + 1e-4) * (1.0 - isBack);
    float isCF = 1.0 - max(isBack, isSide);
    float isCeil = isCF * step(0.0, d.y);
    vec3 wallIn = mix(vec3(0.38, 0.36, 0.32), vec3(0.28, 0.31, 0.34), rh2);
    vec3 floorIn = mix(vec3(0.10, 0.085, 0.07), vec3(0.14, 0.145, 0.15), rh);
    vec3 room = wallIn * isBack + wallIn * 0.8 * isSide + mix(floorIn, vec3(0.55), step(0.0, d.y)) * isCF;
    // 奥の壁の棚や扉
    vec2 bw = vec2(hp.x / roomW, hp.y / fH);
    float shelf = step(0.12, bw.x) * step(bw.x, 0.34 + 0.3 * rh2) * step(bw.y, 0.6) * isBack * step(0.3, rh);
    room = mix(room, room * vec3(0.5, 0.44, 0.38), shelf);
    // 天井の照明
    float camDist = length(vPosition - uCameraPosition.xyz);
    float sz = -hp.z / 2.8 + 0.3;
    float szw = fwidth(sz);
    float strip = smoothstep(0.78 - szw, 0.78 + szw, fract(sz)) * (1.0 - smoothstep(0.2, 0.6, szw)) * (1.0 - smoothstep(25.0, 55.0, camDist));
    float night = material.fRoom.w;
    float lit = step(1.0 - material.fRoom.z, rh) * night;
    float depthShade = mix(1.0, 0.4, clamp(-hp.z / depth, 0.0, 1.0));
    vec3 interior = room * depthShade * mix(0.42, 1.0, lit);
    interior += vec3(0.95, 0.93, 0.86) * strip * isCeil * (0.07 * step(0.45, rh) + 0.6 * lit);
    // ブラインド
    float blindAmt = step(0.5, rh2) * fract(rh2 * 7.7);
    float blind = step(1.0 - blindAmt, wy);
    float slat = 1.0 - 0.2 * step(0.5, fract(uv.y / 0.05)) * (1.0 - smoothstep(6.0, 14.0, camDist));
    interior = mix(interior, vec3(0.52, 0.51, 0.47) * slat, blind * 0.94);

    float reflectK = material.fGlass.a;
    vec3 glassCol = interior * material.fGlass.rgb * (1.0 - reflectK * 0.55);
    // 窓の上と脇にできる、壁の厚みの影
    float recess = smoothstep(0.0, 0.14, dWin + (1.0 - wy) * 0.1);
    glassCol *= mix(0.55, 1.0, recess);

    // バルコニーの奥に引っ込んだ窓は軒の影で暗い
    glassCol *= 1.0 - material.fExtra.y * 0.6;
    frameAmt = max(frameAmt, sqFrame);
    float glassAmt = max(win * (1.0 - frameAmt), sqWin * (1.0 - sqFrame));
    col = mix(col, material.fFrame.rgb, frameAmt);
    albedo = mix(col, glassCol, glassAmt);
    roughness = mix(material.fAccent.a, 0.07, glassAmt);
    roughness = mix(roughness, 0.42, frameAmt);
    metallic = 0.0;
    fresnelF0 = mix(vec3(0.04), vec3(0.04 + 0.22 * reflectK), glassAmt * (1.0 - material.fExtra.y * 0.5));

    // ガラス 1 枚ごとのわずかな傾きで、映り込みに揺らぎを出す
    float pane = cwHash(vec2(bIdx * 3.1 + seed * 13.0, fIdx * 7.7 + floor(wx * mCount)));
    normal = normalize(normal + (tng * (pane - 0.5) + vec3(0.0, fract(pane * 9.3) - 0.5, 0.0)) * 0.05 * glassAmt);
    specularNormal = normal;

    emissive += interior * vec3(1.0, 0.9, 0.72) * lit * glassAmt * (1.0 - blind * 0.5) * 1.25;
  }
`,
    },
  },
};

export function createFacadeMaterial(style: FacadeStyle): Material3D {
  const material = new Material3D({
    baseColor: 0xffffff,
    roughness: style.roughness,
    metallic: 0,
    vertexColors: true,
    extraBits: [facadeBit],
  });
  const data = material.data as Record<string, unknown>;
  data.fDims = [style.floorH, style.bayW, style.groundH, style.parapet];
  data.fWin = [style.winW, style.winH, style.sill, style.frameT];
  data.fDetail = [style.mullions, style.transom, style.pilaster, style.band];
  data.fTile = [style.tile[0], style.tile[1], style.tileStrength, style.tileBond ? 1 : 0];
  data.fRoom = [style.roomBays, style.roomDepth, 0.3, 0];
  data.fFrame = [...linearRgb(style.frame), 1];
  data.fGlass = [...linearRgb(style.glass), style.reflect];
  data.fAccent = [...linearRgb(style.accent), style.roughness];
  data.fExtra = [style.louver, style.recess, style.round ? 1 : 0, 0];
  return material;
}

/** 夜の度合い (0 = 昼, 1 = 夜) を外壁マテリアルに伝える */
export function setFacadeNight(material: Material3D, night: number, litRatio: number): void {
  const data = material.data as Record<string, unknown>;
  const room = data.fRoom as number[];
  data.fRoom = [room[0], room[1], litRatio, night];
}
