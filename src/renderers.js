// Three interchangeable rendering engines sharing one interface:
//   await R.init(canvas) -> bool ; R.resize(w,h,scale) ; R.draw(viewBuf, frame) ; R.name
// frame = { time, heat, camX, camY, flash, zoom, danger, quality, offsetY, siren, accent:[r,g,b], palette:[[r,g,b]x10] }
import { GLSL_VS, GLSL_FS, WGSL, UNIFORM_FLOATS } from './shaders.js';

const BW = 10, BH = 20;

function packUniforms(f, out) {
  const v = (i, a, b, c, d) => { out[i] = a; out[i + 1] = b; out[i + 2] = c; out[i + 3] = d; };
  v(0, f.w, f.h, f.time, f.heat);
  v(4, f.eye[0], f.eye[1], f.eye[2], f.zoom);
  v(8, f.danger, f.quality, f.flash, f.siren);
  v(12, f.accent[0], f.accent[1], f.accent[2], f.scene);
  v(16, f.target[0], f.target[1], f.target[2], 0);
  v(20, f.spot[0], f.spot[1], f.spot[2], 0);
  for (let i = 0; i < 10; i++) {
    const c = f.palette[i] || [0, 0, 0];
    v(24 + i * 4, c[0], c[1], c[2], 1);
  }
  return out;
}

// ---------------------------------------------------------------- WebGPU
export class GPURenderer {
  name = 'WebGPU · ray traced';
  async init(canvas) {
    if (!navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.ctx = canvas.getContext('webgpu');
      if (!this.ctx) return false;
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
      const mod = this.device.createShaderModule({ code: WGSL });
      const info = await mod.getCompilationInfo?.();
      if (info && info.messages.some(m => m.type === 'error')) {
        console.warn('WGSL errors', info.messages.map(m => `${m.lineNum}:${m.message}`).join('\n'));
        return false;
      }
      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.ubuf = this.device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.tex = this.device.createTexture({ size: [BW, BH], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.ubuf } }, { binding: 1, resource: this.tex.createView() }],
      });
      this.u = new Float32Array(UNIFORM_FLOATS);
      this.lost = false;
      this.device.lost.then(() => { this.lost = true; });
      this.adapterInfo = adapter.info ? `${adapter.info.vendor || ''} ${adapter.info.architecture || ''}`.trim() : '';
      return true;
    } catch (e) { console.warn('WebGPU init failed', e); return false; }
  }
  resize() { /* canvas size drives the swapchain */ }
  draw(view, f) {
    const q = this.device.queue;
    q.writeTexture({ texture: this.tex }, view, { bytesPerRow: BW * 4 }, [BW, BH]);
    q.writeBuffer(this.ubuf, 0, packUniforms(f, this.u));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bind); pass.draw(3); pass.end();
    q.submit([enc.finish()]);
  }
}

// ---------------------------------------------------------------- WebGL2
export class GLRenderer {
  name = 'WebGL2 · ray traced';
  async init(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    if (!gl) return false;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, GLSL_VS), fs = sh(gl.FRAGMENT_SHADER, GLSL_FS);
    if (!vs || !fs) return false;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return false; }
    this.p = p; gl.useProgram(p);
    this.loc = {
      u0: gl.getUniformLocation(p, 'u0'), u1: gl.getUniformLocation(p, 'u1'), u2: gl.getUniformLocation(p, 'u2'),
      u3: gl.getUniformLocation(p, 'u3'), u4: gl.getUniformLocation(p, 'u4'), u5: gl.getUniformLocation(p, 'u5'), pal: gl.getUniformLocation(p, 'pal'), board: gl.getUniformLocation(p, 'board'),
    };
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BW, BH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.uniform1i(this.loc.board, 0);
    this.vao = gl.createVertexArray();
    this.u = new Float32Array(UNIFORM_FLOATS);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.adapterInfo = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    return true;
  }
  resize(w, h) { this.gl.viewport(0, 0, w, h); }
  draw(view, f) {
    const gl = this.gl, u = packUniforms(f, this.u);
    gl.useProgram(this.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, view);
    gl.uniform4fv(this.loc.u0, u.subarray(0, 4)); gl.uniform4fv(this.loc.u1, u.subarray(4, 8));
    gl.uniform4fv(this.loc.u2, u.subarray(8, 12)); gl.uniform4fv(this.loc.u3, u.subarray(12, 16));
    gl.uniform4fv(this.loc.u4, u.subarray(16, 20)); gl.uniform4fv(this.loc.u5, u.subarray(20, 24));
    gl.uniform4fv(this.loc.pal, u.subarray(24, 64));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// ---------------------------------------------------------------- Canvas 2D (sprites; Raspberry Pi / low power)
const rgb = (c, m = 1) => `rgb(${Math.min(255, c[0] * 255 * m) | 0},${Math.min(255, c[1] * 255 * m) | 0},${Math.min(255, c[2] * 255 * m) | 0})`;

export class Canvas2DRenderer {
  name = 'Canvas 2D · sprites';
  async init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sprites = new Map();
    this.bgKey = '';
    this.adapterInfo = 'CPU';
    return !!this.ctx;
  }
  resize(w, h) { this.w = w; this.h = h; this.bgKey = ''; this.sprites.clear(); }

  sprite(kind, size, f, cash) {
    const key = `${kind}|${size}|${cash ? 1 : 0}|${f.palette[kind].join()}`;
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas'); s.width = s.height = size;
    const c = s.getContext('2d');
    const col = cash ? [1, 0.76, 0.22] : f.palette[kind];
    if (kind === 8) {
      c.fillStyle = '#2c2f36'; c.fillRect(0, 0, size, size);
      c.save(); c.beginPath(); c.rect(0, size * 0.3, size, size * 0.4); c.clip();
      c.fillStyle = '#8a6a12';
      for (let i = -size; i < size * 2; i += size / 2) { c.beginPath(); c.moveTo(i, size); c.lineTo(i + size / 4, size); c.lineTo(i + size / 4 + size, 0); c.lineTo(i + size, 0); c.fill(); }
      c.restore();
    } else {
      const g = c.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, rgb(col, 1.35)); g.addColorStop(0.5, rgb(col, 1)); g.addColorStop(1, rgb(col, 0.6));
      c.fillStyle = g; c.fillRect(0, 0, size, size);
      const b = Math.max(2, size * 0.14);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(size, 0); c.lineTo(size - b, b); c.lineTo(b, b); c.lineTo(b, size - b); c.lineTo(0, size); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.moveTo(size, size); c.lineTo(0, size); c.lineTo(b, size - b); c.lineTo(size - b, size - b); c.lineTo(size - b, b); c.lineTo(size, 0); c.fill();
      c.strokeStyle = rgb(col, 1.6); c.globalAlpha = 0.5; c.lineWidth = Math.max(1, size * 0.04);
      c.strokeRect(size * 0.26, size * 0.26, size * 0.48, size * 0.48); c.globalAlpha = 1;
      if (cash) {
        c.fillStyle = '#fff6c8'; c.font = `900 ${size * 0.55}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('$', size / 2, size / 2 + size * 0.03);
      }
    }
    this.sprites.set(key, s);
    return s;
  }

  background(f, project) {
    const key = `${this.w}x${this.h}|${f.accent.join()}|${f.zoom}|${f.offsetY}`;
    if (key === this.bgKey) return;
    this.bgKey = key;
    const bg = this.bg || (this.bg = document.createElement('canvas'));
    bg.width = this.w; bg.height = this.h;
    const c = bg.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#05030d'); g.addColorStop(0.65, rgb(f.accent, 0.35)); g.addColorStop(1, '#0a0410');
    c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(255,255,255,${rnd() * 0.7})`; c.fillRect(rnd() * this.w, rnd() * this.h * 0.5, 1.5, 1.5); }
    for (let layer = 0; layer < 2; layer++) {
      let x = 0;
      while (x < this.w) {
        const bw = (20 + rnd() * 60) * (layer ? 0.8 : 1.2), bh = this.h * (0.15 + rnd() * 0.45) * (layer ? 0.8 : 1);
        c.fillStyle = layer ? '#0b0816' : '#06040c';
        c.fillRect(x, this.h - bh, bw, bh);
        for (let wy = this.h - bh + 6; wy < this.h - 4; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 7) {
          if (rnd() < 0.35) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,190,110,0.55)' : rgb(f.accent, 1.2); c.globalAlpha = layer ? 0.4 : 0.75; c.fillRect(wx, wy, 3, 4); c.globalAlpha = 1; }
        }
        x += bw + 2;
      }
    }
    const a = project(0, 20, 0.5), b = project(10, 0, 0.5);
    c.fillStyle = 'rgba(5,4,12,0.92)'; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    c.strokeStyle = rgb(f.accent, 1.3); c.lineWidth = 3; c.shadowColor = rgb(f.accent, 1.5); c.shadowBlur = 18;
    c.strokeRect(a[0] - 3, a[1] - 3, b[0] - a[0] + 6, b[1] - a[1] + 6); c.shadowBlur = 0;
    const cs = (b[0] - a[0]) / 10;
    c.strokeStyle = rgb(f.accent, 0.4); c.globalAlpha = 0.25; c.lineWidth = 1;
    for (let i = 1; i < 10; i++) { c.beginPath(); c.moveTo(a[0] + i * cs, a[1]); c.lineTo(a[0] + i * cs, b[1]); c.stroke(); }
    for (let j = 1; j < 20; j++) { c.beginPath(); c.moveTo(a[0], a[1] + j * cs); c.lineTo(b[0], a[1] + j * cs); c.stroke(); }
    c.globalAlpha = 1;
  }

  draw(view, f) {
    const c = this.ctx;
    const project = f.project;
    this.background(f, (x, y, z) => project(x, y, z, true));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.bg, 0, 0);
    const o = project(0, 20, 0.5), e = project(10, 0, 0.5);
    const cs = (e[0] - o[0]) / 10;
    const size = Math.max(4, Math.round(cs));
    if (f.siren > 0) {
      const ph = Math.sin(f.time * 9);
      c.fillStyle = ph > 0 ? `rgba(255,20,40,${0.12 * f.siren * ph})` : `rgba(30,80,255,${-0.12 * f.siren * ph})`;
      c.fillRect(0, 0, this.w, this.h);
    }
    for (let t = 0; t < BH; t++) for (let x = 0; x < BW; x++) {
      const i = (t * BW + x) * 4, k = view[i], fl = view[i + 1];
      const px = o[0] + x * cs, py = o[1] + (BH - 1 - t) * cs;
      if (k) {
        c.drawImage(this.sprite(k, size, f, fl & 8), px, py, cs + 0.5, cs + 0.5);
        if (fl & 4) { c.fillStyle = `rgba(255,250,235,${view[i + 2] / 255})`; c.fillRect(px, py, cs, cs); }
        else if (fl & 1 && view[i + 2]) { c.fillStyle = `rgba(255,255,255,${view[i + 2] / 255 * 0.3})`; c.fillRect(px, py, cs, cs); }
      } else if (fl & 2) {
        const col = f.palette[view[i + 2]];
        c.fillStyle = rgb(col, 0.25); c.fillRect(px, py, cs, cs);
        c.strokeStyle = rgb(col, 1.2); c.lineWidth = 2; c.strokeRect(px + 2, py + 2, cs - 4, cs - 4);
      }
    }
    if (f.danger > 0.4) { c.fillStyle = `rgba(200,0,20,${(f.danger - 0.4) * 0.25 * (0.5 + 0.5 * Math.sin(f.time * 6))})`; c.fillRect(o[0], o[1], e[0] - o[0], (e[1] - o[1]) * 0.35); }
    if (f.flash > 0) { c.fillStyle = `rgba(255,240,220,${f.flash * 0.5})`; c.fillRect(0, 0, this.w, this.h); }
  }
}

export const ENGINES = { webgpu: GPURenderer, webgl2: GLRenderer, canvas2d: Canvas2DRenderer };
