import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, W, H, KINDS } from '../src/engine.js';
import { playMove } from '../src/ai.js';

test('same seed gives the same piece sequence', () => {
  const a = new Game({ seed: 42 }), b = new Game({ seed: 42 });
  assert.deepEqual(a.queue.map(q => q.kind), b.queue.map(q => q.kind));
});

test('7-bag contains every piece once per 7', () => {
  const g = new Game({ seed: 7 });
  const seen = [g.piece.kind, ...g.queue.slice(0, 6).map(q => q.kind)];
  assert.deepEqual([...seen].sort(), [...KINDS].sort());
});

test('hard drop locks and a full row clears', () => {
  const g = new Game({ seed: 1, heatEnabled: false });
  for (let x = 0; x < W; x++) if (x < 6 || x > 9) g.grid[(H - 1) * W + x] = 8;
  g.piece = { kind: 'I', cash: -1, rot: 0, x: 6, y: 5, lockT: 0, resets: 0, lowest: 5, lastRot: false, kick: 0 };
  g.grid[(H - 1) * W + 6] = 0;
  g.hardDrop();
  const ev = g.drainEvents();
  assert.ok(ev.find(e => e.type === 'clear' && e.lines === 1));
  g.update(400);
  assert.equal(g.lines, 1);
  assert.equal(g.grid.subarray((H - 1) * W).filter(Boolean).length, 0);
});

test('rotation kicks off the wall', () => {
  const g = new Game({ seed: 3 });
  g.piece = { kind: 'T', cash: -1, rot: 1, x: -1, y: 10, lockT: 0, resets: 0, lowest: 10, lastRot: false, kick: 0 };
  assert.ok(g.rotate(1));
  assert.ok(g.fits(g.piece));
});

test('heat rises on a quad and triggers multiplier', () => {
  const g = new Game({ seed: 5 });
  for (let y = H - 4; y < H; y++) for (let x = 0; x < W - 1; x++) g.grid[y * W + x] = 8;
  g.piece = { kind: 'I', cash: -1, rot: 1, x: W - 3, y: 5, lockT: 0, resets: 0, lowest: 5, lastRot: false, kick: 0 };
  g.hardDrop();
  assert.ok(g.heat > 0.7);
  assert.equal(g.lines, 4);
});

test('AI survives and clears lines', () => {
  const g = new Game({ seed: 99, heatEnabled: false });
  for (let i = 0; i < 300 && !g.over; i++) { playMove(g); g.update(300); }
  assert.ok(g.lines > 40, `lines=${g.lines}`);
});

test('view encodes active piece flags', () => {
  const g = new Game({ seed: 2 });
  const buf = g.writeView(new Uint8Array(W * 20 * 4));
  let active = 0; for (let i = 0; i < W * 20; i++) if (buf[i * 4 + 1] & 1) active++;
  assert.equal(active > 0, true);
});
