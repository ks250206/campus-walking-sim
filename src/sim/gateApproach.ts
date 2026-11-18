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

// 写真6の門前。すずかけ門の歩道端を原点に、最初の曲がりの先へ向ける。
const gateX = -220.33;
const gateZ = -146.95;
const length = Math.hypot(-198.84 - gateX, -133.11 - gateZ);
export const gateForward = { x: (-198.84 - gateX) / length, z: (-133.11 - gateZ) / length };

export function gatePoint(along: number, right: number): [number, number] {
  return [gateX + gateForward.x * along - gateForward.z * right, gateZ + gateForward.z * along + gateForward.x * right];
}

// 地理院の空中写真とR3-A・B棟、既存の歩道を照合した岡部野営場の生け垣中心線。
// 門から来ると歩道右側を進み、広場との境で折れて芝地の短辺を囲む。
export const okabeHedge = [
  approachPoint(0.6, 3.17),
  approachPoint(approachLength, 3.17),
  [-96.1, -98.4],
  [-79.4, -91.9],
  [-101.4, -53.7],
] as const;
