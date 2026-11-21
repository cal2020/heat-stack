// Open-world ray marcher (WebGL2 / GLSL ES 3.0).
// One continuous world with three districts:
//   Bryce Valley  — fractal fbm mountains with snow, a lake, floating chrome spheres, atmospheric haze
//   Neon City     — a grid of towers with lit windows and rooftop beacons
//   Maya Studio   — an infinite grey grid floor with clay primitives and a transform gizmo
// The terrain noise uses an integer hash so world.js can sample the exact same height for car physics.

export const WORLD_VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0,0.0,1.0); }`;

// Shared terrain source, also mirrored in JS (world.js → terrainH).
export const WORLD_FS = `#version 300 es
precision highp float; precision highp int;
uniform vec4 uRes;      // w, h, time, quality
uniform vec4 uEye;      // xyz, zoom
uniform vec4 uTarget;   // xyz, stars
uniform vec4 uCar;      // xyz, boost/brake light
uniform vec4 uCarM0; uniform vec4 uCarM1; uniform vec4 uCarM2; // car rotation (world->local rows)
uniform vec4 uCarCol;   // rgb, siren
uniform vec4 uMarks[8]; // x, z, kind(1 job,2 cash,3 studio), active
uniform vec4 uMisc;     // flash, spotlight on, -, -
out vec4 o;

const vec3 SUN = vec3(0.4835, 0.2418, -0.8414);
const float WATER = 0.0;

uint hsh(ivec2 c){ uint h = uint(c.x)*374761393u + uint(c.y)*668265263u; h = (h ^ (h >> 13u))*1274126177u; h ^= h >> 16u; return h; }
float hf(ivec2 c){ return float(hsh(c) & 0xffffffu)/16777216.0; }
float vnoise(vec2 p){ vec2 i=floor(p), f=p-i; vec2 u=f*f*(3.0-2.0*f); ivec2 c=ivec2(i);
  return mix(mix(hf(c), hf(c+ivec2(1,0)), u.x), mix(hf(c+ivec2(0,1)), hf(c+ivec2(1,1)), u.x), u.y); }
float fbm2(vec2 p, int oct){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*vnoise(p); p=p*2.02+vec2(17.3,9.1); a*=0.5; } return s; }
float rectMask(vec2 p, vec2 a, vec2 b, float fe){ float d = max(max(a.x-p.x, p.x-b.x), max(a.y-p.y, p.y-b.y)); return 1.0-smoothstep(0.0, fe, d); }
float roadZ(float x){ return sin(x*0.008)*40.0; }

float terrainH(vec2 p, int oct){
  float m = fbm2(p*0.0045, oct);
  float h = pow(max(m-0.18,0.0),1.6)*420.0;
  float road = 1.0 - smoothstep(14.0, 60.0, abs(p.y - roadZ(p.x)));
  float road2 = (1.0 - smoothstep(10.0, 40.0, abs(p.x))) * step(0.0, p.y) * step(p.y, 170.0);
  float city = rectMask(p, vec2(60.0,-200.0), vec2(460.0,200.0), 40.0);
  float studio = rectMask(p, vec2(-90.0,140.0), vec2(90.0,330.0), 40.0);
  float road3 = (1.0 - smoothstep(10.0, 40.0, abs(p.x + 240.0))) * step(-45.0, p.y) * step(p.y, 150.0);
  float fl = max(max(max(road, road2), road3), max(city, studio));
  h = mix(h, 0.6, fl);
  float ld = length(p - vec2(-240.0, 200.0));
  h = mix(h, -10.0, 1.0 - smoothstep(50.0, 130.0, ld));
  h += smoothstep(470.0, 600.0, max(abs(p.x), abs(p.y)))*220.0;
  return h;
}

float sdBox(vec3 p, vec3 b){ vec3 q = abs(p)-b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }
float sdRBox(vec3 p, vec3 b, float r){ return sdBox(p, b-r) - r; }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz)-t.x, p.y); return length(q)-t.y; }
float sdCone(vec3 p, float h, float r){ float rr = r*(1.0 - clamp(p.y/h, 0.0, 1.0)); vec2 d = vec2(length(p.xz)-rr, abs(p.y-h*0.5)-h*0.5); return (min(max(d.x,d.y),0.0) + length(max(d,0.0)))*0.7; }
float sdCylY(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x,d.y),0.0) + length(max(d,0.0)); }
float sdCylX(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.yz), p.x)) - vec2(r, h); return min(max(d.x,d.y),0.0) + length(max(d,0.0)); }

float buildings(vec3 p, out float bh, out vec2 cellOut){
  bh = 0.0; cellOut = vec2(0.0);
  vec2 dd = max(vec2(80.0-p.x, p.x-440.0), vec2(-180.0-p.z, p.z-180.0));
  float outside = max(max(dd.x, dd.y), 0.0);
  if(outside > 0.0) return outside + 2.0;
  vec2 cell = floor(p.xz/32.0); vec2 q = p.xz - (cell+0.5)*32.0;
  cellOut = cell;
  float border = 16.0 - max(abs(q.x), abs(q.y));
  float hs = hf(ivec2(cell) + ivec2(100,100));
  if(hs < 0.14) return border + 5.0;
  float height = 14.0 + hs*hs*95.0; float w = 8.0 + hf(ivec2(cell)+ivec2(7,3))*3.0;
  bh = height;
  float d = sdBox(vec3(q.x, p.y - height*0.5, q.y), vec3(w, height*0.5, w));
  return min(d, border + 5.0);
}

float studio(vec3 p, out float sid){
  sid = 0.0;
  vec3 c = vec3(0.0, 0.0, 240.0);
  vec3 q = p - c;
  if(length(q.xz) > 110.0) return length(q.xz) - 100.0;
  float t = uRes.z;
  float d = sdTorus(q - vec3(-30.0, 12.0, 0.0), vec2(10.0, 3.5)); sid = 1.0;
  float d2 = length(q - vec3(0.0, 11.0, 25.0)) - 11.0; if(d2 < d){ d = d2; sid = 2.0; }
  float d3 = sdRBox(q - vec3(32.0, 9.0, -5.0), vec3(9.0), 1.0); if(d3 < d){ d = d3; sid = 3.0; }
  float d4 = sdCone(q - vec3(-5.0, 0.0, -35.0), 22.0, 10.0); if(d4 < d){ d = d4; sid = 4.0; }
  // transform gizmo over the sphere (red X, green Y, blue Z arrows)
  vec3 g = q - vec3(0.0, 26.0, 25.0);
  float gx = sdCylX(g - vec3(5.0,0.0,0.0), 0.35, 5.0); if(gx < d){ d = gx; sid = 5.0; }
  float gy = sdCylY(g - vec3(0.0,5.0,0.0), 0.35, 5.0); if(gy < d){ d = gy; sid = 6.0; }
  float gz = sdCylX(vec3(g.z-5.0, g.y, g.x), 0.35, 5.0); if(gz < d){ d = gz; sid = 7.0; }
  return d;
}

float spheres(vec3 p){
  float d = length(p - vec3(-240.0, 22.0, 200.0)) - 16.0;
  d = min(d, length(p - vec3(-185.0, 12.0, 250.0)) - 9.0);
  d = min(d, length(p - vec3(-300.0, 34.0, 160.0)) - 11.0);
  d = min(d, length(p - vec3(-120.0, 70.0, -120.0)) - 14.0);
  return d;
}

float car(vec3 p){
  vec3 q = p - uCar.xyz;
  if(dot(q,q) > 64.0) return length(q) - 5.0;
  q = vec3(dot(uCarM0.xyz, q), dot(uCarM1.xyz, q), dot(uCarM2.xyz, q));
  float body = sdRBox(q - vec3(0.0, 0.85, 0.0), vec3(1.05, 0.38, 2.2), 0.28);
  float cab = sdRBox(q - vec3(0.0, 1.42, -0.25), vec3(0.85, 0.34, 1.1), 0.3);
  float d = min(body, cab);
  vec3 w = vec3(abs(q.x) - 1.05, q.y - 0.48, abs(q.z) - 1.35);
  float wheel = sdCylX(w, 0.48, 0.24);
  return min(d, wheel);
}

// mat: 1 terrain, 3 building, 4 car, 5 studio, 6 chrome
float map(vec3 p, out float mat, out float aux, int oct){
  float th = p.y > 320.0 ? -1e3 : terrainH(p.xz, oct);
  float d = p.y > 320.0 ? p.y - 300.0 : (p.y - th)*0.32;
  mat = 1.0; aux = th;
  float bh; vec2 cl;
  float db = buildings(p, bh, cl); if(db < d){ d = db; mat = 3.0; aux = bh; }
  float sid; float ds = studio(p, sid); if(ds < d){ d = ds; mat = 5.0; aux = sid; }
  float dc = spheres(p); if(dc < d){ d = dc; mat = 6.0; }
  float dcar = car(p); if(dcar < d){ d = dcar; mat = 4.0; }
  return d;
}
float mapD(vec3 p, int oct){ float m, a; return map(p, m, a, oct); }

vec3 normalAt(vec3 p, float t){
  float e = 0.02 + t*0.0015;
  vec2 k = vec2(1.0,-1.0);
  return normalize(k.xyy*mapD(p+k.xyy*e,6) + k.yyx*mapD(p+k.yyx*e,6) + k.yxy*mapD(p+k.yxy*e,6) + k.xxx*mapD(p+k.xxx*e,6));
}

float march(vec3 ro, vec3 rd, float tmax, int steps, out float mat, out float aux){
  float t = 0.05; mat = 0.0; aux = 0.0;
  for(int i=0;i<160;i++){
    if(i >= steps) break;
    vec3 p = ro + rd*t;
    float m, a; float d = map(p, m, a, t < 200.0 ? 4 : 3);
    if(d < 0.0012*t + 0.01){ mat = m; aux = a; return t; }
    t += max(d, 0.01 + t*0.002);
    if(t > tmax) break;
  }
  return -1.0;
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.3;
  for(int i=0;i<28;i++){
    float d = mapD(ro + rd*t, 3);
    res = min(res, 10.0*d/t);
    t += clamp(d, 0.4, 25.0);
    if(res < 0.02 || t > 400.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 sky(vec3 rd){
  float e = rd.y;
  vec3 zen = vec3(0.06,0.16,0.45), hor = vec3(1.0,0.66,0.46);
  vec3 col = mix(hor, zen, pow(clamp(e*1.5+0.04,0.0,1.0),0.55));
  float sd = max(dot(rd,SUN),0.0);
  col += vec3(1.0,0.62,0.32)*pow(sd,6.0)*0.55 + vec3(1.0,0.95,0.8)*smoothstep(0.9988,0.9996,sd)*4.0;
  if(e > 0.0){
    vec2 cp = rd.xz/(e+0.1)*2.2 + vec2(uRes.z*0.015, 0.0);
    float cl = fbm2(cp, 4);
    cl = smoothstep(0.48,0.78,cl)*smoothstep(0.0,0.2,e);
    col = mix(col, vec3(1.0,0.86,0.78)*(0.75+0.45*sd), cl*0.8);
  }
  return col;
}

vec3 fog(vec3 col, float t, vec3 rd){
  float f = 1.0 - exp(-t*0.0019);
  vec3 fc = mix(vec3(0.86,0.62,0.52), vec3(1.0,0.75,0.5), pow(max(dot(rd,SUN),0.0),4.0));
  return mix(col, fc, f*0.85);
}

vec3 shade(vec3 ro, vec3 rd, float t, float mat, float aux, bool primary){
  vec3 p = ro + rd*t;
  vec3 n = normalAt(p, t);
  float q = uRes.w;
  float sh = (primary && q >= 1.0) ? softShadow(p + n*0.2, SUN) : 1.0;
  float dif = max(dot(n, SUN), 0.0);
  float amb = 0.35 + 0.25*n.y;
  vec3 skyAmb = vec3(0.45,0.55,0.8);
  vec3 col;
  if(mat < 1.5){
    float slope = 1.0 - n.y;
    float hgt = p.y;
    vec3 grass = mix(vec3(0.24,0.34,0.13), vec3(0.42,0.4,0.18), vnoise(p.xz*0.05));
    vec3 rock = mix(vec3(0.42,0.33,0.27), vec3(0.6,0.5,0.42), vnoise(p.xz*0.2));
    vec3 c = mix(grass, rock, smoothstep(0.25, 0.5, slope));
    c = mix(c, vec3(0.95,0.97,1.0), smoothstep(150.0, 190.0, hgt + vnoise(p.xz*0.08)*30.0) * (1.0 - smoothstep(0.55,0.8,slope)));
    c = mix(c, vec3(0.78,0.7,0.52), 1.0 - smoothstep(-0.5, 0.4, hgt));     // beach near the water
    // roads
    float road = 1.0 - smoothstep(9.0, 11.0, abs(p.z - roadZ(p.x)));
    road = max(road, (1.0 - smoothstep(7.0, 9.0, abs(p.x))) * step(0.0, p.z) * step(p.z, 160.0));
    road = max(road, (1.0 - smoothstep(7.0, 9.0, abs(p.x + 240.0))) * step(-40.0, p.z) * step(p.z, 110.0));
    if(p.x < 70.0) { c = mix(c, vec3(0.3,0.3,0.33), road); c += vec3(0.9,0.8,0.3)*road*step(0.92, fract(p.x*0.06))*(1.0-smoothstep(0.2,0.5,abs(p.z-roadZ(p.x)))); }
    // city streets
    vec2 cr = max(vec2(80.0-p.x, p.x-440.0), vec2(-180.0-p.z, p.z-180.0));
    if(max(cr.x,cr.y) < 10.0){
      vec2 sq = abs(fract(p.xz/32.0) - 0.5)*32.0;
      float lane = step(0.4, abs(min(sq.x,sq.y) - 13.0));
      c = vec3(0.07,0.07,0.09);
      c += vec3(0.6,0.55,0.3)*(1.0-smoothstep(0.1,0.3,abs(min(sq.x,sq.y)-16.0)))*step(0.5, fract((p.x+p.z)*0.1));
    }
    // studio grid floor
    vec2 sd = p.xz - vec2(0.0, 240.0);
    if(length(sd) < 115.0){
      vec2 g = abs(fract(sd/5.0) - 0.5)*5.0;
      float line = 1.0 - smoothstep(0.05, 0.15, min(g.x, g.y));
      vec2 g2 = abs(fract(sd/25.0) - 0.5)*25.0;
      float major = 1.0 - smoothstep(0.1, 0.25, min(g2.x, g2.y));
      float axis = (1.0 - smoothstep(0.1,0.35,abs(sd.x))) + (1.0 - smoothstep(0.1,0.35,abs(sd.y)));
      vec3 fl = vec3(0.36,0.37,0.38) + line*0.08 + major*0.15;
      fl = mix(fl, vec3(0.1,0.1,0.1), axis*0.6);
      c = mix(c, fl, 1.0 - smoothstep(100.0, 115.0, length(sd)));
    }
    col = c*(dif*sh*vec3(1.25,1.05,0.85) + amb*skyAmb*0.6);
  } else if(mat < 3.5){
    vec2 w = vec2(p.x + p.z, p.y);
    vec2 wi = floor(w*vec2(0.5, 0.33)); vec2 wf = fract(w*vec2(0.5, 0.33));
    float win = step(0.2,wf.x)*step(wf.x,0.8)*step(0.25,wf.y)*step(wf.y,0.75) * step(abs(n.y), 0.5);
    float lit = step(0.45, hf(ivec2(wi) + ivec2(int(aux), 3)));
    vec3 glass = vec3(0.08,0.09,0.13);
    col = glass*(dif*sh*0.8 + amb*0.5);
    vec3 wc = mix(vec3(1.0,0.75,0.45), vec3(0.3,0.9,1.0), hf(ivec2(wi)+ivec2(9,9)));
    col += wc*win*lit*0.9;
    // roof beacon and neon trim
    if(n.y > 0.5) col = vec3(0.1,0.1,0.12)*(dif+0.3);
    col += vec3(1.0,0.2,0.5)*(1.0 - smoothstep(0.0, 0.6, abs(p.y - aux + 1.0)))*0.8;
    vec3 r = reflect(rd, n); col += sky(r)*0.12*step(abs(n.y), 0.5);
  } else if(mat < 4.5){
    vec3 r = reflect(rd, n);
    vec3 env = sky(r);
    float fr = 0.08 + 0.92*pow(1.0 - max(dot(-rd,n),0.0), 5.0);
    vec3 paint = uCarCol.rgb;
    vec3 lq = vec3(dot(uCarM0.xyz, p-uCar.xyz), dot(uCarM1.xyz, p-uCar.xyz), dot(uCarM2.xyz, p-uCar.xyz));
    if(lq.y < 0.98 && abs(lq.x) > 0.8 && abs(abs(lq.z)-1.35) < 0.55) paint = vec3(0.04);    // tyres
    if(lq.y > 1.15 && lq.y < 1.7 && abs(lq.x) < 0.9) paint = vec3(0.05,0.07,0.1);             // windows
    col = paint*(dif*sh*1.1 + amb*0.4) + env*fr*0.8 + pow(max(dot(reflect(-SUN,n),-rd),0.0),60.0)*sh;
    if(lq.z > 2.1 && abs(lq.x) > 0.5 && lq.y < 1.1) col += vec3(1.0,0.95,0.8)*1.5;              // headlights
    if(lq.z < -2.1 && abs(lq.x) > 0.5 && lq.y < 1.1) col += vec3(1.0,0.1,0.1)*(0.6 + uCar.w*1.5); // brake lights
    if(uCarCol.w > 0.0 && lq.y > 1.7) col += mix(vec3(1.0,0.05,0.1), vec3(0.1,0.3,1.0), step(0.0, sin(uRes.z*12.0)))*uCarCol.w*1.5;
  } else if(mat < 5.5){
    vec3 clay = vec3(0.62,0.6,0.58);
    if(aux > 4.5 && aux < 5.5) clay = vec3(1.0,0.12,0.1)*1.4;
    if(aux > 5.5 && aux < 6.5) clay = vec3(0.2,1.0,0.2)*1.2;
    if(aux > 6.5) clay = vec3(0.15,0.3,1.0)*1.4;
    float rim = pow(1.0 - max(dot(-rd,n),0.0), 3.0);
    col = clay*(dif*sh*1.1 + amb*0.55) + rim*0.15;
  } else {
    vec3 r = reflect(rd, n);
    float m2, a2; float t2 = (q >= 2.0) ? march(p + n*0.3, r, 500.0, 60, m2, a2) : -1.0;
    vec3 rc = sky(r);
    if(t2 > 0.0){ rc = (r.y < 0.0) ? vec3(0.3,0.33,0.25) : sky(r)*0.7; }
    col = rc*vec3(0.95,0.93,0.9) + vec3(1.0,0.9,0.7)*pow(max(dot(r,SUN),0.0),120.0)*3.0*sh;
  }
  return fog(col, t, rd);
}

vec3 markerGlow(vec3 ro, vec3 rd, float tHit){
  vec3 acc = vec3(0.0);
  for(int i=0;i<8;i++){
    vec4 m = uMarks[i];
    if(m.w < 0.5) continue;
    float gy = terrainH(m.xy, 3);
    vec3 base = vec3(m.x, max(gy, WATER), m.y);
    // closest approach of the ray to the vertical axis through the marker
    vec2 d2 = rd.xz; float l2 = dot(d2,d2);
    float tc = l2 > 1e-6 ? dot(base.xz - ro.xz, d2)/l2 : 0.0;
    if(tc < 0.0 || (tHit > 0.0 && tc > tHit + 2.0)) continue;
    vec3 cp = ro + rd*tc;
    float dist = length(cp.xz - base.xz);
    float hgt = cp.y - base.y;
    float kind = m.z;
    vec3 c = kind < 1.5 ? vec3(1.0,0.82,0.2) : (kind < 2.5 ? vec3(0.3,1.0,0.45) : vec3(0.35,0.7,1.0));
    float tall = kind < 2.5 && kind > 1.5 ? 4.0 : 40.0;
    float rad = kind > 1.5 && kind < 2.5 ? 1.2 : 3.2;
    float col = exp(-dist*dist/(rad*rad)) * smoothstep(-1.0, 0.0, hgt) * (1.0 - smoothstep(tall*0.6, tall, hgt));
    float ring = exp(-pow(dist - rad*1.5, 2.0)*0.8) * exp(-hgt*hgt*0.5);
    float pulse = 0.75 + 0.25*sin(uRes.z*4.0 + float(i));
    float nearFade = smoothstep(4.0, 16.0, tc);
    acc += c*(col*0.9 + ring*0.6)*pulse*nearFade;
  }
  return acc;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes.xy)/uRes.y;
  vec3 ro = uEye.xyz, ta = uTarget.xyz;
  vec3 fw = normalize(ta-ro), rt = normalize(cross(fw, vec3(0.0,1.0,0.0))), up = cross(rt,fw);
  vec3 rd = normalize(fw + (uv.x*rt + uv.y*up)*uEye.w);
  int steps = uRes.w >= 2.0 ? 150 : (uRes.w >= 1.0 ? 120 : 90);
  float mat, aux;
  float t = march(ro, rd, 1400.0, steps, mat, aux);
  float tw = rd.y < 0.0 ? (WATER - ro.y)/rd.y : -1.0;
  vec3 col;
  if(tw > 0.0 && (t < 0.0 || tw < t)){
    // water: rippled reflective surface (Bryce lake)
    vec3 p = ro + rd*tw;
    float tt = uRes.z;
    vec3 n = normalize(vec3(sin(p.x*0.35+tt)*0.03 + sin(p.z*0.21+p.x*0.1+tt*0.7)*0.03, 1.0, cos(p.z*0.3-tt*1.1)*0.03));
    vec3 r = reflect(rd, n);
    vec3 rc = sky(r);
    if(uRes.w >= 2.0){ float m2, a2; float t2 = march(p + vec3(0.0,0.05,0.0), r, 700.0, 70, m2, a2); if(t2 > 0.0) rc = shade(p, r, t2, m2, a2, false); }
    float fr = 0.12 + 0.88*pow(1.0 - max(dot(-rd,n),0.0), 5.0);
    float depth = clamp((p.y - terrainH(p.xz, 3))*0.08, 0.0, 1.0);
    vec3 wc = mix(vec3(0.15,0.4,0.42), vec3(0.02,0.12,0.18), depth);
    col = fog(mix(wc, rc, max(fr, 0.35)), tw, rd);
    t = tw;
  } else if(t > 0.0){
    col = shade(ro, rd, t, mat, aux, true);
  } else {
    col = sky(rd);
    col = fog(col, 1400.0, rd)*0.25 + col*0.75;
  }
  col += markerGlow(ro, rd, t);
  // wanted-level flash at screen edge
  float siren = uCarCol.w;
  if(siren > 0.0){ float edge = smoothstep(0.35, 0.8, length(uv*vec2(0.8,1.0))); col += mix(vec3(1.0,0.0,0.1), vec3(0.1,0.3,1.0), step(0.0, sin(uRes.z*10.0)))*edge*0.35*siren; }
  col += uMisc.x*vec3(1.0,0.9,0.8)*0.5;
  col *= 1.0 - 0.25*dot(uv,uv);
  col = pow(max(col, vec3(0.0)), vec3(0.95));
  col = col*1.05/(1.0 + col*0.25);
  o = vec4(col, 1.0);
}`;
