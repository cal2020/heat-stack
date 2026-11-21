// HEAT STACK — deterministic falling-block engine with heat / cash / getaway systems.
// Pure logic: no DOM. Runs on the main thread and inside the rival AI worker.

export const W = 10, H = 22, VIS = 20, HIDDEN = H - VIS;
export const KINDS = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
export const GARBAGE = 8;

const BASE = {
  I: { n: 4, c: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  J: { n: 3, c: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { n: 3, c: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  O: { n: 2, c: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  S: { n: 3, c: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  T: { n: 3, c: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  Z: { n: 3, c: [[0, 0], [1, 0], [1, 1], [2, 1]] },
};

// Precompute the 4 rotation states (clockwise) for each kind.
export const SHAPES = {};
for (const k of KINDS) {
  const { n, c } = BASE[k];
  const states = [c];
  for (let r = 1; r < 4; r++) states.push(states[r - 1].map(([x, y]) => [n - 1 - y, x]));
  SHAPES[k] = k === 'O' ? [c, c, c, c] : states;
}

// Wall kicks (x right, y UP as conventionally written); converted to y-down on use.
const K_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const K_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};
const K_180 = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const LINE_SCORE = [0, 100, 300, 500, 800];
const SPIN_SCORE = [400, 800, 1200, 1600];
const MINI_SCORE = [100, 200, 400];
const LINE_ATTACK = [0, 0, 1, 2, 4];
const SPIN_ATTACK = [0, 2, 4, 6];
const COMBO_ATTACK = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

export const CLEAR_MS = 230;
export const LOCK_MS = 500;
export const MAX_RESETS = 15;
export const GETAWAY_MS = 25000;

export function gravityMs(level) {
  const l = Math.min(level, 20);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000;
}

export class Game {
  constructor({ seed = 1, startLevel = 1, mode = 'heat', heatEnabled = true } = {}) {
    this.seed = seed >>> 0;
    this.rngBag = mulberry32(this.seed);
    this.rngCash = mulberry32(this.seed ^ 0x9e3779b9);
    this.rngHole = mulberry32(this.seed ^ 0x85ebca6b);
    this.mode = mode;
    this.heatEnabled = heatEnabled;
    this.grid = new Uint8Array(W * H);   // kind index 1..7, 8 garbage
    this.cash = new Uint8Array(W * H);   // 1 if the locked mino carries cash
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.holdUsed = false;
    this.level = startLevel;
    this.startLevel = startLevel;
    this.lines = 0;
    this.score = 0;
    this.combo = -1;
    this.b2b = false;
    this.pieces = 0;
    this.time = 0;
    this.over = false;
    this.overReason = '';
    this.events = [];
    this.clearing = null;
    this.incoming = [];   // pending garbage line counts
    this.attackOut = 0;   // total lines sent
    // Heat systems
    this.heat = 0;          // 0..5 continuous
    this.sinceClear = 0;
    this.pursuitT = 0;
    this.getaway = null;    // {t, lines}
    this.runCash = 0;
    this.escapes = 0;
    this.maxHeat = 0;
    this.timeline = [];     // [ms, score] samples for ghost racing
    this.sampleT = 0;
    while (this.queue.length < 6) this.queue.push(this.nextFromBag());
    this.spawn();
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  nextFromBag() {
    if (!this.bag.length) {
      const b = KINDS.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(this.rngBag() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      this.bag = b;
    }
    const kind = this.bag.shift();
    const chance = this.heatEnabled ? 0.12 + 0.04 * Math.floor(this.heat) : 0;
    const roll = this.rngCash();
    const cashIdx = Math.floor(this.rngCash() * 4);
    return { kind, cash: roll < chance ? cashIdx : -1 };
  }

  get stars() { return Math.min(5, Math.floor(this.heat + 1e-6)); }
  get multiplier() { return 1 + 0.3 * this.stars; }

  get gravity() {
    const effLevel = this.level + (this.heatEnabled ? this.stars * 0.7 : 0);
    return gravityMs(Math.floor(effLevel));
  }

  cellsOf(p, rot = p.rot, x = p.x, y = p.y) {
    return SHAPES[p.kind][rot].map(([cx, cy]) => [x + cx, y + cy]);
  }

  fits(p, rot = p.rot, x = p.x, y = p.y) {
    for (const [cx, cy] of SHAPES[p.kind][rot]) {
      const gx = x + cx, gy = y + cy;
      if (gx < 0 || gx >= W || gy >= H) return false;
      if (gy >= 0 && this.grid[gy * W + gx]) return false;
    }
    return true;
  }

  spawn(fromHold = null) {
    const next = fromHold || this.queue.shift();
    if (!fromHold) this.queue.push(this.nextFromBag());
    const kind = next.kind;
    const x = kind === 'O' ? 4 : 3;
    const y = HIDDEN - 1;
    this.piece = { kind, cash: next.cash, rot: 0, x, y, lockT: 0, resets: 0, lowest: y, lastRot: false, kick: 0 };
    this.gravT = 0;
    if (!this.fits(this.piece)) {
      if (this.fits(this.piece, 0, x, y - 1)) this.piece.y = y - 1;
      else return this.end('busted');
    }
    // Immediate drop one row if possible (piece appears right away).
    if (this.fits(this.piece, 0, x, this.piece.y + 1)) this.piece.y++;
    this.piece.lowest = this.piece.y;
    this.emit('spawn', { kind });
  }

  end(reason) {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.piece = null;
    this.emit('gameover', { reason });
  }

  // ---- Player actions -------------------------------------------------
  move(dx) {
    const p = this.piece; if (!p || this.over) return false;
    if (!this.fits(p, p.rot, p.x + dx, p.y)) return false;
    p.x += dx; p.lastRot = false;
    this.afterMoveReset();
    this.emit('move');
    return true;
  }

  rotate(dir) { // 1 cw, -1 ccw, 2 = 180
    const p = this.piece; if (!p || this.over || p.kind === 'O') return false;
    const from = p.rot, to = (from + (dir === 2 ? 2 : dir) + 4) % 4;
    const kicks = dir === 2 ? K_180 : (p.kind === 'I' ? K_I : K_JLSTZ)[`${from}>${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const nx = p.x + kx, ny = p.y - ky;
      if (this.fits(p, to, nx, ny)) {
        p.x = nx; p.y = ny; p.rot = to; p.lastRot = true; p.kick = i;
        this.afterMoveReset();
        this.emit('rotate', { kick: i });
        return true;
      }
    }
    return false;
  }

  afterMoveReset() {
    const p = this.piece;
    if (p.y > p.lowest) { p.lowest = p.y; p.resets = 0; }
    if (!this.fits(p, p.rot, p.x, p.y + 1) && p.resets < MAX_RESETS) { p.lockT = 0; p.resets++; }
  }

  softDrop() {
    const p = this.piece; if (!p || this.over) return false;
    if (!this.fits(p, p.rot, p.x, p.y + 1)) return false;
    p.y++; p.lastRot = false; this.score += 1; this.gravT = 0;
    if (p.y > p.lowest) { p.lowest = p.y; p.resets = 0; }
    return true;
  }

  ghostY() {
    const p = this.piece; if (!p) return 0;
    let y = p.y; while (this.fits(p, p.rot, p.x, y + 1)) y++;
    return y;
  }

  hardDrop() {
    const p = this.piece; if (!p || this.over) return;
    const gy = this.ghostY();
    const dist = gy - p.y;
    if (dist > 0) p.lastRot = false;
    p.y = gy; this.score += dist * 2;
    this.emit('harddrop', { dist, x: p.x, cells: this.cellsOf(p) });
    this.lock();
  }

  doHold() {
    const p = this.piece; if (!p || this.over || this.holdUsed) return false;
    const cur = { kind: p.kind, cash: p.cash };
    this.holdUsed = true;
    if (this.hold) { const h = this.hold; this.hold = cur; this.spawn(h); }
    else { this.hold = cur; this.spawn(); }
    this.emit('hold');
    return true;
  }

  // ---- Locking & clearing ----------------------------------------------
  tSpinCheck(p) {
    if (p.kind !== 'T' || !p.lastRot) return { spin: false, mini: false };
    const occ = (x, y) => x < 0 || x >= W || y >= H || (y >= 0 && this.grid[y * W + x] !== 0);
    const cx = p.x + 1, cy = p.y + 1;
    const corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx + 1, cy + 1], [cx - 1, cy + 1]];
    const filled = corners.map(([x, y]) => occ(x, y));
    const count = filled.filter(Boolean).length;
    if (count < 3) return { spin: false, mini: false };
    // Front corners depend on rotation (the side the T points at).
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
    const frontCount = front.filter(i => filled[i]).length;
    const mini = frontCount < 2 && p.kick !== 4;
    return { spin: true, mini };
  }

  lock() {
    const p = this.piece; if (!p) return;
    const spin = this.tSpinCheck(p);
    let allHidden = true;
    const cells = this.cellsOf(p);
    cells.forEach(([x, y], i) => {
      if (y < 0) return;
      this.grid[y * W + x] = KINDS.indexOf(p.kind) + 1;
      this.cash[y * W + x] = p.cash === i ? 1 : 0;
      if (y >= HIDDEN) allHidden = false;
    });
    this.pieces++;
    this.piece = null;
    this.holdUsed = false;
    this.emit('lock', { cells, kind: p.kind });
    if (allHidden) return this.end('busted');

    const rows = [];
    for (let y = 0; y < H; y++) {
      let full = true;
      for (let x = 0; x < W; x++) if (!this.grid[y * W + x]) { full = false; break; }
      if (full) rows.push(y);
    }
    this.score_(rows, spin);
    if (rows.length) {
      this.clearing = { rows, t: 0 };
    } else {
      this.applyGarbage();
      if (!this.over) this.spawn();
    }
  }

  score_(rows, spin) {
    const n = rows.length;
    const lvl = this.level;
    let base = 0, attack = 0, label = '';
    if (spin.spin) {
      base = spin.mini ? MINI_SCORE[Math.min(n, 2)] : SPIN_SCORE[n];
      attack = spin.mini ? Math.max(0, n - 1) : SPIN_ATTACK[n];
      label = (spin.mini ? 'T-SPIN MINI' : 'T-SPIN') + (n ? ' ' + ['', 'SINGLE', 'DOUBLE', 'TRIPLE'][n] : '');
    } else if (n) {
      base = LINE_SCORE[n]; attack = LINE_ATTACK[n];
      label = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][n];
    }
    if (!n) {
      this.combo = -1;
      if (base) { this.score += Math.round(base * lvl * this.multiplier); this.emit('spin', { label }); }
      return;
    }
    const difficult = n === 4 || spin.spin;
    const b2bActive = difficult && this.b2b;
    if (b2bActive) { base *= 1.5; attack += 1; }
    if (difficult) this.b2b = true; else this.b2b = false;
    this.combo++;
    const comboPts = this.combo > 0 ? 50 * this.combo * lvl : 0;
    attack += COMBO_ATTACK[Math.min(this.combo, COMBO_ATTACK.length - 1)];

    // Perfect clear check: are all non-cleared rows empty?
    let pc = true;
    for (let y = 0; y < H && pc; y++) {
      if (rows.includes(y)) continue;
      for (let x = 0; x < W; x++) if (this.grid[y * W + x]) { pc = false; break; }
    }
    let pcPts = 0;
    if (pc) { pcPts = 3000 * lvl; attack += 10; }

    // Cash grab
    let cashCells = 0;
    for (const y of rows) for (let x = 0; x < W; x++) cashCells += this.cash[y * W + x];
    const cashGain = cashCells * 100 * (1 + this.stars);
    this.runCash += cashGain;

    const gained = Math.round((base * lvl + comboPts + pcPts) * this.multiplier);
    this.score += gained;

    // Cancel incoming garbage first, then send.
    while (attack > 0 && this.incoming.length) {
      const take = Math.min(attack, this.incoming[0]);
      this.incoming[0] -= take; attack -= take;
      if (!this.incoming[0]) this.incoming.shift();
    }
    this.attackOut += attack;

    this.lines += n;
    const newLevel = this.startLevel + Math.floor(this.lines / 10);
    if (newLevel > this.level) { this.level = newLevel; this.emit('levelup', { level: newLevel }); }

    this.emit('clear', { rows, lines: n, label, spin: spin.spin, mini: spin.mini, b2b: b2bActive, combo: this.combo, pc, gained, attack, cash: cashGain });

    if (this.heatEnabled) {
      const before = this.stars;
      let dh = 0;
      if (n === 4) dh += 0.8;
      else if (n === 3) dh += 0.35;
      else if (n === 2) dh += 0.12;
      if (spin.spin && !spin.mini) dh += 0.5 + 0.2 * n;
      if (this.combo >= 2) dh += 0.12 * Math.min(this.combo, 6);
      if (b2bActive) dh += 0.2;
      if (pc) dh += 1.5;
      if (cashCells) dh += 0.25 * cashCells;
      this.heat = Math.min(5, this.heat + dh);
      this.maxHeat = Math.max(this.maxHeat, this.heat);
      this.sinceClear = 0;
      if (this.stars !== before) this.emit('heat', { stars: this.stars, up: this.stars > before });
      if (this.getaway) this.getaway.lines += n;
      else if (this.stars >= 5) { this.getaway = { t: 0, lines: 0 }; this.emit('getaway'); }
    }
  }

  collapse() {
    const rows = this.clearing.rows;
    const keepG = [], keepC = [];
    for (let y = 0; y < H; y++) {
      if (rows.includes(y)) continue;
      keepG.push(this.grid.slice(y * W, y * W + W));
      keepC.push(this.cash.slice(y * W, y * W + W));
    }
    this.grid.fill(0); this.cash.fill(0);
    const off = H - keepG.length;
    keepG.forEach((r, i) => { this.grid.set(r, (off + i) * W); this.cash.set(keepC[i], (off + i) * W); });
    this.clearing = null;
    this.spawn();
  }

  receive(lines) { if (lines > 0) { this.incoming.push(lines); this.emit('incoming', { lines }); } }

  applyGarbage() {
    let total = 0;
    while (this.incoming.length && total < 8) total += this.incoming.shift();
    if (total) this.addGarbageRows(total, 'garbage');
  }

  addGarbageRows(n, source) {
    for (let y = 0; y < n; y++) if (this.grid.subarray(y * W, y * W + W).some(Boolean)) { this.end('busted'); }
    this.grid.copyWithin(0, n * W);
    this.cash.copyWithin(0, n * W);
    const hole = Math.floor(this.rngHole() * W);
    for (let y = H - n; y < H; y++) for (let x = 0; x < W; x++) {
      this.grid[y * W + x] = x === hole ? 0 : GARBAGE;
      this.cash[y * W + x] = 0;
    }
    if (this.piece) {
      while (!this.fits(this.piece) && this.piece.y > -2) this.piece.y--;
      this.piece.lowest = Math.min(this.piece.lowest, this.piece.y);
    }
    this.emit('rise', { lines: n, source });
  }

  // ---- Time --------------------------------------------------------------
  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.sampleT += dt;
    if (this.sampleT >= 1000) { this.sampleT -= 1000; this.timeline.push(this.score); }

    if (this.heatEnabled) this.updateHeat(dt);
    if (this.over) return;

    if (this.clearing) {
      this.clearing.t += dt;
      if (this.clearing.t >= CLEAR_MS) this.collapse();
      return;
    }
    const p = this.piece; if (!p) return;
    const grounded = !this.fits(p, p.rot, p.x, p.y + 1);
    if (grounded) {
      p.lockT += dt;
      if (p.lockT >= LOCK_MS || p.resets >= MAX_RESETS && p.lockT >= LOCK_MS * 0.25) this.lock();
    } else {
      p.lockT = 0;
      this.gravT += dt;
      const g = this.gravity;
      while (this.gravT >= g && this.piece) {
        this.gravT -= g;
        if (this.fits(p, p.rot, p.x, p.y + 1)) {
          p.y++; p.lastRot = false;
          if (p.y > p.lowest) { p.lowest = p.y; p.resets = 0; }
        } else break;
      }
    }
  }

  updateHeat(dt) {
    this.sinceClear += dt;
    const before = this.stars;
    if (this.sinceClear > 8000 && !this.getaway) this.heat = Math.max(0, this.heat - dt * 0.00006);
    if (this.stars < before) this.emit('heat', { stars: this.stars, up: false });

    if (this.stars >= 3 && !this.clearing) {
      this.pursuitT += dt;
      const every = 22000 - this.stars * 2500;
      if (this.pursuitT >= every) { this.pursuitT = 0; this.addGarbageRows(1, 'pursuit'); this.emit('pursuit'); }
    } else this.pursuitT = Math.max(0, this.pursuitT - dt);

    if (this.getaway) {
      this.getaway.t += dt;
      if (this.getaway.lines >= 6) {
        const bonus = 5000 * this.level;
        this.score += bonus;
        this.runCash += 1000 * this.level;
        this.escapes++;
        this.getaway = null;
        this.heat = 1.5;
        this.pursuitT = 0;
        this.emit('escaped', { bonus });
        this.emit('heat', { stars: this.stars, up: false });
      } else if (this.getaway.t >= GETAWAY_MS) {
        // Failed to shake them: roadblock drops in, heat stays.
        this.getaway = { t: 0, lines: 0 };
        this.addGarbageRows(2, 'roadblock');
        this.emit('roadblock');
      }
    }
  }

  // Highest occupied visible row as fraction of field (0 empty .. 1 full)
  dangerLevel() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.grid[y * W + x]) return (H - y) / VIS;
    return 0;
  }

  // Encode the visible field into a RGBA8 buffer, row 0 = bottom of the well.
  // R: kind (0 empty,1-7 pieces,8 garbage) G: flags (1 active,2 ghost,4 clearing,8 cash) B: anim 0..255
  writeView(buf) {
    buf.fill(0);
    const put = (x, y, r, g, b) => {
      if (y < HIDDEN || y >= H || x < 0 || x >= W) return;
      const t = (H - 1 - y) * W + x, o = t * 4;
      buf[o] = r; buf[o + 1] |= g; buf[o + 2] = b; buf[o + 3] = 255;
    };
    const clearRows = this.clearing ? this.clearing.rows : null;
    const clearAnim = this.clearing ? Math.min(255, (this.clearing.t / CLEAR_MS) * 255) | 0 : 0;
    for (let y = HIDDEN; y < H; y++) for (let x = 0; x < W; x++) {
      const k = this.grid[y * W + x];
      if (!k) continue;
      let f = this.cash[y * W + x] ? 8 : 0;
      let a = 0;
      if (clearRows && clearRows.includes(y)) { f |= 4; a = clearAnim; }
      put(x, y, k, f, a);
    }
    const p = this.piece;
    if (p) {
      const gy = this.ghostY();
      const k = KINDS.indexOf(p.kind) + 1;
      const lockA = Math.min(255, (p.lockT / LOCK_MS) * 255) | 0;
      if (gy !== p.y) this.cellsOf(p, p.rot, p.x, gy).forEach(([x, y]) => {
        const t = (H - 1 - y) * W + x;
        if (y >= HIDDEN && !buf[t * 4]) { buf[t * 4 + 1] |= 2; buf[t * 4 + 2] = k; }
      });
      this.cellsOf(p).forEach(([x, y], i) => put(x, y, k, 1 | (p.cash === i ? 8 : 0), lockA));
    }
    return buf;
  }

  snapshot() {
    return {
      score: this.score, lines: this.lines, level: this.level, heat: this.heat, stars: this.stars,
      combo: this.combo, b2b: this.b2b, hold: this.hold, holdUsed: this.holdUsed,
      queue: this.queue.slice(0, 5), runCash: this.runCash, over: this.over, overReason: this.overReason,
      getaway: this.getaway, time: this.time, pieces: this.pieces, incoming: this.incoming.reduce((a, b) => a + b, 0),
      pursuit: this.stars >= 3 ? this.pursuitT / (22000 - this.stars * 2500) : 0,
    };
  }
}
