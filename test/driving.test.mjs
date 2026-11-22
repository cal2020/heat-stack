import test from 'node:test';
import assert from 'node:assert/strict';
import { World, terrainH } from '../src/world.js';
const hooks = { isTouch: false, toast() {}, rumble() {} };
const gas = () => ({ steer: 0, gas: 1, brake: 0, drift: 0, boost: 0 });

test('normal throttle climbs a real steep terrain slope from rest', () => {
  const w = new World(hooks), x = -180, z = 0;
  const gx = (terrainH(x+1,z)-terrainH(x-1,z))/2;
  const gz = (terrainH(x,z+1)-terrainH(x,z-1))/2;
  Object.assign(w.car, { x, z, y: terrainH(x,z), yaw: Math.atan2(gx,gz) });
  w.controls = gas;
  for (let i=0;i<120;i++) w.physics(1/60);
  assert.ok(Math.hypot(w.car.x-x,w.car.z-z)>25, 'car should make sustained uphill progress');
  assert.ok(terrainH(w.car.x,w.car.z)-terrainH(x,z)>20, 'car should gain elevation');
});

test('city entrance road provides a flat unobstructed initial drive', () => {
  const w = new World(hooks);
  Object.assign(w.car,{x:64,z:0,y:terrainH(64,0),yaw:Math.PI/2});
  w.controls = gas;
  for(let i=0;i<180;i++)w.physics(1/60);
  assert.ok(w.car.x>140);
  assert.ok(Math.abs(w.car.z)<.01);
  assert.ok(Math.abs(terrainH(w.car.x,w.car.z)-.6)<.01);
});

test('entering a driving job parks without changing position, heading or wanted state', () => {
  let entered;
  const w = new World({...hooks,onJob:(job,stars)=>{entered={job,stars};}});
  Object.assign(w.car,{x:17,z:196,y:.6,yaw:.75,v:[5,2],speed:6});
  w.stars=3;w.near={id:'studio',name:'Studio job'};
  w.enterJob();
  assert.deepEqual([w.car.x,w.car.y,w.car.z,w.car.yaw],[17,.6,196,.75]);
  assert.deepEqual(w.car.v,[0,0]);
  assert.equal(entered.stars,3);
  assert.equal(w.cooldown.studio,20);
});
