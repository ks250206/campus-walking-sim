import { Box, Geometry3D, Vector3 } from '@pixi/3d';

export interface MeshBuilderOptions {
  uvs?: boolean;
  colors?: boolean;
  /** シェーダ用の追加データ (aColor1) を持たせる */
  data?: boolean;
}

/**
 * 頂点を貯めて Geometry3D を作る小さなヘルパー。
 * 表面は「法線の側から見て反時計回り」。
 */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private data: number[] = [];
  private indices: number[] = [];
  private count = 0;
  private readonly hasUvs: boolean;
  private readonly hasColors: boolean;
  private readonly hasData: boolean;

  // 現在の頂点に付ける色と追加データ
  r = 1;
  g = 1;
  b = 1;
  a = 1;
  d0 = 0;
  d1 = 0;
  d2 = 0;
  d3 = 0;

  constructor(options: MeshBuilderOptions = {}) {
    this.hasUvs = options.uvs ?? true;
    this.hasColors = options.colors ?? false;
    this.hasData = options.data ?? false;
  }

  get vertexCount(): number {
    return this.count;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /** 線形 RGB で色を指定する */
  color(r: number, g: number, b: number, a = 1): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  setData(d0: number, d1 = 0, d2 = 0, d3 = 0): this {
    this.d0 = d0;
    this.d1 = d1;
    this.d2 = d2;
    this.d3 = d3;
    return this;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    if (this.hasUvs) this.uvs.push(u, v);
    if (this.hasColors) this.colors.push(this.r, this.g, this.b, this.a);
    if (this.hasData) this.data.push(this.d0, this.d1, this.d2, this.d3);
    return this.count++;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** a → b → c → d が反時計回りの四角形 */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /**
   * 4 点から四角形を作る (法線は自動計算)。p0 → p1 → p2 → p3 が表から見て反時計回り。
   * uv は (u0, v0) – (u1, v1) を p0 = 左下、p2 = 右上として割り当てる。
   */
  quadPoints(
    p0: readonly number[],
    p1: readonly number[],
    p2: readonly number[],
    p3: readonly number[],
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const az = p1[2] - p0[2];
    const bx = p3[0] - p0[0];
    const by = p3[1] - p0[1];
    const bz = p3[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const a = this.vertex(p0[0], p0[1], p0[2], nx, ny, nz, u0, v0);
    const b = this.vertex(p1[0], p1[1], p1[2], nx, ny, nz, u1, v0);
    const c = this.vertex(p2[0], p2[1], p2[2], nx, ny, nz, u1, v1);
    const d = this.vertex(p3[0], p3[1], p3[2], nx, ny, nz, u0, v1);
    this.quad(a, b, c, d);
  }

  /**
   * 軸に沿った直方体。中心 (cx, cz) の底面を y0 に置き、Y 軸まわりに rot (rad) 回転する。
   */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, rot = 0, top = true, bottom = false): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const hx = sx / 2;
    const hz = sz / 2;
    const corner = (lx: number, lz: number, y: number): number[] => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const y1 = y0 + sy;
    const a0 = corner(-hx, hz, y0);
    const b0 = corner(hx, hz, y0);
    const c0 = corner(hx, -hz, y0);
    const d0 = corner(-hx, -hz, y0);
    const a1 = corner(-hx, hz, y1);
    const b1 = corner(hx, hz, y1);
    const c1 = corner(hx, -hz, y1);
    const d1 = corner(-hx, -hz, y1);
    this.quadPoints(a0, b0, b1, a1, 0, 0, sx, sy); // +Z 側
    this.quadPoints(b0, c0, c1, b1, 0, 0, sz, sy); // +X 側
    this.quadPoints(c0, d0, d1, c1, 0, 0, sx, sy); // -Z 側
    this.quadPoints(d0, a0, a1, d1, 0, 0, sz, sy); // -X 側
    if (top) this.quadPoints(a1, b1, c1, d1, 0, 0, sx, sz);
    if (bottom) this.quadPoints(d0, c0, b0, a0, 0, 0, sx, sz);
  }

  /** Y 軸に沿った円柱 (側面のみ、またはふた付き) */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, height: number, segments = 8, cap = false): void {
    const y1 = y0 + height;
    const slope = (r0 - r1) / height;
    const base = this.count;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const nx = Math.sin(t);
      const nz = Math.cos(t);
      const nl = Math.hypot(1, slope);
      this.vertex(cx + nx * r0, y0, cz + nz * r0, nx / nl, slope / nl, nz / nl, i / segments, 0);
      this.vertex(cx + nx * r1, y1, cz + nz * r1, nx / nl, slope / nl, nz / nl, i / segments, 1);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      this.quad(a, a + 2, a + 3, a + 1);
    }
    if (cap && r1 > 0) {
      const center = this.vertex(cx, y1, cz, 0, 1, 0, 0.5, 0.5);
      const ring = this.count;
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        this.vertex(cx + Math.sin(t) * r1, y1, cz + Math.cos(t) * r1, 0, 1, 0, 0.5, 0.5);
      }
      for (let i = 0; i < segments; i++) this.tri(center, ring + i, ring + i + 1);
    }
  }

  build(): Geometry3D | null {
    if (this.count === 0 || this.indices.length === 0) return null;
    const positions = new Float32Array(this.positions);
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i] < min.x) min.x = positions[i];
      if (positions[i] > max.x) max.x = positions[i];
      if (positions[i + 1] < min.y) min.y = positions[i + 1];
      if (positions[i + 1] > max.y) max.y = positions[i + 1];
      if (positions[i + 2] < min.z) min.z = positions[i + 2];
      if (positions[i + 2] > max.z) max.z = positions[i + 2];
    }
    return new Geometry3D({
      positions,
      normals: new Float32Array(this.normals),
      ...(this.hasUvs ? { uvs: new Float32Array(this.uvs) } : {}),
      ...(this.hasColors ? { colors: new Float32Array(this.colors) } : {}),
      ...(this.hasData ? { colors1: new Float32Array(this.data) } : {}),
      indices: this.count > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
      bounds3D: new Box(min, max),
    });
  }
}

/** sRGB の 16 進色 → 線形 RGB (頂点色用) */
export function linearRgb(hex: number): [number, number, number] {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
