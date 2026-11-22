// HEAT STACK — open world: drive a GTA-style chase-cam car through Bryce Valley, Neon City and Maya Studio.
// Rendering: WebGL2 ray marcher (world-shader.js). Physics samples the exact same terrain function in JS.
import { WORLD_VS, WORLD_FS } from './world-shader.js';

// ------------------------------------------------------------------ terrain mirror (must match GLSL)
function hf(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 16777216;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return mix(mix(hf(ix, iy), hf(ix + 1, iy), ux), mix(hf(ix, iy + 1), hf(ix + 1, iy + 1), ux), uy);
}
function fbm2(px, py, oct) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * vnoise(px, py); px = px * 2.02 + 17.3; py = py * 2.02 + 9.1; a *= 0.5; } return s; }
function rectMask(x, z, ax, az, bx, bz, fe) { const d = Math.max(Math.max(ax - x, x - bx), Math.max(az - z, z - bz)); return 1 - smooth(0, fe, d); }
export const roadZ = x => Math.sin(x * 0.008) * 40;
export function terrainH(x, z, oct = 4) {
  const m = fbm2(x * 0.0045, z * 0.0045, oct);
  let h = Math.pow(Math.max(m - 0.18, 0), 1.6) * 420;
  const road = 1 - smooth(14, 60, Math.abs(z - roadZ(x)));
  const road2 = (1 - smooth(10, 40, Math.abs(x))) * (z >= 0 ? 1 : 0) * (z <= 170 ? 1 : 0);
  const city = rectMask(x, z, 60, -200, 460, 200, 40);
  const studio = rectMask(x, z, -90, 140, 90, 330, 40);
  const road3 = (1 - smooth(10, 40, Math.abs(x + 240))) * (z >= -45 ? 1 : 0) * (z <= 150 ? 1 : 0);
  const fl = Math.max(Math.max(Math.max(road, road2), road3), Math.max(city, studio));
  h = mix(h, 0.6, fl);
  const ld = Math.hypot(x + 240, z - 200);
  h = mix(h, -10, 1 - smooth(50, 130, ld));
  h += smooth(470, 600, Math.max(Math.abs(x), Math.abs(z))) * 220;
  return h;
}
function building(cx, cz) {
  const hs = hf(cx + 100, cz + 100);
  if (hs < 0.14) return null;
  return { h: 14 + hs * hs * 95, w: 8 + hf(cx + 7, cz + 3) * 3 };
}
const inCity = (x, z) => x > 80 && x < 440 && z > -180 && z < 180;
function solidAt(x, y, z) {
  if (inCity(x, z)) {
    const cx = Math.floor(x / 32), cz = Math.floor(z / 32), b = building(cx, cz);
    if (b && y < b.h + 0.5 && Math.abs(x - (cx + 0.5) * 32) < b.w + 0.6 && Math.abs(z - (cz + 0.5) * 32) < b.w + 0.6) return true;
  }
  return y < Math.max(terrainH(x, z, 3), 0) + 0.8;
}

export function districtAt(x, z) {
  if (x > 70 && x < 450 && z > -190 && z < 190) return 'NEON CITY';
  if (Math.hypot(x, z - 240) < 115) return 'MAYA STUDIO';
  if (Math.hypot(x + 240, z - 200) < 150) return 'MIRROR LAKE';
  return 'BRYCE VALLEY';
}

// Jobs placed in the world — drive in and stop to start a stacking job.
const JOBS = [
  { id: 'tower', name: 'Tower Job', who: 'Lou Vance', x: 256, z: 16, scene: 'city' },
  { id: 'docks', name: 'Dockside Drop', who: 'Nina Cross', x: 400, z: -144, scene: 'city' },
  { id: 'pass', name: 'Mountain Pass', who: 'Big Tomo', x: -150, z: roadZ(-150), scene: 'bryce' },
  { id: 'lake', name: 'Mirror Lake Heist', who: 'Ada Quill', x: -240, z: 70, scene: 'bryce' },
  { id: 'studio', name: 'Studio Session', who: 'Maya crew', x: 0, z: 196, scene: 'bryce', studio: true },
];

// ------------------------------------------------------------------ world
export class World {
  constructor(hooks) {
    this.h = hooks; // { audio, onJob(job), wallet: {get, add}, isTouch, toast }
    this.active = false;
    this.car = { x: 0, z: 0, y: 1, yaw: Math.PI / 2, v: [0, 0], speed: 0, pitch: 0, roll: 0, vy: 0, brake: 0 };
    this.cam = { eye: [0, 8, -12], target: [0, 1, 0], orbit: 0, orbitHold: 0, pitch: 0.22, dist: 11, mode: 0 };
    this.keys = new Set();
    this.touch = { steer: 0, gas: 0, brake: 0, drift: 0 };
    this.stars = 0; this.heatVal = 0;
    this.cooldown = {};
    this.scale = hooks.isTouch ? 0.55 : 0.7; this.quality = hooks.isTouch ? 1 : 2;
    this.district = '';
    this.pickups = [];
    for (let i = 0; i < 18; i++) this.pickups.push(this.spawnPickup(i));
    this.near = null;
    this.flash = 0;
    this.fps = { acc: 0, n: 0, slow: 0, good: 0 };
  }

  spawnPickup(i) {
    // Spread along the highway, the city streets and the studio road.
    const r = hf(i * 13 + Math.floor(performance.now() / 1000), 77);
    if (i % 3 === 0) { const x = 100 + Math.floor(r * 11) * 32; const z = -176 + Math.floor(hf(i, 5) * 11) * 32 + 16; return { x, z, alive: true, t: 0 }; }
    if (i % 3 === 1) { const x = -420 + r * 470; return { x, z: roadZ(x), alive: true, t: 0 }; }
    return { x: (r - 0.5) * 8, z: 20 + hf(i, 9) * 140, alive: true, t: 0 };
  }

  buildUI() {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'world'; root.hidden = true;
    root.innerHTML = `
      <canvas id="worldCv"></canvas>
      <div class="w-top">
        <button class="chip" data-w="menu">☰ Menu</button>
        <button class="chip" data-w="radio" id="wRadio">📻</button>
        <button class="chip" data-w="cam">🎥 Cam</button>
        <span class="w-fps" id="wFps"></span>
      </div>
      <div class="w-stats">
        <div id="wStars" class="w-stars"></div>
        <div id="wCash" class="w-cash">$0</div>
      </div>
      <canvas id="radar" width="320" height="320"></canvas>
      <div class="w-speed"><b id="wSpeed">0</b><small>km/h</small></div>
      <div id="wLoc" class="w-loc"></div>
      <div id="wChallenge" hidden></div>
      <div id="wPrompt" class="w-prompt" hidden></div>
      <div class="w-help" id="wHelp">W/↑ gas · S/↓ brake · A/D steer · Space drift · Shift boost · E start job · R radio · V camera · drag to look</div>
      <div class="w-touch" id="wTouch" hidden>
        <div class="w-pad"><button data-t="left">◀</button><button data-t="right">▶</button></div>
        <div class="w-pad r"><button data-t="drift" class="sm">DRIFT</button><button data-t="brake">▼</button><button data-t="gas" class="hot">▲</button></div>
      </div>`;
    document.querySelector('#stage').appendChild(root);
    this.root = root;
    this.cv = root.querySelector('#worldCv');
    this.radar = root.querySelector('#radar');
    root.querySelector('[data-w="menu"]').onclick = () => this.h.onExit();
    root.querySelector('[data-w="radio"]').onclick = () => this.h.radio();
    root.querySelector('[data-w="cam"]').onclick = () => { this.cam.mode = (this.cam.mode + 1) % 3; };
    root.querySelector('#wPrompt').onclick = () => this.enterJob();
    // touch driving controls (hold)
    root.querySelectorAll('[data-t]').forEach(b => {
      const k = b.dataset.t;
      const set = v => {
        if (k === 'left') this.touch.steer = v ? -1 : (this.touch.steer === -1 ? 0 : this.touch.steer);
        else if (k === 'right') this.touch.steer = v ? 1 : (this.touch.steer === 1 ? 0 : this.touch.steer);
        else this.touch[k] = v ? 1 : 0;
        b.classList.toggle('down', !!v);
      };
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); this.h.audio.unlock(); set(1); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => set(0)));
    });
    // drag to look around (mouse or one finger on the scene)
    let drag = null;
    this.cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointermove', e => {
      if (!drag) return;
      this.cam.orbit = clamp(this.cam.orbit - (e.clientX - drag.x) * 0.008, -Math.PI, Math.PI);
      this.cam.pitch = clamp(this.cam.pitch + (e.clientY - drag.y) * 0.004, 0.02, 1.1);
      this.cam.orbitHold = 1.6;
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = () => { drag = null; };
    this.cv.addEventListener('pointerup', end); this.cv.addEventListener('pointercancel', end);
    this.cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist = clamp(this.cam.dist * Math.exp(e.deltaY * 0.001), 6, 40); }, { passive: false });
    addEventListener('keydown', e => {
      if (!this.active) return;
      if (/INPUT|SELECT|TEXTAREA/.test(e.target?.tagName)) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Enter') this.enterJob();
      if (e.code === 'KeyR') this.h.radio();
      if (e.code === 'KeyV') this.cam.mode = (this.cam.mode + 1) % 3;
      if (e.code === 'Escape') this.h.onExit();
      this.h.audio.unlock();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('resize', () => this.active && this.resize());
  }

  initGL() {
    if (this.gl) return true;
    const gl = this.cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) return false;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, WORLD_VS), fs = sh(gl.FRAGMENT_SHADER, WORLD_FS);
    if (!vs || !fs) return false;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return false; }
    this.gl = gl; this.prog = p; gl.useProgram(p);
    this.u = {};
    for (const n of ['uRes', 'uEye', 'uTarget', 'uCar', 'uCarM0', 'uCarM1', 'uCarM2', 'uCarCol', 'uMarks', 'uMisc']) this.u[n] = gl.getUniformLocation(p, n);
    this.vao = gl.createVertexArray();
    return true;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
    this.cv.width = Math.max(1, Math.round(w * dpr * this.scale));
    this.cv.height = Math.max(1, Math.round(h * dpr * this.scale));
    this.gl?.viewport(0, 0, this.cv.width, this.cv.height);
  }

  buildRadarMap() {
    if (this.mapImg) return;
    const N = 240, c = document.createElement('canvas'); c.width = c.height = N;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = 600 - (i + 0.5) / N * 1200, z = 600 - (j + 0.5) / N * 1200;
      const h = terrainH(x, z, 3);
      let r, g, b;
      if (h < 0) { r = 40; g = 110; b = 150; }
      else if (h < 2) { r = 70; g = 78; b = 70; }
      else if (h > 160) { r = 220; g = 225; b = 235; }
      else { const k = Math.min(1, h / 140); r = 60 + k * 70; g = 95 + k * 30; b = 50 + k * 40; }
      if (Math.abs(z - roadZ(x)) < 10 && x < 70) { r = g = b = 140; }
      if (Math.abs(x) < 8 && z > 0 && z < 160) { r = g = b = 140; }
      if (Math.abs(x + 240) < 8 && z > -40 && z < 110) { r = g = b = 140; }
      if (inCity(x, z)) {
        const cx = Math.floor(x / 32), cz = Math.floor(z / 32), qx = x - (cx + 0.5) * 32, qz = z - (cz + 0.5) * 32;
        const bd = building(cx, cz);
        if (bd && Math.abs(qx) < bd.w && Math.abs(qz) < bd.w) { r = 34; g = 30; b = 52; } else { r = 120; g = 120; b = 130; }
      }
      if (Math.hypot(x, z - 240) < 110) { r = 150; g = 152; b = 155; }
      const o = (j * N + i) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapImg = c;
  }

  start(resume = false) {
    this.buildUI();
    if (!this.initGL()) { this.h.toast('Open World needs WebGL2'); return false; }
    this.buildRadarMap();
    if (!resume) {
      const c = this.car; c.x = -60; c.z = roadZ(-60); c.yaw = Math.PI / 2; c.v = [0, 0]; c.speed = 0;
      c.y = Math.max(terrainH(c.x, c.z), 0);
    } else {
      // pull away from the marker so we don't immediately re-trigger
      const c = this.car; c.v = [0, 0]; c.speed = 0;
    }
    if (!resume) {
      this.race = this.variant === 'getaway' ? { left: 90, index: 0, points: [[-120, roadZ(-120)], [-200, roadZ(-200)], [-240, 60]] } : null;
    }
    if (!resume && this.race) this.car.yaw = -Math.PI/2;
    this.root.querySelector('#wChallenge').hidden = !this.race;
    this.root.hidden = false;
    this.root.querySelector('#wTouch').hidden = !this.h.isTouch;
    this.root.querySelector('#wHelp').hidden = this.h.isTouch;
    clearTimeout(this.helpTimer); this.helpTimer = setTimeout(() => { this.root.querySelector('#wHelp').hidden = true; }, 6500);
    this.active = true;
    this.resize();
    this.last = performance.now();
    this.h.audio.unlock(); this.h.audio.start();
    this.engineSound(true);
    this.district = '';
    const loop = now => { if (!this.active) return; requestAnimationFrame(loop); this.frame(now); };
    requestAnimationFrame(loop);
    return true;
  }

  stop() {
    this.active = false;
    if (this.root) this.root.hidden = true;
    this.engineSound(false);
    this.keys.clear();
    this.touch = { steer: 0, gas: 0, brake: 0, drift: 0 };
  }

  engineSound(on) {
    const a = this.h.audio; if (!a.ctx) return;
    if (on && !this.eng) {
      const c = a.ctx, o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -1200 + 7;
      f.type = 'lowpass'; f.frequency.value = 400; g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g).connect(a.sBus);
      o1.start(); o2.start();
      this.eng = { o1, o2, f, g };
    } else if (!on && this.eng) {
      const e = this.eng; this.eng = null;
      e.g.gain.setTargetAtTime(0, a.ctx.currentTime, 0.05);
      setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch { /* done */ } }, 300);
    }
  }

  controls() {
    const k = this.keys;
    let steer = (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0) + (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    let gas = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let drift = k.has('Space') ? 1 : 0;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0;
    steer += this.touch.steer; gas = Math.max(gas, this.touch.gas); brake = Math.max(brake, this.touch.brake); drift = Math.max(drift, this.touch.drift);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer += ax;
      gas = Math.max(gas, p.buttons[7]?.value || 0); brake = Math.max(brake, p.buttons[6]?.value || 0);
      if (p.buttons[0]?.pressed) drift = 1;
      if (p.buttons[1]?.pressed) boost = 1;
      if (p.buttons[2]?.pressed && !this.padX) this.enterJob();
      this.padX = !!p.buttons[2]?.pressed;
      const rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      if (Math.abs(rx) > 0.2 || Math.abs(ry) > 0.2) { this.cam.orbit = clamp(this.cam.orbit - rx * 0.05, -Math.PI, Math.PI); this.cam.pitch = clamp(this.cam.pitch + ry * 0.02, 0.02, 1.1); this.cam.orbitHold = 1.2; }
      break;
    }
    return { steer: clamp(steer, -1, 1), gas, brake, drift, boost };
  }

  physics(dt) {
    const c = this.car, ctl = this.controls();
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const rx = fz, rz = -fx;
    let fwd = c.v[0] * fx + c.v[1] * fz;
    let lat = c.v[0] * rx + c.v[1] * rz;
    const ground = terrainH(c.x, c.z);
    const inWater = ground < 0;
    const maxV = (ctl.boost ? 78 : 58) * (inWater ? 0.35 : 1);
    if (ctl.gas) fwd += (ctl.boost ? 34 : 24) * dt * ctl.gas;
    if (ctl.brake) fwd -= (fwd > 1 ? 45 : 16) * dt * ctl.brake;
    fwd = clamp(fwd, -18, maxV);
    fwd *= Math.pow(inWater ? 0.4 : 0.82, dt);            // rolling + air drag
    if (!ctl.gas && !ctl.brake) fwd *= Math.pow(0.6, dt);
    const grip = ctl.drift ? 0.9 : 0.0008;
    lat *= Math.pow(grip, dt);
    const steerRate = ctl.steer * clamp(Math.abs(fwd) / 10, 0, 1) * (ctl.drift ? 2.6 : 1.9) * Math.sign(fwd || 1);
    c.yaw -= steerRate * dt * (1 - clamp(Math.abs(fwd) / 140, 0, 0.45));
    // slope resistance
    const ahead = terrainH(c.x + fx * 2, c.z + fz * 2);
    const slope = (ahead - ground) / 2;
    if (slope > 0.5) fwd *= Math.pow(0.15, dt * (slope - 0.5) * 4);
    fwd -= slope * 9.8 * dt * 0.6;
    c.v = [fx * fwd + rx * lat, fz * fwd + rz * lat];
    c.x += c.v[0] * dt; c.z += c.v[1] * dt;
    c.x = clamp(c.x, -560, 560); c.z = clamp(c.z, -560, 560);
    c.speed = Math.hypot(c.v[0], c.v[1]);
    c.brake = ctl.brake ? 1 : 0;
    c.drifting = ctl.drift && c.speed > 12;
    this.collide();
    // ride height + suspension
    const g2 = terrainH(c.x, c.z);
    const target = Math.max(g2, inWater ? 0 : g2);
    if (c.y > target + 0.05) { c.vy -= 30 * dt; c.y += c.vy * dt; if (c.y < target) { c.y = target; c.vy = 0; } }
    else { c.y += (target - c.y) * Math.min(1, dt * 20); c.vy = 0; }
    const hf_ = terrainH(c.x + fx * 1.6, c.z + fz * 1.6), hb = terrainH(c.x - fx * 1.6, c.z - fz * 1.6);
    const hr = terrainH(c.x + rx * 1, c.z + rz * 1), hl = terrainH(c.x - rx * 1, c.z - rz * 1);
    const tp = inWater ? 0 : Math.atan2(hf_ - hb, 3.2), tr = inWater ? 0 : Math.atan2(hr - hl, 2);
    c.pitch += (tp - c.pitch) * Math.min(1, dt * 8); c.roll += (tr + lat * 0.004 - c.roll) * Math.min(1, dt * 8);
    return ctl;
  }

  collide() {
    const c = this.car;
    const push = (nx, nz, depth) => {
      c.x += nx * depth; c.z += nz * depth;
      const vn = c.v[0] * nx + c.v[1] * nz;
      if (vn < 0) {
        const impact = -vn;
        c.v[0] -= nx * vn * 1.4; c.v[1] -= nz * vn * 1.4;
        c.v[0] *= 0.6; c.v[1] *= 0.6;
        if (impact > 8) { this.flash = Math.min(0.6, impact * 0.02); this.h.audio.play('harddrop'); this.h.rumble?.(Math.min(1, impact / 30)); if (inCity(c.x, c.z) && impact > 18) this.addHeat(0.35); }
      }
    };
    if (inCity(c.x, c.z)) {
      const cx = Math.floor(c.x / 32), cz = Math.floor(c.z / 32);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const b = building(cx + dx, cz + dz); if (!b) continue;
        const bx = (cx + dx + 0.5) * 32, bz = (cz + dz + 0.5) * 32;
        const qx = c.x - bx, qz = c.z - bz, w = b.w + 1.3;
        if (Math.abs(qx) < w && Math.abs(qz) < w) {
          const px = w - Math.abs(qx), pz = w - Math.abs(qz);
          if (px < pz) push(Math.sign(qx), 0, px); else push(0, Math.sign(qz), pz);
        }
      }
    }
    for (const [ox, oz, r] of [[-30, 240, 14], [0, 265, 12], [32, 235, 11], [-5, 205, 11]]) {
      const dx = c.x - ox, dz = c.z - oz, d = Math.hypot(dx, dz);
      if (d < r && d > 0.001) push(dx / d, dz / d, r - d);
    }
  }

  addHeat(v) {
    const before = this.stars;
    this.heatVal = clamp(this.heatVal + v, 0, 5);
    this.stars = Math.floor(this.heatVal);
    if (this.stars > before) { this.h.audio.play('siren'); this.h.toast(`${'★'.repeat(this.stars)}`, '#ffcf4a'); }
  }

  updateHeat(dt) {
    const c = this.car;
    // speed cameras in the city
    if (inCity(c.x, c.z) && c.speed > 52) this.addHeat(dt * 0.12);
    const hidden = !inCity(c.x, c.z) && c.speed < 30;
    this.heatVal = Math.max(0, this.heatVal - dt * (hidden ? 0.12 : 0.025));
    const s = Math.floor(this.heatVal);
    if (s < this.stars) { this.stars = s; if (!s) this.h.toast('LOST THE COPS', '#3dff8a'); }
  }

  pickupsUpdate(dt) {
    const c = this.car;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.alive) { p.t -= dt; if (p.t <= 0) this.pickups[i] = this.spawnPickup(i + Math.floor(Math.random() * 1000)); continue; }
      if (Math.hypot(p.x - c.x, p.z - c.z) < 4) {
        p.alive = false; p.t = 30;
        const amt = 150 + Math.floor(Math.random() * 6) * 50;
        this.h.wallet.add(amt);
        this.h.audio.play('cash');
        this.h.toast(`+$${amt}`, '#ffcf4a');
        if (inCity(c.x, c.z) && Math.random() < 0.35) this.addHeat(0.6);
      }
    }
    // nearest job
    this.near = null;
    for (const j of JOBS) {
      const d = Math.hypot(j.x - c.x, j.z - c.z);
      if (d < 9 && !(this.cooldown[j.id] > 0)) { this.near = j; break; }
    }
    for (const k in this.cooldown) this.cooldown[k] -= dt;
    const pr = this.root.querySelector('#wPrompt');
    if (this.race) this.near = null;
    if (this.near) {
      pr.hidden = false;
      const label = `${this.h.isTouch ? 'Tap' : 'Press E'} · ${this.near.name} — ${this.near.who}`;
      if (pr.textContent !== label) pr.textContent = label;
    } else pr.hidden = true;
  }

  enterJob() {
    if (this.race || !this.near) return;
    const j = this.near;
    this.cooldown[j.id] = 20;
    // park the car just past the marker
    this.car.x -= Math.sin(this.car.yaw) * 10; this.car.z -= Math.cos(this.car.yaw) * 10;
    this.h.onJob(j, this.stars);
  }

  camera(dt) {
    const c = this.car, cm = this.cam;
    if (cm.orbitHold > 0) cm.orbitHold -= dt; else cm.orbit *= Math.pow(0.08, dt);
    const dists = [cm.dist, cm.dist * 1.8, 0];
    const d = dists[cm.mode];
    const yaw = c.yaw + cm.orbit;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let eye, target;
    if (cm.mode === 2) {           // hood cam
      eye = [c.x + Math.sin(c.yaw) * 1.2, c.y + 1.9, c.z + Math.cos(c.yaw) * 1.2];
      target = [eye[0] + fx * 10, eye[1] - 0.6, eye[2] + fz * 10];
    } else {
      const p = cm.pitch;
      const want = [c.x - fx * d * Math.cos(p), c.y + 1.2 + d * Math.sin(p), c.z - fz * d * Math.cos(p)];
      // pull the camera in front of walls / hills between it and the car
      const from = [c.x, c.y + 1.6, c.z];
      for (let i = 1; i <= 14; i++) {
        const f = i / 14, px = from[0] + (want[0] - from[0]) * f, py = from[1] + (want[1] - from[1]) * f, pz = from[2] + (want[2] - from[2]) * f;
        if (solidAt(px, py, pz)) {
          const g = (i - 1.5) / 14;
          if (g < 0.45) { want[0] = c.x - fx * 1.5; want[1] = c.y + 9; want[2] = c.z - fz * 1.5; }   // boxed in: crane up over the car
          else for (let k = 0; k < 3; k++) want[k] = from[k] + (want[k] - from[k]) * g;
          cm.eye = cm.eye.map((v, k2) => v + (want[k2] - v) * 0.5);
          break;
        }
      }
      const k = Math.min(1, dt * 6);
      cm.eye = cm.eye.map((v, i) => v + (want[i] - v) * k);
      eye = cm.eye;
      target = [c.x + Math.sin(c.yaw) * 3, c.y + 1.4, c.z + Math.cos(c.yaw) * 3];
    }
    const zoom = 1.05 + clamp(c.speed / 80, 0, 1) * 0.35;   // FOV widens with speed
    return { eye, target, zoom };
  }

  carMatrix() {
    const c = this.car;
    // local axes: right, up, forward (world -> local rows)
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cr = Math.cos(c.roll), sr = Math.sin(c.roll);
    const f = [sy * cp, sp, cy * cp];
    let r = [cy, 0, -sy];
    r = [r[0] * cr, sr, r[2] * cr];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const ul = Math.hypot(...u) || 1;
    return [r, u.map(v => v / ul), f];
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const ctl = this.physics(dt);
    this.updateHeat(dt);
    this.pickupsUpdate(dt);
    if (this.race) {
      const r = this.race; r.left = Math.max(0, r.left - dt);
      const target = r.points[r.index];
      if (target && Math.hypot(this.car.x-target[0], this.car.z-target[1]) < 14) { r.index++; this.h.audio.play('cash'); }
      const card = this.root.querySelector('#wChallenge');
      if (r.index === r.points.length || r.left === 0) {
        const won = r.index === r.points.length;
        if (won) this.h.wallet.add(1500);
        card.textContent = won ? 'GETAWAY COMPLETE · +$1,500' : 'TIME UP · return to menu to retry';
        this.race = null;
        setTimeout(() => { card.hidden = true; }, 3500);
      } else {
        const distance = Math.round(Math.hypot(this.car.x-r.points[r.index][0], this.car.z-r.points[r.index][1]));
        card.textContent = `GETAWAY · ${Math.ceil(r.left)}s · checkpoint ${r.index+1}/3 · ${distance}m`;
      }
    }
    this.flash *= Math.pow(0.02, dt);
    const { eye, target, zoom } = this.camera(dt);
    // district toast
    const dname = districtAt(this.car.x, this.car.z);
    if (dname !== this.district) {
      this.district = dname;
      const el = this.root.querySelector('#wLoc');
      el.textContent = dname; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(this.locationTimer); this.locationTimer = setTimeout(() => el.classList.remove('show'), 3300);
    }
    if (this.eng) {
      const a = this.h.audio.ctx.currentTime, sp = this.car.speed;
      this.eng.o1.frequency.setTargetAtTime(38 + sp * 2.1 + ctl.gas * 14 + (sp % 22) * 1.5, a, 0.05);
      this.eng.o2.frequency.setTargetAtTime(38 + sp * 2.1, a, 0.05);
      this.eng.f.frequency.setTargetAtTime(300 + sp * 18 + ctl.gas * 400, a, 0.05);
      this.eng.g.gain.setTargetAtTime(0.035 + ctl.gas * 0.035, a, 0.08);
    }
    this.h.audio.intensity = this.stars;
    this.draw(eye, target, zoom);
    this.hud();
    // adaptive resolution
    const F = this.fps; F.acc += dt; F.n++;
    if (F.acc >= 1) {
      const fps = F.n / F.acc; F.acc = 0; F.n = 0;
      this.root.querySelector('#wFps').textContent = `${Math.round(fps)} fps · ${Math.round(this.scale * 100)}% · q${this.quality}`;
      if (fps < 40) { F.slow++; F.good = 0; } else if (fps > 57) { F.good++; F.slow = 0; } else { F.slow = 0; F.good = 0; }
      if (F.slow >= 2) { F.slow = 0; if (this.scale > 0.4) { this.scale = Math.max(0.35, this.scale - 0.1); this.resize(); } else if (this.quality > 0) this.quality--; }
      if (F.good >= 5) { F.good = 0; if (this.quality < 2) this.quality++; else if (this.scale < 0.9) { this.scale += 0.05; this.resize(); } }
    }
  }

  draw(eye, target, zoom) {
    const gl = this.gl, u = this.u, c = this.car;
    gl.useProgram(this.prog);
    gl.uniform4f(u.uRes, this.cv.width, this.cv.height, performance.now() / 1000, this.quality);
    gl.uniform4f(u.uEye, eye[0], eye[1], eye[2], zoom);
    gl.uniform4f(u.uTarget, target[0], target[1], target[2], this.stars);
    gl.uniform4f(u.uCar, c.x, c.y, c.z, c.brake);
    const [r, up, f] = this.carMatrix();
    gl.uniform4f(u.uCarM0, r[0], r[1], r[2], 0);
    gl.uniform4f(u.uCarM1, up[0], up[1], up[2], 0);
    gl.uniform4f(u.uCarM2, f[0], f[1], f[2], 0);
    const col = this.h.carColor();
    gl.uniform4f(u.uCarCol, col[0], col[1], col[2], this.stars > 0 ? Math.min(1, this.stars / 3) : 0);
    // markers: jobs + nearest live pickups
    const marks = new Float32Array(32);
    let n = 0;
    if (this.race) { const [x,z] = this.race.points[this.race.index]; marks.set([x,z,1,1], 0); n++; }
    for (const j of (this.race ? [] : JOBS)) { if (n >= 8) break; marks.set([j.x, j.z, j.studio ? 3 : 1, this.cooldown[j.id] > 0 ? 0 : 1], n * 4); n++; }
    const live = this.pickups.filter(p => p.alive).map(p => [p, Math.hypot(p.x - c.x, p.z - c.z)]).sort((a, b) => a[1] - b[1]);
    for (const [p] of live) { if (n >= 8) break; marks.set([p.x, p.z, 2, 1], n * 4); n++; }
    gl.uniform4fv(u.uMarks, marks);
    gl.uniform4f(u.uMisc, this.flash, 0, 0, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  hud() {
    const c = this.car;
    const sp = Math.round(c.speed * 3.6);
    const el = this.root.querySelector('#wSpeed'); if (el.textContent !== String(sp)) el.textContent = sp;
    const st = this.root.querySelector('#wStars');
    const key = String(this.stars);
    if (st.dataset.k !== key) { st.dataset.k = key; st.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < this.stars ? 'on' : ''}">★</i>`).join(''); }
    const cash = '$' + this.h.wallet.get().toLocaleString();
    const ce = this.root.querySelector('#wCash'); if (ce.textContent !== cash) ce.textContent = cash;
    this.drawRadar();
  }

  drawRadar() {
    const cv = this.radar, ctx = cv.getContext('2d'), S = cv.width, R = S / 2, c = this.car;
    const range = 160 + clamp(c.speed, 0, 60) * 1.5; // units shown from centre to edge
    const k = R / range;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 4, 0, Math.PI * 2); ctx.clip();
    ctx.translate(R, R);
    ctx.rotate(c.yaw);                 // heading up
    ctx.scale(k, k);
    // map image covers world [-600,600] with +z up
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImg, c.x - 600, c.z - 600, 1200, 1200);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-2000, -2000, 4000, 4000);
    const blip = (x, z, color, size, shape = 'dot') => {
      const px = -(x - c.x), pz = -(z - c.z);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (shape === 'sq') ctx.rect(px - size / k, pz - size / k, 2 * size / k, 2 * size / k); else ctx.arc(px, pz, size / k, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of this.pickups) if (p.alive) blip(p.x, p.z, '#3dff8a', 4);
    if (this.race) { const [x,z] = this.race.points[this.race.index]; blip(x,z,'#29e6ff',12,'sq'); }
    for (const j of (this.race ? [] : JOBS)) blip(j.x, j.z, j.studio ? '#5ab4ff' : '#ffcf4a', 8, 'sq');
    ctx.restore();
    // edge arrows for off-radar jobs
    const guidance = this.race ? [{x:this.race.points[this.race.index][0], z:this.race.points[this.race.index][1]}] : JOBS;
    for (const j of guidance) {
      const dx = j.x - c.x, dz = j.z - c.z, d = Math.hypot(dx, dz);
      if (d * k < R - 10) continue;
      const ang = Math.atan2(dx, dz) - c.yaw;
      const ex = R - Math.sin(ang) * (R - 14), ey = R - Math.cos(ang) * (R - 14);
      ctx.fillStyle = j.studio ? '#5ab4ff' : '#ffcf4a'; ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
    }
    // player arrow
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(R, R - 14); ctx.lineTo(R + 9, R + 10); ctx.lineTo(R, R + 5); ctx.lineTo(R - 9, R + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    // ring + north
    ctx.strokeStyle = this.stars ? (Math.sin(performance.now() / 120) > 0 ? '#ff3355' : '#3d7bff') : 'rgba(255,255,255,.5)';
    ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(R, R, R - 4, 0, Math.PI * 2); ctx.stroke();
    const na = -c.yaw; ctx.fillStyle = '#fff'; ctx.font = '900 22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', R - Math.sin(na) * (R - 22), R - Math.cos(na) * (R - 22));
  }
}
