import type { HudState, Landmark } from '../sim/engine';
import type { MapImage } from '../sim/mapImage';
import type { Settings } from '../sim/settings';
import { FullMap, Minimap } from './Minimap';

const COMPASS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const compassLabel = (deg: number): string => COMPASS[Math.round(deg / 45) % 8];

export function Hud({
  hud,
  settings,
  map,
  landmarks,
  showMap,
  showHelp,
  touch,
}: {
  hud: HudState;
  settings: Settings;
  map: MapImage;
  landmarks: Landmark[];
  showMap: boolean;
  showHelp: boolean;
  touch: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* 照準 */}
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-[0_0_3px_rgba(0,0,0,0.9)]" />

      <div className={`absolute left-4 top-4 space-y-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${touch ? 'right-44' : ''}`}>
        <div className={touch ? 'text-sm font-semibold' : 'text-lg font-semibold'}>{hud.place}</div>
        <div className="text-xs text-white/85">
          {compassLabel(hud.heading)} {Math.round(hud.heading)}° ・ 標高 {hud.elevation.toFixed(0)} m
          {hud.flying && <span className="ml-2 rounded bg-sky-500/80 px-1.5 py-0.5 text-[10px] font-semibold">飛行モード</span>}
        </div>
        {settings.showFps && <div className="font-mono text-xs text-emerald-300">{hud.fps} FPS</div>}
      </div>

      {settings.showMinimap && !showMap && (
        <div className={`absolute right-4 ${touch ? 'top-[4.25rem]' : 'top-4'}`}>
          <Minimap map={map} hud={hud} size={touch ? 96 : 184} />
        </div>
      )}

      {showHelp && !touch && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-black/55 px-4 py-2 text-xs leading-relaxed text-white/90 backdrop-blur-sm">
          <b>WASD</b> 移動 ・ <b>マウス</b> 視点 ・ <b>Shift</b> 走る ・ <b>Space</b> ジャンプ ・ <b>M</b> 地図 ・ <b>F</b> 飛行 ・ <b>R</b>{' '}
          入口に戻る ・ <b>Esc</b> メニュー
        </div>
      )}

      {showMap && <FullMap map={map} hud={hud} landmarks={landmarks} touch={touch} />}
    </div>
  );
}
