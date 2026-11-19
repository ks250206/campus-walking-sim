import type { Camera3D } from '@pixi/3d';
import type { CollisionWorld } from './collision';
import type { Heightfield } from './heightfield';

export interface WalkSurface {
  /** その場所にある床 (橋・トンネル・階段など) のうち、maxY 以下でいちばん高いもの。無ければ -Infinity */
  deckAt(x: number, z: number, maxY: number): number;
}

export interface PlayerInput {
  forward: number; // -1 .. 1
  strafe: number; // -1 .. 1
  run: boolean;
  jump: boolean;
  up: number; // 飛行モードの上下
}

const EYE_HEIGHT = 1.62;
const RADIUS = 0.36;
const WALK_SPEED = 1.9;
const RUN_SPEED = 5.4;
const FLY_SPEED = 14;
const FLY_FAST = 55;
const GRAVITY = 14;
const JUMP_SPEED = 4.6;
const STEP_HEIGHT = 0.55;
const PITCH_LIMIT = (88 * Math.PI) / 180;

/** 一人称の歩行者。地形に沿って歩き、壁にぶつかる */
export class Player {
  x = 0;
  y = 0; // 足元の高さ
  z = 0;
  /** 0 = 北向き、正で左 (西) へ回る */
  yaw = 0;
  pitch = 0;
  flying = false;
  onGround = true;
  speed = 0;

  private vx = 0;
  private vy = 0;
  private vz = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private eyeY = 0;
  private readonly resolved = { x: 0, z: 0 };

  private readonly hf: Heightfield;
  private readonly collision: CollisionWorld;
  private readonly surface: WalkSurface;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(
    hf: Heightfield,
    collision: CollisionWorld,
    surface: WalkSurface,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    this.hf = hf;
    this.collision = collision;
    this.surface = surface;
    this.bounds = bounds;
  }

  teleport(x: number, z: number, yawDeg = 0): void {
    this.x = x;
    this.z = z;
    this.y = this.groundAt(x, z, Infinity);
    this.eyeY = this.y + EYE_HEIGHT;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = 0;
    this.vx = this.vy = this.vz = 0;
    this.onGround = true;
    this.speed = this.bobAmount = 0;
  }

  /** テレポートで立つ床の高さで、体の周囲に歩ける余裕があるか。 */
  canStandAt(x: number, z: number): boolean {
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    const y = this.groundAt(x, z, Infinity);
    if (this.collision.resolve(x, z, RADIUS + 0.5, y, this.resolved)) return false;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (Math.abs(this.groundAt(x + dx, z + dz, Infinity) - y) > STEP_HEIGHT) return false;
    }
    return true;
  }

  /** 入力の相対移動量を角度に変換して視点を回す */
  look(dx: number, dy: number, radiansPerUnit: number, invertY: boolean): void {
    this.yaw -= dx * radiansPerUnit;
    this.pitch -= dy * radiansPerUnit * (invertY ? -1 : 1);
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** その位置で立てる床の高さ。fromY より STEP_HEIGHT 以上高い床には乗れない */
  private groundAt(x: number, z: number, fromY: number): number {
    const ground = this.hf.heightAt(x, z);
    const deck = this.surface.deckAt(x, z, fromY + STEP_HEIGHT);
    return deck > ground ? deck : ground;
  }

  update(dt: number, input: PlayerInput, headBob: boolean): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // 前 = (-sin, -cos)、右 = (cos, -sin)
    let mx = -sin * input.forward + cos * input.strafe;
    let mz = -cos * input.forward - sin * input.strafe;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }

    if (this.flying) {
      const speed = input.run ? FLY_FAST : FLY_SPEED;
      const k = 1 - Math.exp(-dt * 8);
      const cp = Math.cos(this.pitch);
      const fy = Math.sin(this.pitch) * input.forward + input.up;
      this.vx += (mx * cp * speed + cos * input.strafe * (1 - cp) * speed - this.vx) * k;
      this.vz += (mz * cp * speed + -sin * input.strafe * (1 - cp) * speed - this.vz) * k;
      this.vy += (fy * speed - this.vy) * k;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      const floor = this.hf.heightAt(this.x, this.z) + 0.2;
      if (this.y < floor) this.y = floor;
      this.onGround = false;
      this.speed = Math.hypot(this.vx, this.vz);
      this.eyeY = this.y + EYE_HEIGHT;
      this.bobAmount = 0;
      return;
    }

    const target = input.run ? RUN_SPEED : WALK_SPEED;
    const accel = this.onGround ? 12 : 2.5;
    const k = 1 - Math.exp(-dt * accel);
    this.vx += (mx * target - this.vx) * k;
    this.vz += (mz * target - this.vz) * k;

    if (this.onGround && input.jump) {
      this.vy = JUMP_SPEED;
      this.onGround = false;
    }

    // 水平移動 → 壁から押し戻す
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    this.collision.resolve(nx, nz, RADIUS, this.y, this.resolved);
    nx = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, this.resolved.x));
    nz = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, this.resolved.z));
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.speed = dt > 0 ? moved / dt : 0;
    this.x = nx;
    this.z = nz;

    // 垂直方向
    const ground = this.groundAt(this.x, this.z, this.y);
    if (this.onGround) {
      if (this.y - ground > STEP_HEIGHT) {
        this.onGround = false; // 段差から落ちる
      } else {
        this.y = ground;
        this.vy = 0;
      }
    }
    if (!this.onGround) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.onGround = true;
      }
    }

    // 視点: 段差で急に跳ねないように少しなめらかに追従させる
    const eyeTarget = this.y + EYE_HEIGHT;
    const follow = 1 - Math.exp(-dt * 22);
    this.eyeY += (eyeTarget - this.eyeY) * follow;
    if (Math.abs(eyeTarget - this.eyeY) > 1.2) this.eyeY = eyeTarget;

    const bobTarget = headBob && this.onGround ? Math.min(1, this.speed / WALK_SPEED) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * (1 - Math.exp(-dt * 8));
    this.bobPhase += moved * (input.run ? 4.6 : 6.6);
  }

  /** カメラに位置と向きを書き込む */
  applyTo(camera: Camera3D): void {
    const running = this.speed > WALK_SPEED * 1.4;
    const amp = (running ? 0.055 : 0.032) * this.bobAmount;
    const bobY = Math.sin(this.bobPhase) * amp;
    const bobX = Math.cos(this.bobPhase * 0.5) * amp * 0.6;
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    camera.position.set(this.x + cos * bobX, this.eyeY + bobY, this.z - sin * bobX);
    // ヨー (Y 軸) → ピッチ (X 軸) の順のクォータニオン
    const cy = Math.cos(this.yaw / 2);
    const sy = Math.sin(this.yaw / 2);
    const cx = Math.cos(this.pitch / 2);
    const sx = Math.sin(this.pitch / 2);
    camera.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
  }

  get eyeHeight(): number {
    return this.eyeY;
  }

  /** 方位 (0 = 北、時計回り、度) */
  get heading(): number {
    const deg = (-this.yaw * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
}
