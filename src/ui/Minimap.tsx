import { useEffect, useRef } from 'react';
import type { HudState } from '../sim/engine';
import type { TravelDestination } from '../sim/fastTravel';
import type { Landmark } from '../sim/types';
import type { MapImage } from '../sim/mapImage';

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, headingDeg: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.8);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = '#ff4d4f';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 右上のミニマップ (北が上、自分を中心に半径 range m) */
export function Minimap({ map, hud, range = 95, size }: { map: MapImage; hud: HudState; range?: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#c3d3ae';
    ctx.fillRect(0, 0, size, size);
    const sx = (hud.x - range - map.x0) * map.scale;
    const sy = (hud.z - range - map.z0) * map.scale;
    const sw = range * 2 * map.scale;
    ctx.drawImage(map.canvas, sx, sy, sw, sw, 0, 0, size, size);
    ctx.restore();
    drawPlayer(ctx, size / 2, size / 2, hud.heading, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', size / 2, 13);
  }, [map, hud.x, hud.z, hud.heading, range, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="rounded-full shadow-lg shadow-black/40" />;
}

/** 全体図 */
export function FullMap({
  map,
  hud,
  landmarks,
  destination,
}: {
  map: MapImage;
  hud: HudState;
  landmarks: Landmark[];
  destination?: TravelDestination;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const frame = canvas?.parentElement;
    if (!canvas || !ctx || !frame) return;
    const draw = (): void => {
      const k = Math.min(frame.clientWidth / map.canvas.width, frame.clientHeight / map.canvas.height);
      if (k <= 0) return;
      const w = Math.round(map.canvas.width * k);
      const h = Math.round(map.canvas.height * k);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(map.canvas, 0, 0, w, h);
      const px = (x: number): number => (x - map.x0) * map.scale * k;
      const pz = (z: number): number => (z - map.z0) * map.scale * k;
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      const seen = new Set<string>();
      for (const l of landmarks) {
        const label = l.name.replace(/(高層棟|本棟|棟)$/, '');
        if (seen.has(label)) continue;
        seen.add(label);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, px(l.x), pz(l.z) + 4);
        ctx.fillStyle = '#3b2a22';
        ctx.fillText(label, px(l.x), pz(l.z) + 4);
      }
      drawPlayer(ctx, px(hud.x), pz(hud.z), hud.heading, 9);
      if (destination) {
        ctx.beginPath();
        ctx.arc(px(destination.x), pz(destination.z), 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#0369a1';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [map, hud.x, hud.z, hud.heading, landmarks, destination]);
  return <canvas ref={ref} aria-hidden="true" className="rounded-lg shadow-2xl ring-1 ring-white/30" />;
}
