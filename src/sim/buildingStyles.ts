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
  [/^R3低層棟$/, 'r3Low'],
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

/**
 * 大学のアクセシビリティマップ (各地区の「建物情報」) に載っている、地上の階数と主な施設。
 * 外壁の窓の段数と、現在地の表示に使う。先に書いたものが優先される。
 */
const CAMPUS_INFO: [RegExp, number, string?][] = [
  [/^J2・J3/, 20],
  [/^J1/, 9, '学生支援課 / 教務課'],
  [/^H1/, 3, 'カフェテリア (生協食堂) / レストラン / 多目的ホール'],
  [/^H2/, 3, '生協購買 / 学生相談室'],
  [/^G1/, 10],
  [/^G2/, 11],
  [/^G3/, 11, '保健管理センター / トレーニングルーム'],
  [/^G4-A/, 2],
  [/^G4/, 2, '卓球室'],
  [/^G5/, 9, '遺失物センター'],
  [/^B1・B2-A/, 5],
  [/^B1・B2-B/, 3],
  [/^B1・B2-C/, 4],
  // B1 棟 (9 階) と B2 棟 (11 階) は各階でつながった 1 つの外形になっている
  [/^B[12]/, 11, 'ものつくりセンター'],
  [/^R1-A/, 3],
  [/^R1-B/, 1],
  [/^R1/, 9],
  [/^R2-/, 2],
  [/^R2/, 9],
  [/^R3-[AB]/, 1],
  [/^R3-C/, 2],
  [/^R3-D/, 3],
  [/^R3低層棟$/, 1],
  [/^R3/, 6],
  [/^S1/, 4],
  [/^S2/, 7],
  [/^S3/, 3, '図書館'],
  [/^S[4567]/, 2],
  [/^S8/, 5, 'レクチャーホール'],
];

function campusInfo(name: string | undefined): [RegExp, number, string?] | undefined {
  return name ? CAMPUS_INFO.find(([pattern]) => pattern.test(name)) : undefined;
}

/** その棟 (の、高さ height の部分) の地上階数。資料に無ければ undefined */
export function officialFloors(b: BuildingData, height: number): number | undefined {
  if (!b.c) return undefined;
  const info = campusInfo(b.n);
  if (!info) return undefined;
  // 同じ棟名で登録されている低い付属部分は、棟全体の階数ではなく高さから決める
  return height / info[1] < 2.9 ? Math.max(1, Math.round(height / 4)) : info[1];
}

/** 現在地の表示に添える説明 (階数と主な施設) */
export function campusNote(name: string): string {
  const info = campusInfo(name);
  if (!info) return '';
  return info[2] ? `地上 ${info[1]} 階 ・ ${info[2]}` : `地上 ${info[1]} 階`;
}

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
