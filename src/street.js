// Open-world-crime style systems layered over the engine (all original names and content):
//   • Contacts phone you with timed jobs (missions) → MISSION PASSED / FAILED, cash + respect
//   • Police chopper searchlight at high heat — staying in the light fills the pursuit faster
//   • Bribes: pay run cash to drop a star
//   • Radio stations you can flip between
//   • Respect → persistent rank

export const CONTACTS = {
  lou: { name: 'Lou Vance', role: 'Fixer', face: '🕴️' },
  nina: { name: 'Nina Cross', role: 'Smuggler', face: '👩‍🎤' },
  tomo: { name: 'Big Tomo', role: 'Street racer', face: '🏎️' },
  ada: { name: 'Ada Quill', role: 'Hacker', face: '👩‍💻' },
};

// Each job: who calls, the pitch, goal + seconds, and how to measure progress from engine events.
export const JOBS = [
  { id: 'demo', who: 'lou', title: 'Demolition', pitch: 'Need eight floors gone. Fast.', goal: 8, secs: 40, unit: 'lines', reward: 2500, cash: 400, respect: 2, on: (e) => e.type === 'clear' ? e.lines : 0 },
  { id: 'cash', who: 'nina', title: 'Bag Run', pitch: 'Two bags are in the stack. Grab them.', goal: 2, secs: 55, unit: 'bags', reward: 2000, cash: 900, respect: 2, on: (e) => e.type === 'clear' ? (e.cashCells || 0) : 0 },
  { id: 'spin', who: 'ada', title: 'Clean Entry', pitch: 'Slip a T in sideways. No alarms.', goal: 1, secs: 60, unit: 'T-spins', reward: 4000, cash: 600, respect: 3, on: (e) => e.type === 'clear' && e.spin && !e.mini ? 1 : 0 },
  { id: 'quad', who: 'tomo', title: 'Four-Lane Blowout', pitch: 'One quad. Make the crowd lose it.', goal: 1, secs: 50, unit: 'quads', reward: 3500, cash: 500, respect: 3, on: (e) => e.type === 'clear' && e.lines === 4 ? 1 : 0 },
  { id: 'combo', who: 'tomo', title: 'Chain Reaction', pitch: 'Hit a 3-combo. Keep the engine hot.', goal: 3, secs: 45, unit: 'combo', reward: 3000, cash: 500, respect: 2, max: true, on: (e) => e.type === 'clear' ? e.combo : 0 },
  { id: 'heat', who: 'lou', title: 'Make Noise', pitch: 'I need the cops looking your way. Get to 3 stars.', goal: 3, secs: 60, unit: '★', reward: 3000, cash: 700, respect: 3, max: true, on: (e, g) => g.stars },
];

export const RANKS = [
  [0, 'Street Rat'], [5, 'Hustler'], [15, 'Wheelman'], [30, 'Enforcer'], [55, 'Fixer'], [90, 'Shot Caller'], [140, 'Kingpin'],
];
export function rankOf(respect) {
  let r = RANKS[0][1], next = null;
  for (let i = 0; i < RANKS.length; i++) { if (respect >= RANKS[i][0]) { r = RANKS[i][1]; next = RANKS[i + 1] || null; } }
  return { name: r, next };
}

export const STATIONS = [
  { id: 'neon', name: 'NEON 88.8', dj: 'DJ Halo', tag: 'synthwave for the night shift', bpm: 112, roots: [55, 55, 49, 41.2, 43.65, 43.65, 49, 49], lead: 'square', bass: 'sawtooth', scale: [1, 1.122, 1.189, 1.335, 1.498, 1.587, 1.782, 2] },
  { id: 'bass', name: 'BASS CITY 101.7', dj: 'Mona Drop', tag: 'low end, no limits', bpm: 128, roots: [41.2, 41.2, 36.7, 36.7, 49, 49, 43.65, 46.25], lead: 'sawtooth', bass: 'square', scale: [1, 1.189, 1.335, 1.498, 1.587, 1.782, 2, 2.378] },
  { id: 'tide', name: 'LOW TIDE FM', dj: 'Captain Calm', tag: 'slow waves, warm tape', bpm: 84, roots: [65.4, 65.4, 55, 55, 58.27, 58.27, 49, 49], lead: 'triangle', bass: 'triangle', scale: [1, 1.122, 1.26, 1.498, 1.682, 2, 2.245, 2.52] },
  { id: 'off', name: 'RADIO OFF', dj: '', tag: 'just the city', bpm: 0 },
];

export class Street {
  constructor(hooks) {
    this.h = hooks;   // { popup, banner, crew, audio, phone(show,data), hud(data) }
    this.reset(null);
  }

  reset(game, enabled = true) {
    this.game = game;
    this.enabled = enabled && !!game;
    this.job = null;
    this.nextCall = 14000 + Math.random() * 6000;
    this.calling = null;
    this.spot = [5, 10, 0];
    this.spotT = Math.random() * 100;
    this.inLight = 0;
    this.respectRun = 0;
    this.jobsDone = 0;
    this.lastJob = null;
    this.chopperOn = false;
  }

  bribeCost() { const g = this.game; return g ? 400 * Math.max(1, g.stars) * g.level : 0; }

  bribe() {
    const g = this.game; if (!g || g.over || g.stars < 1) return false;
    const cost = this.bribeCost();
    if (g.runCash < cost) { this.h.popup('NOT ENOUGH CASH', `bribe costs $${cost.toLocaleString()}`, 'hot', 0.3); return false; }
    g.runCash -= cost;
    g.heat = Math.max(0, Math.floor(g.heat + 1e-6) - 1 + 0.2);
    if (g.stars < 5) g.getaway = null;
    g.pursuitT = 0;
    g.emit('heat', { stars: g.stars, up: false });
    this.h.popup(`-$${cost.toLocaleString()}`, 'cops paid off · heat down', 'gold', 0.3);
    this.h.audio.play('cash');
    this.h.crew('money', 2000, true);
    return true;
  }

  // Called every frame with dt and the engine events drained this frame.
  update(dt, events) {
    const g = this.game; if (!this.enabled || !g || g.over) return;
    // Searchlight: wanders over the board at 4★+, locks harder during a getaway.
    this.chopperOn = g.stars >= 4 || !!g.getaway;
    if (this.chopperOn) {
      this.spotT += dt / 1000 * (g.getaway ? 1.5 : 1);
      const p = g.piece;
      let tx = 5 + Math.sin(this.spotT * 0.9) * 4 + Math.sin(this.spotT * 2.3) * 1;
      let ty = 10 + Math.sin(this.spotT * 0.6 + 1) * 7;
      if (p && g.getaway) { // homes in on the active piece during a getaway
        const px = p.x + 1.5, py = 21 - (p.y + 1);
        tx += (px - tx) * 0.5; ty += (py - ty) * 0.5;
      }
      this.spot[0] += (tx - this.spot[0]) * Math.min(1, dt / 300);
      this.spot[1] += (ty - this.spot[1]) * Math.min(1, dt / 300);
      this.spot[2] = Math.min(1, this.spot[2] + dt / 800);
      if (p) {
        const px = p.x + 1.5, py = 21 - (p.y + 1);
        const lit = Math.hypot(px - this.spot[0], py - this.spot[1]) < 2.2;
        if (lit) { g.pursuitT += dt * 1.2; this.inLight += dt; if (this.inLight > 600 && this.inLight - dt <= 600) this.h.crew('shocked', 1800, true); }
        else this.inLight = 0;
      }
      if (!this._chopSound || performance.now() - this._chopSound > 900) { this._chopSound = performance.now(); this.h.audio.play('chopper'); }
    } else this.spot[2] = Math.max(0, this.spot[2] - dt / 800);

    // Phone calls → jobs.
    if (this.job) {
      this.job.left -= dt;
      for (const e of events) {
        const v = this.job.def.on(e, g);
        if (!v) continue;
        this.job.prog = this.job.def.max ? Math.max(this.job.prog, v) : this.job.prog + v;
      }
      if (this.job.def.max) this.job.prog = Math.max(this.job.prog, this.job.def.id === 'heat' ? g.stars : 0);
      if (this.job.prog >= this.job.def.goal) this.pass();
      else if (this.job.left <= 0) this.fail();
      else this.h.hud(this.job);
    } else {
      this.nextCall -= dt;
      if (this.nextCall <= 0) this.call();
    }
  }

  call() {
    const options = JOBS.filter(j => j.id !== this.lastJob && !(j.id === 'heat' && this.game.stars >= 3));
    const def = options[Math.floor(Math.random() * options.length)];
    this.lastJob = def.id;
    const c = CONTACTS[def.who];
    this.job = { def, left: def.secs * 1000, prog: 0, contact: c };
    this.h.phone(true, { contact: c, def });
    this.h.audio.play('phone');
    this.h.hud(this.job);
  }

  pass() {
    const { def } = this.job; const g = this.game;
    const reward = def.reward * g.level;
    g.score += reward; g.runCash += def.cash;
    this.respectRun += def.respect; this.jobsDone++;
    this.h.banner('MISSION PASSED', '#ffcf4a', `RESPECT +${def.respect}  ·  $${def.cash.toLocaleString()}  ·  +${reward.toLocaleString()}`);
    this.h.audio.play('mission');
    this.h.crew('party', 2500, true);
    this.end();
  }
  fail() {
    this.h.banner('MISSION FAILED', '#ff4d6d', `${this.job.contact.name} hung up`);
    this.h.audio.play('fail');
    this.end();
  }
  end() { this.job = null; this.nextCall = 20000 + Math.random() * 15000; this.h.hud(null); this.h.phone(false); }
}
