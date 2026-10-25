import test from 'node:test';
import assert from 'node:assert/strict';
import {junctionPhase, trafficDesiredSpeed, pedestrianMayCross} from '../dist/traffic-rules.js';

const car = overrides => ({x: -5, z: 30, heading: 0, speed: 8, cruise: 10, radius: 2.3, ...overrides});

test('24-second junction cycle has amber phases and never conflicting greens', () => {
  assert.deepEqual(junctionPhase(0, 0, 0), {northSouth: 'green', eastWest: 'red', pedestrians: false});
  assert.equal(junctionPhase(0, 0, 9).northSouth, 'amber');
  assert.equal(junctionPhase(0, 0, 11).pedestrians, true);
  assert.equal(junctionPhase(0, 0, 12).eastWest, 'green');
  assert.equal(junctionPhase(0, 0, 21).eastWest, 'amber');
  assert.equal(junctionPhase(0, 0, 23).pedestrians, true);
  assert.deepEqual(junctionPhase(0, 0, -1), junctionPhase(0, 0, 23));
  for (let time = 0; time < 48; time += 0.25) {
    const phase = junctionPhase(160, -320, time);
    assert.ok(!(phase.northSouth === 'green' && phase.eastWest === 'green'));
  }
});

test('red lights slow approaching cars, hold at stop line, and release on green', () => {
  assert.ok(trafficDesiredSpeed(car(), [], null, [], [], 14) < 8);
  assert.equal(trafficDesiredSpeed(car({z: 20.8, speed: 0}), [], null, [], [], 14), 0);
  assert.equal(trafficDesiredSpeed(car(), [], null, [], [], 2), 10);
  assert.equal(trafficDesiredSpeed(car({z: 15}), [], null, [], [], 14), 10, 'committed traffic clears intersection');
  assert.equal(trafficDesiredSpeed(car({cruise: 0}), [], null, [], [], 2), 0, 'explicitly stopped traffic stays stopped');
});

test('amber stops cars that can brake and lets close committed cars continue', () => {
  assert.ok(trafficDesiredSpeed(car({z: 28, speed: 4}), [], null, [], [], 9.5) <= 4);
  assert.equal(trafficDesiredSpeed(car({z: 23, speed: 12}), [], null, [], [], 9.5), 10);
});

test('following uses headway and closing speed while ignoring the opposite lane', () => {
  const self = car({z: 80, speed: 10});
  const lead = car({z: 68, speed: 3});
  assert.ok(trafficDesiredSpeed(self, [self, lead], null, [], [], 2) < 3);
  assert.equal(trafficDesiredSpeed(self, [car({x: 5, z: 68, heading: Math.PI})], null, [], [], 2), 10);
  assert.equal(trafficDesiredSpeed(self, [car({z: 95})], null, [], [], 2), 10, 'vehicle behind does not block escape');
});

test('parked player and static obstacles block the actual forward lane', () => {
  const self = car({z: 80, speed: 8});
  assert.equal(trafficDesiredSpeed(self, [], car({z: 73, speed: 0}), [], [], 2), 0);
  const blocking = {x: -5, z: 69, hx: 1.2, hz: 2};
  assert.ok(trafficDesiredSpeed(self, [], null, [], [blocking], 2) < 2);
  assert.equal(trafficDesiredSpeed(self, [], null, [], [{...blocking, x: 15}], 2), 10, 'parked pavement obstacle outside lane is ignored');
});

test('curved perception detects parked blockers beyond the current heading ray', () => {
  const self = car({x: -5, z: 80, speed: 6, progress: 0, curveLength: 100,
    curve: {getPointAt(t) {return {x: -5 + 100 * t, z: 80 - 20 * t};}}});
  const blocker = {x: 5, z: 78, hx: 1, hz: 1};
  assert.ok(trafficDesiredSpeed(self, [], null, [], [blocker], 2) < 3);
});

test('drivers yield to all pedestrians in their path, including ordinary sidewalk walkers', () => {
  const self = car({z: 80, speed: 7});
  const walker = {x: -5, z: 72, axis: 'x', direction: 1, speed: 0.9, radius: 0.55, crossing: false};
  assert.ok(trafficDesiredSpeed(self, [], null, [walker], [], 2) < 1);
  assert.equal(trafficDesiredSpeed(self, [], null, [{...walker, x: 14.5}], [], 2), 10);
});

test('east-west crossers wait for north-south red and clear after entering', () => {
  const person = {x: -14.5, z: -15, axis: 'x', direction: 1, speed: 0.9, radius: 0.55, crossing: true};
  assert.equal(pedestrianMayCross(person, [], null, 2), false);
  assert.equal(pedestrianMayCross(person, [], null, 14), true);
  assert.equal(pedestrianMayCross({...person, x: -7}, [], null, 2), true, 'committed walker continues despite changed signal');
  assert.equal(pedestrianMayCross({...person, x: -11.9}, [], null, 2), true, 'walker just inside the road edge keeps clearing');
  assert.equal(pedestrianMayCross({...person, direction: -1}, [], null, 2), true, 'walker moving away from road continues');
});

test('ordinary north-south sidewalk walkers infer cross streets and yield to crossing cars', () => {
  const person = {x: -14.5, z: -14.5, axis: 'z', direction: 1, speed: 0.9, radius: 0.55};
  assert.equal(pedestrianMayCross(person, [], null, 14), false, 'east-west green blocks north-south pedestrian entry');
  assert.equal(pedestrianMayCross(person, [], null, 2), true);
  assert.equal(pedestrianMayCross({...person, z: -60}, [], null, 14), true, 'ordinary pavement walking remains free');
  const approaching = {x: -30, z: -12, heading: Math.PI / 2, speed: 8, radius: 2.3};
  assert.equal(pedestrianMayCross(person, [approaching], null, 2), false, 'actual crossing conflict overrides permission');
});
