/**
 * 歩行者の当たり判定 (平面上の円 vs 壁の線分・柱の円)。
 * 一様グリッドに登録しておき、近くのものだけ調べる。
 */
export class CollisionWorld {
  private readonly cell = 8;
  private readonly segs: number[] = []; // ax, az, bx, bz, 上端の高さ
  private readonly circles: number[] = []; // x, z, r, 上端の高さ
  private readonly segGrid = new Map<number, number[]>();
  private readonly circleGrid = new Map<number, number[]>();

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  /** 壁の線分。top より高い位置 (橋の上など) にいるときは無視される */
  addSegment(ax: number, az: number, bx: number, bz: number, top = Infinity): void {
    const id = this.segs.length / 5;
    this.segs.push(ax, az, bx, bz, top);
    const i0 = Math.floor(Math.min(ax, bx) / this.cell);
    const i1 = Math.floor(Math.max(ax, bx) / this.cell);
    const j0 = Math.floor(Math.min(az, bz) / this.cell);
    const j1 = Math.floor(Math.max(az, bz) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.segGrid.get(k);
        if (!list) this.segGrid.set(k, (list = []));
        list.push(id);
      }
    }
  }

  addRing(points: number[], top = Infinity): void {
    const n = points.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.addSegment(points[i * 2], points[i * 2 + 1], points[j * 2], points[j * 2 + 1], top);
    }
  }

  addPolyline(points: number[], top = Infinity): void {
    for (let i = 0; i + 3 < points.length; i += 2) this.addSegment(points[i], points[i + 1], points[i + 2], points[i + 3], top);
  }

  addCircle(x: number, z: number, r: number, top = Infinity): void {
    const id = this.circles.length / 4;
    this.circles.push(x, z, r, top);
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let list = this.circleGrid.get(k);
    if (!list) this.circleGrid.set(k, (list = []));
    list.push(id);
  }

  /**
   * 半径 r の円を (x, z) に置いたときの押し戻し後の位置を out に返す。
   * feetY は足元の高さ。それより低い障害物は乗り越えられるものとして無視する。
   */
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const i0 = Math.floor((x - r) / this.cell);
      const i1 = Math.floor((x + r) / this.cell);
      const j0 = Math.floor((z - r) / this.cell);
      const j1 = Math.floor((z + r) / this.cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = this.key(i, j);
          const segList = this.segGrid.get(k);
          if (segList) {
            for (const id of segList) {
              const o = id * 5;
              if (feetY >= this.segs[o + 4] - 0.05) continue;
              const ax = this.segs[o];
              const az = this.segs[o + 1];
              const dx = this.segs[o + 2] - ax;
              const dz = this.segs[o + 3] - az;
              const l2 = dx * dx + dz * dz;
              let t = l2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / l2;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const px = x - (ax + dx * t);
              const pz = z - (az + dz * t);
              const d2 = px * px + pz * pz;
              if (d2 >= r * r) continue;
              const d = Math.sqrt(d2);
              if (d > 1e-5) {
                x += (px / d) * (r - d);
                z += (pz / d) * (r - d);
              } else {
                // 線の真上: 線に垂直な向きへ逃がす
                const len = Math.sqrt(l2) || 1;
                x += (-dz / len) * r;
                z += (dx / len) * r;
              }
              moved = true;
              hit = true;
            }
          }
          const circleList = this.circleGrid.get(k);
          if (circleList) {
            for (const id of circleList) {
              const o = id * 4;
              if (feetY >= this.circles[o + 3] - 0.05) continue;
              const px = x - this.circles[o];
              const pz = z - this.circles[o + 1];
              const rr = r + this.circles[o + 2];
              const d2 = px * px + pz * pz;
              if (d2 >= rr * rr) continue;
              const d = Math.sqrt(d2) || 1e-4;
              x += (px / d) * (rr - d);
              z += (pz / d) * (rr - d);
              moved = true;
              hit = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    out.x = x;
    out.z = z;
    return hit;
  }
}
