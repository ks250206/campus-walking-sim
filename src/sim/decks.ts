import type { Heightfield } from './heightfield';
import type { WalkSurface } from './player';
import type { CampusJson } from './types';

/** 橋など、地形より上にある歩ける床 */
export class Decks implements WalkSurface {
  constructor(_json: CampusJson, _hf: Heightfield) {}

  deckAt(_x: number, _z: number): number {
    return -Infinity;
  }
}
