import type { CampusJson } from './types';

/** 地形メッシュの格子間隔 (m) */
export const FINE_STEP = 2;

/**
 * 地形の高さ。DEM (4 m 間隔) を Catmull-Rom で 2 m 間隔に細かくし、
 * 描画するメッシュの三角形とまったく同じ面で高さを返す (足が浮いたり沈んだりしないように)。
 */
export class Heightfield {
  readonly x0: number;
  readonly z0: number;
  readonly width: number;
  readonly depth: number;
  readonly nx: number;
  readonly nz: number;
  readonly step = FINE_STEP;
  readonly heights: Float32Array;
  /** トンネルを掘る前の地表。トンネルの上の「ふた」として描画・歩行に使う */
  surface: Float32Array | null = null;
  /** ふたをかぶせるセル ((nx-1) × (nz-1)) */
  capCells: Uint8Array | null = null;

  private readonly src: Float32Array;
  private readonly srcNx: number;
  private readonly srcNz: number;
  private readonly srcStep: number;

  constructor(raw: Uint16Array, info: CampusJson['terrain']) {
    this.srcNx = info.nx;
    this.srcNz = info.nz;
    this.srcStep = info.step;
    this.src = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.src[i] = info.hMin + raw[i] * info.unit;

    this.x0 = info.x0;
    this.z0 = info.z0;
    this.width = (info.nx - 1) * info.step;
    this.depth = (info.nz - 1) * info.step;
    this.nx = Math.round(this.width / FINE_STEP) + 1;
    this.nz = Math.round(this.depth / FINE_STEP) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.heights[j * this.nx + i] = this.smooth(this.x0 + i * FINE_STEP, this.z0 + j * FINE_STEP);
      }
    }
  }

  private srcAt(i: number, j: number): number {
    const ci = i < 0 ? 0 : i >= this.srcNx ? this.srcNx - 1 : i;
    const cj = j < 0 ? 0 : j >= this.srcNz ? this.srcNz - 1 : j;
    return this.src[cj * this.srcNx + ci];
  }

  /** 元の DEM を Catmull-Rom 補間した滑らかな高さ */
  private smooth(x: number, z: number): number {
    const fx = (x - this.x0) / this.srcStep;
    const fz = (z - this.z0) / this.srcStep;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const w = (t: number): [number, number, number, number] => {
      const t2 = t * t;
      const t3 = t2 * t;
      return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
    };
    const wx = w(tx);
    const wz = w(tz);
    let h = 0;
    for (let b = 0; b < 4; b++) {
      let row = 0;
      for (let a = 0; a < 4; a++) row += this.srcAt(i - 1 + a, j - 1 + b) * wx[a];
      h += row * wz[b];
    }
    return h;
  }

  contains(x: number, z: number): boolean {
    return x >= this.x0 && x <= this.x0 + this.width && z >= this.z0 && z <= this.z0 + this.depth;
  }

  /** 格子の高さ配列を、メッシュの三角形と同じ面で補間する */
  private sample(heights: Float32Array, x: number, z: number): number {
    let fx = (x - this.x0) / FINE_STEP;
    let fz = (z - this.z0) / FINE_STEP;
    if (fx < 0) fx = 0;
    else if (fx > this.nx - 1.0001) fx = this.nx - 1.0001;
    if (fz < 0) fz = 0;
    else if (fz > this.nz - 1.0001) fz = this.nz - 1.0001;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const o = j * this.nx + i;
    const h00 = heights[o];
    const h10 = heights[o + 1];
    const h01 = heights[o + this.nx];
    const h11 = heights[o + this.nx + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** 地面の高さ (ワールド Y)。トンネルの中では掘り込んだ底の高さになる */
  heightAt(x: number, z: number): number {
    return this.sample(this.heights, x, z);
  }

  /** トンネルの上にかぶせた地表の高さ。ふたの無い場所では -Infinity */
  capHeightAt(x: number, z: number): number {
    if (!this.surface || !this.capCells) return -Infinity;
    const i = Math.floor((x - this.x0) / FINE_STEP);
    const j = Math.floor((z - this.z0) / FINE_STEP);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return -Infinity;
    if (!this.capCells[j * (this.nx - 1) + i]) return -Infinity;
    return this.sample(this.surface, x, z);
  }

  /** トンネルを掘る前の地表の高さ */
  uncarvedAt(x: number, z: number): number {
    return this.sample(this.surface ?? this.heights, x, z);
  }

  /** 見えている地表の高さ (木や小物を置く高さ)。トンネルの上ではふたの高さ */
  surfaceAt(x: number, z: number): number {
    return Math.max(this.sample(this.heights, x, z), this.capHeightAt(x, z));
  }

  /** 地面の法線 (正規化済み) を out に書き込む */
  normalAt(x: number, z: number, out: [number, number, number]): [number, number, number] {
    const e = FINE_STEP;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx / (2 * e);
    const nz = -dz / (2 * e);
    const len = Math.hypot(nx, 1, nz);
    out[0] = nx / len;
    out[1] = 1 / len;
    out[2] = nz / len;
    return out;
  }

  /** ふた (トンネルの上の地表) の法線 */
  capNormalAt(x: number, z: number, out: [number, number, number]): [number, number, number] {
    const surface = this.surface ?? this.heights;
    const e = FINE_STEP;
    const nx = -(this.sample(surface, x + e, z) - this.sample(surface, x - e, z)) / (2 * e);
    const nz = -(this.sample(surface, x, z + e) - this.sample(surface, x, z - e)) / (2 * e);
    const len = Math.hypot(nx, 1, nz);
    out[0] = nx / len;
    out[1] = 1 / len;
    out[2] = nz / len;
    return out;
  }

  /** 多角形の外周・内部を通して最低/最高の地面を調べる */
  rangeAlong(points: number[]): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const h = this.heightAt(points[i], points[i + 1]);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return [lo, hi];
  }

  /**
   * 線分 a → b に沿った帯を、a から b へ直線的に変わる高さに整える (通路・階段・トンネルの掘り込み)。
   *   mode 'set'   : その高さにそろえる (盛る・削る)
   *   mode 'lower' : その高さより高いところだけ削る
   *   cap          : 削る前の地表を保存し、その上を「ふた」で覆う (トンネル)。帯の両端は垂直に切る
   */
  shapeCorridor(o: CorridorShape): void {
    const dx = o.bx - o.ax;
    const dz = o.bz - o.az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const ux = dx / len;
    const uz = dz / len;
    const reach = o.halfWidth + o.feather;
    const i0 = Math.max(0, Math.floor((Math.min(o.ax, o.bx) - reach - this.x0) / FINE_STEP));
    const i1 = Math.min(this.nx - 1, Math.ceil((Math.max(o.ax, o.bx) + reach - this.x0) / FINE_STEP));
    const j0 = Math.max(0, Math.floor((Math.min(o.az, o.bz) - reach - this.z0) / FINE_STEP));
    const j1 = Math.min(this.nz - 1, Math.ceil((Math.max(o.az, o.bz) + reach - this.z0) / FINE_STEP));
    if (o.cap && !this.surface) {
      this.surface = Float32Array.from(this.heights);
      this.capCells = new Uint8Array((this.nx - 1) * (this.nz - 1));
    }
    const touched = o.cap ? new Uint8Array(this.nx * this.nz) : null;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = this.x0 + i * FINE_STEP - o.ax;
        const pz = this.z0 + j * FINE_STEP - o.az;
        const along = px * ux + pz * uz;
        const side = Math.abs(-px * uz + pz * ux);
        let dist = side;
        if (o.cap || o.flatEnds) {
          if (along < 0 || along > len) continue;
        } else if (along < 0) dist = Math.hypot(px, pz);
        else if (along > len) dist = Math.hypot(px - dx, pz - dz);
        if (dist > reach) continue;
        const t = Math.min(1, Math.max(0, along / len));
        const target = o.ay + (o.by - o.ay) * t;
        const edge = dist <= o.halfWidth ? 1 : 1 - (dist - o.halfWidth) / o.feather;
        const k = edge * edge * (3 - 2 * edge);
        const idx = j * this.nx + i;
        const before = this.heights[idx];
        if (o.mode === 'lower' && before <= target) continue;
        this.heights[idx] = before * (1 - k) + target * k;
        if (touched) touched[idx] = 1;
        // トンネルの真上の地表は、天井より下がらないように持ち上げておく
        if (o.cap && this.surface && o.capMin !== undefined && side <= (o.capMinHalfWidth ?? 0)) {
          this.surface[idx] = Math.max(this.surface[idx], o.capMin);
        }
      }
    }
    if (!touched || !this.capCells) return;
    // 4 隅とも帯の内側 (両端の間) にあり、どれかが削られたセルにふたをかぶせる
    const inside = (i: number, j: number): boolean => {
      const along = (this.x0 + i * FINE_STEP - o.ax) * ux + (this.z0 + j * FINE_STEP - o.az) * uz;
      return along >= 0 && along <= len;
    };
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const a = j * this.nx + i;
        if (!(touched[a] || touched[a + 1] || touched[a + this.nx] || touched[a + this.nx + 1])) continue;
        if (!(inside(i, j) && inside(i + 1, j) && inside(i, j + 1) && inside(i + 1, j + 1))) continue;
        this.capCells[j * (this.nx - 1) + i] = 1;
      }
    }
  }

  /** 円形の範囲を高さ y にならす (建物の敷地やコートを平らにするため) */
  flatten(points: number[], y: number, feather = 3): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minZ = Math.min(minZ, points[i + 1]);
      maxZ = Math.max(maxZ, points[i + 1]);
    }
    const i0 = Math.max(0, Math.floor((minX - feather - this.x0) / FINE_STEP));
    const i1 = Math.min(this.nx - 1, Math.ceil((maxX + feather - this.x0) / FINE_STEP));
    const j0 = Math.max(0, Math.floor((minZ - feather - this.z0) / FINE_STEP));
    const j1 = Math.min(this.nz - 1, Math.ceil((maxZ + feather - this.z0) / FINE_STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * FINE_STEP;
        const z = this.z0 + j * FINE_STEP;
        const d = signedDistanceToPolygon(x, z, points);
        if (d > feather) continue;
        const t = d <= 0 ? 1 : 1 - d / feather;
        const k = t * t * (3 - 2 * t);
        const o = j * this.nx + i;
        this.heights[o] = this.heights[o] * (1 - k) + y * k;
      }
    }
  }
}

export interface CorridorShape {
  ax: number;
  az: number;
  /** a 側の高さ */
  ay: number;
  bx: number;
  bz: number;
  /** b 側の高さ */
  by: number;
  /** この幅までは目標の高さにそろえる */
  halfWidth: number;
  /** その外側で元の地形になじませる幅 */
  feather: number;
  mode: 'set' | 'lower';
  /** 帯の両端を丸めず、垂直に切る */
  flatEnds?: boolean;
  cap?: boolean;
  /** ふたの高さの下限 (トンネルの天井より上に保つ) */
  capMin?: number;
  capMinHalfWidth?: number;
}

/** 点と多角形 [x, z, ...] の符号付き距離 (内側が負) */
export function signedDistanceToPolygon(x: number, z: number, pts: number[]): number {
  let inside = false;
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2];
    const zi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const zj = pts[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi;
    const dz = zj - zi;
    const l2 = dx * dx + dz * dz;
    let t = l2 === 0 ? 0 : ((x - xi) * dx + (z - zi) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (xi + t * dx), z - (zi + t * dz));
    if (d < best) best = d;
  }
  return inside ? -best : best;
}

export function pointInPolygon(x: number, z: number, pts: number[]): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2];
    const zi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const zj = pts[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
