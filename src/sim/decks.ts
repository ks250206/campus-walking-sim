import type { CampusExtras } from './extras';
import type { Heightfield } from './heightfield';
import type { WalkSurface } from './player';
import type { CampusJson, RoadData } from './types';

export interface DeckSpan {
  kind: string;
  width: number;
  /** 中心線 [x, z, ...] */
  pts: number[];
  /** 各点での床の高さ */
  ys: number[];
}

const key = (x: number, z: number): string => `${x.toFixed(1)},${z.toFixed(1)}`;

/**
 * 地形とは別に歩ける面: 橋 (両端の地面を直線でつないだ床)、トンネルの床、階段、
 * そしてトンネルの上にかぶせた地表。
 */
export class Decks implements WalkSurface {
  /** 橋 (描画もする) */
  readonly spans: DeckSpan[] = [];
  /** トンネルの床や階段など、当たり判定だけの面 */
  private readonly strips: DeckSpan[] = [];
  private readonly hf: Heightfield;

  constructor(json: CampusJson, hf: Heightfield, extras: CampusExtras) {
    this.hf = hf;
    for (const s of extras.strips) {
      this.strips.push({ kind: 'strip', width: s.halfWidth * 2, pts: [s.ax, s.az, s.bx, s.bz], ys: [s.ay, s.by] });
    }
    const bridges = json.roads.filter((r) => r.br && !r.tn && r.k !== 'steps' && r.k !== 'rail');
    // 端点を共有する同種の橋をつないで 1 本にする
    const used = new Set<RoadData>();
    for (const start of bridges) {
      if (used.has(start)) continue;
      used.add(start);
      let pts = [...start.p];
      let grew = true;
      while (grew) {
        grew = false;
        for (const other of bridges) {
          if (used.has(other) || other.k !== start.k) continue;
          const o = other.p;
          const head = key(pts[0], pts[1]);
          const tail = key(pts[pts.length - 2], pts[pts.length - 1]);
          const oHead = key(o[0], o[1]);
          const oTail = key(o[o.length - 2], o[o.length - 1]);
          if (tail === oHead) pts = pts.concat(o.slice(2));
          else if (tail === oTail) pts = pts.concat(reversePairs(o).slice(2));
          else if (head === oTail) pts = o.slice(0, -2).concat(pts);
          else if (head === oHead) pts = reversePairs(o).slice(0, -2).concat(pts);
          else continue;
          used.add(other);
          grew = true;
        }
      }
      // 歩道橋の階段などにつながる橋は、端の高さが分からないので扱わない
      const endsFree = [0, pts.length - 2].every((i) => {
        const k = key(pts[i], pts[i + 1]);
        return !json.roads.some(
          (r) => r.br && r.k === 'steps' && (key(r.p[0], r.p[1]) === k || key(r.p[r.p.length - 2], r.p[r.p.length - 1]) === k),
        );
      });
      if (!endsFree) continue;
      if (!hf.contains(pts[0], pts[1]) || !hf.contains(pts[pts.length - 2], pts[pts.length - 1])) continue;

      const lengths = [0];
      for (let i = 2; i < pts.length; i += 2)
        lengths.push(lengths[lengths.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
      const total = lengths[lengths.length - 1] || 1;
      const y0 = hf.heightAt(pts[0], pts[1]);
      const y1 = hf.heightAt(pts[pts.length - 2], pts[pts.length - 1]);
      const ys = lengths.map((l) => y0 + ((y1 - y0) * l) / total);
      this.spans.push({ kind: start.k, width: start.w, pts, ys });
    }
  }

  /** (x, z) にある歩ける面のうち、maxY 以下でいちばん高いもの。無ければ -Infinity */
  deckAt(x: number, z: number, maxY: number): number {
    let best = -Infinity;
    const cap = this.hf.capHeightAt(x, z);
    if (cap <= maxY) best = cap;
    for (const list of [this.spans, this.strips]) {
      for (const span of list) {
        const p = span.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i];
          const dz = p[i + 3] - p[i + 1];
          const l2 = dx * dx + dz * dz;
          if (l2 === 0) continue;
          const t = ((x - p[i]) * dx + (z - p[i + 1]) * dz) / l2;
          if (t < 0 || t > 1) continue;
          const d = Math.hypot(x - (p[i] + dx * t), z - (p[i + 1] + dz * t));
          if (d > span.width / 2) continue;
          const y = span.ys[i / 2] + (span.ys[i / 2 + 1] - span.ys[i / 2]) * t;
          if (y > best && y <= maxY) best = y;
        }
      }
    }
    return best;
  }
}

function reversePairs(p: number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}
