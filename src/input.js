// Unified input: keyboard, gamepad (Standard Gamepad mapping), touch buttons and board gestures.
// Produces discrete actions with DAS/ARR auto-repeat for horizontal movement and soft drop.

export const DEFAULT_KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], soft: ['ArrowDown', 'KeyS'],
  hard: ['Space'], cw: ['ArrowUp', 'KeyX', 'KeyW'], ccw: ['KeyZ', 'ControlLeft'], r180: ['KeyQ'],
  hold: ['KeyC', 'ShiftLeft', 'ShiftRight'], pause: ['Escape', 'KeyP'],
  emote1: ['Digit1'], emote2: ['Digit2'], emote3: ['Digit3'], emote4: ['Digit4'],
};

export class Input {
  constructor(onAction) {
    this.on = onAction;
    this.das = 130; this.arr = 12; this.sdf = 20; // ms
    this.held = new Map();      // action -> {t, repeated}
    this.keyMap = new Map();
    for (const [a, ks] of Object.entries(DEFAULT_KEYS)) ks.forEach(k => this.keyMap.set(k, a));
    this.lastDir = null;
    this.padPrev = [];
    this.enabled = true;
    addEventListener('keydown', e => {
      const a = this.keyMap.get(e.code); if (!a) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      e.preventDefault();
      if (e.repeat) return;
      this.press(a, 'key');
    });
    addEventListener('keyup', e => { const a = this.keyMap.get(e.code); if (a) this.release(a); });
    addEventListener('blur', () => this.held.clear());
  }

  press(a, src) {
    if (!this.enabled && a !== 'pause') return;
    if (a === 'left' || a === 'right' || a === 'soft') {
      if (this.held.has(a)) return;
      this.held.set(a, { t: 0, rep: 0 });
      if (a !== 'soft') this.lastDir = a;
      this.on(a, src);
    } else this.on(a, src);
  }
  release(a) { this.held.delete(a); if (this.lastDir === a) this.lastDir = this.held.has('left') ? 'left' : this.held.has('right') ? 'right' : null; }

  update(dt) {
    this.pollPad();
    if (!this.enabled) return;
    for (const [a, h] of this.held) {
      h.t += dt;
      if (a === 'soft') {
        h.rep += dt;
        while (h.rep >= this.sdf) { h.rep -= this.sdf; this.on('soft', 'repeat'); }
        continue;
      }
      if (a !== this.lastDir) continue;
      if (h.t >= this.das) {
        if (this.arr <= 0) { for (let i = 0; i < 10; i++) this.on(a, 'repeat'); }
        else {
          h.rep += dt;
          if (h.t - dt < this.das) h.rep = 0;
          while (h.rep >= this.arr) { h.rep -= this.arr; this.on(a, 'repeat'); }
        }
      }
    }
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      this.pad = p;
      const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const state = {
        left: b(14) || ax < -0.5, right: b(15) || ax > 0.5, soft: b(13) || ay > 0.6,
        hard: b(12) || ay < -0.7, cw: b(1) || b(3), ccw: b(0) || b(2), hold: b(4) || b(5) || b(6) || b(7),
        pause: b(9), r180: b(8),
      };
      for (const [a, v] of Object.entries(state)) {
        const prev = this.padPrev[p.index + a];
        if (v && !prev) this.press(a, 'pad');
        if (!v && prev) this.release(a);
        this.padPrev[p.index + a] = v;
      }
      break;
    }
  }

  rumble(strength = 0.5, ms = 80) {
    try {
      if (this.pad && this.pad.vibrationActuator) this.pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
      else if (navigator.vibrate && this.touchUsed) navigator.vibrate(Math.min(ms, 60));
    } catch { /* unsupported */ }
  }

  // On-screen buttons: [data-act] elements; press-and-hold supported.
  bindButtons(root) {
    root.querySelectorAll('[data-act]').forEach(el => {
      const a = el.dataset.act;
      const down = e => { e.preventDefault(); this.touchUsed = true; el.classList.add('down'); this.press(a, 'touch'); el.setPointerCapture?.(e.pointerId); };
      const up = e => { e.preventDefault(); el.classList.remove('down'); this.release(a); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    });
  }

  // Gestures on the play surface: drag to move by cells, tap to rotate, flick down to hard drop, flick up to hold.
  bindGestures(el, cellPx) {
    let s = null;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      this.touchUsed = true;
      s = { x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, lastY: e.clientY, moved: false, softAcc: 0 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!s) return;
      const cp = cellPx();
      let dx = e.clientX - s.lastX;
      while (Math.abs(dx) >= cp * 0.9) { const dir = dx > 0 ? 'right' : 'left'; this.on(dir, 'gesture'); s.lastX += Math.sign(dx) * cp * 0.9; dx = e.clientX - s.lastX; s.moved = true; }
      const dy = e.clientY - s.lastY;
      if (dy > cp * 0.9) { this.on('soft', 'gesture'); s.lastY = e.clientY; s.moved = true; }
    });
    const end = e => {
      if (!s) return;
      const dt = performance.now() - s.t, dy = e.clientY - s.y, dx = e.clientX - s.x;
      const vy = dy / Math.max(dt, 1);
      if (vy > 1.1 && dy > 40) this.on('hard', 'gesture');
      else if (vy < -1.0 && dy < -40) this.on('hold', 'gesture');
      else if (!s.moved && dt < 260 && Math.hypot(dx, dy) < 14) this.on(e.clientX < innerWidth / 2 ? 'ccw' : 'cw', 'gesture');
      s = null;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', () => { s = null; });
  }
}
