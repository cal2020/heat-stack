import { Game, W, H, VIS, KINDS, SHAPES, seedFromString, GETAWAY_MS } from './engine.js';
import { ENGINES } from './renderers.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { CameraRig, CAMERA_MODES, DIST } from './camera.js';
import { Street, STATIONS, rankOf } from './street.js';
import { World } from './world.js';

// ------------------------------------------------------------------ storage
const store = {
  get(k, d) { try { const v = localStorage.getItem('hs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hs.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ------------------------------------------------------------------ districts (block palettes + city tint)
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const DISTRICTS = [
  { id: 'docks', name: 'Neon Docks', price: 0, accent: '#29e6ff', blocks: ['#22e1ff', '#3f6bff', '#ff9a2e', '#ffd93d', '#3dff8a', '#c54dff', '#ff3d6e'], blurb: 'Where every crew starts.' },
  { id: 'pier', name: 'Vice Pier', price: 2500, accent: '#ff5fa8', blocks: ['#5ff2e8', '#7f8cff', '#ffb36b', '#fff27a', '#7dffb0', '#ff7ae0', '#ff5470'], blurb: 'Sunset pastels and boardwalk lights.' },
  { id: 'hills', name: 'Midnight Hills', price: 6000, accent: '#8a6bff', blocks: ['#7fd4ff', '#5a5cff', '#c58bff', '#e8d8ff', '#6effd2', '#a24dff', '#ff6bb5'], blurb: 'Mansions above the haze.' },
  { id: 'chrome', name: 'Chrome Downtown', price: 12000, accent: '#c8e4ff', blocks: ['#d9f2ff', '#8fb2d9', '#b8c4d4', '#f0f4fa', '#9fe0d0', '#a8a0ff', '#ff9aa8'], blurb: 'Glass towers. Mirror finish.' },
  { id: 'desert', name: 'Solar Desert', price: 20000, accent: '#ff8a2b', blocks: ['#ffe17a', '#ff7a2b', '#ffb03d', '#fff1b8', '#ffd25e', '#ff5a3d', '#c23b2b'], blurb: 'Heat shimmer on the highway.' },
];
function paletteOf(d) { const p = [[0, 0, 0], ...d.blocks.map(hex), [0.35, 0.36, 0.4], [1, 0.8, 0.3]]; return p; }

// ------------------------------------------------------------------ state
const defaults = { engine: 'auto', quality: 'auto', scale: 1, das: 130, arr: 12, rival: 1, music: true, sfx: true, shake: true, haptics: true, touch: null, ghost: true, camera: 'tilt', world: 'city', station: 0 };
const settings = { ...defaults, ...store.get('settings', {}) };
let wallet = store.get('wallet', 0);
let owned = new Set(store.get('owned', ['docks']));
let district = DISTRICTS.find(d => d.id === store.get('district', 'docks')) || DISTRICTS[0];
let playerName = store.get('name', '') || 'Player' + Math.floor(Math.random() * 900 + 100);
store.set('name', playerName);

const audio = new Audio();
audio.music = settings.music; audio.sfx = settings.sfx;
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (settings.touch === null) settings.touch = isTouch;

let game = null, mode = 'street', running = false, paused = false;
let renderer = null, canvas = $('#view');
const view = new Uint8Array(W * VIS * 4);
let fxShake = 0, fxFlash = 0, parallax = 0;
let quality = 2, scale = 1;
let rival = null, rivalState = null;
let challenge = null;   // decoded challenge from URL
let wakeLock = null;
let lastRunStats = null;
let respect = store.get('respect', 0);
let fromWorld = null;   // the world job we launched from, if any
let boardWorld = null;  // temporary board scene override for world jobs
const cam = new CameraRig(settings.camera);
cam.onModeChange = m => { settings.camera = m; store.set('settings', settings); const el = document.querySelector('#setCamera'); if (el) el.value = m; resize(); };
let station = STATIONS[settings.station] || STATIONS[0];
audio.station = station;

// ------------------------------------------------------------------ renderer management
async function setupRenderer(pref) {
  const order = pref === 'auto' ? ['webgpu', 'webgl2', 'canvas2d'] : [pref, 'webgl2', 'canvas2d'];
  for (const name of [...new Set(order)]) {
    const fresh = document.createElement('canvas');
    fresh.id = 'view'; fresh.setAttribute('aria-label', 'Game board');
    canvas.replaceWith(fresh); canvas = fresh;
    const R = new ENGINES[name]();
    if (await R.init(canvas)) {
      renderer = R; renderer.key = name;
      input?.bindGestures(canvas, () => layoutInfo.cs);
      cam.bind(canvas, { onTwoFinger: () => input?.cancelGesture?.() });
      $('#engineTag').textContent = R.name;
      $('#gpuInfo').textContent = `Active engine: ${R.name}${R.adapterInfo ? ' · ' + R.adapterInfo : ''}. ` + capsText();
      resize();
      return;
    }
  }
}

function capsText() {
  const c = [];
  c.push(navigator.gpu ? 'WebGPU ✓' : 'WebGPU ✗');
  c.push(document.createElement('canvas').getContext('webgl2') ? 'WebGL2 ✓' : 'WebGL2 ✗');
  c.push('Canvas2D ✓');
  return c.join(' · ');
}

// ------------------------------------------------------------------ layout & projection
const layoutInfo = { cs: 30, offY: 0, zoom: 0.8, bx: 0, by: 0, bw: 0, bh: 0, w: 0, h: 0 };


function project(x, y, z = 0.5, noCam = false) {
  const L = layoutInfo;
  if (noCam || !cam.basis) {
    const s = L.h / ((30 - z) * L.zoom);
    const cy = 10 - L.offY;
    return [L.w / 2 + (x - 5) * s, L.h / 2 - (y - cy) * s];
  }
  return cam.project([x, y, z], L.w, L.h, L.zoom);
}
const is3D = () => cam.mode !== 'flat' && renderer?.key !== 'canvas2d';

function resize() {
  const w = innerWidth, h = innerHeight;
  const L = layoutInfo; L.w = w; L.h = h;
  const portrait = w < h * 0.95;
  const touchOn = settings.touch && running;
  $('#touch').hidden = !touchOn;
  let cs, cyPx;
  if (portrait) {
    const pw = Math.min(86, w * 0.2);
    const bottom = touchOn ? 230 : 24, top = 60;
    cs = Math.min((w - pw * 2 - 28) / 10, (h - top - bottom) / 20);
    cyPx = top + (h - top - bottom) / 2;
  } else {
    cs = Math.min((h * 0.9) / 20, (w * 0.92) / 24);
    if (touchOn) cs = Math.min(cs, (h - 30) / 20);
    cyPx = h / 2 + (touchOn ? -4 : 6);
  }
  if (is3D()) cs *= 0.9;
  cs = Math.max(8, Math.floor(cs));
  L.cs = cs;
  // At z=0.5 the scale is h/((29.5)*zoom) = cs
  L.zoom = h / (DIST * cs);
  L.offY = (h / 2 - cyPx) / cs;
  const tl = project(0, 20, 0.5, true), br = project(10, 0, 0.5, true);
  L.bx = tl[0]; L.by = tl[1]; L.bw = br[0] - tl[0]; L.bh = br[1] - tl[1];

  const dpr = Math.min(devicePixelRatio || 1, 2);
  const s = dpr * scale;
  canvas.width = Math.max(1, Math.round(w * s)); canvas.height = Math.max(1, Math.round(h * s));
  renderer?.resize(canvas.width, canvas.height);
  const fx = $('#fx'); fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr);
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (renderer?.key === 'canvas2d') { renderer.resize(canvas.width, canvas.height); renderer.ctx.setTransform(1, 0, 0, 1, 0, 0); }

  // Panels
  const lp = $('#leftPanel'), rp = $('#rightPanel');
  if (portrait) {
    const pw = Math.max(60, Math.min(86, L.bx - 12));
    Object.assign(lp.style, { left: (L.bx - pw - 8) + 'px', top: L.by + 'px', width: pw + 'px', height: L.bh + 'px' });
    Object.assign(rp.style, { left: (L.bx + L.bw + 8) + 'px', top: L.by + 'px', width: pw + 'px', height: L.bh + 'px' });
  } else {
    const pw = Math.min(170, L.bx - 30);
    Object.assign(lp.style, { left: (L.bx - pw - 22) + 'px', top: L.by + 'px', width: pw + 'px', height: L.bh + 'px' });
    Object.assign(rp.style, { left: (L.bx + L.bw + 22) + 'px', top: L.by + 'px', width: pw + 'px', height: L.bh + 'px' });
  }
  document.body.classList.toggle('portrait', portrait);
  Object.assign($('#incoming').style, { left: (L.bx - 12) + 'px', top: L.by + 'px', height: L.bh + 'px' });
}

// ------------------------------------------------------------------ particles (overlay canvas)
const fxCtx = $('#fx').getContext('2d');
const parts = [];
function burst(x, y, color, n, { speed = 6, life = 900, size = 0.35, gravity = 0.012, shape = 'sq' } = {}) {
  const [sx, sy] = project(x, y, 1);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * speed;
    parts.push({ x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.5, life, t: 0, size: layoutInfo.cs * size * (0.5 + Math.random()), color, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, gravity, shape });
  }
}
function drawFx(dt) {
  const c = fxCtx; c.clearRect(0, 0, layoutInfo.w, layoutInfo.h);
  c.globalCompositeOperation = 'lighter';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); continue; }
    const k = dt / 16;
    p.x += p.vx * k; p.y += p.vy * k; p.vy += p.gravity * dt * k; p.rot += p.vr * k; p.vx *= 0.99;
    const a = 1 - p.t / p.life;
    c.globalAlpha = a; c.fillStyle = p.color;
    c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
    if (p.shape === 'coin') { c.beginPath(); c.ellipse(0, 0, p.size * 0.5, p.size * 0.5 * Math.abs(Math.cos(p.rot * 2)), 0, 0, 7); c.fill(); }
    else if (p.shape === 'spark') { c.fillRect(-p.size, -1, p.size * 2, 2); }
    else c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    c.restore();
  }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  if (parts.length > 900) parts.splice(0, parts.length - 900);
}
const cssColor = c => `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;

// ------------------------------------------------------------------ popups, banners, crew, emotes
function popup(big, sub = '', cls = 'cool', yFrac = 0.42) {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.style.top = (layoutInfo.by + layoutInfo.bh * yFrac) + 'px';
  el.style.left = (layoutInfo.bx + layoutInfo.bw / 2) + 'px';
  el.innerHTML = `<span class="big"></span><span class="sub"></span>`;
  el.querySelector('.big').textContent = big; el.querySelector('.sub').textContent = sub;
  $('#popups').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
function clearOverlays() {
  for (const id of ['banner', 'popups', 'emotes']) $('#'+id).replaceChildren();
  clearTimeout(phoneTimer);
  $('#phone').hidden = true; $('#phone').classList.remove('ring');
  $('#job').hidden = true; $('#radioCard').classList.remove('show');
}
let phoneTimer;
function banner(text, color = '#ff4d6d', sub = '') {
  const el = document.createElement('div'); el.className = 'msg'; el.style.color = color; el.textContent = text;
  if (sub) { const sm = document.createElement('small'); sm.textContent = sub; el.appendChild(sm); }
  $('#banner').replaceChildren(el); setTimeout(() => el.remove(), 1800);
}

// ------------------------------------------------------------------ street systems (jobs, chopper, bribes, radio)
const street = new Street({
  popup: (...a) => popup(...a), banner: (...a) => banner(...a), crew: (...a) => crew(...a), audio,
  phone(show, d) {
    const el = $('#phone');
    clearTimeout(phoneTimer);
    if (!show) { el.classList.remove('ring'); el.hidden = true; return; }
    phoneTimer = setTimeout(() => { el.hidden = true; el.classList.remove('ring'); }, 3200);
    el.hidden = false; el.classList.add('ring');
    $('#phoneFace').textContent = d.contact.face;
    $('#phoneWho').textContent = `${d.contact.name} · ${d.contact.role}`;
    $('#phoneMsg').textContent = `“${d.def.pitch}”`;
  },
  hud(job) {
    const el = $('#job');
    if (!job) { el.hidden = true; return; }
    el.hidden = false;
    $('#jobTitle').textContent = job.def.title.toUpperCase();
    $('#jobProg').textContent = `${Math.min(job.prog, job.def.goal)}/${job.def.goal} ${job.def.unit}`;
    $('#jobTime').textContent = Math.ceil(job.left / 1000) + 's';
    $('#jobTime').classList.toggle('hot', job.left < 10000);
  },
});
function setStation(i, announce = true) {
  settings.station = (i + STATIONS.length) % STATIONS.length; store.set('settings', settings);
  station = STATIONS[settings.station]; audio.station = station;
  $('#radioBtn').textContent = '📻 ' + station.name;
  if (announce) {
    audio.play('tune');
    const el = $('#radioCard');
    el.innerHTML = '<b></b><small></small>'; el.querySelector('b').textContent = station.name;
    el.querySelector('small').textContent = station.dj ? `${station.dj} — ${station.tag}` : station.tag;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(el.expiry); el.expiry = setTimeout(() => el.classList.remove('show'), 2700);
  }
}
function updateBribe() {
  const b = $('#bribeBtn'); if (!game || !game.heatEnabled) { b.hidden = true; return; }
  b.hidden = game.stars < 1;
  const cost = street.bribeCost();
  const label = `💵 Bribe $${cost.toLocaleString()}`;
  if (b.textContent !== label) b.textContent = label;
  b.disabled = game.runCash < cost;
}

const CREW = {
  chill: ['😎', ['Smooth.', 'Easy money.', 'Keep it clean.', 'We cruising.']],
  hype: ['🤩', ['LET\'S GO!', 'That\'s the play!', 'Big moves!', 'Cash it!']],
  smug: ['😏', ['Back to back, baby.', 'Too clean.', 'They can\'t touch us.']],
  nervous: ['😰', ['Uh... stack\'s high.', 'Dig out, dig out!', 'Getting tight here!']],
  shocked: ['😱', ['Roadblock!', 'They\'re on us!', 'Incoming!']],
  angry: ['😤', ['They hit us!', 'Send it back!', 'Oh, it\'s ON.']],
  mind: ['🤯', ['PERFECT CLEAR?!', 'No way. NO WAY.']],
  party: ['🥳', ['WE GOT AWAY!', 'Clean getaway!', 'Ghosted \'em.']],
  money: ['🤑', ['Get that bag.', 'Cha-ching.', 'Cash grabbed.']],
  sweat: ['🥵', ['It\'s HOT out here.', 'Five stars. Move!', 'Lose them!']],
  dead: ['💀', ['Busted.', 'We\'ll be back.', 'Bail money...']],
  focus: ['🧐', ['Eyes up.', 'Plan the next one.', 'Setup the T...']],
};
let crewMood = 'chill', crewUntil = 0;
function crew(mood, ms = 2200, force = false) {
  const now = performance.now();
  if (!force && now < crewUntil && mood === crewMood) return;
  crewMood = mood; crewUntil = now + ms;
  const [face, lines] = CREW[mood];
  const f = $('#crewFace'); f.textContent = face; f.classList.remove('bump'); void f.offsetWidth; f.classList.add('bump');
  $('#crewSay').textContent = lines[Math.floor(Math.random() * lines.length)];
}

const EMOTES = [['🔥', 'Too hot'], ['😎', 'Easy'], ['💸', 'Get paid'], ['🫡', 'Respect']];
const RIVAL_REPLY = { 0: ['🧯', 'Cool it'], 1: ['🙄', 'Sure...'], 2: ['💰', 'Mine'], 3: ['🤝', 'GG'] };
function emote(i, who = 'you') {
  const [e, t] = who === 'you' ? EMOTES[i] : (RIVAL_REPLY[i] || EMOTES[i]);
  const el = document.createElement('div'); el.className = 'emote';
  const L = layoutInfo;
  const x = who === 'you' ? L.bx + L.bw * (0.25 + Math.random() * 0.5) : L.bx + L.bw + 40;
  el.style.left = (x - 28) + 'px'; el.style.top = (L.by + L.bh * 0.55) + 'px';
  el.innerHTML = `${e}<small></small>`; el.querySelector('small').textContent = who === 'you' ? t : `${$('#rivalName').textContent}: ${t}`;
  $('#emotes').appendChild(el); setTimeout(() => el.remove(), 1900);
  audio.play('emote');
  if (who === 'you') {
    burst(5, 10, '#ffcf4a', 8, { speed: 3, life: 600, size: 0.2 });
    if (rival && Math.random() < 0.8) setTimeout(() => { emote(i, 'rival'); $('#rivalFace').textContent = (RIVAL_REPLY[i] || EMOTES[i])[0]; }, 700 + Math.random() * 600);
  }
}

// ------------------------------------------------------------------ mini piece canvases
function drawPiece(c, kind, cx, cy, cs, cash = -1, alpha = 1) {
  const cells = SHAPES[kind][0];
  const xs = cells.map(p => p[0]), ys = cells.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
  const ox = cx - (w * cs) / 2 - Math.min(...xs) * cs, oy = cy - (h * cs) / 2 - Math.min(...ys) * cs;
  const pal = paletteOf(district);
  cells.forEach(([x, y], i) => {
    const col = i === cash ? [1, 0.78, 0.25] : pal[KINDS.indexOf(kind) + 1];
    const px = ox + x * cs, py = oy + y * cs;
    c.globalAlpha = alpha;
    const g = c.createLinearGradient(px, py, px + cs, py + cs);
    g.addColorStop(0, cssColor(col.map(v => Math.min(1, v * 1.3)))); g.addColorStop(1, cssColor(col.map(v => v * 0.65)));
    c.fillStyle = g; c.fillRect(px + 1, py + 1, cs - 2, cs - 2);
    c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(px + 1, py + 1, cs - 2, Math.max(2, cs * 0.14));
    if (i === cash) { c.fillStyle = '#fff6c8'; c.font = `900 ${cs * 0.6}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', px + cs / 2, py + cs / 2 + 1); }
  });
  c.globalAlpha = 1;
}
function drawSide(snap) {
  const hc = $('#holdCv').getContext('2d'); hc.clearRect(0, 0, 120, 80);
  if (snap.hold) drawPiece(hc, snap.hold.kind, 60, 40, 22, snap.hold.cash, snap.holdUsed ? 0.35 : 1);
  const ncv = $('#nextCv'), compact = !!rival || document.body.classList.contains('portrait'), n = compact ? 3 : 5;
  if (ncv.height !== n * 60) ncv.height = n * 60;
  const nc = ncv.getContext('2d'); nc.clearRect(0, 0, 120, ncv.height);
  snap.queue.slice(0, n).forEach((q, i) => drawPiece(nc, q.kind, 60, 32 + i * 58, i === 0 ? 24 : 18, q.cash, i === 0 ? 1 : 0.8));
}
function drawRival() {
  if (!rivalState) return;
  const c = $('#rivalCv').getContext('2d'); const pal = paletteOf(district);
  c.fillStyle = '#05030a'; c.fillRect(0, 0, 60, 120);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) {
    const k = rivalState.grid[y * 10 + x];
    if (k) { c.fillStyle = cssColor(pal[k]); c.fillRect(x * 6, y * 6, 5.5, 5.5); }
  }
  $('#rivalScore').textContent = rivalState.score.toLocaleString() + (rivalState.stars ? ' · ' + '★'.repeat(rivalState.stars) : '');
}

// ------------------------------------------------------------------ HUD
let lastHud = {};
function updateHud(snap) {
  const set = (id, v) => { if (lastHud[id] !== v) { lastHud[id] = v; $(id).textContent = v; } };
  set('#score', snap.score.toLocaleString());
  set('#cash', '$' + snap.runCash.toLocaleString());
  set('#level', String(snap.level));
  set('#lines', String(snap.lines));
  const starsKey = snap.stars + '|' + (game.heatEnabled ? 1 : 0);
  if (lastHud.stars !== starsKey) {
    lastHud.stars = starsKey;
    $('#stars').innerHTML = game.heatEnabled ? Array.from({ length: 5 }, (_, i) => `<i class="${i < snap.stars ? 'on' : ''}">★</i>`).join('') : '<small class="fine">off</small>';
    $('#stars').classList.toggle('max', snap.stars >= 5);
  }
  $('#pursuitMeter').firstElementChild.style.width = Math.min(100, snap.pursuit * 100) + '%';
  $('#pursuitMeter').style.visibility = snap.stars >= 3 ? 'visible' : 'hidden';
  $('#getaway').hidden = !snap.getaway;
  if (snap.getaway) { $('#gaLines').textContent = snap.getaway.lines; $('#gaTime').style.width = (100 - snap.getaway.t / GETAWAY_MS * 100) + '%'; }
  $('#incoming i').style.height = Math.min(100, snap.incoming * 5) + '%';
  if (challenge && mode === 'challenge') {
    const sec = Math.floor(snap.time / 1000);
    const tl = challenge.t, idx = Math.min(tl.length - 1, Math.floor(sec / 2));
    const theirs = idx >= 0 ? tl[idx] : 0;
    const max = Math.max(challenge.sc, snap.score, 1);
    $('#ghostBar').style.width = (theirs / max * 100) + '%';
    $('#youBar').style.width = (snap.score / max * 100) + '%';
    const d = snap.score - theirs;
    $('#ghostDelta').textContent = (d >= 0 ? '+' : '') + d.toLocaleString() + ' vs ' + challenge.n;
    $('#ghostDelta').style.color = d >= 0 ? '#3dff8a' : '#ff4d6d';
  }
}

// ------------------------------------------------------------------ game flow
function rivalSkill() { return [{ pps: 0.9, mistake: 0.14, name: 'ROOKIE RAY' }, { pps: 1.6, mistake: 0.04, name: 'VEGA' }, { pps: 2.6, mistake: 0, name: 'LEGEND KAI' }][settings.rival] || { pps: 1.6, mistake: 0.04, name: 'VEGA' }; }

function startGame(m) {
  clearOverlays();
  audio.unlock();
  cam.revolution = null;
  if (m === 'revolutions') cam.setMode('tilt');
  mode = m;
  let seed = (Math.random() * 2 ** 32) >>> 0;
  if (m === 'daily') seed = seedFromString('daily-' + todayKey());
  if (m === 'challenge' && challenge) seed = challenge.s >>> 0;
  game = new Game({ seed, heatEnabled: m !== 'chill' && m !== 'revolutions' });
  running = true; paused = false; parts.length = 0; lastHud = {};
  $('#menu').hidden = true; $('#over').hidden = true; $('#pause').hidden = true; $('#hud').hidden = false;
  $('#ghostRace').hidden = m !== 'challenge';
  if (m === 'challenge') $('#ghostName').textContent = `Ghost · ${challenge.n}`;
  stopRival();
  if (m === 'rival') {
    const sk = rivalSkill();
    $('#rival').hidden = false; $('#rivalName').textContent = sk.name; $('#rivalFace').textContent = '😏';
    rival = new Worker(new URL('./rival-worker.js', import.meta.url), { type: 'module' });
    rival.onmessage = onRival;
    rival.postMessage({ type: 'start', seed, pps: sk.pps, mistake: sk.mistake });
  } else $('#rival').hidden = true;
  $('#rightPanel').classList.toggle('compact', m === 'rival');
  input.enabled = true;
  street.reset(game, !fromWorld && m !== 'chill' && m !== 'rival' && m !== 'revolutions');
  if (fromWorld) { $('#job').hidden = false; $('#jobTitle').textContent = 'DRIVING JOB'; $('#jobProg').textContent = '0/8 lines'; $('#jobTime').textContent = ''; }
  audio.intensity = 0; audio.start();
  resize();
  crew('chill', 2000, true);
  banner(m === 'revolutions' ? 'REVOLUTIONS 3D' : m === 'rival' ? 'CREW RIVAL' : m === 'daily' ? 'DAILY HEIST' : m === 'challenge' ? `BEAT ${challenge.n.toUpperCase()}` : m === 'chill' ? 'NIGHT DRIVE' : 'STREET RUN', district.accent);
  requestWake();
}

function stopRival() { if (rival) { rival.postMessage({ type: 'stop' }); rival.terminate(); rival = null; } rivalState = null; }

function onRival({ data }) {
  if (!game || game.over) return;
  if (data.type === 'state') { rivalState = data; }
  else if (data.type === 'attack') { game.receive(data.lines); }
  else if (data.type === 'clear' && data.lines >= 4) { $('#rivalFace').textContent = '😤'; setTimeout(() => emote(1, 'rival'), 200); }
  else if (data.type === 'over') { rivalState && (rivalState.over = true); banner('RIVAL BUSTED', '#3dff8a'); game.end('win'); }
}

function pause(on) {
  if (!running || !game || game.over) return;
  paused = on;
  $('#pause').hidden = !on;
  input.enabled = !on;
  rival?.postMessage({ type: 'pause', paused: on });
  if (on) audio.stop(); else audio.start();
}

function quitToMenu() {
  clearOverlays();
  running = false; paused = false; stopRival(); audio.stop();
  $('#hud').hidden = true; $('#pause').hidden = true; $('#over').hidden = true; $('#menu').hidden = false;
  game = null; boardWorld = null; resize(); refreshMenu(); releaseWake();
  if (fromWorld) { fromWorld = null; enterWorld(true); }
}

// ------------------------------------------------------------------ open world
const world = new World({
  audio, isTouch,
  wallet: { get: () => wallet, add: n => { wallet += n; store.set('wallet', wallet); } },
  toast: (t, c = '#ffffff') => banner(t, c),
  radio: () => setStation(settings.station + 1),
  carColor: () => hex(district.accent),
  rumble: v => { if (settings.haptics) input.rumble(v, 120); },
  onExit: () => { clearOverlays(); world.stop(); $('#menu').hidden = false; refreshMenu(); releaseWake(); audio.stop(); },
  onJob: (job, stars) => {
    world.stop();
    fromWorld = job; boardWorld = job.scene;
    startGame('street');
    if (stars) { game.heat = Math.min(4.5, stars); }
    banner(job.name.toUpperCase(), '#ffcf4a', 'Clear 8 lines · then return to your car');
  },
});
function enterWorld(resume = false, variant = 'roam') {
  clearOverlays();
  if (!resume) world.variant = variant;
  $('#menu').hidden = true; $('#hud').hidden = true; $('#over').hidden = true; $('#pause').hidden = true; $('#touch').hidden = true;
  if (!world.start(resume)) { $('#menu').hidden = false; return; }
  requestWake();
  if (!resume) banner(world.variant === 'getaway' ? 'MIDNIGHT GETAWAY' : 'OPEN WORLD', '#29e6ff', world.variant === 'getaway' ? 'follow the checkpoint on your radar' : 'drive into a glowing marker to start a job');
}

function finishRun() {
  const s = game.snapshot();
  const won = game.overReason === 'win';
  const keep = won ? 1 : game.escapes ? 0.75 : 0.5;
  const banked = Math.round(s.runCash * keep);
  wallet += banked; store.set('wallet', wallet);
  const rankBefore = rankOf(respect).name;
  const respectGain = street.respectRun + game.escapes * 2;
  respect += respectGain; store.set('respect', respect);
  const rankNow = rankOf(respect);
  const recKey = mode === 'challenge' ? 'street' : mode;
  const recs = store.get('records', {});
  const list = recs[recKey] || [];
  const best = list.length ? list[0].score : 0;
  list.push({ name: playerName, score: s.score, lines: s.lines, heat: Math.floor(game.maxHeat), date: todayKey(), day: mode === 'daily' ? todayKey() : undefined });
  list.sort((a, b) => b.score - a.score); recs[recKey] = list.slice(0, 10); store.set('records', recs);
  lastRunStats = { score: s.score, lines: s.lines, seed: game.seed, mode, timeline: game.timeline.filter((_, i) => i % 2 === 0) };

  audio.stop();
  audio.play(won ? 'escape' : 'over');
  crew(won ? 'party' : 'dead', 99999, true);
  const t = $('#overTitle');
  t.textContent = won ? 'YOU WIN' : 'BUSTED'; t.className = won ? 'clean' : 'busted';
  let sub = fromWorld ? (won ? 'Eight lines cleared. Returning to your car.' : 'Job ended. Returning to your car.') : won ? `${$('#rivalName').textContent} went down first.` : 'The stack hit the ceiling.';
  if (mode === 'challenge') sub = s.score > challenge.sc ? `You beat ${challenge.n} by ${(s.score - challenge.sc).toLocaleString()}!` : `${challenge.n} still leads by ${(challenge.sc - s.score).toLocaleString()}.`;
  $('#overSub').textContent = sub;
  const tm = Math.floor(s.time / 1000);
  const cells = [
    ['SCORE', s.score.toLocaleString(), s.score > best], ['LINES', s.lines], ['TIME', `${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, '0')}`],
    ['PEAK HEAT', '★'.repeat(Math.floor(game.maxHeat)) || '—'], ['ESCAPES', game.escapes], ['BANKED', `$${banked.toLocaleString()}` + (keep < 1 ? ` (${keep * 100}%)` : '')],
    ['JOBS', street.jobsDone], ['RESPECT', `+${respectGain}`], ['RANK', rankNow.name, rankNow.name !== rankBefore],
  ];
  street.reset(null);
  $('#results').innerHTML = cells.map(([k, v, nb]) => `<div class="${nb ? 'newbest' : ''}"><span>${k}${nb ? ' · BEST' : ''}</span><b>${v}</b></div>`).join('');
  $('#overMenuBtn').textContent = fromWorld ? '🚗 Back to the streets' : 'Menu';
  const finishedGame = game;
  if (fromWorld) banner(won ? 'JOB COMPLETE' : 'JOB ENDED', won ? '#3dff8a' : '#ffcf4a', 'Returning to your parked car…');
  setTimeout(() => {
    if (game !== finishedGame) return;
    if (fromWorld) quitToMenu(); else $('#over').hidden = false;
  }, fromWorld ? 1600 : 900);
  input.enabled = false;
  stopRival();
  releaseWake();
}

// ------------------------------------------------------------------ event handling
function handleEvents() {
  const ev = game.drainEvents();
  frameEvents = ev;
  const pal = paletteOf(district);
  for (const e of ev) {
    switch (e.type) {
      case 'move': audio.play('move'); break;
      case 'rotate': audio.play('rotate'); break;
      case 'hold': audio.play('hold'); break;
      case 'lock': audio.play('lock'); break;
      case 'harddrop': {
        audio.play('harddrop');
        if (settings.shake) fxShake = Math.min(1, fxShake + 0.25 + e.dist * 0.02);
        for (const [x, y] of e.cells) {
          const wy = H - 1 - y;
          burst(x + 0.5, wy, '#ffffff', 2, { speed: 3, life: 300, size: 0.1, shape: 'spark' });
        }
        if (settings.haptics) input.rumble(0.3, 40);
        break;
      }
      case 'clear': {
        if (mode === 'revolutions') cam.revolve();
        if (fromWorld && game.lines >= 8 && !game.over) game.end('win');
        audio.play('clear', e);
        for (const y of e.rows) {
          const wy = H - 1 - y + 0.5;
          for (let x = 0; x < W; x++) {
            const k = game.grid[y * W + x];
            const col = game.cash[y * W + x] ? '#ffcf4a' : cssColor(pal[k] || [1, 1, 1]);
            burst(x + 0.5, wy, col, e.lines >= 4 ? 5 : 3, { speed: 4 + e.lines * 1.5, life: 900 + e.lines * 150, size: 0.3 });
            if (game.cash[y * W + x]) burst(x + 0.5, wy, '#ffd95a', 10, { speed: 7, life: 1200, size: 0.45, shape: 'coin' });
          }
        }
        if (settings.shake) fxShake = Math.min(1.4, fxShake + e.lines * 0.18 + (e.spin ? 0.3 : 0));
        fxFlash = Math.max(fxFlash, e.lines >= 4 || e.spin ? 0.55 : 0.18);
        if (settings.haptics) input.rumble(0.25 + e.lines * 0.15, 60 + e.lines * 30);
        const parts_ = [];
        if (e.b2b) parts_.push('B2B');
        if (e.combo > 0) parts_.push(`${e.combo} COMBO`);
        const cls = e.pc ? 'gold' : e.lines >= 4 ? 'pink' : e.spin ? 'pink' : e.combo > 2 ? 'hot' : 'cool';
        const show = e.lines >= 2 || e.spin || e.combo > 0 || e.pc;
        if (show) popup(e.pc ? 'PERFECT CLEAR' : e.label, [`+${e.gained.toLocaleString()}`, ...parts_].join('  ·  '), cls);
        if (e.cash) { setTimeout(() => popup(`+$${e.cash.toLocaleString()}`, 'cash grabbed', 'gold', 0.58), 180); audio.play('cash'); crew('money'); }
        if (e.pc) { crew('mind', 3000, true); burst(5, 10, '#ffcf4a', 80, { speed: 10, life: 1800, size: 0.35 }); }
        else if (e.lines >= 4 || (e.spin && !e.mini)) crew(e.b2b ? 'smug' : 'hype');
        else if (e.combo >= 3) crew('hype');
        if (rival && e.attack > 0) rival.postMessage({ type: 'garbage', lines: e.attack });
        break;
      }
      case 'spin': popup(e.label, '', 'pink'); audio.play('spin'); break;
      case 'levelup': popup(`LEVEL ${e.level}`, 'speed up', 'cool', 0.25); break;
      case 'heat':
        if (e.up) {
          audio.play('heatUp'); banner('★'.repeat(e.stars), '#ffcf4a');
          if (e.stars >= 3) { audio.play('siren'); crew('sweat'); }
          audio.intensity = e.stars;
        } else { audio.intensity = e.stars; popup('HEAT COOLING', '★'.repeat(e.stars) || 'clean', 'cool', 0.2); crew('chill'); }
        break;
      case 'getaway': banner('GETAWAY!', '#ff3355'); audio.play('siren'); crew('sweat', 4000, true); popup('CLEAR 6 LINES', 'in 25 seconds', 'hot', 0.6); break;
      case 'escaped': banner('ESCAPED', '#3dff8a'); audio.play('escape'); crew('party', 3500, true); popup(`+${e.bonus.toLocaleString()}`, 'getaway bonus', 'gold'); burst(5, 10, '#3dff8a', 70, { speed: 9, life: 1600 }); break;
      case 'roadblock': banner('ROADBLOCK', '#ffcf4a'); crew('shocked', 2500, true); break;
      case 'pursuit': popup('PURSUIT', 'roadblock rising', 'hot', 0.8); crew('shocked'); break;
      case 'rise': audio.play('rise'); if (settings.shake) fxShake = Math.min(1.4, fxShake + 0.35); if (e.source === 'garbage') crew('angry'); break;
      case 'incoming': crew('angry', 1500); break;
      case 'gameover': finishRun(); break;
    }
  }
}
let frameEvents = [];

// ------------------------------------------------------------------ main loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsShown = 0, qTimer = 0, slowStreak = 0, photoPending = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(50, now - last); last = now;
  if (world.active) return;
  input.update(dt);
  if (running && game && !paused) {
    if (!(mode === 'revolutions' && cam.revolution)) game.update(dt);
    handleEvents();
    const evs = frameEvents;
    street.update(dt, evs);
    if (game.events.length) handleEvents();
    const snap = game.snapshot();
    updateHud(snap); drawSide(snap); drawRival(); updateBribe();
    if (fromWorld && !game.over) $('#jobProg').textContent = `${Math.min(game.lines, 8)}/8 lines`;
    const danger = game.dangerLevel();
    if (danger > 0.7 && crewMood !== 'nervous' && performance.now() > crewUntil) crew('nervous', 2500);
  }
  render(now, dt);
  // FPS + adaptive quality
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 1000) {
    fpsShown = Math.round(fpsN * 1000 / fpsAcc);
    $('#fps').textContent = `${fpsShown} fps · q${quality} · ${Math.round(scale * 100)}%`;
    if (settings.quality === 'auto' && running && !paused && document.visibilityState === 'visible') adapt(fpsShown);
    fpsAcc = 0; fpsN = 0;
  }
}

function adapt(fps) {
  qTimer++;
  if (fps < 48) slowStreak++; else slowStreak = 0;
  if (slowStreak >= 2) {
    slowStreak = 0;
    if (quality > 0) quality--;
    else if (scale > 0.4) { scale = Math.max(0.4, scale - 0.15); resize(); }
    else if (renderer.key !== 'canvas2d') { setupRenderer('canvas2d'); }
    qTimer = 0;
  } else if (fps >= 58 && qTimer > 6) {
    qTimer = 0;
    if (scale < settings.scale) { scale = Math.min(settings.scale, scale + 0.1); resize(); }
    else if (quality < 2) quality++;
  }
}

function render(now, dt) {
  if (!renderer) return;
  const t = now / 1000;
  fxShake *= Math.pow(0.0025, dt / 1000);
  fxFlash *= Math.pow(0.002, dt / 1000);
  let heat = 0, danger = 0, siren = 0;
  if (game) {
    game.writeView(view);
    if (!settings.ghost) for (let i = 0; i < W * VIS; i++) view[i * 4 + 1] &= ~2;
    heat = game.heat; danger = running ? game.dangerLevel() : 0;
    siren = game.getaway ? 1 : game.stars >= 3 ? (game.stars - 2) / 3 : 0;
    if (game.piece) parallax += (((game.piece.x + 1.5) - 5) * 0.08 - parallax) * Math.min(1, dt / 200);
  } else {
    view.fill(0);
    parallax = Math.sin(t * 0.25) * 0.6;
  }
  const sx = (Math.random() - 0.5) * fxShake * 0.5, sy = (Math.random() - 0.5) * fxShake * 0.5;
  const { eye, target } = cam.update({ t, centerY: 10 - layoutInfo.offY, parallax, shake: [sx, sy], attract: !game, forceFlat: renderer.key === 'canvas2d' });
  const pal = paletteOf(district);
  const f = {
    w: canvas.width, h: canvas.height, time: t, heat, eye, target, flash: fxFlash,
    zoom: layoutInfo.zoom, danger, quality: settings.quality === 'auto' ? quality : +settings.quality, offsetY: layoutInfo.offY,
    siren, accent: hex(district.accent), palette: pal, scene: (boardWorld || settings.world) === 'bryce' ? 1 : 0,
    spot: street.spot,
  };
  if (renderer.key === 'canvas2d') {
    const s = canvas.width / layoutInfo.w;
    f.project = (x, y, z, noCam) => project(x, y, z, noCam).map(v => v * s);
  }
  renderer.draw(view, f);
  drawFx(dt);
  if (photoPending) { const p = photoPending; photoPending = null; p(); }
}

// ------------------------------------------------------------------ social: challenges, sharing, photos
const b64u = { enc: s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) };
function readChallenge() {
  const c = new URLSearchParams(location.search).get('c');
  if (!c) return null;
  try {
    const o = JSON.parse(b64u.dec(c));
    if (typeof o.s !== 'number' || typeof o.sc !== 'number' || !Array.isArray(o.t)) return null;
    o.n = String(o.n || 'A friend').slice(0, 14);
    o.t = o.t.slice(0, 600).map(Number);
    return o;
  } catch { return null; }
}
function challengeUrl() {
  const r = lastRunStats;
  const payload = { v: 1, s: r.seed, n: playerName, sc: r.score, t: r.timeline.slice(0, 600) };
  const u = new URL(location.href); u.search = ''; u.hash = '';
  u.searchParams.set('c', b64u.enc(JSON.stringify(payload)));
  return u.toString();
}
async function shareChallenge() {
  const url = challengeUrl();
  const text = `I scored ${lastRunStats.score.toLocaleString()} on HEAT STACK. Same pieces, your turn.`;
  try {
    if (navigator.share) { await navigator.share({ title: 'HEAT STACK challenge', text, url }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); popup('LINK COPIED', 'send it to your crew', 'cool', 0.5); }
  catch { prompt('Copy this challenge link:', url); }
}
function takePhoto() {
  return new Promise(resolve => {
    photoPending = () => {
      const L = layoutInfo, out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height;
      const c = out.getContext('2d');
      c.drawImage(canvas, 0, 0, out.width, out.height);
      c.drawImage($('#fx'), 0, 0, out.width, out.height);
      const s = out.width / L.w;
      c.font = `italic 900 ${28 * s}px system-ui`; c.fillStyle = '#ffffff'; c.shadowColor = district.accent; c.shadowBlur = 20 * s;
      c.fillText('HEAT STACK', 20 * s, 44 * s);
      if (game) { c.font = `700 ${16 * s}px ui-monospace, monospace`; c.fillText(`${game.score.toLocaleString()} pts · ${'★'.repeat(game.stars)} · ${district.name}`, 20 * s, 68 * s); }
      out.toBlob(resolve, 'image/png');
    };
  });
}
async function sharePhoto() {
  document.body.classList.add('photo');
  await new Promise(r => setTimeout(r, 60));
  const blob = await takePhoto();
  document.body.classList.remove('photo');
  if (!blob) return;
  const file = new File([blob], 'heat-stack.png', { type: 'image/png' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'HEAT STACK' }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'heat-stack.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------------ menus
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function refreshMenu() {
  $('#walletTag').textContent = '$' + wallet.toLocaleString();
  { const r = rankOf(respect); $('#rankTag').textContent = `${r.name} · ${respect} respect` + (r.next ? ` · next: ${r.next[1]} at ${r.next[0]}` : ''); }
  const recs = store.get('records', {});
  const daily = (recs.daily || []).filter(r => r.day === todayKey());
  $('#dailyInfo').textContent = daily.length ? `Today's best: ${daily[0].score.toLocaleString()}. Same pieces for everyone.` : `Seed for ${todayKey()}. Everyone gets the same pieces.`;
  $('#caps').textContent = capsText() + (renderer ? ` · rendering with ${renderer.name}` : '');
  if (challenge) {
    $('#challenge').hidden = false;
    $('#challenge').innerHTML = `<b></b> challenged you: beat <b></b> on their seed. <button class="primary" id="takeChallenge">Take it</button>`;
    const bs = $('#challenge').querySelectorAll('b'); bs[0].textContent = challenge.n; bs[1].textContent = challenge.sc.toLocaleString();
    $('#takeChallenge').onclick = () => startGame('challenge');
  }
}
function openSheet(id) { $(id).hidden = false; audio.play('ui'); }
$$('.sheet .close').forEach(b => b.addEventListener('click', () => { b.closest('.sheet').hidden = true; }));

function renderDistricts() {
  $('#districtList').innerHTML = '';
  for (const d of DISTRICTS) {
    const has = owned.has(d.id);
    const el = document.createElement('button');
    el.className = 'district' + (d === district ? ' active' : '') + (has ? '' : ' locked');
    el.innerHTML = `<b></b><div class="sw">${d.blocks.map(c => `<i style="background:${c}"></i>`).join('')}</div><small></small><span></span>`;
    el.querySelector('b').textContent = d.name; el.querySelector('small').textContent = d.blurb;
    el.querySelector('span').textContent = d === district ? 'Active' : has ? 'Ride here' : `Unlock · $${d.price.toLocaleString()}`;
    el.onclick = () => {
      if (!has) {
        if (wallet < d.price) { el.querySelector('span').textContent = `Need $${(d.price - wallet).toLocaleString()} more`; return; }
        wallet -= d.price; owned.add(d.id); store.set('wallet', wallet); store.set('owned', [...owned]); audio.unlock(); audio.play('cash');
      }
      district = d; store.set('district', d.id);
      document.documentElement.style.setProperty('--accent', d.accent);
      renderDistricts(); refreshMenu();
    };
    $('#districtList').appendChild(el);
  }
}
function renderRecords() {
  const recs = store.get('records', {});
  const names = { street: 'Street Run', rival: 'Crew Rival', daily: 'Daily Heist', chill: 'Night Drive' };
  let html = '';
  for (const [k, n] of Object.entries(names)) {
    const list = recs[k] || [];
    html += `<h3>${n.toUpperCase()}</h3>`;
    html += list.length ? `<table>${list.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${r.day ? ' · ' + r.day : ''}</td><td>${r.score.toLocaleString()}</td></tr>`).join('')}</table>` : '<p class="fine">No runs yet.</p>';
  }
  $('#recordList').innerHTML = html;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bindSettings() {
  const bind = (id, key, conv = v => v, after) => {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
    const out = el.nextElementSibling?.tagName === 'OUTPUT' ? el.nextElementSibling : null;
    const show = () => { if (out) out.textContent = el.value + (key === 'scale' ? '×' : ' ms'); };
    show();
    el.addEventListener('input', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : conv(el.value);
      store.set('settings', settings); show(); after?.();
    });
  };
  bind('#setEngine', 'engine', v => v, () => setupRenderer(settings.engine));
  bind('#setQuality', 'quality', v => v, () => { if (settings.quality !== 'auto') quality = +settings.quality; });
  bind('#setScale', 'scale', Number, () => { scale = settings.scale; resize(); });
  bind('#setDas', 'das', Number, () => { input.das = settings.das; });
  bind('#setArr', 'arr', Number, () => { input.arr = settings.arr; });
  bind('#setRival', 'rival', Number);
  bind('#setMusic', 'music', v => v, () => audio.setMusic(settings.music));
  bind('#setSfx', 'sfx', v => v, () => audio.setSfx(settings.sfx));
  bind('#setShake', 'shake');
  bind('#setHaptics', 'haptics');
  bind('#setTouch', 'touch', v => v, resize);
  bind('#setGhost', 'ghost');
  bind('#setCamera', 'camera', v => v, () => { cam.setMode(settings.camera); });
  bind('#setWorld', 'world', v => v);
}

// ------------------------------------------------------------------ platform: wake lock, visibility, PWA
async function requestWake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not granted */ } }
function releaseWake() { try { wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pause(true);
  else if (running && wakeLock === null) requestWake();
});
let installEvt = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  const b = document.createElement('button'); b.textContent = '⬇ Install app';
  b.className = 'primary'; b.style.cssText = 'border-radius:10px;padding:6px 12px;border:0';
  b.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; b.remove(); };
  $('#installSlot').replaceChildren(b);
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ------------------------------------------------------------------ input wiring
const input = new Input((a, src) => {
  if (a === 'pause') { if (running && game && !game.over) pause(!paused); return; }
  if (!running || paused || !game || game.over || (mode === 'revolutions' && cam.revolution)) return;
  audio.unlock();
  switch (a) {
    case 'left': game.move(-1); break;
    case 'right': game.move(1); break;
    case 'soft': if (game.softDrop() && src !== 'repeat') audio.play('soft'); break;
    case 'hard': game.hardDrop(); break;
    case 'cw': game.rotate(1); break;
    case 'ccw': game.rotate(-1); break;
    case 'r180': game.rotate(2); break;
    case 'hold': game.doHold(); break;
    case 'radio': setStation(settings.station + 1); break;
    case 'bribe': street.bribe(); break;
    case 'frame': cam.frame(); cam.setMode('free'); popup('FRAMED', 'free camera · Alt+drag to orbit', 'cool', 0.15); break;
    case 'camera': cycleCamera(); break;
    case 'emote1': emote(0); break; case 'emote2': emote(1); break; case 'emote3': emote(2); break; case 'emote4': emote(3); break;
  }
});
input.das = settings.das; input.arr = settings.arr;
input.bindButtons($('#touch'));
$$('#emoteBar button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); emote(+b.dataset.emote); }));

$$('.mode').forEach(b => b.addEventListener('click', () => { if (b.dataset.mode === 'getaway') { audio.unlock(); enterWorld(false, 'getaway'); } else if (b.dataset.mode === 'world') { audio.unlock(); enterWorld(); } else startGame(b.dataset.mode); }));
$('#districtBtn').onclick = () => { renderDistricts(); openSheet('#districts'); };
$('#boardBtn').onclick = () => { renderRecords(); openSheet('#records'); };
$('#settingsBtn').onclick = () => openSheet('#settings');
$('#pauseSettingsBtn').onclick = () => openSheet('#settings');
$('#howBtn').onclick = () => openSheet('#how');
$('#pauseBtn').onclick = () => pause(true);
function cycleCamera() { const ms = Object.keys(CAMERA_MODES); cam.setMode(ms[(ms.indexOf(cam.mode) + 1) % ms.length]); popup('CAMERA', CAMERA_MODES[cam.mode], 'cool', 0.15); }
$('#radioBtn').onclick = () => { audio.unlock(); setStation(settings.station + 1); };
$('#camBtn').onclick = cycleCamera;
$('#bribeBtn').addEventListener('click', () => street.bribe());
$('#resumeBtn').onclick = () => pause(false);
$('#restartBtn').onclick = () => startGame(mode);
$('#quitBtn').onclick = quitToMenu;
$('#againBtn').onclick = () => startGame(mode);
$('#overMenuBtn').onclick = quitToMenu;
$('#shareBtn').onclick = shareChallenge;
$('#photoBtn').onclick = sharePhoto;
$('#overPhotoBtn').onclick = sharePhoto;
const nameInput = $('#nameInput'); nameInput.value = playerName;
nameInput.addEventListener('input', () => { playerName = nameInput.value.trim().slice(0, 14) || 'Player'; store.set('name', playerName); });
addEventListener('resize', resize);
addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });

// ------------------------------------------------------------------ boot
(async function boot() {
  challenge = readChallenge();
  document.documentElement.style.setProperty('--accent', district.accent);
  scale = settings.scale;
  if (settings.quality !== 'auto') quality = +settings.quality;
  // Low-power ARM Linux (e.g. Raspberry Pi): start conservative, the adapter will climb if there's headroom.
  if (/Linux (aarch64|armv7l|armv8)/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) { quality = 0; scale = Math.min(scale, 0.5); }
  bindSettings();
  setStation(settings.station, false);
  await setupRenderer(settings.engine);
  resize(); refreshMenu();
  if (!store.get('seenHow', false)) { store.set('seenHow', true); }
  requestAnimationFrame(frame);
  // Debug/test hook (read-only usage by automated checks).
  window.__heat = { get game() { return game; }, get renderer() { return renderer?.key; }, startGame, layoutInfo, world, enterWorld, cam };
})();
