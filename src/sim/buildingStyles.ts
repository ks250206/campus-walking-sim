import type { FacadeStyleId } from './facade';
import type { BuildingData } from './types';

/**
 * キャンパス内の棟ごとの外観。棟名 (OSM) の前方一致で引く。
 * 公開されている写真・資料から読み取れた特徴をもとにしている。
 */
const CAMPUS_STYLES: [RegExp, FacadeStyleId][] = [
  [/^J2・J3/, 'curtain'],
  [/^H1/, 'hall'],
  [/^H2/, 'hall'],
  [/守衛所/, 'hut'],
];

export function buildingStyleFor(b: BuildingData, area: number, height: number): FacadeStyleId {
  if (b.c) {
    const name = b.n ?? '';
    for (const [pattern, style] of CAMPUS_STYLES) if (pattern.test(name)) return style;
    if (area < 90 || height < 4.2) return 'hut';
    if (height > 24) return 'tower';
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
