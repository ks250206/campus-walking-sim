import { DirectionalLight, FlatMaterial, Mesh3D, SphereGeometry } from '@pixi/3d';
import type { Container3D, Fog, Hemisphere, ShaderBit, View3D } from '@pixi/3d';
import { noiseBit } from './shaderBits';

const LATITUDE = (35.5145 * Math.PI) / 180;
/** 太陽の赤緯 (4 月下旬ごろ) */
const DECLINATION = (12 * Math.PI) / 180;

/** 空のドーム: 天頂〜地平線のグラデーション、太陽、流れる雲 */
const skyBit: ShaderBit = {
  name: 'cwSky',
  requires: [noiseBit],
  bindings: {
    material: {
      sunDir: 'vec3<f32>',
      zenith: 'vec3<f32>',
      horizon: 'vec3<f32>',
      sunColor: 'vec3<f32>',
      cloudiness: 'f32',
    },
  },
  gl: {
    fragment: {
      material: /* glsl */ `
  {
    vec3 dir = normalize(vPosition - uCameraPosition.xyz);
    float up = max(dir.y, 0.0);
    // 地平線に近いほど白っぽく霞む
    float t = pow(1.0 - up, 3.2);
    vec3 col = mix(material.zenith, material.horizon, t);
    col = mix(col, material.horizon * 0.92, smoothstep(0.0, -0.12, dir.y));

    float sunAmt = max(dot(dir, material.sunDir), 0.0);
    col += material.sunColor * (pow(sunAmt, 9.0) * 0.16 + pow(sunAmt, 90.0) * 0.35);

    // 雲: 高さ一定の平面に投影したノイズ
    vec2 cp = dir.xz / (dir.y + 0.12) * 1.5 + vec2(uTime * 0.006, uTime * 0.0025);
    float c1 = cwFbm(cp);
    float c2 = cwFbm(cp * 2.7 + 31.0);
    float cover = smoothstep(1.0 - material.cloudiness, 1.0 - material.cloudiness + 0.38, c1 * 0.75 + c2 * 0.25);
    cover *= smoothstep(0.015, 0.16, dir.y);
    float shade = smoothstep(0.35, 0.95, c2);
    vec3 cloudLit = mix(material.horizon, vec3(1.0), 0.75) + material.sunColor * 0.12 * pow(sunAmt, 3.0);
    vec3 cloudCol = mix(cloudLit, cloudLit * vec3(0.72, 0.76, 0.84), shade * 0.55);
    col = mix(col, cloudCol, cover * 0.93);

    // 太陽の円盤
    float disc = smoothstep(0.99962, 0.99988, sunAmt);
    col += material.sunColor * disc * (1.0 - cover) * 6.0;

    albedo = decodeColor(clamp(col, 0.0, 1.0)) + material.sunColor * disc * (1.0 - cover) * 4.0;
    alpha = 1.0;
  }
`,
    },
  },
};

const mixRgb = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);
const toHex = (c: number[]): number =>
  (Math.round(Math.min(1, Math.max(0, c[0])) * 255) << 16) |
  (Math.round(Math.min(1, Math.max(0, c[1])) * 255) << 8) |
  Math.round(Math.min(1, Math.max(0, c[2])) * 255);
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Sky {
  readonly sun: DirectionalLight;
  readonly environment: Hemisphere = { skyColor: 0xbcd4f0, groundColor: 0x6b6250, intensity: 0.9 };
  readonly fog: Fog & { type: 'exp2'; density: number } = { type: 'exp2', color: 0xc4d4e2, density: 0.00055 };
  /** 太陽の方向 (地面 → 太陽) */
  readonly sunDirection = { x: 0.3, y: 0.8, z: 0.5 };
  private readonly dome: Mesh3D;
  private readonly material: FlatMaterial;
  private hour = 10.5;
  /** 0 = 昼, 1 = 夜 (窓明かりや街灯に使う) */
  night = 0;

  private readonly view: View3D;

  constructor(view: View3D, parent: Container3D, shadows: boolean) {
    this.view = view;
    this.sun = new DirectionalLight({
      color: 0xfff1dc,
      intensity: 3.2,
      castShadow: shadows,
      shadow: { cascades: 3, maxDistance: 190, lambda: 0.78, normalBias: 0.06, update: [1, 2, 3] },
    });
    parent.addChild(this.sun);

    this.material = new FlatMaterial({ baseColor: 0xffffff, doubleSided: true, fog: false, extraBits: [skyBit] });
    this.dome = new Mesh3D({
      label: 'sky',
      geometry: new SphereGeometry({ radius: 5200, widthSegments: 32, heightSegments: 20 }),
      material: this.material,
      castShadow: false,
      receiveShadow: false,
    });
    parent.addChild(this.dome);

    view.environment = this.environment;
    view.fog = this.fog;
    this.setTime(this.hour);
  }

  get time(): number {
    return this.hour;
  }

  setShadows(enabled: boolean): void {
    this.sun.castShadow = enabled;
  }

  setFogDensity(density: number): void {
    this.fog.density = density;
  }

  /** 時刻 (0–24 時、地方太陽時) から太陽・空・霞の色を決める */
  setTime(hour: number): void {
    this.hour = hour;
    const h = ((hour - 12) * 15 * Math.PI) / 180;
    const east = -Math.cos(DECLINATION) * Math.sin(h);
    const north = Math.cos(LATITUDE) * Math.sin(DECLINATION) - Math.sin(LATITUDE) * Math.cos(DECLINATION) * Math.cos(h);
    const up = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(h);
    const altitude = Math.asin(up); // rad

    // 影が真横に伸びすぎないよう、光源としての高度は少し持ち上げる
    const lightUp = Math.max(up, 0.13);
    const hl = Math.hypot(east, north) || 1;
    const hs = Math.sqrt(1 - lightUp * lightUp);
    const d = this.sunDirection;
    d.x = (east / hl) * hs;
    d.y = lightUp;
    d.z = (-north / hl) * hs;

    const day = smooth(-0.1, 0.18, up); // 0 = 夜, 1 = 昼
    const golden = 1 - smooth(0.05, 0.42, up); // 朝夕の赤み

    const sunCol = mixRgb([1.0, 0.96, 0.88], [1.0, 0.56, 0.27], golden);
    this.sun.color = toHex(sunCol);
    this.sun.intensity = 4.6 * day * (1 - golden * 0.5);

    const zenith = mixRgb(mixRgb([0.015, 0.02, 0.05], [0.27, 0.46, 0.76], day), [0.24, 0.32, 0.56], golden * day * 0.6);
    const horizon = mixRgb(mixRgb([0.03, 0.04, 0.08], [0.76, 0.84, 0.91], day), [0.98, 0.66, 0.42], golden * day * 0.8);

    // 天空光は空の色そのままだと青すぎるので、雲や霞の白を混ぜた色にする
    const skyLight = mixRgb(mixRgb(zenith, horizon, 0.6), [0.86, 0.88, 0.9], 0.45 * day);
    this.environment.skyColor = toHex(skyLight);
    this.environment.groundColor = toHex(mixRgb([0.02, 0.02, 0.03], [0.46, 0.43, 0.36], day));
    this.environment.intensity = 0.1 + 0.62 * day;
    this.fog.color = toHex(horizon);
    this.view.background = toHex(horizon);
    this.night = 1 - smooth(-0.02, 0.22, up);

    const data = this.material.data as Record<string, unknown>;
    data.sunDir = [east, up, -north];
    data.zenith = zenith;
    data.horizon = horizon;
    data.sunColor = sunCol.map((c) => c * day);
    data.cloudiness = 0.46;
    void altitude;
  }

  /** 毎フレーム: 空と光源をカメラに追従させる */
  update(cameraX: number, cameraY: number, cameraZ: number): void {
    this.dome.position.set(cameraX, cameraY, cameraZ);
    const d = this.sunDirection;
    this.sun.position.set(cameraX + d.x * 400, cameraY + d.y * 400, cameraZ + d.z * 400);
    this.sun.lookAt({ x: cameraX, y: cameraY, z: cameraZ });
  }
}
