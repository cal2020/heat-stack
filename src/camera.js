// 3D camera rig: Flat / 3D tilt / Cinematic orbit / Free (Maya-style navigation).
// Free mode uses Maya viewport conventions: Alt+LMB tumble, Alt+MMB track, Alt+RMB (or wheel) dolly, F to frame.
// On touch screens (iPhone/Android): two-finger drag tumbles, pinch dollies, double two-finger tap frames.

export const DIST = 29.5;
export const CAMERA_MODES = { flat: 'Flat (classic)', tilt: '3D tilt', orbit: 'Cinematic orbit', free: 'Free · Maya-style' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class CameraRig {
  constructor(mode = 'tilt') {
    this.mode = mode;
    this.free = { yaw: -0.38, pitch: 0.2, dist: DIST, panX: 0, panY: 0 };
    this.eye = [5, 10, 30]; this.target = [5, 10, 0.5];
    this.basis = null;
    this.onModeChange = null;
  }

  setMode(m) { if (CAMERA_MODES[m]) { this.mode = m; this.onModeChange?.(m); } }

  frame() { this.free = { yaw: -0.38, pitch: 0.2, dist: DIST, panX: 0, panY: 0 }; }

  // Enter free mode from whatever view is on screen so the switch is seamless.
  toFree() {
    if (this.mode === 'free') return;
    const d = sub(this.eye, this.target);
    const dist = Math.hypot(d[0], d[1], d[2]);
    this.free = { yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(clamp(d[1] / dist, -1, 1)), dist, panX: 0, panY: 0 };
    this.setMode('free');
  }

  // Compute eye/target for this frame. center = board centre in world units, shake = [x,y], parallax in units.
  update({ t, centerY, parallax = 0, shake = [0, 0], attract = false, forceFlat = false }) {
    const c = [5, centerY, 0.5];
    let mode = forceFlat ? 'flat' : this.mode;
    if (attract && !forceFlat) mode = 'orbit';
    let yaw, pitch, dist = DIST;
    if (mode === 'flat') {
      const cx = parallax + shake[0] + (attract ? Math.sin(t * 0.2) * 1.5 : 0);
      const cy = shake[1] + (attract ? Math.cos(t * 0.17) * 0.8 : 0);
      this.eye = [5 + cx, centerY + cy, 30];
      this.target = [5 + cx * 0.15, centerY + cy * 0.15, 0.5];
    } else {
      if (mode === 'tilt') { yaw = -0.36 + parallax * 0.035; pitch = 0.2; }
      else if (mode === 'orbit') { yaw = Math.sin(t * 0.13) * 0.55; pitch = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.09)); }
      else { yaw = this.free.yaw; pitch = this.free.pitch; dist = this.free.dist; c[0] += this.free.panX; c[1] += this.free.panY; }
      this.target = [c[0], c[1], c[2]];
      this.eye = [
        c[0] + dist * Math.sin(yaw) * Math.cos(pitch) + shake[0],
        c[1] + dist * Math.sin(pitch) + shake[1],
        c[2] + dist * Math.cos(yaw) * Math.cos(pitch),
      ];
    }
    const fw = norm(sub(this.target, this.eye));
    const rt = norm(cross(fw, [0, 1, 0]));
    const up = cross(rt, fw);
    this.basis = { fw, rt, up };
    return { eye: this.eye, target: this.target };
  }

  // World -> CSS pixel projection matching the shader's camera (uv scaled by viewport height).
  project(p, w, h, zoom) {
    const { fw, rt, up } = this.basis;
    const d = sub(p, this.eye);
    const z = Math.max(0.01, dot(d, fw));
    return [w / 2 + (dot(d, rt) / z / zoom) * h, h / 2 - (dot(d, up) / z / zoom) * h];
  }

  // Pan in the camera plane (Maya "track").
  track(dx, dy, h) {
    const k = this.free.dist / h * 0.9;
    this.free.panX = clamp(this.free.panX - dx * k * Math.cos(this.free.yaw), -15, 15);
    this.free.panY = clamp(this.free.panY + dy * k, -12, 12);
  }
  tumble(dx, dy) {
    this.free.yaw = clamp(this.free.yaw - dx * 0.006, -1.45, 1.45);
    this.free.pitch = clamp(this.free.pitch + dy * 0.005, -0.25, 1.2);
  }
  dolly(amount) { this.free.dist = clamp(this.free.dist * Math.exp(amount), 14, 70); }

  bind(el, { onTwoFinger } = {}) {
    let drag = null;
    const touches = new Map();
    let pinch = null, lastTwoTap = 0;
    el.addEventListener('contextmenu', e => { if (e.altKey || drag) e.preventDefault(); });
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') {
        if (!e.altKey) return;
        e.preventDefault();
        this.toFree();
        drag = { b: e.button, x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        return;
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        onTwoFinger?.();
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, t: performance.now(), moved: false };
      }
    });
    el.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (drag.b === 0) this.tumble(dx, dy);
        else if (drag.b === 1) this.track(dx, dy, innerHeight);
        else if (drag.b === 2) this.dolly(-dx * 0.004 + dy * 0.004);
        return;
      }
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinch) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const ddx = cx - pinch.cx, ddy = cy - pinch.cy;
        if (!pinch.moved && Math.hypot(ddx, ddy) + Math.abs(d - pinch.d) < 6) return;
        if (!pinch.moved) { pinch.moved = true; this.toFree(); }
        this.tumble(ddx * 1.4, ddy * 1.4);
        this.dolly(Math.log(pinch.d / Math.max(20, d)));
        pinch.d = d; pinch.cx = cx; pinch.cy = cy;
      }
    });
    const up = e => {
      if (drag) { drag = null; return; }
      if (touches.size === 2 && pinch && !pinch.moved && performance.now() - pinch.t < 300) {
        const now = performance.now();
        if (now - lastTwoTap < 450) { this.frame(); this.setMode('free'); }
        lastTwoTap = now;
      }
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.toFree();
      if (e.ctrlKey) this.dolly(e.deltaY * 0.01);        // trackpad pinch
      else if (e.altKey || Math.abs(e.deltaX) < 1) this.dolly(e.deltaY * 0.0015);
      else this.tumble(-e.deltaX * 0.5, 0);
    }, { passive: false });
  }
}
