/**
 * 国道246号をくぐった先、構内広場に出る手前の直線歩道 (幅4.5 m)。
 * 中心線の両端は campus.json の pedestrian の頂点。小物の位置は公式案内の
 * 「すずかけ門」写真7と地理院の空中写真からの概算。right は入構方向の右。
 */
const start = { x: -136.64, z: -107.78 };
const dx = -107.67 - start.x;
const dz = -103.87 - start.z;
export const approachLength = Math.hypot(dx, dz);

export function approachPoint(along: number, right: number): [number, number] {
  return [start.x + (dx * along - dz * right) / approachLength, start.z + (dz * along + dx * right) / approachLength];
}
