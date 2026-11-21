// Rival crew AI: plays the same seed on its own thread and trades garbage with the player.
import { Game, W, H } from './engine.js';
import { playMove } from './ai.js';

let game = null, pps = 1, mistake = 0, acc = 0, timer = null, last = 0, paused = false;

function tick() {
  const now = performance.now();
  const dt = Math.min(100, now - last); last = now;
  if (!game || game.over || paused) return;
  game.update(dt);
  acc += dt;
  const interval = 1000 / pps;
  if (acc >= interval && game.piece) { acc -= interval; playMove(game, { mistakeRate: mistake }); }
  const ev = game.drainEvents();
  for (const e of ev) {
    if (e.type === 'clear' && e.attack > 0) postMessage({ type: 'attack', lines: e.attack });
    if (e.type === 'clear') postMessage({ type: 'clear', lines: e.lines, label: e.label, combo: e.combo });
    if (e.type === 'gameover') postMessage({ type: 'over' });
    if (e.type === 'escaped') postMessage({ type: 'escaped' });
  }
  const grid = new Uint8Array(W * 20);
  grid.set(game.grid.subarray((H - 20) * W));
  postMessage({ type: 'state', grid, score: game.score, lines: game.lines, stars: game.stars, over: game.over }, [grid.buffer]);
}

onmessage = ({ data }) => {
  if (data.type === 'start') {
    game = new Game({ seed: data.seed, heatEnabled: true });
    pps = data.pps; mistake = data.mistake; acc = 0; paused = false; last = performance.now();
    clearInterval(timer); timer = setInterval(tick, 50);
  } else if (data.type === 'garbage' && game) game.receive(data.lines);
  else if (data.type === 'pause') { paused = data.paused; last = performance.now(); }
  else if (data.type === 'stop') { clearInterval(timer); game = null; }
};
