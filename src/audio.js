// Synthesised audio: SFX + an adaptive night-drive soundtrack whose layers follow the heat level.
export class Audio {
  constructor() { this.ctx = null; this.music = true; this.sfx = true; this.intensity = 0; this.step = 0; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.mBus = c.createGain(); this.mBus.gain.value = this.music ? 0.32 : 0; this.mBus.connect(this.master);
    this.sBus = c.createGain(); this.sBus.gain.value = this.sfx ? 0.8 : 0; this.sBus.connect(this.master);
    // Simple feedback delay for space.
    this.delay = c.createDelay(); this.delay.delayTime.value = 0.28;
    const fb = c.createGain(); fb.gain.value = 0.28; const wet = c.createGain(); wet.gain.value = 0.25;
    this.delay.connect(fb).connect(this.delay); this.delay.connect(wet).connect(this.master);
    const len = c.sampleRate * 0.3; const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  setMusic(on) { this.music = on; if (this.mBus) this.mBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1); }
  setSfx(on) { this.sfx = on; if (this.sBus) this.sBus.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05); }

  tone(freq, dur, { type = 'square', vol = 0.2, bus, t = this.ctx.currentTime, slide = 0, attack = 0.005, send = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sBus);
    if (send) { const s = c.createGain(); s.gain.value = send; g.connect(s).connect(this.delay); }
    o.start(t); o.stop(t + dur + 0.05);
  }

  hit(dur, vol, freq = 1200, bus, t = this.ctx.currentTime, q = 1) {
    const c = this.ctx; if (!c) return;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.sBus); s.start(t); s.stop(t + dur + 0.02);
  }

  play(name, data = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'move': this.tone(880, 0.03, { vol: 0.04, type: 'triangle' }); break;
      case 'rotate': this.tone(1320, 0.04, { vol: 0.05, type: 'triangle', slide: 1.2 }); break;
      case 'soft': this.tone(220, 0.02, { vol: 0.03 }); break;
      case 'lock': this.tone(140, 0.09, { vol: 0.16, type: 'sine', slide: 0.6 }); this.hit(0.05, 0.1, 400); break;
      case 'harddrop': this.tone(90, 0.18, { vol: 0.3, type: 'sine', slide: 0.4 }); this.hit(0.12, 0.25, 250, null, t, 0.7); break;
      case 'hold': this.tone(660, 0.06, { vol: 0.07, type: 'sawtooth', slide: 0.7 }); break;
      case 'clear': {
        const n = data.lines || 1;
        const chord = n >= 4 ? [523, 659, 784, 1047, 1319] : [440, 554, 659, 880].slice(0, n + 1);
        chord.forEach((f, i) => this.tone(f, 0.35 + n * 0.05, { vol: 0.09, type: 'sawtooth', t: t + i * 0.035, send: 0.5 }));
        this.hit(0.25, 0.15, 3000, null, t, 0.5);
        if (data.combo > 0) this.tone(440 * Math.pow(2, Math.min(data.combo, 12) / 12), 0.15, { vol: 0.08, type: 'square', t: t + 0.12 });
        break;
      }
      case 'spin': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.12, { vol: 0.08, type: 'triangle', t: t + i * 0.05, send: 0.4 })); break;
      case 'cash': [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.12, { vol: 0.07, type: 'square', t: t + i * 0.06, send: 0.6 })); break;
      case 'heatUp': this.tone(300, 0.5, { vol: 0.12, type: 'sawtooth', slide: 2.2, send: 0.4 }); break;
      case 'siren': for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 880, 0.22, { vol: 0.07, type: 'square', t: t + i * 0.22 }); break;
      case 'rise': this.tone(70, 0.3, { vol: 0.25, type: 'sawtooth', slide: 0.5 }); this.hit(0.3, 0.2, 180); break;
      case 'escape': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, { vol: 0.1, type: 'sawtooth', t: t + i * 0.08, send: 0.6 })); break;
      case 'over': [440, 349, 262, 196].forEach((f, i) => this.tone(f, 0.4, { vol: 0.12, type: 'triangle', t: t + i * 0.18 })); break;
      case 'emote': this.tone(1046, 0.08, { vol: 0.06, type: 'triangle', slide: 1.5 }); break;
      case 'ui': this.tone(1200, 0.03, { vol: 0.04, type: 'triangle' }); break;
    }
  }

  // 16-step sequencer at 112-140 bpm depending on heat.
  schedule() {
    const c = this.ctx; if (!c || !this.playing) return;
    const bpm = 112 + this.intensity * 6;
    const stepDur = 60 / bpm / 4;
    const roots = [55, 55, 49, 41.2, 43.65, 43.65, 49, 49];
    while (this.nextT < c.currentTime + 0.15) {
      const s = this.step % 16, bar = Math.floor(this.step / 16) % 8, t = this.nextT, I = this.intensity;
      const root = roots[bar];
      if (s % 4 === 0) { this.tone(110, 0.16, { type: 'sine', vol: 0.5, bus: this.mBus, t, slide: 0.35 }); }
      if (I >= 1 && s % 8 === 4) this.hit(0.12, 0.25, 1800, this.mBus, t, 0.8);
      if (s % 2 === 1) this.hit(0.03, 0.07 + I * 0.02, 8000, this.mBus, t, 2);
      if ([0, 3, 6, 10, 12, 14].includes(s)) this.tone(root * (s === 14 ? 1.5 : 1), stepDur * 1.6, { type: 'sawtooth', vol: 0.16, bus: this.mBus, t });
      if (I >= 2) {
        const arp = [4, 3, 0, 2, 4, 7, 3, 2][s % 8];
        const scale = [1, 1.122, 1.189, 1.335, 1.498, 1.587, 1.782, 2];
        this.tone(root * 4 * scale[arp], stepDur * 0.9, { type: 'square', vol: 0.045, bus: this.mBus, t, send: 0.4 });
      }
      if (I >= 4 && s % 8 === 0) this.tone(root * 8, stepDur * 4, { type: 'triangle', vol: 0.05, bus: this.mBus, t, attack: 0.05, send: 0.5 });
      this.nextT += stepDur; this.step++;
    }
  }
  start() { this.playing = true; if (this.ctx) this.nextT = this.ctx.currentTime + 0.05; }
  stop() { this.playing = false; }
}
