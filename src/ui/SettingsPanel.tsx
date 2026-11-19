import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS, FOV_RANGE, RESOLUTION_OPTIONS, SENSITIVITY_RANGE, settingsStore, useSettings } from '../sim/settings';
import type { Antialiasing, ResolutionPreset, Settings, ShadowLevel } from '../sim/settings';

const SHADOW_OPTIONS: { value: ShadowLevel; label: string }[] = [
  { value: 'off', label: 'なし' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

function Row({ label, value, hint, children }: { label: string; value?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-white">{label}</span>
        {value !== undefined && <span className="font-mono text-sm tabular-nums text-sky-200">{value}</span>}
      </div>
      {children}
      {hint && <p className="mt-1 text-xs leading-relaxed text-white/50">{hint}</p>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
      <span>{label}</span>
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const formatTime = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
};

/** 水平視野角 (16:9 のとき) */
const horizontalFov = (vertical: number): number =>
  Math.round((2 * Math.atan(Math.tan((vertical * Math.PI) / 360) * (16 / 9)) * 180) / Math.PI);

export function SettingsPanel({ getRenderSize }: { getRenderSize?: () => { width: number; height: number } | undefined }) {
  const s = useSettings();
  // 設定を反映したあとの実際の描画サイズ (解像度を変えると 1 フレーム後に変わる)
  const [renderSize, setRenderSize] = useState(() => getRenderSize?.());
  useEffect(() => {
    const id = requestAnimationFrame(() => setRenderSize(getRenderSize?.()));
    const onResize = (): void => setRenderSize(getRenderSize?.());
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', onResize);
    };
  }, [getRenderSize, s.resolution, s.antialiasing]);
  const set = (patch: Partial<Settings>): void => {
    const next = patch.antialiasing ?? s.antialiasing;
    const needsReload = (s.antialiasing === 'msaa') !== (next === 'msaa');
    settingsStore.set(patch);
    // WebGL の MSAA はコンテキスト作成時にしか変更できない。
    if (needsReload) window.location.reload();
  };
  const selectClass =
    'w-full rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400';

  return (
    <div className="space-y-5">
      <section className="space-y-4">
        <h3 className="text-xs font-semibold tracking-widest text-white/50">表示</h3>
        <Row
          label="解像度"
          value={renderSize ? `${renderSize.width} × ${renderSize.height}` : undefined}
          hint="描画する縦のピクセル数です。横は画面の縦横比に合わせます。重いときは下げてください。"
        >
          <select className={selectClass} value={s.resolution} onChange={(e) => set({ resolution: e.target.value as ResolutionPreset })}>
            {RESOLUTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="アンチエイリアス"
          hint="MSAA の切り替え時は再読み込みします。SSAA は縦横2倍で描画するため負荷が高く、GPUの上限により倍率が制限されることがあります。"
        >
          <select className={selectClass} value={s.antialiasing} onChange={(e) => set({ antialiasing: e.target.value as Antialiasing })}>
            <option value="off">なし</option>
            <option value="msaa">MSAA（輪郭を平滑化）</option>
            <option value="fxaa">FXAA（軽量）</option>
            <option value="ssaa">SSAA（高画質・高負荷）</option>
          </select>
        </Row>
        <Row
          label="視野角 (FOV)"
          value={`${Math.round(s.fov)}°`}
          hint={`垂直視野角。16:9 の画面では水平およそ ${horizontalFov(s.fov)}° です。`}
        >
          <input
            type="range"
            className="w-full"
            min={FOV_RANGE.min}
            max={FOV_RANGE.max}
            step={1}
            value={s.fov}
            onChange={(e) => set({ fov: Number(e.target.value) })}
          />
        </Row>
        <Row label="影の品質">
          <div className="grid grid-cols-4 gap-1">
            {SHADOW_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => set({ shadows: o.value })}
                className={`rounded-md px-2 py-1.5 text-sm transition ${s.shadows === o.value ? 'bg-sky-500 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="見通し (霞の薄さ)" value={`${(0.6 * 10 ** s.visibility).toFixed(1)} km`}>
          <input
            type="range"
            className="w-full"
            min={0}
            max={1}
            step={0.01}
            value={s.visibility}
            onChange={(e) => set({ visibility: Number(e.target.value) })}
          />
        </Row>
        <Row label="時刻" value={formatTime(s.timeOfDay)}>
          <input
            type="range"
            className="w-full"
            min={5}
            max={19}
            step={0.25}
            value={s.timeOfDay}
            onChange={(e) => set({ timeOfDay: Number(e.target.value) })}
          />
        </Row>
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold tracking-widest text-white/50">操作</h3>
        <Row label="視点操作の感度" value={s.mouseSensitivity.toFixed(2)}>
          <input
            type="range"
            className="w-full"
            min={SENSITIVITY_RANGE.min}
            max={SENSITIVITY_RANGE.max}
            step={0.05}
            value={s.mouseSensitivity}
            onChange={(e) => set({ mouseSensitivity: Number(e.target.value) })}
          />
        </Row>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle label="上下の視点操作を反転" checked={s.invertY} onChange={(v) => set({ invertY: v })} />
          <Toggle label="歩行時の視点の揺れ" checked={s.headBob} onChange={(v) => set({ headBob: v })} />
          <Toggle label="ミニマップを表示" checked={s.showMinimap} onChange={(v) => set({ showMinimap: v })} />
          <Toggle label="FPS を表示" checked={s.showFps} onChange={(v) => set({ showFps: v })} />
          <Toggle label="陰影を強調 (SSAO・重い)" checked={s.ambientOcclusion} onChange={(v) => set({ ambientOcclusion: v })} />
        </div>
      </section>

      <button
        type="button"
        onClick={() => set({ ...DEFAULT_SETTINGS })}
        className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
      >
        初期設定に戻す
      </button>
    </div>
  );
}
