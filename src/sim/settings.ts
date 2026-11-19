import { useSyncExternalStore } from 'react';

export type ResolutionPreset = 'native' | '2160' | '1440' | '1080' | '900' | '720' | '540';
export type ShadowLevel = 'off' | 'low' | 'medium' | 'high';
export type Antialiasing = 'off' | 'msaa' | 'fxaa' | 'ssaa';

export interface Settings {
  /** 描画解像度 (縦のピクセル数。横は画面の縦横比に合わせる) */
  resolution: ResolutionPreset;
  /** アンチエイリアス方式 */
  antialiasing: Antialiasing;
  /** 視点操作の感度 (1 が標準) */
  mouseSensitivity: number;
  /** 上下の視点操作を反転 */
  invertY: boolean;
  /** 垂直視野角 (度) */
  fov: number;
  /** 影の品質 */
  shadows: ShadowLevel;
  /** 見通し距離 (0 = 霞が濃い, 1 = 遠くまで見える) */
  visibility: number;
  /** 時刻 (時) */
  timeOfDay: number;
  /** 歩行時の視点の揺れ */
  headBob: boolean;
  /** 環境光の遮蔽 (SSAO) */
  ambientOcclusion: boolean;
  showFps: boolean;
  showMinimap: boolean;
}

// 高 DPI のタッチ端末では描画負荷を抑えて起動する。
const prefersTouch = window.matchMedia('(pointer: coarse)').matches;

export const DEFAULT_SETTINGS: Settings = {
  resolution: prefersTouch ? '540' : 'native',
  antialiasing: 'msaa',
  mouseSensitivity: 1,
  invertY: false,
  fov: 68,
  shadows: prefersTouch ? 'off' : 'medium',
  visibility: 0.6,
  timeOfDay: 10.5,
  headBob: true,
  ambientOcclusion: false,
  showFps: false,
  showMinimap: true,
};

export const RESOLUTION_OPTIONS: { value: ResolutionPreset; label: string }[] = [
  { value: 'native', label: 'ネイティブ (画面に合わせる)' },
  { value: '2160', label: '3840 × 2160 (4K)' },
  { value: '1440', label: '2560 × 1440 (WQHD)' },
  { value: '1080', label: '1920 × 1080 (フル HD)' },
  { value: '900', label: '1600 × 900' },
  { value: '720', label: '1280 × 720 (HD)' },
  { value: '540', label: '960 × 540' },
];

export const FOV_RANGE = { min: 40, max: 110 };
export const SENSITIVITY_RANGE = { min: 0.1, max: 20 };

const STORAGE_KEY = 'campus-walking-sim.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    merged.fov = clamp(Number(merged.fov) || DEFAULT_SETTINGS.fov, FOV_RANGE.min, FOV_RANGE.max);
    merged.mouseSensitivity = clamp(Number(merged.mouseSensitivity) || 1, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max);
    merged.visibility = clamp(Number(merged.visibility), 0, 1);
    merged.timeOfDay = clamp(Number(merged.timeOfDay), 5, 19);
    if (!RESOLUTION_OPTIONS.some((o) => o.value === merged.resolution)) merged.resolution = 'native';
    if (!['off', 'msaa', 'fxaa', 'ssaa'].includes(merged.antialiasing)) merged.antialiasing = DEFAULT_SETTINGS.antialiasing;
    if (!['off', 'low', 'medium', 'high'].includes(merged.shadows)) merged.shadows = 'medium';
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

let current = load();
const listeners = new Set<() => void>();

function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 保存できなくても動作には影響しない (プライベートブラウズなど)
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSettings = (): Settings => current;

export const settingsStore = {
  get: getSettings,
  set: setSettings,
  reset: (): void => setSettings({ ...DEFAULT_SETTINGS }),
  subscribe,
};

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}

/** 設定の解像度から、CSS 1 ピクセルあたりの描画ピクセル数を求める */
export function resolutionScale(preset: ResolutionPreset, cssHeight: number, devicePixelRatio: number): number {
  if (preset === 'native') return Math.min(devicePixelRatio, 2);
  const target = Number(preset);
  return clamp(target / Math.max(1, cssHeight), 0.25, 4);
}
