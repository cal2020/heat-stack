// Placement search for the rival crew AI (and the in-game "coach" hint).
import { W, H, SHAPES, KINDS } from './engine.js';

const WEIGHTS = { height: -4.5, rows: 3.4, rowT: -3.2, colT: -9.3, holes: -7.9, wells: -3.4 };

function evaluate(grid, landingY, cleared) {
  let rowT = 0, colT = 0, holes = 0, wells = 0;
  for (let y = 0; y < H; y++) {
    let prev = 1;
    for (let x = 0; x < W; x++) { const f = grid[y * W + x] ? 1 : 0; if (f !== prev) rowT++; prev = f; }
    if (!prev) rowT++;
  }
  for (let x = 0; x < W; x++) {
    let prev = 0, seen = false;
    for (let y = 0; y < H; y++) {
      const f = grid[y * W + x] ? 1 : 0;
      if (f !== prev) colT++;
      if (f) seen = true; else if (seen) holes++;
      prev = f;
    }
    if (!prev) colT++;
    let depth = 0;
    for (let y = 0; y < H; y++) {
      const here = grid[y * W + x];
      const l = x === 0 || grid[y * W + x - 1];
      const r = x === W - 1 || grid[y * W + x + 1];
      if (!here && l && r) { depth++; wells += depth; } else if (here) break; else depth = 0;
    }
  }
  return WEIGHTS.height * (H - landingY) + WEIGHTS.rows * cleared + WEIGHTS.rowT * rowT +
    WEIGHTS.colT * colT + WEIGHTS.holes * holes + WEIGHTS.wells * wells;
}

function fits(grid, kind, rot, x, y) {
  for (const [cx, cy] of SHAPES[kind][rot]) {
    const gx = x + cx, gy = y + cy;
    if (gx < 0 || gx >= W || gy >= H) return false;
    if (gy >= 0 && grid[gy * W + gx]) return false;
  }
  return true;
}

export function bestPlacement(grid, kind) {
  let best = null;
  const rots = kind === 'O' ? 1 : 4;
  for (let rot = 0; rot < rots; rot++) {
    for (let x = -3; x < W; x++) {
      if (!fits(grid, kind, rot, x, 0)) continue;
      let y = 0; while (fits(grid, kind, rot, x, y + 1)) y++;
      const g = grid.slice();
      const id = KINDS.indexOf(kind) + 1;
      for (const [cx, cy] of SHAPES[kind][rot]) g[(y + cy) * W + x + cx] = id;
      let cleared = 0;
      for (let yy = H - 1; yy >= 0; yy--) {
        let full = true;
        for (let xx = 0; xx < W; xx++) if (!g[yy * W + xx]) { full = false; break; }
        if (full) {
          cleared++;
          g.copyWithin(W, 0, yy * W); g.fill(0, 0, W); yy++;
        }
      }
      const score = evaluate(g, y + 1, cleared);
      if (!best || score > best.score) best = { rot, x, y, score };
    }
  }
  return best;
}

// Drive a Game instance to a placement (used by the rival).
export function playMove(game, { mistakeRate = 0 } = {}) {
  const p = game.piece; if (!p) return;
  const a = bestPlacement(game.grid, p.kind);
  const holdKind = game.hold ? game.hold.kind : game.queue[0].kind;
  const b = !game.holdUsed ? bestPlacement(game.grid, holdKind) : null;
  let target = a, useHold = false;
  if (b && (!a || b.score > a.score + 2)) { target = b; useHold = true; }
  if (useHold) game.doHold();
  const cur = game.piece; if (!cur || !target) { game.hardDrop(); return; }
  let rot = target.rot, x = target.x;
  if (Math.random() < mistakeRate) x = Math.max(-1, Math.min(W - 2, x + (Math.random() < 0.5 ? -1 : 1)));
  if (game.fits(cur, rot, x, cur.y)) { cur.rot = rot; cur.x = x; }
  game.hardDrop();
}
