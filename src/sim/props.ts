import { Container3D } from '@pixi/3d';
import type { CollisionWorld } from './collision';
import type { Decks } from './decks';
import type { Heightfield } from './heightfield';
import type { CampusData } from './types';

export function buildProps(_data: CampusData, _hf: Heightfield, _collision: CollisionWorld, _decks: Decks): Container3D {
  return new Container3D({ label: 'props' });
}
