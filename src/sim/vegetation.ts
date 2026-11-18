import { Container3D } from '@pixi/3d';
import type { CollisionWorld } from './collision';
import type { Heightfield } from './heightfield';
import type { CampusData } from './types';

export function buildVegetation(_data: CampusData, _hf: Heightfield, _collision: CollisionWorld): Container3D {
  return new Container3D({ label: 'vegetation' });
}
