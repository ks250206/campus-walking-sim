import type { CampusExtras } from './extras';
import type { Heightfield } from './heightfield';
import type { CampusJson, Vec2 } from './types';

// J2・J3棟2階の玄関1。PLATEAUの北東面の折れ点から、二棟の間のガラス面を割り出す。
// out は玄関から屋外、right は坂を上って玄関を見る人の右。
const corner: Vec2 = [5.21, 161.85];
export const doorNormal: Vec2 = [0.765, -0.644];
const glassHalf = 4.8;
export function entrancePoint(out: number, right: number): Vec2 {
  const [nx, nz] = doorNormal;
  return [corner[0] + nx * out + nz * (right + glassHalf), corner[1] + nz * out - nx * (right + glassHalf)];
}
export const glassMidpoint = entrancePoint(-2.4, 0);

// 航空写真の芝地の林側の縁。坂は建物の正面に対して少し斜めに取り付く。
const threshold = entrancePoint(1.8, 0);
export const rampOut: Vec2 = [0.536, -0.844];
export function rampPoint(distance: number, right = 0): Vec2 {
  const [dx, dz] = rampOut;
  return [threshold[0] + dx * distance + dz * right, threshold[1] + dz * distance - dx * right];
}
export const forkDistance = 14.8;

// G2棟の公式経路写真2・3と航空写真から推定した、坑口手前までの林道。
export const woodlandPath: Vec2[] = [
  rampPoint(forkDistance),
  [15, 146.7],
  [18.2, 147.3],
  [21.5, 146.4],
  [26, 143.2],
  [31, 139.5],
  [35.4, 137.9],
  [39.3, 138.1],
  [44, 139.85],
];

export function addJ23Approach(json: CampusJson, hf: Heightfield, portal: { x: number; z: number; y: number }): CampusExtras['clearings'] {
  const tower = json.buildings.find((b) => b.n === 'J2・J3高層棟');
  if (!tower) return [];
  // 一体の外形から、玄関上部の奥まったガラス面と右の塔の妻面を分ける。
  const i = tower.r.findIndex((x, i, r) => i % 2 === 0 && Math.hypot(x - corner[0], r[i + 1] - corner[1]) < 0.1);
  if (i >= 0) tower.r.splice(i, 2, ...entrancePoint(-2.4, -glassHalf), ...entrancePoint(-2.4, glassHalf), ...entrancePoint(0, glassHalf));

  const fork = rampPoint(forkDistance);
  const approach: Vec2[] = [[20.18, 96.3], [24, 95.9], [28.6, 99.7], [31.2, 105], [31.6, 109.8], [30.5, 114.5], rampPoint(43), fork];
  const clearings: CampusExtras['clearings'] = [];
  const path = (points: Vec2[], width: number, startY: number, endY: number, name: string): void => {
    const distances = [0];
    for (let i = 1; i < points.length; i++)
      distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const grade = (endY - startY) / distances[distances.length - 1];
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      hf.shapeCorridor({
        ax,
        az,
        bx,
        bz,
        ay: startY + grade * distances[i - 1],
        by: startY + grade * distances[i],
        halfWidth: width / 2 + 0.8,
        feather: 3.5,
        mode: 'set',
      });
    }
    const p = points.flat();
    json.roads.push({ k: 'footway', w: width, p, sf: 'asphalt', c: 1, n: name, noLamps: true });
    clearings.push({ p, radius: width / 2 + 1.6 });
  };
  const floor = tower.b + 5.2;
  const forkY = floor - 1.15;
  path(approach, 3.5, hf.heightAt(...approach[0]), forkY, 'J2・J3棟への坂');
  path([fork, rampPoint(3), threshold], 3.5, forkY, floor, 'J2・J3棟 2階玄関1');
  path([...woodlandPath, [portal.x, portal.z]], 2.15, forkY, portal.y, 'G地区への小径');

  const apron = [
    entrancePoint(-2.5, -4.8),
    entrancePoint(-2.5, 4.8),
    entrancePoint(3.8, 4.8),
    rampPoint(4, 2.3),
    rampPoint(4, -2),
    entrancePoint(3.8, -4.8),
  ].flat();
  hf.flatten(apron, floor, 2);
  json.areas.push({ k: 'plaza', r: apron, noLamps: true });
  // 縁の明るい舗装帯。外側には手すりと段状の腰掛けが並ぶ。
  json.areas.push({ k: 'plaza', r: [rampPoint(3, 1), rampPoint(3, 2.4), rampPoint(32, 2.4), rampPoint(32, 1)].flat() });
  // 写真にある林縁。分岐の口を空け、樹冠は小径の両側からかかる。
  const trees = [
    [18, 141, 6.5, 0],
    [15, 150.3, 2.3, 2],
    [21, 151, 7, 0],
    [22, 142.4, 2.6, 2],
    [26, 148.6, 4.3, 2],
    [30, 135, 7.6, 0],
    [34, 142.8, 2.7, 2],
    [37.5, 133.8, 5.8, 0],
    [40, 142.6, 2.4, 2],
    [...rampPoint(9, -5.6), 3.7, 2],
    [...rampPoint(23, -6.8), 7.2, 0],
    [...rampPoint(36, -4.8), 6, 0],
  ];
  json.trees.push(...trees.flat());
  return clearings;
}
