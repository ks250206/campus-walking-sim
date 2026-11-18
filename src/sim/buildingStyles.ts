import type { FacadeStyleId } from './facade';
import type { BuildingData } from './types';

/**
 * キャンパス内の棟ごとの外観。棟名 (OSM) で引く。
 * 大学の公開資料・写真から読み取れた特徴 (外壁の色、窓の形、バルコニーの有無など) をもとにしている。
 */
const CAMPUS_STYLES: [RegExp, FacadeStyleId][] = [
  [/^J2・J3/, 'j2j3'],
  [/^J1/, 'slabJ1'],
  [/^H1/, 'h1'],
  [/^H2/, 'h2'],
  [/^G1/, 'slabG1'],
  [/^G2/, 'slabG2'],
  [/^G3/, 'g3'],
  [/^G5/, 'g5'],
  [/^G4-A/, 'whiteBox'],
  [/^G4/, 'concrete'],
  [/^B1・B2-A/, 'greyTile'],
  [/^B1・B2-[BC]/, 'greyTile'],
  [/^B[12]/, 'slabB'],
  [/^R3-/, 'concrete'],
  [/^R3/, 'slabR3'],
  [/^R[12]高層/, 'slabR'],
  [/^R[12]-/, 'concrete'],
  [/^S1/, 's1'],
  [/^S2/, 's2'],
  [/^S3/, 's3'],
  [/^S8/, 's8'],
  [/^S6/, 'concrete'],
  [/^S[457]/, 'whiteBox'],
  [/守衛所/, 'hut'],
];

/** 屋上がミントグリーンの防水塗装になっている棟 (航空写真で確認できる) */
const MINT_ROOF = /^(R1-|R2-|R3|S4|S5|S6|H2|B1・B2-)/;
export const MINT_ROOF_COLOR = 0x8fd9c6;

export function hasMintRoof(b: BuildingData): boolean {
  return Boolean(b.c && b.n && MINT_ROOF.test(b.n));
}

export function buildingStyleFor(b: BuildingData, area: number, height: number): FacadeStyleId {
  if (b.c) {
    const name = b.n ?? '';
    for (const [pattern, style] of CAMPUS_STYLES) {
      if (!pattern.test(name)) continue;
      // 高層棟に付属する低い部分 (同じ名前で登録されている) は、低層棟の外観にする
      if (style.startsWith('slab') && height < 14) return 'concrete';
      return style;
    }
    if (area < 90 || height < 4.2) return 'hut';
    if (height > 24) return 'slabR';
    if (height < 9.5 && area < 600) return 'concrete';
    return 'lab';
  }
  if (b.u === 'train_station') return 'commercial';
  if (b.u === 'roof') return 'warehouse';
  if (b.u === 'apartments' || (height >= 10.5 && area > 140)) return 'apartment';
  if (area > 650 && height < 15) return 'warehouse';
  if (area > 260 || height >= 10.5) return 'commercial';
  return 'house';
}
