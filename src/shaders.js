// Voxel-grid ray tracer for the well, written twice: GLSL ES 3.0 (WebGL2) and WGSL (WebGPU).
// Primary rays + shadow rays + one reflection bounce, all traced with a 2D DDA through
// the 10x20 board slab (z in [0,1]). Background is a procedural night city.

export const GLSL_VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0,0.0,1.0); }`;

export const GLSL_FS = `#version 300 es
precision highp float; precision highp int;
uniform vec4 u0; uniform vec4 u1; uniform vec4 u2; uniform vec4 u3;
uniform vec4 pal[10];
uniform sampler2D board;
out vec4 o;
const vec3 LDIR = vec3(-0.42, 0.72, 0.9);

vec4 cellAt(ivec2 c){ if(c.x<0||c.x>9||c.y<0||c.y>19) return vec4(0.0); return floor(texelFetch(board,c,0)*255.0+0.5); }
float h1(float n){ return fract(sin(n)*43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

vec3 sky(vec3 ro, vec3 rd){
  float t=u0.z, heat=u0.w;
  vec3 top = mix(vec3(0.015,0.01,0.05), vec3(0.07,0.0,0.04), heat/5.0);
  vec3 hor = u3.rgb*0.45 + vec3(0.08,0.02,0.09);
  float h = clamp(rd.y*1.3+0.35,0.0,1.0);
  vec3 col = mix(hor, top, h);
  vec2 sp = rd.xy/(abs(rd.z)+0.2)*240.0;
  col += step(0.994, h2(floor(sp))) * (1.0-smoothstep(0.08,0.3,length(fract(sp)-0.5))) * h * 0.9;
  if(rd.z < -0.05){
    for(int layer=0; layer<2; layer++){
      float zp = layer==0 ? -38.0 : -70.0;
      float tt = (zp - ro.z)/rd.z;
      vec3 q = ro + rd*tt;
      float wdt = layer==0 ? 4.0 : 6.5;
      float bx = floor(q.x/wdt) + float(layer)*50.0;
      float bh = -10.0 + h1(bx*1.7)*26.0 + h1(bx*3.1)*h1(bx*0.7)*24.0 - float(layer)*4.0;
      if(q.y < bh){
        vec2 w = vec2(q.x*1.3, q.y*1.7); vec2 wi = floor(w); vec2 wf = fract(w);
        float lit = step(0.58, h2(wi+bx*13.0)) * step(0.22,wf.x)*step(wf.x,0.72)*step(0.25,wf.y)*step(wf.y,0.78);
        float flick = 0.75+0.25*sin(t*0.6+h2(wi)*40.0);
        vec3 wc = mix(vec3(1.0,0.72,0.4), u3.rgb*1.4, h2(wi*2.3));
        float fade = layer==0 ? 1.0 : 0.55;
        vec3 b = vec3(0.012,0.01,0.025)*(1.0+float(layer)) + wc*lit*flick*0.6*fade;
        if(abs(q.y-bh)<0.35 && abs(fract(q.x/wdt)-0.5)<0.05) b += vec3(1.0,0.1,0.1)*(0.5+0.5*sin(t*3.0+bx));
        col = mix(b, hor, float(layer)*0.35);
        break;
      }
    }
  }
  float s = u2.w;
  if(s > 0.0){
    float ph = sin(t*9.0);
    col += s*0.22*(vec3(1.0,0.05,0.1)*max(ph,0.0) + vec3(0.1,0.25,1.0)*max(-ph,0.0))*(1.2-h);
  }
  return col;
}

bool trace(vec3 ro, vec3 rd, float tLim, out float tHit, out vec3 nOut, out vec4 dOut, out ivec2 cOut, inout vec3 ghost){
  tHit=0.0; nOut=vec3(0.0); dOut=vec4(0.0); cOut=ivec2(0);
  vec3 inv = 1.0/rd;
  vec3 t0 = (vec3(0.0)-ro)*inv, t1 = (vec3(10.0,20.0,1.0)-ro)*inv;
  vec3 ts = min(t0,t1), tb = max(t0,t1);
  float tn = max(max(ts.x,ts.y),ts.z), tf = min(min(tb.x,tb.y),tb.z);
  if(tn>tf || tf<0.0) return false;
  tn = max(tn,0.0);
  vec3 nn = tn==ts.x ? vec3(-sign(rd.x),0.0,0.0) : (tn==ts.y ? vec3(0.0,-sign(rd.y),0.0) : vec3(0.0,0.0,-sign(rd.z)));
  vec3 p = ro + rd*(tn+1e-4);
  ivec2 c = clamp(ivec2(floor(p.xy)), ivec2(0), ivec2(9,19));
  vec2 st = sign(rd.xy);
  vec2 tD = abs(inv.xy);
  vec2 tM = tn + (vec2(c) + max(st,0.0) - p.xy)*inv.xy;
  float tc = tn;
  for(int i=0;i<36;i++){
    vec4 d = cellAt(c);
    if(d.x > 0.5){ tHit=tc; nOut=nn; dOut=d; cOut=c; return true; }
    float tNext = min(min(tM.x,tM.y), tf);
    if((int(d.y)&2)!=0){ ghost += pal[int(d.z)].rgb * (tNext-tc) * 0.07; }
    if(tM.x < tM.y){ tc=tM.x; tM.x+=tD.x; c.x+=int(st.x); nn=vec3(-st.x,0.0,0.0); }
    else { tc=tM.y; tM.y+=tD.y; c.y+=int(st.y); nn=vec3(0.0,-st.y,0.0); }
    if(tc>tf || tc>tLim || c.x<0||c.x>9||c.y<0||c.y>19) break;
  }
  return false;
}

bool occluded(vec3 p){
  float t; vec3 n; vec4 d; ivec2 c; vec3 g=vec3(0.0);
  return trace(p, normalize(LDIR), 40.0, t, n, d, c, g);
}

vec3 shadeBlock(vec3 ro, vec3 rd, float t, vec3 n, vec4 d, ivec2 c, bool primary, out float refl){
  vec3 p = ro + rd*t;
  int k = int(d.x), f = int(d.y);
  vec3 base = pal[k].rgb;
  vec2 lf = clamp(p.xy - vec2(c), 0.0, 1.0);
  bool isActive=(f&1)!=0, clearing=(f&4)!=0, cash=(f&8)!=0;
  vec3 N = n;
  float edgeD = min(min(lf.x,1.0-lf.x),min(lf.y,1.0-lf.y));
  if(n.z > 0.5){
    float bw = 0.15;
    vec2 e = vec2(lf.x<bw ? -(bw-lf.x) : (lf.x>1.0-bw ? lf.x-(1.0-bw) : 0.0),
                  lf.y<bw ? -(bw-lf.y) : (lf.y>1.0-bw ? lf.y-(1.0-bw) : 0.0));
    N = normalize(vec3(e/bw*1.1, 1.0));
  }
  if(cash) base = vec3(1.0,0.76,0.22);
  vec3 L = normalize(LDIR);
  float dif = max(dot(N,L),0.0);
  vec3 Hh = normalize(L-rd);
  float spec = pow(max(dot(N,Hh),0.0), cash?90.0:48.0);
  float sh = 1.0;
  if(primary && u2.y >= 1.0 && occluded(p + n*0.003)) sh = 0.35;
  vec3 col = base*(0.3 + 0.9*dif*sh) + spec*sh*(cash?1.2:0.65);
  if(n.z > 0.5){
    float inset = smoothstep(0.24,0.28,edgeD);
    col *= 0.9 + 0.12*inset;
    col += base*0.18*(1.0-smoothstep(0.0,0.06,abs(edgeD-0.26)));
  }
  if(k == 8){
    float stripe = step(0.5, fract((lf.x+lf.y)*2.0));
    vec3 g = mix(vec3(0.18,0.19,0.22), vec3(0.55,0.42,0.08), stripe*step(0.3,lf.y)*step(lf.y,0.7));
    col = g*(0.3+0.7*dif*sh) + spec*sh*0.15;
  }
  if(cash && n.z > 0.5){
    float r = length(lf-0.5);
    float ring = (1.0-smoothstep(0.0,0.03,abs(r-0.24)));
    float bar = step(abs(lf.x-0.5),0.035)*step(abs(lf.y-0.5),0.2);
    col = mix(col, vec3(1.4,1.1,0.5), max(ring,bar)*0.8);
    col += vec3(1.0,0.9,0.5)*pow(max(0.0,sin(u0.z*4.0+float(c.x+c.y))),24.0)*0.6;
  }
  if(isActive){ col += base*0.22; col = mix(col, vec3(1.3), d.z/255.0*0.35); }
  if(clearing){ float a = d.z/255.0; col = mix(col, vec3(2.2,2.0,1.8), smoothstep(0.0,0.5,a)); }
  refl = k==8 ? 0.04 : (cash ? 0.55 : 0.22);
  return col;
}

vec3 wall(vec3 p){
  vec2 g = p.xy; ivec2 c = ivec2(floor(g)); vec2 lf = fract(g);
  float ed = min(min(lf.x,1.0-lf.x),min(lf.y,1.0-lf.y));
  vec3 col = vec3(0.02,0.02,0.045) + u3.rgb*0.035 + (1.0-smoothstep(0.0,0.035,ed))*u3.rgb*0.14;
  for(int dy=-1; dy<=1; dy++) for(int dx=-1; dx<=1; dx++){
    vec4 d = cellAt(c+ivec2(dx,dy));
    if(d.x > 0.5){ vec2 cen = vec2(c+ivec2(dx,dy))+0.5; col += pal[int(d.x)].rgb*0.2*exp(-length(g-cen)*1.7); }
  }
  if(u2.y >= 1.0 && occluded(p + vec3(0.0,0.0,0.002))) col *= 0.45;
  vec4 d0 = cellAt(c);
  if((int(d0.y)&2)!=0){ vec3 gc = pal[int(d0.z)].rgb; col += gc*(0.06 + (1.0-smoothstep(0.03,0.08,ed))*1.3); }
  col += vec3(0.7,0.02,0.05)*u2.x*(0.5+0.5*sin(u0.z*6.0))*smoothstep(0.35,1.0,p.y/20.0)*0.35;
  return col;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u0.xy)/u0.y;
  float cy = 10.0 - u2.z;
  vec3 ro = vec3(5.0 + u1.x, cy + u1.y, 30.0);
  vec3 ta = vec3(5.0 + u1.x*0.15, cy + u1.y*0.15, 0.5);
  vec3 fw = normalize(ta-ro), rt = normalize(cross(fw, vec3(0.0,1.0,0.0))), up = cross(rt,fw);
  vec3 rd = normalize(fw + (uv.x*rt + uv.y*up)*u1.w);
  rd = vec3(abs(rd.x)<1e-5?1e-5:rd.x, abs(rd.y)<1e-5?1e-5:rd.y, rd.z);
  float tH; vec3 n; vec4 d; ivec2 c; vec3 ghost = vec3(0.0);
  vec3 col;
  if(trace(ro, rd, 1e4, tH, n, d, c, ghost)){
    float rf; col = shadeBlock(ro, rd, tH, n, d, c, true, rf);
    if(u2.y >= 2.0){
      vec3 p = ro + rd*tH; vec3 r = reflect(rd, n);
      float t2; vec3 n2; vec4 d2; ivec2 c2; vec3 g2 = vec3(0.0); vec3 rc; float dm;
      if(trace(p+n*0.003, r, 40.0, t2, n2, d2, c2, g2)) rc = shadeBlock(p+n*0.003, r, t2, n2, d2, c2, false, dm);
      else rc = sky(p, r);
      float fr = rf + (1.0-rf)*pow(1.0-max(dot(-rd,n),0.0),5.0)*0.5;
      col = mix(col, rc + g2, fr);
    }
  } else {
    float tz = -ro.z/rd.z; vec3 p = ro + rd*tz;
    vec2 q = max(vec2(-p.x,-p.y), vec2(p.x-10.0, p.y-20.0));
    float dist = length(max(q,0.0));
    if(dist <= 0.0) col = wall(p);
    else {
      col = sky(ro, rd);
      vec3 acc = mix(u3.rgb, vec3(1.0,0.15,0.2), clamp(u0.w/5.0,0.0,1.0)*0.6);
      col += acc*exp(-dist*2.2)*0.45;
      col = mix(col, acc*1.6, (1.0-smoothstep(0.16,0.24,dist))*smoothstep(0.0,0.06,dist));
    }
  }
  col += ghost;
  col += u1.z*vec3(1.0,0.9,0.8)*0.5;
  col *= 1.0 - 0.3*dot(uv,uv);
  col *= 1.45; float mx = max(max(col.r,col.g),col.b); col *= (1.0+mx*0.2)/(1.0+mx*0.6); col = pow(col, vec3(0.92));
  o = vec4(col, 1.0);
}`;

export const WGSL = /* wgsl */`
struct U { u0: vec4f, u1: vec4f, u2: vec4f, u3: vec4f, pal: array<vec4f,10> };
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var board: texture_2d<f32>;

struct VO { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.pos = vec4f(p*2.0-1.0, 0.0, 1.0); return o;
}

const LDIR = vec3f(-0.42, 0.72, 0.9);
fn cellAt(c: vec2i) -> vec4f {
  if (c.x<0 || c.x>9 || c.y<0 || c.y>19) { return vec4f(0.0); }
  return floor(textureLoad(board, c, 0)*255.0 + 0.5);
}
fn h1(n: f32) -> f32 { return fract(sin(n)*43758.5453); }
fn h2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1,311.7)))*43758.5453); }

fn sky(ro: vec3f, rd: vec3f) -> vec3f {
  let t = U_.u0.z; let heat = U_.u0.w;
  let top = mix(vec3f(0.015,0.01,0.05), vec3f(0.07,0.0,0.04), heat/5.0);
  let hor = U_.u3.rgb*0.45 + vec3f(0.08,0.02,0.09);
  let h = clamp(rd.y*1.3+0.35, 0.0, 1.0);
  var col = mix(hor, top, h);
  let sp = rd.xy/(abs(rd.z)+0.2)*240.0;
  col += vec3f(step(0.994, h2(floor(sp))) * (1.0-smoothstep(0.08,0.3,length(fract(sp)-0.5))) * h * 0.9);
  if (rd.z < -0.05) {
    for (var layer = 0; layer < 2; layer++) {
      let zp = select(-70.0, -38.0, layer==0);
      let tt = (zp - ro.z)/rd.z;
      let q = ro + rd*tt;
      let wdt = select(6.5, 4.0, layer==0);
      let bx = floor(q.x/wdt) + f32(layer)*50.0;
      let bh = -10.0 + h1(bx*1.7)*26.0 + h1(bx*3.1)*h1(bx*0.7)*24.0 - f32(layer)*4.0;
      if (q.y < bh) {
        let w = vec2f(q.x*1.3, q.y*1.7); let wi = floor(w); let wf = fract(w);
        let lit = step(0.58, h2(wi+bx*13.0)) * step(0.22,wf.x)*step(wf.x,0.72)*step(0.25,wf.y)*step(wf.y,0.78);
        let flick = 0.75+0.25*sin(t*0.6+h2(wi)*40.0);
        let wc = mix(vec3f(1.0,0.72,0.4), U_.u3.rgb*1.4, h2(wi*2.3));
        let fade = select(0.55, 1.0, layer==0);
        var b = vec3f(0.012,0.01,0.025)*(1.0+f32(layer)) + wc*lit*flick*0.6*fade;
        if (abs(q.y-bh)<0.35 && abs(fract(q.x/wdt)-0.5)<0.05) { b += vec3f(1.0,0.1,0.1)*(0.5+0.5*sin(t*3.0+bx)); }
        col = mix(b, hor, f32(layer)*0.35);
        break;
      }
    }
  }
  let s = U_.u2.w;
  if (s > 0.0) {
    let ph = sin(t*9.0);
    col += s*0.22*(vec3f(1.0,0.05,0.1)*max(ph,0.0) + vec3f(0.1,0.25,1.0)*max(-ph,0.0))*(1.2-h);
  }
  return col;
}

struct Hit { ok: bool, t: f32, n: vec3f, d: vec4f, c: vec2i, ghost: vec3f };

fn trace(ro: vec3f, rd: vec3f, tLim: f32) -> Hit {
  var hit: Hit; hit.ok = false; hit.ghost = vec3f(0.0);
  let inv = 1.0/rd;
  let t0 = (vec3f(0.0)-ro)*inv; let t1 = (vec3f(10.0,20.0,1.0)-ro)*inv;
  let ts = min(t0,t1); let tb = max(t0,t1);
  var tn = max(max(ts.x,ts.y),ts.z); let tf = min(min(tb.x,tb.y),tb.z);
  if (tn>tf || tf<0.0) { return hit; }
  tn = max(tn, 0.0);
  var nn = vec3f(0.0,0.0,-sign(rd.z));
  if (tn==ts.x) { nn = vec3f(-sign(rd.x),0.0,0.0); } else if (tn==ts.y) { nn = vec3f(0.0,-sign(rd.y),0.0); }
  let p = ro + rd*(tn+1e-4);
  var c = clamp(vec2i(floor(p.xy)), vec2i(0), vec2i(9,19));
  let st = sign(rd.xy);
  let tD = abs(inv.xy);
  var tM = tn + (vec2f(c) + max(st, vec2f(0.0)) - p.xy)*inv.xy;
  var tc = tn;
  for (var i = 0; i < 36; i++) {
    let d = cellAt(c);
    if (d.x > 0.5) { hit.ok = true; hit.t = tc; hit.n = nn; hit.d = d; hit.c = c; return hit; }
    let tNext = min(min(tM.x,tM.y), tf);
    if ((i32(d.y) & 2) != 0) { hit.ghost += U_.pal[i32(d.z)].rgb * (tNext-tc) * 0.07; }
    if (tM.x < tM.y) { tc = tM.x; tM.x += tD.x; c.x += i32(st.x); nn = vec3f(-st.x,0.0,0.0); }
    else { tc = tM.y; tM.y += tD.y; c.y += i32(st.y); nn = vec3f(0.0,-st.y,0.0); }
    if (tc>tf || tc>tLim || c.x<0 || c.x>9 || c.y<0 || c.y>19) { break; }
  }
  return hit;
}

fn occluded(p: vec3f) -> bool { return trace(p, normalize(LDIR), 40.0).ok; }

struct Shade { col: vec3f, refl: f32 };
fn shadeBlock(ro: vec3f, rd: vec3f, h: Hit, primary: bool) -> Shade {
  let p = ro + rd*h.t;
  let k = i32(h.d.x); let f = i32(h.d.y);
  var base = U_.pal[k].rgb;
  let lf = clamp(p.xy - vec2f(h.c), vec2f(0.0), vec2f(1.0));
  let isActive = (f&1)!=0; let clearing = (f&4)!=0; let cash = (f&8)!=0;
  var N = h.n;
  let edgeD = min(min(lf.x,1.0-lf.x),min(lf.y,1.0-lf.y));
  if (h.n.z > 0.5) {
    let bw = 0.15;
    var e = vec2f(0.0);
    if (lf.x < bw) { e.x = -(bw-lf.x); } else if (lf.x > 1.0-bw) { e.x = lf.x-(1.0-bw); }
    if (lf.y < bw) { e.y = -(bw-lf.y); } else if (lf.y > 1.0-bw) { e.y = lf.y-(1.0-bw); }
    N = normalize(vec3f(e/bw*1.1, 1.0));
  }
  if (cash) { base = vec3f(1.0,0.76,0.22); }
  let L = normalize(LDIR);
  let dif = max(dot(N,L), 0.0);
  let Hh = normalize(L-rd);
  let spec = pow(max(dot(N,Hh),0.0), select(48.0, 90.0, cash));
  var sh = 1.0;
  if (primary && U_.u2.y >= 1.0) { if (occluded(p + h.n*0.003)) { sh = 0.35; } }
  var col = base*(0.3 + 0.9*dif*sh) + vec3f(spec*sh*select(0.65, 1.2, cash));
  if (h.n.z > 0.5) {
    let inset = smoothstep(0.24,0.28,edgeD);
    col *= 0.9 + 0.12*inset;
    col += base*0.18*(1.0-smoothstep(0.0,0.06,abs(edgeD-0.26)));
  }
  if (k == 8) {
    let stripe = step(0.5, fract((lf.x+lf.y)*2.0));
    let g = mix(vec3f(0.18,0.19,0.22), vec3f(0.55,0.42,0.08), stripe*step(0.3,lf.y)*step(lf.y,0.7));
    col = g*(0.3+0.7*dif*sh) + vec3f(spec*sh*0.15);
  }
  if (cash && h.n.z > 0.5) {
    let r = length(lf-0.5);
    let ring = (1.0-smoothstep(0.0,0.03,abs(r-0.24)));
    let bar = step(abs(lf.x-0.5),0.035)*step(abs(lf.y-0.5),0.2);
    col = mix(col, vec3f(1.4,1.1,0.5), max(ring,bar)*0.8);
    col += vec3f(1.0,0.9,0.5)*pow(max(0.0,sin(U_.u0.z*4.0+f32(h.c.x+h.c.y))),24.0)*0.6;
  }
  if (isActive) { col += base*0.22; col = mix(col, vec3f(1.3), h.d.z/255.0*0.35); }
  if (clearing) { let a = h.d.z/255.0; col = mix(col, vec3f(2.2,2.0,1.8), smoothstep(0.0,0.5,a)); }
  var s: Shade; s.col = col;
  s.refl = select(select(0.22, 0.55, cash), 0.04, k==8);
  return s;
}

fn wall(p: vec3f) -> vec3f {
  let g = p.xy; let c = vec2i(floor(g)); let lf = fract(g);
  let ed = min(min(lf.x,1.0-lf.x),min(lf.y,1.0-lf.y));
  var col = vec3f(0.02,0.02,0.045) + U_.u3.rgb*0.035 + (1.0-smoothstep(0.0,0.035,ed))*U_.u3.rgb*0.14;
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
    let d = cellAt(c + vec2i(dx,dy));
    if (d.x > 0.5) { let cen = vec2f(c + vec2i(dx,dy)) + 0.5; col += U_.pal[i32(d.x)].rgb*0.2*exp(-length(g-cen)*1.7); }
  } }
  if (U_.u2.y >= 1.0) { if (occluded(p + vec3f(0.0,0.0,0.002))) { col *= 0.45; } }
  let d0 = cellAt(c);
  if ((i32(d0.y)&2)!=0) { let gc = U_.pal[i32(d0.z)].rgb; col += gc*(0.06 + (1.0-smoothstep(0.03,0.08,ed))*1.3); }
  col += vec3f(0.7,0.02,0.05)*U_.u2.x*(0.5+0.5*sin(U_.u0.z*6.0))*smoothstep(0.35,1.0,p.y/20.0)*0.35;
  return col;
}

@fragment fn fs(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  // WebGPU framebuffer y is top-down; flip to match GL.
  let fc = vec2f(fragPos.x, U_.u0.y - fragPos.y);
  let uv = (fc - 0.5*U_.u0.xy)/U_.u0.y;
  let cy = 10.0 - U_.u2.z;
  let ro = vec3f(5.0 + U_.u1.x, cy + U_.u1.y, 30.0);
  let ta = vec3f(5.0 + U_.u1.x*0.15, cy + U_.u1.y*0.15, 0.5);
  let fw = normalize(ta-ro); let rt = normalize(cross(fw, vec3f(0.0,1.0,0.0))); let up = cross(rt,fw);
  var rd = normalize(fw + (uv.x*rt + uv.y*up)*U_.u1.w);
  if (abs(rd.x) < 1e-5) { rd.x = 1e-5; }
  if (abs(rd.y) < 1e-5) { rd.y = 1e-5; }
  let h = trace(ro, rd, 1e4);
  var col: vec3f;
  if (h.ok) {
    let s = shadeBlock(ro, rd, h, true);
    col = s.col;
    if (U_.u2.y >= 2.0) {
      let p = ro + rd*h.t; let r = reflect(rd, h.n);
      let h2_ = trace(p + h.n*0.003, r, 40.0);
      var rc: vec3f;
      if (h2_.ok) { rc = shadeBlock(p + h.n*0.003, r, h2_, false).col; } else { rc = sky(p, r); }
      let fr = s.refl + (1.0-s.refl)*pow(1.0-max(dot(-rd,h.n),0.0),5.0)*0.5;
      col = mix(col, rc + h2_.ghost, fr);
    }
  } else {
    let tz = -ro.z/rd.z; let p = ro + rd*tz;
    let q = max(vec2f(-p.x,-p.y), vec2f(p.x-10.0, p.y-20.0));
    let dist = length(max(q, vec2f(0.0)));
    if (dist <= 0.0) { col = wall(p); }
    else {
      col = sky(ro, rd);
      let acc = mix(U_.u3.rgb, vec3f(1.0,0.15,0.2), clamp(U_.u0.w/5.0,0.0,1.0)*0.6);
      col += acc*exp(-dist*2.2)*0.45;
      col = mix(col, acc*1.6, (1.0-smoothstep(0.16,0.24,dist))*smoothstep(0.0,0.06,dist));
    }
  }
  col += h.ghost;
  col += U_.u1.z*vec3f(1.0,0.9,0.8)*0.5;
  col *= 1.0 - 0.3*dot(uv,uv);
  col *= 1.45; let mx = max(max(col.r,col.g),col.b); col *= (1.0+mx*0.2)/(1.0+mx*0.6); col = pow(max(col, vec3f(0.0)), vec3f(0.92));
  return vec4f(col, 1.0);
}`;
