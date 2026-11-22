// Lit 3D Klax cabinet: bevelled meshes, shadow map, bloom and animated feedback.
export const KLAX_COLORS=['#17203b','#30dff6','#ffca57','#ff5d91','#a58aff','#b2ef65','#ff974d'];
const norm=a=>{const d=Math.hypot(...a)||1;return a.map(v=>v/d);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const VS=`#version 300 es
precision highp float;
layout(location=0)in vec3 position;layout(location=1)in vec3 normal;layout(location=2)in vec3 center;layout(location=3)in vec3 scale;layout(location=4)in vec3 color;layout(location=5)in vec3 material;layout(location=6)in float rotation;
uniform vec3 eye;uniform vec3 right;uniform vec3 up;uniform vec3 forward;uniform float aspect;uniform float focal;
uniform vec3 lightEye;uniform vec3 lightRight;uniform vec3 lightUp;uniform vec3 lightForward;uniform bool shadowPass;
out vec3 P;out vec3 N;out vec3 C;out vec3 M;out vec3 S;
void main(){float ca=cos(rotation),sa=sin(rotation);vec3 q=position*scale;P=center+vec3(q.x,q.y*ca-q.z*sa,q.y*sa+q.z*ca);vec3 nn=normalize(normal/scale);N=vec3(nn.x,nn.y*ca-nn.z*sa,nn.y*sa+nn.z*ca);C=pow(color,vec3(2.2));M=material;vec3 l=P-lightEye;S=vec3(dot(l,lightRight)/8.,dot(l,lightUp)/13.,dot(l,lightForward)/20.-1.);
if(shadowPass){gl_Position=vec4(S,1.);return;}vec3 d=P-eye;float z=dot(d,forward);gl_Position=vec4(dot(d,right)*focal/aspect,dot(d,up)*focal,1.004*z-.2004,z);}`;
const FS=`#version 300 es
precision highp float;in vec3 P;in vec3 N;in vec3 C;in vec3 M;in vec3 S;uniform vec3 eye;uniform vec3 lightEye;uniform sampler2D shadowMap;uniform bool shadowPass;out vec4 outColor;
const float PI=3.14159265;
void main(){if(shadowPass){outColor=vec4(0.);return;}vec3 n=normalize(N),v=normalize(eye-P),l=normalize(lightEye-P),h=normalize(v+l);float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.);float rough=M.x,metal=M.y,a=rough*rough,a2=a*a;float den=nh*nh*(a2-1.)+1.;float D=a2/(PI*den*den+.0001);float k=(rough+1.)*(rough+1.)/8.;float G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);vec3 f0=mix(vec3(.045),C,metal);vec3 F=f0+(1.-f0)*pow(1.-vh,5.);vec3 spec=D*G*F/max(4.*nv*max(nl,.001),.001);
vec3 sc=S*.5+.5;float sh=1.;if(all(greaterThan(sc,vec3(0.)))&&all(lessThan(sc,vec3(1.)))){sh=0.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){float dep=texture(shadowMap,sc.xy+vec2(x,y)/1024.).r;sh+=sc.z-.003<dep?1.:.25;}sh/=9.;}
vec3 col=((1.-F)*C*(1.-metal)/PI+spec)*nl*sh*vec3(4.8,5.2,6.0);
col+=C*(vec3(.09,.14,.24)+vec3(.08,.18,.24)*max(n.x,0.)+vec3(.22,.06,.15)*max(-n.x,0.))*(1.-metal*.65);
float rim=pow(1.-nv,3.);col+=rim*vec3(.09,.26,.38)*(.2+metal);col+=C*M.z;
float fog=1.-exp(-length(eye-P)*.007);col=mix(col,vec3(.008,.012,.035),fog);outColor=vec4(col,1.);}`;
const QUAD=`#version 300 es
out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const POST=`#version 300 es
precision highp float;in vec2 uv;out vec4 outColor;uniform sampler2D scene;uniform sampler2D glow;uniform vec2 resolution;uniform int pass;uniform float time;uniform float impact;uniform vec3 impactColor;
void main(){vec2 px=1./resolution;vec3 col=vec3(0.);if(pass==0){col=texture(scene,uv).rgb;float bright=max(max(col.r,col.g),col.b);outColor=vec4(col*smoothstep(.45,.95,bright),1.);return;}
vec2 axis=pass==1?vec2(px.x,0.):vec2(0.,px.y);vec3 b=texture(glow,uv).rgb*.227027;for(int i=1;i<=4;i++){float w=i==1?.194595:i==2?.121622:i==3?.054054:.016216;b+=(texture(glow,uv+axis*float(i)*1.7).rgb+texture(glow,uv-axis*float(i)*1.7).rgb)*w;}if(pass==1){outColor=vec4(b,1.);return;}
col=texture(scene,uv).rgb+b*.6;col+=vec3(.005,.012,.023)*exp(-dot((uv-.5)*vec2(1.4,1.),(uv-.5)*vec2(1.4,1.))*6.);col=col/(1.+col*.4);col=pow(max(col,vec3(0.)),vec3(1./2.2));float vign=1.-.28*pow(length((uv-.5)*vec2(1.2,1.)),1.4);col*=vign;col+=impactColor*impact*.08*pow(length(uv-.5)*1.5,2.);col+=(fract(sin(dot(uv*resolution,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;outColor=vec4(col,1.);}`;
function roundedMesh(){const vertices=[],axes=[[[1,0,0],[0,1,0],[0,0,1]],[[-1,0,0],[0,1,0],[0,0,-1]],[[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]]],v=[-.5,-.39,.39,.5];
for(const [n,u,w]of axes)for(let i=0;i<3;i++)for(let j=0;j<3;j++){const corner=(a,b)=>{const p=n.map((c,k)=>c*.5+u[k]*v[a]+w[k]*v[b]),q=p.map(c=>clamp(c,-.4,.4)),nn=norm(sub(p,q));return {p:q.map((c,k)=>c+nn[k]*.1),n:nn};};const pts=[corner(i,j),corner(i+1,j),corner(i+1,j+1),corner(i,j+1)];for(const k of [0,1,2,0,2,3])vertices.push(pts[k]);}return vertices;}
const MESH=roundedMesh();
export class KlaxRenderer {
  constructor(canvas){this.canvas=canvas;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'high-performance'});this.particles=[];this.flights=[];this.paddle=2;this.flash=0;this.last=performance.now();this.disposed=false;this.glowEnabled=true;
    if(!this.gl){this.ctx=canvas.getContext('2d');return;}
    const g=this.gl,compile=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    const program=(v,f)=>{const p=g.createProgram();const a=compile(g.VERTEX_SHADER,v),b=compile(g.FRAGMENT_SHADER,f);g.attachShader(p,a);g.attachShader(p,b);g.linkProgram(p);g.deleteShader(a);g.deleteShader(b);if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p));return p;};
    this.program=program(VS,FS);this.post=program(QUAD,POST);this.u=Object.fromEntries(['eye','right','up','forward','aspect','focal','lightEye','lightRight','lightUp','lightForward','shadowPass','shadowMap'].map(k=>[k,g.getUniformLocation(this.program,k)]));this.pu=Object.fromEntries(['scene','glow','resolution','pass','time','impact','impactColor'].map(k=>[k,g.getUniformLocation(this.post,k)]));
    this.meshBuffer=g.createBuffer();this.buffer=g.createBuffer();this.vao=g.createVertexArray();g.bindVertexArray(this.vao);g.bindBuffer(g.ARRAY_BUFFER,this.meshBuffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(MESH.flatMap(v=>[...v.p,...v.n])),g.STATIC_DRAW);for(let i=0;i<2;i++){g.enableVertexAttribArray(i);g.vertexAttribPointer(i,3,g.FLOAT,false,24,i*12);}g.bindBuffer(g.ARRAY_BUFFER,this.buffer);for(let i=2;i<=6;i++){g.enableVertexAttribArray(i);g.vertexAttribPointer(i,i===6?1:3,g.FLOAT,false,52,(i-2)*12);g.vertexAttribDivisor(i,1);}this.quad=g.createVertexArray();
    this.lightEye=[-4,17,8];this.lightForward=norm(sub([0,4,-4],this.lightEye));this.lightRight=norm(cross(this.lightForward,[0,1,0]));this.lightUp=cross(this.lightRight,this.lightForward);
    this.shadow=g.createTexture();g.bindTexture(g.TEXTURE_2D,this.shadow);g.texImage2D(g.TEXTURE_2D,0,g.DEPTH_COMPONENT24,1024,1024,0,g.DEPTH_COMPONENT,g.UNSIGNED_INT,null);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);this.shadowFB=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,this.shadowFB);g.framebufferTexture2D(g.FRAMEBUFFER,g.DEPTH_ATTACHMENT,g.TEXTURE_2D,this.shadow,0);g.drawBuffers([g.NONE]);g.readBuffer(g.NONE);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Shadow framebuffer incomplete');g.bindFramebuffer(g.FRAMEBUFFER,null);
  }
  target(w,h,depth=false){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);const f=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,f);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,t,0);let d=null;if(depth){d=g.createRenderbuffer();g.bindRenderbuffer(g.RENDERBUFFER,d);g.renderbufferStorage(g.RENDERBUFFER,g.DEPTH_COMPONENT24,w,h);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.DEPTH_ATTACHMENT,g.RENDERBUFFER,d);}return {f,t,d};}
  resize(){if(!this.gl)return;const g=this.gl,w=this.canvas.width,h=this.canvas.height;if(w===this.w&&h===this.h)return;this.w=w;this.h=h;for(const v of this.targets||[]){g.deleteTexture(v.t);g.deleteFramebuffer(v.f);if(v.d)g.deleteRenderbuffer(v.d);}this.targets=[this.target(w,h,true),this.target(Math.max(1,w>>1),Math.max(1,h>>1)),this.target(Math.max(1,w>>1),Math.max(1,h>>1))];g.bindFramebuffer(g.FRAMEBUFFER,null);}
  box(p,s,color,emission=0,metal=0,rotation=0,rough=.3){const col=typeof color==='string'?rgb(color):color;this.data.push(...p,...s,...col,rough,metal,emission,rotation);}
  tile(x,y,z,color,size=.82,rotation=0,flash=false){const c=flash?'#ffffff':KLAX_COLORS[color];this.box([x,y,z],[size,size,.3],c,flash?1.2:.35,.35,rotation,.2);
    // Raised ivory pips distinguish tile colors even without color perception.
    const n=color<=3?color:color-2;
    for(let i=0;i<n;i++){const ox=(i-(n-1)/2)*size*.16,cy=Math.cos(rotation),sy=Math.sin(rotation);this.box([x+ox,y-.165*sy,z+.165*cy],[size*.065,size*.3,.025],'#effbff',.2,.2,rotation,.25);}}
  event(e,game){if(e.type==='clear'){for(const [x,y]of game.clearCells)for(let i=0;i<9;i++)this.particles.push({p:[(x-2)*1.08,y+.8,1.65],v:[(Math.random()-.5)*4,Math.random()*5+1,(Math.random()-.5)*3],life:.65+Math.random()*.35,color:game.grid[x][y]});this.flash=.55;this.flashColor=[.2,1.,.9];}
    if(e.type==='catch')for(let i=0;i<8;i++)this.particles.push({p:[(game.lane-2)*1.08,5.7,.1],v:[(Math.random()-.5)*2,Math.random()*3,(Math.random()-.5)*2],life:.5,color:game.stack.at(-1)||1});
    if(e.type==='drop')this.flights.push({x:e.lane,y:e.row,color:e.color,t:0});if(e.type==='miss'){this.flash=.9;this.flashColor=[1.,.1,.3];}
  }
  render(game,now){if(!this.gl){this.fallback(game,now);return;}const g=this.gl;this.resize();const dt=Math.min(.05,(now-this.last)/1000);this.last=now;this.paddle+=(game.lane-this.paddle)*Math.min(1,dt*22);this.flash*=Math.exp(-dt*6);this.data=[];
    // Sculpted dark cabinet, inset bins, cyan rails and a purple runway spine.
    this.box([0,-.18,1.35],[6.65,.42,3.4],'#161d36',0,.85);
    this.box([0,2.62,.72],[6.4,5.5,.24],'#17213a',0,.75);
    for(let x=0;x<5;x++)for(let y=0;y<5;y++)this.box([(x-2)*1.08,y+.65,1.0],[1.01,.94,.19],x===game.lane?'#1a3f55':'#101b30',x===game.lane?.13:0,.45);
    for(const x of [-3.04,3.04]){this.box([x,2.55,1.1],[.14,5.65,.45],'#3d4f68',0,.8);this.box([x+.025,2.6,1.35],[.035,5.55,.04],'#42e6ff',1.7);}
    this.box([0,-.01,1.32],[6.15,.05,.05],'#fa6bca',1.6);
    this.box([0,5.52,-5.8],[6.2,.35,10.6],'#111b35',0,.7,.25);
    // Each lane gets its own longitudinal illuminated track.
    for(let i=0;i<=5;i++){const x=(i-2.5)*1.08;this.box([x,5.8,-5.75],[.035,.045,10.5],i===game.lane||i===game.lane+1?'#47e5ed':'#314d75',i===game.lane||i===game.lane+1?.85:.25,.5,.25);}
    for(const x of [-3.2,3.2]){this.box([x,6,-5.8],[.32,.48,10.8],'#28364b',0,.8,.25);this.box([x,6.28,-5.72],[.055,.05,10.8],x<0?'#4be8ff':'#d686ff',1.4,0,.25);}
    for(let i=0;i<19;i++){const t=(i/19+now*.000045)%1,z=-10.7+t*10,y=7.05-t*2.55;for(const x of [-3.22,3.22])this.box([x,y+.14,z],[.09,.11,.3],x<0?'#38e6fb':'#e082f9',1.8);}
    // Rotating runway tiles travel down the ramp toward the catch paddle.
    for(const t of game.tiles){const z=-10.9+t.progress*10.5,y=7.1-t.progress*2.65,flip=-Math.PI*.5+.25+Math.sin(t.progress*Math.PI*10)*.36;this.tile((t.lane-2)*1.08,y+.65,z,t.color,.78,flip);}
    const px=(this.paddle-2)*1.08;this.box([px,4.95,.34],[1.04,.22,1.08],'#56deea',.45,.75);this.box([px,4.86,.65],[.74,.1,.45],'#d4ffff',1.3,.1);
    game.stack.forEach((c,i)=>this.tile(px,5.18+i*.21,.28,c,.72,-Math.PI/2));
    // Landing preview marks the selected bin and the top tile's destination.
    const row=game.grid[game.lane].findIndex(c=>!c);if(game.stack.length&&row>=0){const yy=row+.65;for(const xx of [-.43,.43])this.box([(game.lane-2)*1.08+xx,yy,1.3],[.035,.83,.03],KLAX_COLORS[game.stack.at(-1)],1.6);for(const dy of [-.4,.4])this.box([(game.lane-2)*1.08,yy+dy,1.3],[.87,.035,.03],KLAX_COLORS[game.stack.at(-1)],1.6);}
    for(let x=0;x<5;x++)for(let y=0;y<5;y++){const c=game.grid[x][y];if(!c)continue;const moving=this.flights.some(f=>f.x===x&&f.y===y);if(moving)continue;const flash=game.clearCells.some(([a,b])=>a===x&&b===y);this.tile((x-2)*1.08,y+.65,1.3,c,.88,0,flash&&Math.sin(now*.038)>0);}
    this.flights=this.flights.filter(f=>{f.t+=dt;const t=Math.min(1,f.t/.23),ease=t*t;this.tile((f.x-2)*1.08,5.2+(f.y+.65-5.2)*ease,.35+t*.95,f.color,.88,(-Math.PI/2)*(1-t));return t<1;});
    this.particles=this.particles.filter(p=>{p.life-=dt;if(p.life<=0)return false;p.v[1]-=7*dt;for(let i=0;i<3;i++)p.p[i]+=p.v[i]*dt;this.box(p.p,[.06,.06,.06],KLAX_COLORS[p.color],2);return true;});
    // Holographic runway gateway and cabinet feet.
    this.box([0,7.48,-11.08],[6.7,.16,.3],'#675bed',1.15,.3);for(const x of [-3.25,3.25])this.box([x,8,-11.05],[.12,1.2,.22],'#ae76ff',1.35);
    for(let i=0;i<5;i++)this.box([(i-2)*.38,-.38,2.25],[.22,.045,.08],i<5-game.drops?'#5de7e4':'#e34370',i<5-game.drops?.9:1.1);
    const buffer=new Float32Array(this.data);g.bindVertexArray(this.vao);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,buffer,g.DYNAMIC_DRAW);g.useProgram(this.program);for(const k of ['lightEye','lightRight','lightUp','lightForward'])g.uniform3fv(this.u[k],this[k]);
    // Stable directional shadow pass.
    g.enable(g.DEPTH_TEST);g.bindFramebuffer(g.FRAMEBUFFER,this.shadowFB);g.viewport(0,0,1024,1024);g.clear(g.DEPTH_BUFFER_BIT);g.uniform1i(this.u.shadowPass,1);g.drawArraysInstanced(g.TRIANGLES,0,MESH.length,buffer.length/13);
    const aspect=this.w/this.h;this.eye=aspect<.85?[0,12.5,18.5]:[.3,12,18];const target=[0,3.65,-2.6],forward=norm(sub(target,this.eye)),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);this.camera={eye:this.eye,forward,right,up,aspect,focal:aspect<.85?3.05:2.85};
    g.bindFramebuffer(g.FRAMEBUFFER,this.targets[0].f);g.viewport(0,0,this.w,this.h);g.clearColor(.002,.004,.012,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);g.uniform1i(this.u.shadowPass,0);g.uniform3fv(this.u.eye,this.eye);g.uniform3fv(this.u.forward,forward);g.uniform3fv(this.u.right,right);g.uniform3fv(this.u.up,up);g.uniform1f(this.u.aspect,aspect);g.uniform1f(this.u.focal,this.camera.focal);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.shadow);g.uniform1i(this.u.shadowMap,0);g.drawArraysInstanced(g.TRIANGLES,0,MESH.length,buffer.length/13);
    g.disable(g.DEPTH_TEST);g.useProgram(this.post);g.bindVertexArray(this.quad);g.uniform1f(this.pu.time,now/1000);g.uniform1f(this.pu.impact,this.flash);g.uniform3fv(this.pu.impactColor,this.flashColor||[0,0,0]);g.uniform1i(this.pu.scene,0);g.uniform1i(this.pu.glow,1);
    const post=(pass,fb,scene,glow,w,h)=>{g.bindFramebuffer(g.FRAMEBUFFER,fb);g.viewport(0,0,w,h);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,scene);g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,glow);g.uniform2f(this.pu.resolution,this.w/2,this.h/2);g.uniform1i(this.pu.pass,pass);g.drawArrays(g.TRIANGLES,0,3);};
    post(0,this.targets[1].f,this.targets[0].t,this.targets[0].t,Math.max(1,this.w>>1),Math.max(1,this.h>>1));post(1,this.targets[2].f,this.targets[0].t,this.targets[1].t,Math.max(1,this.w>>1),Math.max(1,this.h>>1));post(2,null,this.targets[0].t,this.targets[2].t,this.w,this.h);
  }
  laneAt(clientX,clientY){const rect=this.canvas.getBoundingClientRect();if(!this.camera){const cs=Math.min(rect.width/6,rect.height/11);return clamp(Math.floor(((clientX-rect.left)-(rect.width-cs*5)/2)/cs),0,4);}const {eye,right,up,forward,aspect,focal}=this.camera,x=((clientX-rect.left)/rect.width*2-1)*aspect/focal,y=(1-(clientY-rect.top)/rect.height*2)/focal,rd=norm(forward.map((v,i)=>v+right[i]*x+up[i]*y));let t=(1.3-eye[2])/rd[2];const boardY=eye[1]+rd[1]*t;if(boardY>5.5){const rampT=(4.29-eye[1]-.255*eye[2])/(rd[1]+.255*rd[2]);if(rampT>0)t=rampT;}const wx=eye[0]+rd[0]*t;return clamp(Math.round(wx/1.08+2),0,4);}
  fallback(game,now){const c=this.ctx,w=this.canvas.width,h=this.canvas.height;c.fillStyle='#080e21';c.fillRect(0,0,w,h);const cs=Math.min(w/6,h/11),bx=(w-cs*5)/2,by=h-cs*5-10;const tile=(x,y,size,color)=>{const grad=c.createLinearGradient(x,y,x+size,y+size);grad.addColorStop(0,'#ffffff');grad.addColorStop(.18,KLAX_COLORS[color]);grad.addColorStop(1,'#172740');c.fillStyle=grad;c.shadowColor=KLAX_COLORS[color];c.shadowBlur=9;c.fillRect(x+3,y+3,size-6,size-6);c.shadowBlur=0;};for(let i=0;i<=5;i++){c.strokeStyle='#28759a';c.beginPath();c.moveTo(w/2+(i-2.5)*cs*.5,10);c.lineTo(bx+i*cs,by-30);c.stroke();}for(const t of game.tiles){const s=cs*(.5+t.progress*.5);tile(w/2+(t.lane-2.5)*s,10+t.progress*(by-60),s,t.color);}for(let x=0;x<5;x++)for(let y=0;y<5;y++){c.strokeStyle=x===game.lane?'#69e6ec':'#263c59';c.strokeRect(bx+x*cs,by+(4-y)*cs,cs,cs);if(game.grid[x][y])tile(bx+x*cs,by+(4-y)*cs,cs,game.grid[x][y]);}c.fillStyle='#7dffff';c.fillRect(bx+game.lane*cs,by-15,cs,5);game.stack.forEach((color,i)=>tile(bx+game.lane*cs,by-30-i*cs*.2,cs*.65,color));}
  dispose(){if(!this.gl)return;this.disposed=true;const g=this.gl;g.deleteBuffer(this.buffer);g.deleteBuffer(this.meshBuffer);g.deleteVertexArray(this.vao);g.deleteVertexArray(this.quad);g.deleteProgram(this.program);g.deleteProgram(this.post);g.deleteTexture(this.shadow);g.deleteFramebuffer(this.shadowFB);for(const v of this.targets||[]){g.deleteTexture(v.t);g.deleteFramebuffer(v.f);if(v.d)g.deleteRenderbuffer(v.d);}g.getExtension('WEBGL_lose_context')?.loseContext();}
}
