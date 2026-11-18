import { pointInPolygon, signedDistanceToPolygon } from './heightfield';
import type { Player } from './player';
import type { CampusJson, Landmark } from './types';

export interface TravelDestination {
  name: string;
  x: number;
  z: number;
  yaw: number;
}

const WALKABLE_ROADS = new Set(['footway', 'pedestrian', 'path', 'service']);
const ARRIVAL_DISTANCE = 8;
const MAX_DISTANCE = 60;

/** 棟のそばにある、屋外の歩道・構内道路を到着地点にする。 */
export function findTravelDestinations(json: CampusJson, landmarks: Landmark[], player: Player): TravelDestination[] {
  const sites: { x: number; z: number }[] = [];
  for (const road of json.roads) {
    if (road.br || road.tn || road.pv || !WALKABLE_ROADS.has(road.k)) continue;
    const p = road.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i];
      const dz = p[i + 3] - p[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 3));
      for (let step = 0; step <= steps; step++) {
        sites.push({ x: p[i] + (dx * step) / steps, z: p[i + 1] + (dz * step) / steps });
      }
    }
  }

  const obstacles = [...json.buildings.map((b) => b.r), ...json.areas.filter((a) => a.k === 'water').map((a) => a.r)];
  const destinations = new Map<string, TravelDestination>();
  for (const landmark of landmarks) {
    if (destinations.has(landmark.name)) continue;
    const candidates = [];
    for (const site of sites) {
      const distance = signedDistanceToPolygon(site.x, site.z, landmark.ring);
      if (distance >= 3 && distance <= MAX_DISTANCE) candidates.push({ site, score: Math.abs(distance - ARRIVAL_DISTANCE) });
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const {
      site: { x, z },
    } of candidates) {
      if (!player.canStandAt(x, z) || obstacles.some((ring) => pointInPolygon(x, z, ring))) continue;
      const yaw = (Math.atan2(x - landmark.x, z - landmark.z) * 180) / Math.PI;
      destinations.set(landmark.name, { name: landmark.name, x, z, yaw });
      break;
    }
  }
  return [...destinations.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
}
