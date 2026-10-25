// Deterministic browser-independent driving and GPS simulation. Distances are metres.
export const ROAD_COORDS = Object.freeze([-320, -160, 0, 160, 320]);
export const WORLD_LIMIT = 390;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const approach = (value, target, amount) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
const SURFACES = Object.freeze({
  road: {grip: 1, drag: 0, bump: 0.003},
  sidewalk: {grip: 0.8, drag: 0.6, bump: 0.016},
  grass: {grip: 0.58, drag: 1.65, bump: 0.032},
});

export function roadSurfaceAt(x, z) {
  const edge = Math.min(...ROAD_COORDS.map(r => Math.min(Math.abs(x - r), Math.abs(z - r))));
  return edge <= 12 ? 'road' : edge <= 17 ? 'sidewalk' : 'grass';
}

export class CarPhysics {
  constructor() {
    this.x = -5;
    this.z = 55;
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.damage = 0;
    this.radius = 2.1;
    // Body motion is separate from wheel contact: metres vertically, radians in rotation.
    this.heave = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.wheelAngle = 0;
    this.longitudinalAcceleration = 0;
    this.lateralAcceleration = 0;
    this._heaveVelocity = 0;
    this._pitchVelocity = 0;
    this._rollVelocity = 0;
    this._gear = 'D';
    this._throttle = 0;
    this._brake = 0;
    this._impactCooldown = 0;
    this._pedestrianCooldown = 0;
  }

  get gear() { return this._gear; }
  set gear(value) {
    // A transmission interlock prevents changing direction while moving.
    if (['D', 'R', 'N'].includes(value) && Math.abs(this.speed) < 0.55) {
      this._gear = value;
      this.speed = 0;
    }
  }

  update(dt, input = {}, colliders = [], traffic = [], pedestrians = []) {
    if (!Number.isFinite(dt) || dt <= 0) return [];
    dt = Math.min(dt, 0.15); // Ignore long background-tab pauses.
    const events = [];
    const steps = Math.ceil(dt / (1 / 90));
    const step = dt / steps;
    const throttle = clamp(Number(input.throttle) || 0, 0, 1);
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const steering = clamp(Number(input.steer) || 0, -1, 1);

    for (let i = 0; i < steps; i++) {
      this._impactCooldown = Math.max(0, this._impactCooldown - step);
      this._pedestrianCooldown = Math.max(0, this._pedestrianCooldown - step);
      const initialSpeed = this.speed;
      const surface = SURFACES[input.surface] || SURFACES[roadSurfaceAt(this.x, this.z)];
      const absoluteSpeed = Math.abs(this.speed);
      // Rack response and steering lock decrease smoothly as road speed increases.
      this.steer = approach(this.steer, steering, step * (3.6 / (1 + absoluteSpeed * 0.035)));
      this._throttle = approach(this._throttle, throttle, step * (throttle > this._throttle ? 2.4 : 4.8));
      this._brake = approach(this._brake, brake, step * 7);
      const direction = this._gear === 'R' ? -1 : this._gear === 'D' ? 1 : 0;
      const limit = direction < 0 ? 6 : 22.2;
      // Both pedals held: service brake wins. Braking alone never selects reverse.
      const enginePull = 4.15 * (1 - 0.52 * Math.pow(clamp(absoluteSpeed / limit, 0, 1), 1.35));
      const acceleration = brake > 0.05 || input.handbrake ? 0 : this._throttle * direction * enginePull;
      const drag = 0.18 + absoluteSpeed * 0.025 + this.speed * this.speed * 0.003 + surface.drag * (0.5 + absoluteSpeed * 0.13);
      const brakeDeceleration = Math.pow(this._brake, 1.18) * 10.2 * surface.grip;
      this.speed = approach(this.speed, 0, (drag + brakeDeceleration + (input.handbrake ? 12 : 0)) * step);
      this.speed += acceleration * step;
      this.speed = clamp(this.speed, -6, 22.2);
      if (Math.abs(this.speed) > limit) this.speed = approach(this.speed, direction * limit, step * 6);
      if (Math.abs(this.speed) < 0.012 && acceleration === 0) this.speed = 0;
      this.wheelAngle = this.steer * 0.56 / (1 + Math.abs(this.speed) * 0.09);
      const idealYawRate = this.speed / 2.8 * Math.tan(this.wheelAngle);
      const gripLimit = 8.4 * surface.grip * (input.handbrake ? 0.72 : 1);
      const maxYawRate = gripLimit / Math.max(1.5, Math.abs(this.speed));
      const desiredYawRate = clamp(idealYawRate, -maxYawRate, maxYawRate);
      this.yawRate += (desiredYawRate - this.yawRate) * (1 - Math.exp(-step * (6 + surface.grip * 3)));
      this.heading += this.yawRate * step * Math.min(1, Math.abs(this.speed) / 0.2);
      this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
      this.x += Math.sin(this.heading) * this.speed * step;
      this.z -= Math.cos(this.heading) * this.speed * step;

      for (const obstacle of colliders) this._resolveBox(obstacle, events);
      for (const vehicle of traffic) this._resolveCircle(vehicle, 'collision', events);
      for (const pedestrian of pedestrians) this._resolveCircle(pedestrian, 'pedestrian', events);
      const bx = clamp(this.x, -WORLD_LIMIT, WORLD_LIMIT);
      const bz = clamp(this.z, -WORLD_LIMIT, WORLD_LIMIT);
      if (bx !== this.x || bz !== this.z) {
        this._impact('collision', Math.abs(this.speed), events);
        this.speed = 0;
        this.x = bx;
        this.z = bz;
      }
      const accelerationNow = clamp((this.speed - initialSpeed) / step, -14, 10);
      this.longitudinalAcceleration += (accelerationNow - this.longitudinalAcceleration) * (1 - Math.exp(-step * 12));
      this.lateralAcceleration = this.speed * this.yawRate;
      this._suspension(step, surface);
    }
    return events;
  }

  _suspension(dt, surface) {
    const motion = Math.min(Math.abs(this.speed) / 7, 1);
    const roughness = (Math.sin(this.x * 1.7 + this.z * 0.72) + Math.sin(this.z * 2.6 - this.x * 0.63) * 0.4) * surface.bump * motion;
    const targets = {
      heave: roughness,
      pitch: clamp(this.longitudinalAcceleration * 0.009, -0.085, 0.065),
      roll: clamp(this.lateralAcceleration * 0.014, -0.115, 0.115),
    };
    for (const [axis, frequency, damping] of [['heave', 12, 0.8], ['pitch', 9, 0.78], ['roll', 8, 0.82]]) {
      const velocity = `_${axis}Velocity`;
      this[velocity] += ((targets[axis] - this[axis]) * frequency * frequency - this[velocity] * 2 * damping * frequency) * dt;
      this[axis] += this[velocity] * dt;
    }
  }

  _resolveBox(box, events) {
    if (!box || !Number.isFinite(box.x + box.z + box.hx + box.hz)) return;
    const closestX = clamp(this.x, box.x - box.hx, box.x + box.hx);
    const closestZ = clamp(this.z, box.z - box.hz, box.z + box.hz);
    let dx = this.x - closestX;
    let dz = this.z - closestZ;
    let distance = Math.hypot(dx, dz);
    if (distance >= this.radius) return;
    if (distance < 0.000001) {
      const faces = [
        {d: this.x - (box.x - box.hx), x: -1, z: 0},
        {d: box.x + box.hx - this.x, x: 1, z: 0},
        {d: this.z - (box.z - box.hz), x: 0, z: -1},
        {d: box.z + box.hz - this.z, x: 0, z: 1},
      ];
      const face = faces.reduce((a, b) => a.d < b.d ? a : b);
      dx = face.x;
      dz = face.z;
      distance = 1;
      this.x += dx * (face.d + this.radius + 0.001);
      this.z += dz * (face.d + this.radius + 0.001);
    } else {
      const overlap = this.radius - distance + 0.001;
      this.x += dx / distance * overlap;
      this.z += dz / distance * overlap;
    }
    this._respond(dx / distance, dz / distance, 'collision', events);
  }

  _resolveCircle(other, type, events) {
    if (!other || !Number.isFinite(other.x + other.z)) return;
    const dx = this.x - other.x;
    const dz = this.z - other.z;
    const minDistance = this.radius + (other.radius || (type === 'pedestrian' ? 0.5 : 2.5));
    const distance = Math.hypot(dx, dz);
    if (distance >= minDistance) return;
    const nx = distance > 0.00001 ? dx / distance : -Math.sin(this.heading);
    const nz = distance > 0.00001 ? dz / distance : Math.cos(this.heading);
    this.x += nx * (minDistance - distance + 0.001);
    this.z += nz * (minDistance - distance + 0.001);
    const otherSpeed = Number(other.speed) || 0;
    const otherHeading = Number(other.heading) || 0;
    const velocity = {
      x: Number.isFinite(other.vx) ? other.vx : Math.sin(otherHeading) * otherSpeed,
      z: Number.isFinite(other.vz) ? other.vz : -Math.cos(otherHeading) * otherSpeed,
    };
    this._respond(nx, nz, type, events, velocity);
  }

  _respond(nx, nz, type, events, otherVelocity = {x: 0, z: 0}) {
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    const closingVelocity = (fx * this.speed - otherVelocity.x) * nx + (fz * this.speed - otherVelocity.z) * nz;
    if (closingVelocity < -0.01) {
      const normalSpeed = -closingVelocity;
      this._impact(type, normalSpeed, events);
      const impulse = -closingVelocity * 1.08 * (fx * nx + fz * nz);
      // Non-player traffic keeps its own lane; cap the player's rebound instead of pushing it.
      const nextSpeed = this.speed + impulse;
      const crossesZero = this.speed !== 0 && Math.sign(nextSpeed) !== Math.sign(this.speed);
      this.speed = crossesZero ? Math.sign(nextSpeed) * Math.min(2, Math.abs(nextSpeed)) : clamp(nextSpeed, this.speed - 4, this.speed + 4);
      this.speed = clamp(this.speed, -6, 22.2);
      this.yawRate *= 0.75;
    }
  }

  _impact(type, impactSpeed, events) {
    const cooldown = type === 'pedestrian' ? '_pedestrianCooldown' : '_impactCooldown';
    if (impactSpeed < 0.6 || this[cooldown] > 0) return;
    const severity = clamp(impactSpeed / 22.2, 0.03, 1);
    this.damage = clamp(this.damage + severity * (type === 'pedestrian' ? 4 : 24), 0, 100);
    this[cooldown] = 1.2;
    events.push({type, severity, speed: impactSpeed});
  }
}

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const samePoint = (a, b) => pointDistance(a, b) < 0.001;

function roadProjection(point) {
  let best = null;
  for (const coordinate of ROAD_COORDS) {
    const choices = [
      {x: coordinate, z: clamp(point.z, -WORLD_LIMIT, WORLD_LIMIT), axis: 'z', line: coordinate},
      {x: clamp(point.x, -WORLD_LIMIT, WORLD_LIMIT), z: coordinate, axis: 'x', line: coordinate},
    ];
    for (const choice of choices) {
      const distance = pointDistance(point, choice);
      if (!best || distance < best.distance) best = {...choice, distance};
    }
  }
  return best;
}

/** GPS polyline follows the road network; perpendicular connectors retain lane positions. */
export function findRoute(start, target) {
  const from = roadProjection(start);
  const to = roadProjection(target);
  const nodes = [];
  const edges = [];
  for (const x of ROAD_COORDS) for (const z of ROAD_COORDS) nodes.push({x, z});
  nodes.push({x: from.x, z: from.z}, {x: to.x, z: to.z});
  for (let i = 0; i < nodes.length; i++) edges.push([]);
  const connect = (i, j) => {
    const distance = pointDistance(nodes[i], nodes[j]);
    edges[i].push({node: j, distance});
    edges[j].push({node: i, distance});
  };
  for (let i = 0; i < 25; i++) {
    for (let j = i + 1; j < 25; j++) {
      if (nodes[i].x === nodes[j].x || nodes[i].z === nodes[j].z) connect(i, j);
    }
    if ((from.axis === 'z' && nodes[i].x === from.line) || (from.axis === 'x' && nodes[i].z === from.line)) connect(i, 25);
    if ((to.axis === 'z' && nodes[i].x === to.line) || (to.axis === 'x' && nodes[i].z === to.line)) connect(i, 26);
  }
  if (from.axis === to.axis && from.line === to.line) connect(25, 26);
  // At an intersection both perpendicular roads are available immediately.
  for (let i = 0; i < 25; i++) {
    if (samePoint(nodes[25], nodes[i])) connect(i, 25);
    if (samePoint(nodes[26], nodes[i])) connect(i, 26);
  }
  const costs = Array(nodes.length).fill(Infinity);
  const previous = Array(nodes.length).fill(-1);
  const pending = new Set(nodes.map((_, i) => i));
  costs[25] = 0;
  while (pending.size) {
    let current = -1;
    for (const i of pending) if (current < 0 || costs[i] < costs[current]) current = i;
    if (current === 26 || costs[current] === Infinity) break;
    pending.delete(current);
    for (const edge of edges[current]) {
      const nextCost = costs[current] + edge.distance;
      if (nextCost < costs[edge.node]) {
        costs[edge.node] = nextCost;
        previous[edge.node] = current;
      }
    }
  }
  const indices = [];
  let cursor = 26;
  while (cursor !== -1) {
    indices.unshift(cursor);
    if (cursor === 25) break;
    cursor = previous[cursor];
  }
  const route = [{x: start.x, z: start.z}, ...indices.map(i => ({...nodes[i]})), {x: target.x, z: target.z}];
  return route.filter((point, i) => i === 0 || !samePoint(point, route[i - 1]));
}

export const routeLength = route => route.slice(1).reduce((sum, point, i) => sum + pointDistance(point, route[i]), 0);

export function distanceToRoute(point, route) {
  if (route.length === 1) return pointDistance(point, route[0]);
  let nearest = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t));
  }
  return nearest;
}

export const JOBS = Object.freeze([
  {
    id: 'chai-run', type: 'Food delivery', title: 'The afternoon chai run',
    description: 'Collect fresh chai and snacks from Chai Corner. Deliver them to the station staff.',
    pickup: {name: 'Chai Corner', x: -5, z: -40},
    dropoff: {name: 'Surya Nagar Station', x: 155, z: -235}, reward: 320,
  },
  {
    id: 'market-parcel', type: 'Courier', title: 'A parcel across town',
    description: 'Pick up a parcel at Sadar Market and take it to the clinic reception.',
    pickup: {name: 'Sadar Market', x: -165, z: -80},
    dropoff: {name: 'City Care Clinic', x: -5, z: -270}, reward: 420,
  },
  {
    id: 'grocery-run', type: 'Grocery delivery', title: 'Everyday essentials',
    description: 'Collect the grocery order from Annapurna Stores and drop it at Lakeview Apartments.',
    pickup: {name: 'Annapurna Stores', x: 75, z: 165},
    dropoff: {name: 'Lakeview Apartments', x: 315, z: 85}, reward: 480,
  },
  {
    id: 'airport-cargo', type: 'Airport logistics', title: 'Airport cargo transfer',
    description: 'Report at the airport cargo gate, verify the manifest, then take the sealed consignment to the station parcel office.',
    pickup: {name: 'Navapur Airport · Cargo Gate', x: 235, z: -325},
    dropoff: {name: 'Surya Nagar Station · Parcel Office', x: 155, z: -235},
    reward: 560, serviceSeconds: 3, workLabel: 'Checking cargo manifest',
  },
  {
    id: 'station-parcels', type: 'Station courier', title: 'The morning parcel round',
    description: 'Collect the signed parcel bag at the station office and hand it to the Sadar Market dispatch clerk.',
    pickup: {name: 'Surya Nagar Station · Parcel Office', x: 155, z: -235},
    dropoff: {name: 'Sadar Market · Dispatch Office', x: -165, z: -80},
    reward: 510, serviceSeconds: 2.5, workLabel: 'Signing the parcel register',
  },
  {
    id: 'residential-technician', type: 'Residential maintenance', title: 'An apartment service call',
    description: 'Pick up the service kit at the utilities depot. Drive to Lakeview Apartments and complete a short maintenance visit.',
    pickup: {name: 'Navapur Utilities · Service Depot', x: -5, z: 235},
    dropoff: {name: 'Lakeview Apartments · Reception', x: 315, z: 85},
    reward: 640, serviceSeconds: 4, workLabel: 'Completing the service visit',
  },
]);
