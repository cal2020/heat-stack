const palette=['#172237','#27d9ef','#ffcf4a','#c67aff','#ff718c','#6ceba1','#ff994a','#588cff'];
export const arcadePalette=palette;
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const faces=[[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[1,0,1],[1,0,0],[1,1,0],[1,1,1]],[[0,0,1],[0,0,0],[1,0,0],[1,0,1]],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]],[[1,0,0],[0,0,0],[0,1,0],[1,1,0]],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]];
const normals=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const corners=[[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]];
export class PitRenderer {
  constructor(canvas){this.canvas=canvas;this.yaw=.38;this.pitch=1.05;this.distance=17;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:true});
    if(!this.gl){this.ctx=canvas.getContext('2d');return;}
    const g=this.gl;
    const compile=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    this.program=g.createProgram();g.attachShader(this.program,compile(g.VERTEX_SHADER,`#version 300 es
    precision highp float;layout(location=0)in vec3 pos;layout(location=1)in vec3 normal;layout(location=2)in vec3 color;
    uniform vec3 eye;uniform vec3 right;uniform vec3 up;uniform vec3 forward;uniform float aspect;out vec3 col;
    void main(){vec3 d=pos-eye;float z=dot(d,forward);gl_Position=vec4(dot(d,right)*1.9/aspect,dot(d,up)*1.9,1.004*z-.2004,z);float light=.48+.52*max(dot(normal,normalize(vec3(-.4,1.,.6))),0.);col=color*light;}`));
    g.attachShader(this.program,compile(g.FRAGMENT_SHADER,`#version 300 es
    precision highp float;in vec3 col;out vec4 outColor;void main(){outColor=vec4(col,1.);}`));g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));
    this.uniforms=Object.fromEntries(['eye','right','up','forward','aspect'].map(n=>[n,g.getUniformLocation(this.program,n)]));this.buffer=g.createBuffer();this.vao=g.createVertexArray();g.bindVertexArray(this.vao);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);for(let i=0;i<3;i++){g.enableVertexAttribArray(i);g.vertexAttribPointer(i,3,g.FLOAT,false,36,i*12);}g.enable(g.DEPTH_TEST);
  }
  dispose(){if(!this.gl)return;const g=this.gl;g.deleteBuffer(this.buffer);g.deleteVertexArray(this.vao);g.deleteProgram(this.program);g.getExtension('WEBGL_lose_context')?.loseContext();}
  camera(w,h){const c=[2.5,6,2.5],d=this.distance*Math.max(1,.65/(w/h));this.eye=[c[0]+d*Math.sin(this.yaw)*Math.cos(this.pitch),c[1]+d*Math.sin(this.pitch),c[2]+d*Math.cos(this.yaw)*Math.cos(this.pitch)];this.forward=norm(sub(c,this.eye));this.right=norm(cross(this.forward,[0,1,0]));this.up=cross(this.right,this.forward);}
  project(p,w,h){const d=sub(p,this.eye),z=dot(d,this.forward);return [w/2+dot(d,this.right)*h*.95/z,h/2-dot(d,this.up)*h*.95/z];}
  direction(action){const candidates=[[1,0],[-1,0],[0,1],[0,-1]];const v=(action==='left'||action==='right')?this.right:this.up;const sign=(action==='left'||action==='down')?-1:1;return candidates.sort((a,b)=>sign*((b[0]-a[0])*v[0]+(b[1]-a[1])*v[2]))[0];}
  render(game){const c=this.canvas,w=c.width,h=c.height;this.camera(w,h);const triangles=[],lines=[],polys=[],linePairs=[];
    const addLine=(a,b,color)=>{const cc=rgb(color);for(const v of [a,b])lines.push(...v,0,1,0,...cc);linePairs.push([a,b,color]);};
    const cube=(x,y,z,kind,ghost=false)=>{const color=rgb(palette[kind]||'#fff'),point=v=>[x+.045+v[0]*.91,y+.045+v[1]*.91,z+.045+v[2]*.91];
      if(!ghost)faces.forEach((f,i)=>{const pts=f.map(point);for(const j of [0,1,2,0,2,3])triangles.push(...pts[j],...normals[i],...color);const brightness=.48+.52*Math.max(0,dot(normals[i],norm([-.4,1,.6])));polys.push({pts,color:color.map(v=>v*brightness),depth:pts.reduce((s,p)=>s+dot(sub(p,this.eye),this.forward),0)/4});});
      for(const [a,b]of edges)addLine(point(corners[a]),point(corners[b]),ghost?'#d8f6ff':palette[kind]);
    };
    for(let i=0;i<=5;i++){addLine([i,0,0],[i,0,5],'#327a97');addLine([0,0,i],[5,0,i],'#327a97');}
    for(let y=0;y<=game.depth;y++){for(const z of [0,5])addLine([0,y,z],[5,y,z],y===game.depth?'#8aebff':'#183e57');for(const x of [0,5])addLine([x,y,0],[x,y,5],y===game.depth?'#8aebff':'#183e57');}
    for(const x of [0,5])for(const z of [0,5])addLine([x,0,z],[x,game.depth,z],'#488bb2');
    for(let y=0;y<game.depth;y++)for(let z=0;z<5;z++)for(let x=0;x<5;x++){const k=game.grid[game.index(x,y,z)];if(k)cube(x,y,z,k);}
    if(!game.over){for(const [x,y,z]of game.ghost())cube(x,y,z,game.piece.kind,true);for(const [x,y,z]of game.cells())cube(x,y,z,game.piece.kind);}
    if(this.gl){const g=this.gl;g.viewport(0,0,w,h);g.clearColor(.025,.035,.075,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);g.useProgram(this.program);g.bindVertexArray(this.vao);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);for(const n of ['eye','right','up','forward'])g.uniform3fv(this.uniforms[n],this[n]);g.uniform1f(this.uniforms.aspect,w/h);g.bufferData(g.ARRAY_BUFFER,new Float32Array(triangles),g.DYNAMIC_DRAW);g.drawArrays(g.TRIANGLES,0,triangles.length/9);g.bufferData(g.ARRAY_BUFFER,new Float32Array(lines),g.DYNAMIC_DRAW);g.depthFunc(g.LEQUAL);g.drawArrays(g.LINES,0,lines.length/9);g.depthFunc(g.LESS);}
    else {const ctx=this.ctx;ctx.fillStyle='#070b18';ctx.fillRect(0,0,w,h);polys.sort((a,b)=>b.depth-a.depth);for(const {pts,color}of polys){ctx.beginPath();pts.forEach((p,i)=>{const [x,y]=this.project(p,w,h);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.fillStyle=`rgb(${color.map(v=>Math.round(v*255)).join(',')})`;ctx.fill();}for(const [a,b,col]of linePairs){ctx.beginPath();ctx.moveTo(...this.project(a,w,h));ctx.lineTo(...this.project(b,w,h));ctx.strokeStyle=col;ctx.lineWidth=1;ctx.stroke();}}
  }
}
