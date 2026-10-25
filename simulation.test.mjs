import test from 'node:test';
import assert from 'node:assert/strict';
import {CarPhysics, findRoute, routeLength, distanceToRoute, roadSurfaceAt, JOBS} from '../dist/simulation.js';

function run(car, seconds, input, obstacles = [], traffic = [], pedestrians = []) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...car.update(1 / 60, input, obstacles, traffic, pedestrians));
  return events;
}

test('accelerator moves north and service brake stops without reversing', () => {
  const car = new CarPhysics();
  run(car, 4, {throttle: 1});
  assert.ok(car.speed > 10);
  assert.ok(car.z < 35);
  run(car, 4, {brake: 1});
  assert.equal(car.speed, 0);
  run(car, 2, {brake: 1});
  assert.equal(car.speed, 0);
});

test('transmission interlock, reverse limit, and brake priority', () => {
  const car = new CarPhysics();
  run(car, 2, {throttle: 1});
  car.gear = 'R';
  assert.equal(car.gear, 'D');
  run(car, 2, {brake: 1});
  car.gear = 'R';
  run(car, 4, {throttle: 1});
  assert.ok(car.speed < -4 && car.speed >= -6);
  run(car, 2, {throttle: 1, brake: 1});
  assert.equal(car.speed, 0);
});

test('positive steering turns right; frame-rate independent integration', () => {
  const car = new CarPhysics();
  run(car, 2, {throttle: 1, steer: 0.5});
  assert.ok(car.heading > 0 && car.x > -5);
  const a = new CarPhysics(), b = new CarPhysics();
  for (let t = 0; t < 120; t++) a.update(1 / 60, {throttle: 1});
  for (let t = 0; t < 60; t++) b.update(1 / 30, {throttle: 1});
  assert.ok(Math.abs(a.z - b.z) < 0.1);
});

test('wall blocks maximum-speed car and produces one meaningful impact', () => {
  const car = new CarPhysics();
  car.speed = 22.2;
  const wall = {x: -5, z: 45, hx: 8, hz: 0.5};
  const events = run(car, 0.6, {throttle: 1}, [wall]);
  assert.ok(car.z >= wall.z + wall.hz + car.radius - 0.01);
  assert.equal(events.filter(e => e.type === 'collision').length, 1);
  assert.ok(car.damage > 0);
});

test('traffic and pedestrians block movement and report distinct impacts', () => {
  for (const type of ['collision', 'pedestrian']) {
    const car = new CarPhysics();
    car.speed = 12;
    const entity = {x: -5, z: 49, radius: 0.7};
    const events = run(car, 0.5, {}, [], type === 'collision' ? [entity] : [], type === 'pedestrian' ? [entity] : []);
    assert.ok(events.some(e => e.type === type));
    assert.ok(car.z > 51);
  }
});

test('GPS follows road segments with perpendicular lane connectors', () => {
  const start = {x: -5, z: 55};
  for (const target of JOBS.flatMap(job => [job.pickup, job.dropoff])) {
    const route = findRoute(start, target);
    assert.deepEqual(route[0], start);
    assert.deepEqual(route.at(-1), {x: target.x, z: target.z});
    for (let i = 1; i < route.length; i++) {
      assert.ok(route[i].x === route[i - 1].x || route[i].z === route[i - 1].z, 'no diagonal shortcut');
    }
    assert.ok(routeLength(route) >= Math.hypot(target.x - start.x, target.z - start.z));
    assert.ok(distanceToRoute(start, route) < 0.01);
  }
});

test('GPS takes direct route on the same road and supports outer road extensions', () => {
  const route = findRoute({x: -5, z: 55}, {x: -5, z: -40});
  assert.ok(routeLength(route) <= 105.01);
  const outer = findRoute({x: 0, z: 380}, {x: 320, z: -380});
  assert.equal(routeLength(outer), 1080);
});

test('sprung body pitches under acceleration and braking, then settles at rest', () => {
  const car = new CarPhysics();
  run(car, 1.5, {throttle: 1});
  assert.ok(car.pitch > 0.01, 'acceleration lifts the nose');
  run(car, 0.35, {brake: 1});
  assert.ok(car.pitch < -0.01, 'braking compresses the front suspension');
  run(car, 6, {brake: 1});
  for (const value of [car.heave, car.pitch, car.roll]) assert.ok(Number.isFinite(value) && Math.abs(value) < 0.001);
});

test('high-speed steering obeys tyre grip and produces restrained body roll', () => {
  const car = new CarPhysics();
  car.speed = 22;
  run(car, 0.8, {throttle: 1, steer: 1, surface: 'road'});
  assert.ok(car.yawRate > 0 && car.lateralAcceleration <= 8.5, 'lateral grip limits yaw');
  assert.ok(car.roll > 0.025 && car.roll < 0.13, 'outside suspension takes cornering load');
  assert.ok(car.wheelAngle < 0.22, 'steering lock decreases at road speed');
});

test('grass increases rolling resistance and body movement versus asphalt', () => {
  const asphalt = new CarPhysics(), grass = new CarPhysics();
  asphalt.speed = grass.speed = 8;
  let roadBounce = 0, grassBounce = 0;
  for (let i = 0; i < 60; i++) {
    asphalt.update(1 / 60, {surface: 'road'});
    grass.update(1 / 60, {surface: 'grass'});
    roadBounce += asphalt.heave * asphalt.heave;
    grassBounce += grass.heave * grass.heave;
  }
  assert.ok(grass.speed < asphalt.speed - 1);
  assert.ok(grassBounce > roadBounce * 3);
  assert.equal(roadSurfaceAt(0, 55), 'road');
  assert.equal(roadSurfaceAt(14, 55), 'sidewalk');
  assert.equal(roadSurfaceAt(60, 55), 'grass');
});

test('progressive brake pressure changes the stopping distance', () => {
  const light = new CarPhysics(), hard = new CarPhysics();
  light.speed = hard.speed = 12;
  run(light, 0.7, {brake: 0.25});
  run(hard, 0.7, {brake: 1});
  assert.ok(light.speed > hard.speed + 3);
  assert.ok(light.z < hard.z - 1);
});

test('traffic impacts use relative closing speed instead of total player speed', () => {
  const car = new CarPhysics();
  car.speed = 12;
  const lead = {x: -5, z: 49, radius: 2.5, heading: 0, speed: 10};
  const events = run(car, 0.15, {}, [], [lead]);
  assert.equal(events.filter(e => e.type === 'collision').length, 1);
  assert.ok(events[0].speed < 3, 'same-direction contact has a small closing speed');
  assert.ok(car.damage < 4);
  const parked = new CarPhysics();
  const rearCar = {x: -5, z: 58, radius: 2.5, heading: 0, speed: 8};
  const rearEvents = parked.update(1 / 60, {}, [], [rearCar]);
  assert.ok(rearEvents.some(e => e.type === 'collision'), 'moving traffic can strike a stopped player');
});

test('workplace jobs add short service visits while preserving original save IDs', () => {
  assert.deepEqual(JOBS.slice(0, 3).map(j => [j.id, j.reward]), [['chai-run', 320], ['market-parcel', 420], ['grocery-run', 480]]);
  assert.equal(new Set(JOBS.map(j => j.id)).size, JOBS.length);
  assert.equal(JOBS.length, 6);
  for (const job of JOBS.slice(3)) {
    assert.ok(job.serviceSeconds > 0 && job.serviceSeconds <= 4);
    assert.ok(job.workLabel && job.pickup.name && job.dropoff.name && job.reward > 0);
  }
});
