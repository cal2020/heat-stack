import test from 'node:test';
import assert from 'node:assert/strict';
import {PitGame, TileGame, rotateVoxel} from '../src/arcade-engine.js';

test('3D rotations return to their original shape after four quarter-turns',()=>{for(const axis of ['x','y','z']){let p=[1,2,3];for(let n=0;n<4;n++)p=rotateVoxel(p,axis);assert.deepEqual(p,[1,2,3]);assert.deepEqual(rotateVoxel(rotateVoxel(p,axis),axis,-1),p);}});
test('pit rotations can change height, and reject collisions without corrupting the piece',()=>{const g=new PitGame({seed:1});g.piece={kind:1,shape:[[-1,0,0],[0,0,0],[1,0,0]],x:2,y:8,z:2};assert.equal(g.rotate('z'),true);assert.equal(new Set(g.cells().map(c=>c[1])).size,3);const before=JSON.stringify(g.piece);g.grid.fill(1);assert.equal(g.rotate('x'),false);assert.equal(JSON.stringify(g.piece),before);});
test('pit drop lands on the ghost and cannot pass through occupied voxels',()=>{const g=new PitGame({seed:1});g.piece={kind:2,shape:[[0,0,0]],x:2,y:10,z:2};g.grid[g.index(2,3,2)]=1;const ghost=g.ghost();assert.deepEqual(ghost,[[2,4,2]]);g.hardDrop();assert.equal(g.grid[g.index(2,4,2)],2);assert.equal(g.grid[g.index(2,3,2)],1);});
test('pit clears complete horizontal layers and drops higher voxels into their place',()=>{const g=new PitGame({seed:4});for(let z=0;z<5;z++)for(let x=0;x<5;x++)g.grid[g.index(x,0,z)]=1;g.grid[g.index(2,0,2)]=0;g.grid[g.index(4,1,4)]=3;g.piece={kind:2,shape:[[0,0,0]],x:2,y:10,z:2};g.hardDrop();assert.equal(g.layers,1);assert.equal(g.grid[g.index(4,0,4)],3);assert.equal(g.grid[g.index(4,1,4)],0);assert.equal(g.grid.filter(Boolean).length,1);});
test('pit ends when the next piece cannot spawn',()=>{const g=new PitGame({seed:2});g.grid.fill(1);g.spawn();assert.equal(g.over,true);});
test('pit movement is bounded in both floor dimensions',()=>{const g=new PitGame({seed:8});for(let n=0;n<20;n++)g.move(-1,-1);assert.equal(g.fits(g.piece),true);assert.equal(g.move(-1,-1),false);});
test('tile paddle catches up to five and counts missed tiles',()=>{const g=new TileGame();g.tiles=[{lane:2,color:3,progress:.999}];g.update(20);assert.deepEqual(g.stack,[3]);g.tiles=[{lane:1,color:2,progress:.999}];g.update(20);assert.equal(g.drops,1);g.stack=[1,2,3,4,5];g.tiles=[{lane:2,color:1,progress:.999}];g.update(20);assert.equal(g.drops,2);assert.equal(g.stack.length,5);});
test('tile drop uses top tile and toss returns it to the ramp',()=>{const g=new TileGame();g.stack=[1,2];g.lane=3;g.drop();assert.equal(g.grid[3][0],2);g.toss();assert.deepEqual(g.stack,[]);assert.equal(g.tiles.at(-1).color,1);assert.equal(g.tiles.at(-1).lane,3);});
test('tile matches horizontal, vertical and both diagonals',()=>{for(const cells of [[[0,0],[1,0],[2,0]],[[2,0],[2,1],[2,2]],[[0,0],[1,1],[2,2]],[[0,2],[1,1],[2,0]]]){const g=new TileGame();for(const [x,y]of cells)g.grid[x][y]=4;const m=g.findMatches();assert.equal(m.lines,1);assert.equal(m.cells.length,3);}});
test('tile clears collapse into a scoring cascade',()=>{const g=new TileGame();g.tiles=[];g.grid[0]=[2,0,0,0,0];g.grid[1]=[2,0,0,0,0];g.grid[2]=[1,1,1,2,0];g.resolve();assert.equal(g.matches,1);g.update(250);assert.equal(g.matches,2);assert.equal(g.chain,2);g.update(250);assert.equal(g.grid.flat().filter(Boolean).length,0);assert.ok(g.score>=450);});
test('tile misses and overflowing bins end the game',()=>{const g=new TileGame();for(let i=0;i<8;i++)g.miss();assert.equal(g.over,true);assert.equal(g.drops,5);const h=new TileGame();h.grid[2]=[1,2,1,2,1];h.stack=[3];h.drop();assert.equal(h.over,true);});
test('five tile matches advance a wave',()=>{const g=new TileGame();g.waveMatches=4;g.grid[0][0]=g.grid[1][0]=g.grid[2][0]=1;g.resolve();assert.equal(g.wave,2);});

test('right action moves the Klax paddle rather than calling a rotation method', async()=>{
  const {Arcade}=await import('../src/arcade.js');const game=new TileGame({seed:1});
  const a={kind:'tiles',game,paused:false,reverse:false,h:{audio:{play(){}}},message(){}};
  Arcade.prototype.act.call(a,'right');assert.equal(game.lane,3);
  Arcade.prototype.act.call(a,'left');assert.equal(game.lane,2);
  for(let i=0;i<15;i++)Arcade.prototype.act.call(a,'right');assert.equal(game.lane,4);
});
test('Klax binds arrow keys, WASD, Space and Enter to gameplay actions',async()=>{
  const {Arcade}=await import('../src/arcade.js');const a={kind:'tiles',game:{over:false},paused:false};
  for(const [key,action]of Object.entries({ArrowRight:'right',ArrowLeft:'left',KeyA:'left',KeyD:'right',Space:'drop',Enter:'drop',KeyW:'toss',ArrowUp:'toss'}))assert.equal(Arcade.prototype.keyAction.call(a,key),action);
});
