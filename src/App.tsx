import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Simulator } from './sim/engine';
import type { HudState } from './sim/engine';
import { loadCampusData } from './sim/loadData';
import { settingsStore, useSettings } from './sim/settings';
import type { SourceCredit } from './sim/types';
import { Hud } from './ui/Hud';
import { SettingsPanel } from './ui/SettingsPanel';
import { TouchControls } from './ui/TouchControls';

type Phase = 'loading' | 'title' | 'playing' | 'paused' | 'error';
type Tab = 'main' | 'settings' | 'controls' | 'credits';

const CONTROLS: [string, string][] = [
  ['W A S D / 矢印キー', '移動'],
  ['マウス', '視点を動かす'],
  ['Shift', '走る'],
  ['Space', 'ジャンプ'],
  ['M', '全体図を開く / 閉じる'],
  ['F', '飛行モード (E / Q で上昇・下降)'],
  ['R', '入口 (すずかけ門) に戻る'],
  ['Esc', 'メニューを開く'],
];

const TOUCH_CONTROLS: [string, string][] = [
  ['左下のスティック', '移動'],
  ['画面をドラッグ', '視点を動かす'],
  ['走る', '押している間、走る'],
  ['ジャンプ', 'タップしてジャンプする'],
  ['飛行', '飛行モード (「上昇」「下降」を長押し)'],
  ['地図', '全体図を開く / 閉じる'],
  ['メニュー', '一時停止 / 入口に戻る'],
];

const INITIAL_HUD: HudState = { fps: 0, x: 0, z: 0, heading: 0, elevation: 0, place: '', flying: false, running: false };

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [sim, setSim] = useState<Simulator | null>(null);
  const settings = useSettings();
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState({ label: '読み込み中', ratio: 0 });
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('main');
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [touch, setTouch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [showMap, setShowMap] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [credits, setCredits] = useState<SourceCredit[]>([]);

  // 起動: データを読み込み、3D の世界を組み立てる
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let sim: Simulator | null = null;
    void (async () => {
      try {
        const data = await loadCampusData((label) => setProgress({ label, ratio: 0.02 }));
        if (cancelled) return;
        setCredits(data.json.meta.sources);
        sim = await Simulator.create(host, data, settingsStore.get(), (label, ratio) => setProgress({ label, ratio }));
        if (cancelled) {
          sim.destroy();
          return;
        }
        setSim(sim);
        (window as unknown as { __sim?: Simulator }).__sim = sim;
        sim.onHud = setHud;
        sim.onLockChange = (locked) => {
          setPhase((p) => (locked ? 'playing' : p === 'playing' ? 'paused' : p));
          if (!locked) setShowMap(false);
        };
        setPhase('title');
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      setSim(null);
      sim?.destroy();
    };
  }, []);

  // 設定の変更を反映する
  useEffect(() => {
    sim?.applySettings(settings);
  }, [sim, settings]);

  // 操作説明は歩き始めて少ししたら消す
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = window.setTimeout(() => setShowHelp(false), 9000);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing' || touch) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyM' && !e.repeat) setShowMap((v) => !v);
      if (e.code === 'KeyH' && !e.repeat) setShowHelp((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, touch]);

  const start = (e: MouseEvent<HTMLButtonElement>): void => {
    if (!sim) return;
    const event = e.nativeEvent;
    const useTouch = touch || ('pointerType' in event && event.pointerType === 'touch') || !sim.app.canvas.requestPointerLock;
    sim.setShowcase(false);
    setTab('main');
    setShowHelp(true);
    if (useTouch) {
      setTouch(true);
      sim.startTouch();
      setPhase('playing');
    } else {
      sim.requestLock();
    }
  };

  const pauseTouch = useCallback(() => {
    sim?.stopTouch();
    setShowMap(false);
    setPhase('paused');
  }, [sim]);

  useEffect(() => {
    if (phase !== 'playing' || !touch) return;
    const onVisibilityChange = (): void => {
      if (document.hidden) pauseTouch();
    };
    window.addEventListener('blur', pauseTouch);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', pauseTouch);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [phase, touch, pauseTouch]);

  const backToTitle = useCallback(() => {
    if (!sim) return;
    sim.respawn();
    sim.setShowcase(true);
    setTab('main');
    setPhase('title');
  }, [sim]);

  const getRenderSize = useCallback(() => sim?.renderSize, [sim]);

  const menuOpen = phase === 'title' || phase === 'paused';

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <div ref={hostRef} className="absolute inset-0" />

      {phase === 'playing' && sim && (
        <>
          <Hud hud={hud} settings={settings} map={sim.map} landmarks={sim.landmarks} showMap={showMap} showHelp={showHelp} touch={touch} />
          {touch && (
            <TouchControls
              sim={sim}
              flying={hud.flying}
              showHelp={showHelp}
              showMap={showMap}
              onToggleMap={() => setShowMap((v) => !v)}
              onPause={pauseTouch}
            />
          )}
        </>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-slate-950">
          <div className="text-center">
            <p className="text-xs tracking-[0.3em] text-sky-300/80">YOKOHAMA CAMPUS WALKING SIMULATOR</p>
            <h1 className="mt-2 text-2xl font-bold">横浜キャンパス ウォーキングシミュレータ</h1>
          </div>
          <div className="h-1.5 w-72 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-sky-400 transition-[width] duration-300"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <p id="status" className="text-sm text-white/70">
            {progress.label} …
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 p-6">
          <div className="max-w-lg rounded-xl border border-red-400/40 bg-red-950/40 p-6">
            <h2 className="text-lg font-semibold text-red-200">起動できませんでした</h2>
            <p id="status" className="mt-2 break-words text-sm text-red-100/90">
              error: {error}
            </p>
            <p className="mt-3 text-xs text-white/60">
              WebGL 2 に対応したブラウザ (Chrome / Edge / Firefox / Safari の最新版) でお試しください。
            </p>
          </div>
        </div>
      )}

      {menuOpen && (
        <div
          data-ui="menu"
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-slate-950/55 via-slate-950/35 to-slate-950/75 p-4"
        >
          <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl backdrop-blur-md">
            <header className="border-b border-white/10 px-6 pb-4 pt-5">
              <p className="text-[11px] tracking-[0.28em] text-sky-300/80">INSTITUTE OF SCIENCE TOKYO ・ YOKOHAMA CAMPUS</p>
              <h1 className="mt-1 text-2xl font-bold leading-tight">
                東京科学大学 横浜キャンパス
                <span className="block text-base font-medium text-white/75">ウォーキングシミュレータ</span>
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-white/55">
                公開データから再現した旧すずかけ台キャンパスを、一人称視点で歩けます。大学とは無関係の非公式な作品です。
              </p>
            </header>

            <nav className="flex flex-wrap gap-1 border-b border-white/10 px-2 pt-2 text-sm sm:px-4">
              {(
                [
                  ['main', phase === 'paused' ? '一時停止中' : 'スタート'],
                  ['settings', '設定'],
                  ['controls', '操作方法'],
                  ['credits', 'データ出典'],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`rounded-t-md px-2 py-2 transition sm:px-3 ${tab === id ? 'bg-white/10 font-semibold text-white' : 'text-white/60 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {tab === 'main' && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={start}
                    className="w-full rounded-xl bg-sky-500 px-6 py-3.5 text-lg font-bold text-white shadow-lg shadow-sky-900/40 transition hover:bg-sky-400 active:scale-[0.99]"
                  >
                    {phase === 'paused' ? '歩行を再開する' : 'キャンパスを歩く'}
                  </button>
                  <p className="text-center text-xs text-white/55">
                    {touch
                      ? '左下のスティックで移動し、画面をドラッグして見回します。右上のボタンでメニューに戻れます。'
                      : 'クリックするとマウスで視点を動かせるようになります。Esc でいつでもこのメニューに戻れます。'}
                  </p>
                  {phase === 'paused' && (
                    <button
                      type="button"
                      onClick={backToTitle}
                      className="w-full rounded-lg border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                    >
                      入口に戻ってタイトルへ
                    </button>
                  )}
                  <ul className="grid grid-cols-2 gap-2 pt-1 text-xs text-white/70">
                    <li className="rounded-md bg-white/5 px-3 py-2">建物の形と高さ: 国土交通省 PLATEAU の実測値</li>
                    <li className="rounded-md bg-white/5 px-3 py-2">道・池・門・棟名: OpenStreetMap</li>
                    <li className="rounded-md bg-white/5 px-3 py-2">丘陵の起伏: 国土地理院 5 m 標高</li>
                    <li className="rounded-md bg-white/5 px-3 py-2">樹木の位置: 空中写真から推定</li>
                  </ul>
                </div>
              )}
              {tab === 'settings' && <SettingsPanel getRenderSize={getRenderSize} />}
              {tab === 'controls' && (
                <table className="w-full text-sm">
                  <tbody>
                    {(touch ? TOUCH_CONTROLS : CONTROLS).map(([key, action]) => (
                      <tr key={key} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-4 font-mono text-sky-200">{key}</td>
                        <td className="py-2 text-white/85">{action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'credits' && (
                <div className="space-y-3 text-sm">
                  <p className="text-xs leading-relaxed text-white/60">
                    このシミュレータは、次の公開データを加工して作成しています。建物の外観や小物は公開資料を参考にした推定で、実際とは異なる部分があります。
                  </p>
                  {credits.map((c) => (
                    <div key={c.name} className="rounded-md bg-white/5 px-3 py-2">
                      <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-sky-300 hover:underline">
                        {c.name}
                      </a>
                      <div className="text-xs text-white/60">
                        {c.credit} ・ {c.license}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
