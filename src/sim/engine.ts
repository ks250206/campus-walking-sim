import { Container3D, View3D } from '@pixi/3d';
import type { Pass3D } from '@pixi/3d';
import { FxaaEffect, SsaoEffect } from '@pixi/3d/extras';
import { Application, RendererType } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import { buildBuildings } from './buildings';
import { CollisionWorld } from './collision';
import { Heightfield, signedDistanceToPolygon } from './heightfield';
import { Player } from './player';
import type { PlayerInput } from './player';
import { buildProps, prepareTerrain } from './props';
import { setFacadeNight } from './facade';
import type { Material3D } from '@pixi/3d';
import { resolutionScale } from './settings';
import type { Settings, ShadowLevel } from './settings';
import { Sky } from './sky';
import { buildTerrain } from './terrain';
import type { CampusData } from './types';
import { buildVegetation } from './vegetation';
import { Decks } from './decks';
import { renderMapImage } from './mapImage';
import type { MapImage } from './mapImage';

export interface HudState {
  fps: number;
  x: number;
  z: number;
  /** 方位 (0 = 北、時計回り) */
  heading: number;
  /** 標高 (m) */
  elevation: number;
  place: string;
  flying: boolean;
  running: boolean;
}

export interface Landmark {
  name: string;
  x: number;
  z: number;
  ring: number[];
}

const SHADOW_QUALITY: Record<Exclude<ShadowLevel, 'off'>, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

/** スタート地点: すずかけ門を入ったところ */
const SPAWN = { x: -214, z: -146.5, yaw: -84 };

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export class Simulator {
  readonly app: Application;
  readonly view: View3D;
  readonly hf: Heightfield;
  readonly player: Player;
  readonly sky: Sky;
  readonly landmarks: Landmark[] = [];
  /** ミニマップ・全体図の下地 */
  readonly map: MapImage;
  onHud: ((state: HudState) => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly input: PlayerInput = { forward: 0, strafe: 0, run: false, jump: false, up: 0 };
  private settings: Settings;
  private active = false;
  private hudTimer = 0;
  private fpsSmooth = 60;
  private place = '';
  private placeTimer = 0;
  private showcase = true;
  private showcaseAngle = 0.6;
  private ssao: SsaoEffect | null = null;
  private fxaa: FxaaEffect | null = null;
  private readonly disposers: (() => void)[] = [];
  private readonly campusBoundary: number[][];
  private readonly facadeMaterials: Material3D[];
  private readonly lampMaterial: Material3D;

  private constructor(app: Application, view: View3D, world: Container3D, data: CampusData, settings: Settings, parts: BuiltWorld) {
    this.app = app;
    this.view = view;
    this.settings = settings;
    this.hf = parts.hf;
    this.sky = parts.sky;
    this.player = parts.player;
    this.map = parts.map;
    this.facadeMaterials = parts.facadeMaterials;
    this.lampMaterial = parts.lampMaterial;
    this.campusBoundary = data.json.campusBoundary;
    void world;

    for (const b of data.json.buildings) {
      if (!b.n || !b.c) continue;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < b.r.length; i += 2) {
        cx += b.r[i];
        cz += b.r[i + 1];
      }
      this.landmarks.push({ name: b.n, x: cx / (b.r.length / 2), z: cz / (b.r.length / 2), ring: b.r });
    }

    this.bindInput();
    this.applySettings(settings, true);
    this.player.applyTo(view.camera);
    app.ticker.add(this.tick);
  }

  static async create(
    host: HTMLElement,
    data: CampusData,
    settings: Settings,
    onProgress: (label: string, ratio: number) => void,
  ): Promise<Simulator> {
    onProgress('描画エンジンを起動中', 0.05);
    const app = new Application();
    await app.init({
      preference: 'webgl',
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      resolution: resolutionScale(settings.resolution, host.clientHeight || window.innerHeight, window.devicePixelRatio || 1),
      backgroundColor: 0xbfd0df,
      powerPreference: 'high-performance',
      hello: false,
    });
    app.canvas.style.display = 'block';
    host.appendChild(app.canvas);

    const view = new View3D({
      autoResize: true,
      toneMapping: 'aces',
      exposure: 1.0,
      shadowQuality: settings.shadows === 'off' ? 'medium' : SHADOW_QUALITY[settings.shadows],
      shadowFilter: 'pcf',
    });
    app.stage.addChild(view);
    view.camera.near = 0.2;
    view.camera.far = 7000;
    view.camera.fov = settings.fov;

    const world = new Container3D({ label: 'world' });
    view.root.addChild(world);

    const json = data.json;
    onProgress('地形を生成中', 0.15);
    await nextFrame();
    const hf = new Heightfield(data.terrain, json.terrain);
    const collision = new CollisionWorld();
    prepareTerrain(json, hf);
    const decks = new Decks(json, hf);

    const sky = new Sky(view, world, settings.shadows !== 'off');

    const terrain = buildTerrain(data, hf, 2048);
    world.addChild(terrain.node);

    onProgress('建物を生成中', 0.4);
    await nextFrame();
    const buildings = buildBuildings(data, hf, collision);
    world.addChild(buildings.node);

    onProgress('樹木を配置中', 0.6);
    await nextFrame();
    world.addChild(buildVegetation(data, hf, collision));

    onProgress('道路・設備を配置中', 0.8);
    await nextFrame();
    const props = buildProps(data, hf, collision, decks);
    world.addChild(props.node);

    const b = json.meta.bounds;
    const player = new Player(hf, collision, decks, { minX: b.minX + 4, maxX: b.maxX - 4, minZ: b.minZ + 4, maxZ: b.maxZ - 4 });
    player.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);

    onProgress('シェーダを準備中', 0.92);
    const sim = new Simulator(app, view, world, data, settings, {
      hf,
      sky,
      player,
      map: renderMapImage(json),
      facadeMaterials: buildings.facadeMaterials,
      lampMaterial: props.lampMaterial,
    });
    // 最初の 1 フレームでシェーダをコンパイルしておく
    await nextFrame();
    await nextFrame();
    onProgress('準備完了', 1);
    return sim;
  }

  // ---------------------------------------------------------------- 設定
  applySettings(settings: Settings, force = false): void {
    const prev = this.settings;
    this.settings = settings;
    const { view, app } = this;

    view.camera.fov = settings.fov;

    if (force || prev.resolution !== settings.resolution) this.applyResolution();

    if (force || prev.shadows !== settings.shadows) {
      this.sky.setShadows(settings.shadows !== 'off');
      if (settings.shadows !== 'off') view.shadowQuality = SHADOW_QUALITY[settings.shadows];
    }

    if (force || prev.timeOfDay !== settings.timeOfDay) {
      this.sky.setTime(settings.timeOfDay);
      // 暗くなったら窓明かりと街灯をつける
      const night = this.sky.night;
      for (const m of this.facadeMaterials) setFacadeNight(m, night, 0.45);
      if (this.lampMaterial.emissive) this.lampMaterial.emissive.strength = night * 7;
    }

    // 見通し距離: 霞の濃さ (およそ 0.6 km 〜 6 km)
    if (force || prev.visibility !== settings.visibility) {
      const range = 600 * 10 ** settings.visibility;
      this.sky.setFogDensity(0.83 / range);
    }

    if (force || prev.ambientOcclusion !== settings.ambientOcclusion) {
      const passes: Pass3D[] = [];
      if (settings.ambientOcclusion && this.canRenderFloat()) {
        this.ssao ??= new SsaoEffect({ radius: 0.9, intensity: 1.1, fadeDistance: [60, 120] });
        this.fxaa ??= new FxaaEffect();
        passes.push(this.ssao, this.fxaa);
      }
      view.passes = passes;
    }
    void app;
  }

  private canRenderFloat(): boolean {
    const renderer = this.app.renderer;
    if (renderer.type !== RendererType.WEBGL) return true;
    return Boolean((renderer as WebGLRenderer).context.extensions.colorBufferFloat);
  }

  private applyResolution(): void {
    const host = this.app.canvas.parentElement;
    const w = host?.clientWidth || window.innerWidth;
    const h = host?.clientHeight || window.innerHeight;
    const scale = resolutionScale(this.settings.resolution, h, window.devicePixelRatio || 1);
    // GPU のテクスチャ上限を超えないようにする
    const maxDim = 8192;
    const safe = Math.min(scale, maxDim / Math.max(w, h));
    this.app.renderer.resize(w, h, safe);
  }

  /** 実際の描画ピクセル数 */
  get renderSize(): { width: number; height: number } {
    return { width: this.app.canvas.width, height: this.app.canvas.height };
  }

  // ---------------------------------------------------------------- 入力
  private bindInput(): void {
    const canvas = this.app.canvas;
    const on = <K extends keyof DocumentEventMap>(
      target: Document | Window | HTMLElement,
      type: K,
      fn: (e: DocumentEventMap[K]) => void,
    ): void => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };

    on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      this.active = locked;
      if (!locked) this.keys.clear();
      this.onLockChange?.(locked);
    });
    on(document, 'mousemove', (e) => {
      if (!this.active) return;
      this.player.look(e.movementX, e.movementY, this.settings.mouseSensitivity, this.settings.invertY);
    });
    on(document, 'keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      // ブラウザが Esc を自分で処理しない環境でも、メニューに戻れるようにする
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.releaseLock();
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.player.flying = !this.player.flying;
      if (e.code === 'KeyR') this.respawn();
    });
    on(document, 'keyup', (e) => {
      this.keys.delete(e.code);
    });
    on(window, 'blur' as keyof DocumentEventMap, () => this.keys.clear());
    on(window, 'resize' as keyof DocumentEventMap, () => this.applyResolution());
  }

  /** マウスを捕まえて操作を始める (ユーザー操作のイベント内で呼ぶこと) */
  requestLock(): void {
    const canvas = this.app.canvas as HTMLCanvasElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      // 可能なら OS のマウス加速を外した生の移動量を使う
      const result = canvas.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof result.catch === 'function') result.catch(() => void canvas.requestPointerLock());
    } catch {
      void canvas.requestPointerLock();
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** タイトル画面用の俯瞰カメラに切り替える */
  setShowcase(enabled: boolean): void {
    this.showcase = enabled;
    if (!enabled) this.player.applyTo(this.view.camera);
  }

  respawn(): void {
    this.player.flying = false;
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);
  }

  teleport(x: number, z: number, yawDeg?: number): void {
    this.player.teleport(x, z, yawDeg ?? (-this.player.yaw * 180) / Math.PI);
  }

  // ---------------------------------------------------------------- 毎フレーム
  private readonly tick = (): void => {
    const ticker = this.app.ticker;
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    const k = this.keys;
    const input = this.input;
    input.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    input.strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    input.run = k.has('ShiftLeft') || k.has('ShiftRight');
    input.jump = k.has('Space');
    input.up = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('ControlLeft') || k.has('KeyQ') || k.has('KeyC') ? 1 : 0);

    const p = this.player;
    const camera = this.view.camera;
    if (this.showcase) {
      // タイトル画面: キャンパスの上空をゆっくり回る
      this.showcaseAngle += dt * 0.035;
      const a = this.showcaseAngle;
      camera.position.set(-10 + Math.sin(a) * 330, 150, -10 + Math.cos(a) * 330);
      camera.lookAt({ x: -10, y: 22, z: -10 });
    } else {
      if (this.active) p.update(dt, input, this.settings.headBob);
      p.applyTo(camera);
    }
    const cam = camera.position;
    this.sky.update(cam.x, cam.y, cam.z);

    this.fpsSmooth += (ticker.FPS - this.fpsSmooth) * 0.05;
    this.hudTimer -= dt;
    this.placeTimer -= dt;
    if (this.placeTimer <= 0) {
      this.placeTimer = 0.4;
      this.place = this.describePlace(p.x, p.z);
    }
    if (this.hudTimer <= 0 && this.onHud) {
      this.hudTimer = 0.1;
      this.onHud({
        fps: Math.round(this.fpsSmooth),
        x: p.x,
        z: p.z,
        heading: p.heading,
        elevation: p.y + 50,
        place: this.place,
        flying: p.flying,
        running: input.run && p.speed > 2.5,
      });
    }
  };

  private describePlace(x: number, z: number): string {
    let best: Landmark | null = null;
    let bestDist = 22;
    for (const l of this.landmarks) {
      if (Math.abs(l.x - x) > 140 || Math.abs(l.z - z) > 140) continue;
      const d = signedDistanceToPolygon(x, z, l.ring);
      if (d < bestDist) {
        bestDist = d;
        best = l;
      }
    }
    if (best) return best.name;
    for (const ring of this.campusBoundary) {
      if (signedDistanceToPolygon(x, z, ring) < 0) return '横浜キャンパス 構内';
    }
    return 'キャンパス周辺';
  }

  /** 開発・検証用: 視点を直接指定する */
  debugView(x: number, z: number, yawDeg: number, pitchDeg = 0, height?: number): void {
    const p = this.player;
    this.showcase = false;
    p.flying = false;
    p.teleport(x, z, yawDeg);
    p.pitch = (pitchDeg * Math.PI) / 180;
    if (height !== undefined) {
      p.flying = true;
      p.y = this.hf.heightAt(x, z) + height;
      p.update(0, this.input, false);
    }
    p.applyTo(this.view.camera);
  }

  destroy(): void {
    this.releaseLock();
    for (const d of this.disposers) d();
    this.app.ticker.remove(this.tick);
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  }
}

interface BuiltWorld {
  hf: Heightfield;
  sky: Sky;
  player: Player;
  map: MapImage;
  facadeMaterials: Material3D[];
  lampMaterial: Material3D;
}
