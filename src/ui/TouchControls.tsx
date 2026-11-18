import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Simulator } from '../sim/engine';

const BUTTON =
  'pointer-events-auto touch-none min-h-11 rounded-xl border border-white/30 bg-slate-950/75 px-3 text-sm font-semibold text-white active:bg-sky-700';
const STICK_RADIUS = 36;
const ZERO = { x: 0, y: 0 };

function capture(e: PointerEvent<HTMLElement>): boolean {
  if (e.button !== 0) return false;
  e.currentTarget.setPointerCapture(e.pointerId);
  return true;
}

function HoldButton({ label, onHold }: { label: string; onHold: (pressed: boolean) => void }) {
  const pointer = useRef<number | null>(null);
  const release = (e: PointerEvent<HTMLButtonElement>): void => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    onHold(false);
  };
  return (
    <button
      type="button"
      className={BUTTON}
      onPointerDown={(e) => {
        if (pointer.current !== null || !capture(e)) return;
        pointer.current = e.pointerId;
        onHold(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {label}
    </button>
  );
}

export function TouchControls({
  sim,
  flying,
  showHelp,
  showMap,
  onToggleMap,
  onPause,
}: {
  sim: Simulator;
  flying: boolean;
  showHelp: boolean;
  showMap: boolean;
  onToggleMap: () => void;
  onPause: () => void;
}) {
  const stick = useRef<number | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState(ZERO);

  useEffect(() => () => sim.clearTouchInput(), [sim]);

  const toggleMap = (): void => {
    stick.current = look.current = null;
    setKnob(ZERO);
    sim.clearTouchInput();
    onToggleMap();
  };

  const moveStick = (e: PointerEvent<HTMLDivElement>): void => {
    if (stick.current !== e.pointerId) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - left - width / 2;
    const dy = e.clientY - top - height / 2;
    const scale = Math.max(STICK_RADIUS, Math.hypot(dx, dy));
    setKnob({ x: (dx / scale) * STICK_RADIUS, y: (dy / scale) * STICK_RADIUS });
    sim.setTouchMovement(dx / scale, -dy / scale);
  };

  const stopStick = (e: PointerEvent<HTMLDivElement>): void => {
    if (stick.current !== e.pointerId) return;
    stick.current = null;
    setKnob(ZERO);
    sim.setTouchMovement(0, 0);
  };

  const stopLook = (e: PointerEvent<HTMLDivElement>): void => {
    if (look.current?.id === e.pointerId) look.current = null;
  };

  return (
    <div className="pointer-events-none absolute inset-0 select-none" onContextMenu={(e) => e.preventDefault()}>
      {showMap ? (
        <div className="pointer-events-auto absolute inset-0 touch-none" />
      ) : (
        <>
          <div
            data-ui="touch-look"
            className="pointer-events-auto absolute inset-0 touch-none"
            onPointerDown={(e) => {
              if (look.current || !capture(e)) return;
              look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const last = look.current;
              if (last?.id !== e.pointerId) return;
              sim.lookTouch(e.clientX - last.x, e.clientY - last.y);
              last.x = e.clientX;
              last.y = e.clientY;
            }}
            onPointerUp={stopLook}
            onPointerCancel={stopLook}
            onLostPointerCapture={stopLook}
          />
          {showHelp && (
            <p className="absolute bottom-36 left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded-lg bg-black/65 px-3 py-2 text-center text-xs">
              左下のスティックで移動 ・ 画面をドラッグして見回す
            </p>
          )}
          <div
            data-ui="touch-stick"
            className="pointer-events-auto absolute bottom-4 left-4 grid size-28 touch-none place-items-center rounded-full border border-white/40 bg-slate-950/50"
            onPointerDown={(e) => {
              if (stick.current !== null || !capture(e)) return;
              stick.current = e.pointerId;
              moveStick(e);
            }}
            onPointerMove={moveStick}
            onPointerUp={stopStick}
            onPointerCancel={stopStick}
            onLostPointerCapture={stopStick}
          >
            <div
              className="pointer-events-none size-11 rounded-full border border-white/60 bg-white/35 shadow-md"
              style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
            />
          </div>
          <div className="absolute bottom-4 right-4 grid grid-cols-2 gap-2">
            <button type="button" className={BUTTON} aria-pressed={flying} onClick={() => sim.toggleFlight()}>
              飛行
            </button>
            <HoldButton label="走る" onHold={(pressed) => sim.setTouchAction('run', pressed)} />
            {flying && <HoldButton label="下降" onHold={(pressed) => sim.setTouchAction('down', pressed)} />}
            <HoldButton label={flying ? '上昇' : 'ジャンプ'} onHold={(pressed) => sim.setTouchAction('jump', pressed)} />
          </div>
        </>
      )}
      <div className="absolute right-4 top-4 flex gap-2">
        <button type="button" className={BUTTON} aria-pressed={showMap} onClick={toggleMap}>
          {showMap ? '地図を閉じる' : '地図'}
        </button>
        <button type="button" className={BUTTON} onClick={onPause}>
          メニュー
        </button>
      </div>
    </div>
  );
}
