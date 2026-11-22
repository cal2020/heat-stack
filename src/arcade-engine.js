// Original implementations of two classic rule sets, with no browser dependencies.
const rngFor = seed => { let n=seed>>>0; return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;}; };
export const PIT_SHAPES = [
  [[-1,0,0],[0,0,0],[1,0,0]],
  [[0,0,0],[1,0,0],[0,0,1],[1,0,1]],
  [[-1,0,0],[0,0,0],[1,0,0],[0,0,1]],
  [[-1,0,0],[0,0,0],[1,0,0],[1,0,1]],
  [[-1,0,0],[0,0,0],[0,0,1],[1,0,1]],
  [[0,0,0],[1,0,0],[0,-1,0],[0,0,1]],
  [[0,0,0],[1,0,0],[1,-1,0],[1,-1,1]],
];
export function rotateVoxel([x,y,z], axis, dir=1) {
  if(axis==='x')return [x,-dir*z,dir*y];
  if(axis==='y')return [dir*z,y,-dir*x];
  return [-dir*y,dir*x,z];
}
export class PitGame {
  constructor({seed=Date.now(),width=5,depth=12}={}){
    this.width=width;this.depth=depth;this.grid=new Uint8Array(width*width*depth);this.random=rngFor(seed);
    this.score=0;this.layers=0;this.level=1;this.time=0;this.over=false;this.events=[];this.fall=0;this.lockTime=0;this.resets=0;
    this.queue=Array.from({length:4},()=>this.makePiece());this.spawn();
  }
  makePiece(){const kind=Math.floor(this.random()*PIT_SHAPES.length);return {kind:kind+1,shape:PIT_SHAPES[kind].map(c=>[...c])};}
  index(x,y,z){return x+z*this.width+y*this.width*this.width;}
  cells(p=this.piece){return p?p.shape.map(([x,y,z])=>[x+p.x,y+p.y,z+p.z]):[];}
  fits(p){return this.cells(p).every(([x,y,z])=>x>=0&&x<this.width&&z>=0&&z<this.width&&y>=0&&y<this.depth&&!this.grid[this.index(x,y,z)]);}
  spawn(){const q=this.queue.shift();this.queue.push(this.makePiece());this.piece={...q,x:Math.floor(this.width/2),y:this.depth-1,z:Math.floor(this.width/2)};this.fall=0;this.lockTime=0;this.resets=0;if(!this.fits(this.piece)){this.over=true;this.events.push({type:'over'});}}
  move(dx,dz){if(this.over)return false;const p={...this.piece,x:this.piece.x+dx,z:this.piece.z+dz};if(!this.fits(p))return false;this.piece=p;if(this.resets++<8)this.lockTime=0;return true;}
  rotate(axis,dir=1){if(this.over)return false;const shape=this.piece.shape.map(c=>rotateVoxel(c,axis,dir));for(const [dx,dy,dz] of [[0,0,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,-1,0]]){const p={...this.piece,shape,x:this.piece.x+dx,y:this.piece.y+dy,z:this.piece.z+dz};if(this.fits(p)){this.piece=p;if(this.resets++<8)this.lockTime=0;return true;}}return false;}
  descend(){const p={...this.piece,y:this.piece.y-1};if(!this.fits(p))return false;this.piece=p;this.lockTime=0;return true;}
  softDrop(){if(this.over)return; if(this.descend())this.score++;}
  ghost(){const p={...this.piece};while(this.fits({...p,y:p.y-1}))p.y--;return this.cells(p);}
  hardDrop(){if(this.over)return;while(this.descend())this.score+=2;this.lock();}
  lock(){for(const [x,y,z] of this.cells())this.grid[this.index(x,y,z)]=this.piece.kind;
    const size=this.width*this.width,keep=[];let n=0;
    for(let y=0;y<this.depth;y++){const layer=this.grid.slice(y*size,(y+1)*size);if(layer.every(Boolean))n++;else keep.push(layer);}
    if(n){this.grid.fill(0);keep.forEach((layer,y)=>this.grid.set(layer,y*size));this.layers+=n;this.level=1+Math.floor(this.layers/5);this.score+=250*n*n*this.level;this.events.push({type:'clear',count:n});}
    this.events.push({type:'lock'});this.spawn();
  }
  update(dt){if(this.over)return;this.time+=dt;this.fall+=dt;const interval=Math.max(160,1400-this.level*95);while(this.fall>=interval){this.fall-=interval;if(!this.descend())break;}
    if(!this.fits({...this.piece,y:this.piece.y-1})){this.lockTime+=dt;if(this.lockTime>=550)this.lock();}else this.lockTime=0;
  }
}
export class TileGame {
  constructor({seed=Date.now()}={}){this.random=rngFor(seed);this.grid=Array.from({length:5},()=>Array(5).fill(0));this.tiles=[];this.stack=[];this.lane=2;this.score=0;this.matches=0;this.wave=1;this.waveMatches=0;this.drops=0;this.over=false;this.time=0;this.spawnT=0;this.events=[];this.clearCells=[];this.clearT=0;this.chain=0;this.spawnTile();this.tiles[0].lane=this.lane;this.tiles[0].progress=.58;this.spawnTile();this.tiles[1].progress=.05;}
  spawnTile(){this.tiles.push({lane:Math.floor(this.random()*5),color:1+Math.floor(this.random()*Math.min(6,3+Math.floor(this.wave/2))),progress:0});}
  move(dx){if(this.over)return;this.lane=Math.max(0,Math.min(4,this.lane+dx));}
  miss(){if(this.over)return;this.drops++;this.events.push({type:'miss'});if(this.drops>=5){this.over=true;this.events.push({type:'over'});}}
  toss(){if(this.over||!this.stack.length)return;this.tiles.push({lane:this.lane,color:this.stack.pop(),progress:.3});this.events.push({type:'toss'});}
  drop(){if(this.over||this.clearT||!this.stack.length)return false;const col=this.grid[this.lane],y=col.findIndex(c=>!c);if(y<0){this.over=true;this.events.push({type:'over'});return false;}const color=this.stack.pop();col[y]=color;this.events.push({type:'drop',lane:this.lane,row:y,color});this.chain=0;this.events.push({type:'lock'});this.resolve();return true;}
  findMatches(){const hits=new Set();let lines=0;for(let x=0;x<5;x++)for(let y=0;y<5;y++){const color=this.grid[x][y];if(!color)continue;for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){const px=x-dx,py=y-dy;if(px>=0&&px<5&&py>=0&&py<5&&this.grid[px][py]===color)continue;const run=[];let a=x,b=y;while(a>=0&&a<5&&b>=0&&b<5&&this.grid[a][b]===color){run.push([a,b]);a+=dx;b+=dy;}if(run.length>=3){lines++;for(const [a,b] of run)hits.add(a+5*b);}}}return {cells:[...hits].map(v=>[v%5,Math.floor(v/5)]),lines};}
  resolve(){const m=this.findMatches();if(!m.cells.length){this.chain=0;return;}this.clearCells=m.cells;this.clearT=240;this.chain++;this.matches+=m.lines;this.waveMatches+=m.lines;this.score+=m.cells.length*50*this.chain*this.wave;this.events.push({type:'clear',count:m.lines,chain:this.chain});if(this.waveMatches>=5){this.wave++;this.waveMatches-=5;this.drops=Math.max(0,this.drops-1);this.events.push({type:'wave',wave:this.wave});}}
  update(dt){if(this.over)return;this.time+=dt;if(this.clearT){this.clearT-=dt;if(this.clearT<=0){for(const [x,y] of this.clearCells)this.grid[x][y]=0;for(let x=0;x<5;x++){const col=this.grid[x].filter(Boolean);this.grid[x]=[...col,...Array(5-col.length).fill(0)];}this.clearCells=[];this.clearT=0;this.resolve();}}
    this.spawnT+=dt;const spawn=Math.max(450,1700-this.wave*100);while(this.spawnT>=spawn){this.spawnT-=spawn;this.spawnTile();}
    const speed=(.13+this.wave*.014)/1000;
    for(const tile of this.tiles){tile.progress+=dt*speed;if(tile.progress>=1){if(tile.lane===this.lane&&this.stack.length<5){this.stack.push(tile.color);this.events.push({type:'catch'});}else this.miss();}}
    this.tiles=this.tiles.filter(t=>t.progress<1);
  }
}
