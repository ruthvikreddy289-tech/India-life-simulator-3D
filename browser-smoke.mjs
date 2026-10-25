// Run against a local static server: node tests/browser-smoke.mjs [http://127.0.0.1:8765]
// Chromium emulates iPad viewport and touch; this does not substitute for physical Safari QA.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const baseURL = process.argv[2] || 'http://127.0.0.1:8765';
const screenshotPath = new URL('../qa/', import.meta.url).pathname;
await mkdir(screenshotPath, {recursive: true});
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
    '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const errors = [];
const results = [];
const performanceResults = [];
const screenshotResults = [];
let screenshotsUnavailable = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function capture(page, name) {
  if (await page.evaluate(() => !!window.__qaRasterSuppressed)) {
    screenshotResults.push({name, saved: false, error: 'Visual capture skipped: GPU raster suppressed for interaction-only QA'});
    return;
  }
  if (screenshotsUnavailable) {
    screenshotResults.push({name, saved: false, error: 'Skipped after an earlier compositor timeout'});
    return;
  }
  let paused = false;
  try {
    // Freeze RAF while the software GPU composites the frame. Resume real time for controls/FPS.
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 50)));
    paused = true;
    await page.screenshot({path: `${screenshotPath}${name}.png`, timeout: 60000, animations: 'disabled'});
    screenshotResults.push({name, saved: true});
  } catch (error) {
    screenshotsUnavailable = true;
    screenshotResults.push({name, saved: false, error: error.message.split('\n')[0]});
    console.warn(`${name}: screenshot unavailable (${error.message.split('\n')[0]}). Continuing functional checks.`);
  } finally {
    if (paused) await page.clock.resume();
  }
}

async function disableRasterForInteractionQA(page) {
  // Asset loading, shaders, the initial image, and FPS are exercised with real draw calls first.
  // SwiftShader is too slow for sustained input tests; preserve the DOM/RAF/simulation while
  // suppressing subsequent GPU geometry work. No performance or visual claim uses this phase.
  const methods = await page.evaluate(() => {
    let count = 0;
    for (const type of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      const prototype = window[type]?.prototype;
      if (!prototype) continue;
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        if (typeof prototype[name] !== 'function') continue;
        Object.defineProperty(prototype, name, {configurable: true, writable: true, value() {}});
        count++;
      }
    }
    window.__qaRasterSuppressed = true;
    return count;
  });
  assert.ok(methods >= 4, 'interaction QA suppresses GPU raster calls after real rendering verification');
  console.log('Interaction-only phase: GPU draws suppressed; real DOM, multitouch, vehicle animation state, physics, jobs, and saves continue. FPS evidence above uses real drawing.');
}

async function waitSim(page, seconds) {
  const start = await page.evaluate(() => window.indiaLife.state.elapsed);
  try {
    await page.waitForFunction(target => window.indiaLife.state.elapsed >= target,
      start + seconds, {timeout: 30000, polling: 50});
  } catch (error) {
    console.error('Simulation stalled:', await page.evaluate(() => ({...window.indiaLife.state,
      hidden: document.hidden, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id)})));
    throw error;
  }
}

async function waitSpeed(page, predicate) {
  await page.waitForFunction(predicate, null, {timeout: 30000, polling: 50});
}

async function snapshot(page) {
  return page.evaluate(() => {
    const {player, state, route} = window.indiaLife;
    return {x: player.x, z: player.z, speed: player.speed, heading: player.heading, gear: player.gear,
      paused: state.paused, started: state.started, wallet: state.wallet, completed: state.completed,
      job: state.job?.id, stage: state.stage, routeLength: route.length, elapsed: state.elapsed};
  });
}

async function touchPoints(page, ids) {
  return Promise.all(ids.map(async (selector, i) => {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, `${selector} has a touch target`);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2, id: i + 1, radiusX: 5, radiusY: 5, force: 1};
  }));
}

async function checkLayout(page, label) {
  const outside = await page.evaluate(() => {
    const ids = ['brake', 'accelerator', 'reverse-pedal', 'steering-wheel', 'pause-button', 'jobs-button'];
    return ids.filter(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.width < 35 || r.height < 35;
    });
  });
  assert.deepEqual(outside, [], `${label}: primary controls remain on screen with usable targets`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
}

try {
  // A separate saved-game fixture proves the v1 storage contract survives asset/physics upgrades.
  const fixtureContext = await browser.newContext({viewport: {width: 1024, height: 768}});
  await fixtureContext.addInitScript(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    const key = 'india-life-navapur-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      version: 1, wallet: 4321, completed: 7, jobId: 'chai-run', stage: 'pickup', sound: false,
      quality: 'low', elapsed: 125, car: {x: -5, z: 55, heading: 0, damage: 12},
    }));
  });
  const fixturePage = await fixtureContext.newPage();
  fixturePage.on('pageerror', error => errors.push(`saved fixture: ${error.message}`));
  await fixturePage.goto(baseURL, {waitUntil: 'networkidle'});
  await fixturePage.waitForFunction(() => !!window.indiaLife, null, {timeout: 60000});
  await disableRasterForInteractionQA(fixturePage);
  const restored = await snapshot(fixturePage);
  assert.equal(restored.wallet, 4321, 'v1 wallet survives upgrade');
  assert.equal(restored.completed, 7, 'v1 completed jobs survive upgrade');
  assert.equal(restored.job, 'chai-run', 'v1 active delivery survives upgrade');
  assert.equal(restored.stage, 'pickup');
  assert.equal(restored.x, -5);assert.equal(restored.z, 55);
  assert.equal(await fixturePage.evaluate(() => window.indiaLife.player.damage), 12);
  await fixturePage.locator('#start-button').click();
  await fixturePage.locator('#settings-button').click();
  await fixturePage.locator('#repair-car').click();
  assert.equal((await snapshot(fixturePage)).wallet, 4171, 'repair charges the displayed ₹150');
  assert.equal(await fixturePage.evaluate(() => window.indiaLife.player.damage), 0, 'repair restores condition');
  await fixturePage.locator('#repair-car').click();
  assert.equal((await snapshot(fixturePage)).wallet, 4171, 'repairing a healthy car has no charge');
  await fixturePage.evaluate(() => Object.assign(window.indiaLife.player, {x: 75, z: 75, speed: 8}));
  await fixturePage.locator('#reset-car').click();
  const recovered = await snapshot(fixturePage);
  assert.ok([-320, -160, 0, 160, 320].some(r => Math.abs(Math.abs(recovered.x - r) - 5) < 0.1 || Math.abs(Math.abs(recovered.z - r) - 5) < 0.1), 'recovery returns car to a traffic lane');
  assert.equal(recovered.speed, 0, 'recovery stops the vehicle');
  await fixturePage.locator('#settings-button').click();
  await fixturePage.locator('#reset-progress').click();
  assert.equal((await snapshot(fixturePage)).wallet, 4171, 'first reset tap preserves progress');
  assert.equal((await snapshot(fixturePage)).completed, 7, 'first reset tap preserves completed jobs');
  assert.match(await fixturePage.locator('#reset-progress').textContent(), /again/i, 'reset requires a second explicit tap');
  await fixturePage.locator('#reset-progress').click();
  const reset = await snapshot(fixturePage);
  assert.equal(reset.wallet, 1250);assert.equal(reset.completed, 0);assert.equal(reset.job, undefined);
  await fixtureContext.close();
  console.log('Saved v1 fixture restored; repair, road recovery, and two-step progress reset passed');

  for (const profile of [
    {name: 'desktop', viewport: {width: 1440, height: 900}, hasTouch: false},
    {name: 'ipad-landscape', viewport: {width: 1024, height: 768}, hasTouch: true},
  ]) {
    const context = await browser.newContext({...profile, deviceScaleFactor: 1});
    await context.addInitScript(() => {
      window.__qaHornSchedules = 0;
      if (typeof AudioParam !== 'undefined') {
        const original = AudioParam.prototype.setValueAtTime;
        AudioParam.prototype.setValueAtTime = function(value, ...args) {
          if (Math.abs(value - 0.028) < 0.00001) window.__qaHornSchedules++;
          return original.call(this, value, ...args);
        };
      }
    });
    const page = await context.newPage();
    // Install before navigation so the game's RAF timestamps share the same clock origin.
    await page.clock.install({time: new Date()});
    page.on('pageerror', error => errors.push(`${profile.name}: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error' && !/favicon/.test(message.text() + message.location().url)) errors.push(`${profile.name}: ${message.text()}`);
    });
    await page.goto(baseURL, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => !!window.indiaLife, null, {timeout: 60000});
    await page.locator('#loading').waitFor({state: 'hidden'});
    assert.deepEqual(errors, [], `${profile.name}: no boot/module errors`);
    await page.waitForFunction(() => window.indiaLife.vehicle?.loadedAsset, null, {timeout: 60000});
    assert.equal(await page.evaluate(() => window.indiaLife.vehicle.wheelPivots.length), 4, 'glTF vehicle exposes four independently animated wheels');
    assert.ok(await page.evaluate(() => !!window.indiaLife.vehicle.body), 'glTF vehicle exposes suspended body');
    await capture(page, `${profile.name}-welcome`);
    await page.locator('#start-button').click();
    console.log(`${profile.name}: started; checking traffic and controls`);
    assert.equal((await snapshot(page)).started, true, 'Start enters playable game');
    await checkLayout(page, profile.name);
    const beforeTraffic = await page.evaluate(() => window.indiaLife.world.traffic.slice(0, 8).map(v => [v.x, v.z]));
    await waitSim(page, 0.15);
    const afterTraffic = await page.evaluate(() => window.indiaLife.world.traffic.slice(0, 8).map(v => [v.x, v.z]));
    assert.notDeepEqual(afterTraffic, beforeTraffic, 'traffic moves during play');

    const performanceSample = await page.evaluate(() => new Promise(resolve => {
      let frames = 0;
      const started = performance.now();
      function measure(now) {
        frames++;
        if (now - started < 2000) {requestAnimationFrame(measure);return;}
        const sim = window.indiaLife;
        resolve({fps: Number((frames * 1000 / (now - started)).toFixed(1)),
          calls: sim.renderInfo?.render.calls, triangles: sim.renderInfo?.render.triangles,
          vehicleMetrics: sim.vehicle.metrics, hardware: 'headless Chromium / SwiftShader software renderer'});
      }
      requestAnimationFrame(measure);
    }));
    performanceResults.push({profile: profile.name, ...performanceSample});
    console.log(`${profile.name}: measured ${performanceSample.fps}fps, ${performanceSample.calls}draws, ${performanceSample.triangles}triangles; 30fps target ${performanceSample.fps >= 30 ? 'met in this environment' : 'not met in software rendering'}`);
    await disableRasterForInteractionQA(page);

    for (const label of ['Interior camera', 'City camera', 'Chase camera']) {
      await page.locator('#camera-button').click();
      assert.equal(await page.locator('#toast').textContent(), label, 'camera button cycles all three views');
    }
    const hornBefore = await page.evaluate(() => window.__qaHornSchedules);
    await page.locator('#horn').click();
    assert.ok(await page.evaluate(before => window.__qaHornSchedules > before, hornBefore), 'horn schedules its Web Audio tone');
    await page.locator('#settings-button').click();
    await page.locator('#sound-toggle').uncheck();
    assert.equal(await page.evaluate(() => window.indiaLife.state.sound), false, 'sound toggle mutes city sounds');
    await page.locator('#sound-toggle').check();
    assert.equal(await page.evaluate(() => window.indiaLife.state.sound), true, 'sound toggle restores city sounds');
    await page.locator('#quality-select').selectOption('low');
    assert.equal(await page.evaluate(() => window.indiaLife.state.quality), 'low', 'graphics selector applies low quality');
    const settingsSave = await page.evaluate(() => JSON.parse(localStorage.getItem('india-life-navapur-v1')));
    assert.equal(settingsSave.sound, true);assert.equal(settingsSave.quality, 'low');
    await page.locator('#settings-close').click();
    assert.deepEqual(errors, [], `${profile.name}: camera, horn, and settings produce no runtime errors`);

    // Browser-generated input checks pointer capture, independent pedals, and steering.
    if (profile.hasTouch) {
      const cdp = await context.newCDPSession(page);
      const touches = await touchPoints(page, ['#accelerator', '#steering-wheel']);
      const wheelBox = await page.locator('#steering-wheel').boundingBox();
      touches[1].y -= wheelBox.height * 0.33;
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: touches});
      touches[1].x += wheelBox.width * 0.33;touches[1].y += wheelBox.height * 0.33;
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: touches});
      await waitSpeed(page, () => window.indiaLife.player.speed > 2 && window.indiaLife.player.heading > 0.05);
      const accelerating = await snapshot(page);
      assert.ok(accelerating.speed > 1, 'touch accelerator drives the car');
      assert.ok(accelerating.heading > 0.05, 'second simultaneous touch drags the wheel and steers');
      assert.ok(Number(await page.locator('#steering-wheel').getAttribute('aria-valuenow')) > 25, 'wheel slider reflects proportional drag');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      // Touching reverse while moving must leave the transmission in drive.
      const reverse = await touchPoints(page, ['#reverse-pedal']);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: reverse});
      assert.equal((await snapshot(page)).gear, 'D', 'reverse pedal rejects a direction change in motion');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      const pedals = await touchPoints(page, ['#accelerator', '#brake']);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: pedals});
      await waitSpeed(page, () => Math.abs(window.indiaLife.player.speed) < 0.1);
      assert.ok(Math.abs((await snapshot(page)).speed) < 0.1, 'brake wins when both touch pedals are held');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: reverse});
      await waitSpeed(page, () => window.indiaLife.player.speed < -1);
      assert.equal((await snapshot(page)).gear, 'R', 'reverse pedal selects reverse at rest and drives backward');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      const accelerator = await touchPoints(page, ['#accelerator']);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: accelerator});
      assert.equal((await snapshot(page)).gear, 'R', 'accelerator rejects drive while reversing');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: await touchPoints(page, ['#brake'])});
      await waitSpeed(page, () => Math.abs(window.indiaLife.player.speed) < 0.1);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: accelerator});
      await waitSpeed(page, () => window.indiaLife.player.speed > 1);
      assert.equal((await snapshot(page)).gear, 'D', 'accelerator selects drive once stopped');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
      assert.equal(await page.locator('#accelerator').getAttribute('aria-pressed'), 'false', 'pointer cancellation releases the accelerator');
      assert.equal(await page.locator('#reverse-pedal').getAttribute('aria-pressed'), 'false', 'reverse pedal remains released');
      await page.keyboard.down('s');
      await waitSpeed(page, () => Math.abs(window.indiaLife.player.speed) < 0.1);
      await page.keyboard.up('s');
    } else {
      await page.keyboard.down('w');
      await waitSpeed(page, () => window.indiaLife.player.speed > 2);
      const accelerating = await snapshot(page);
      assert.ok(accelerating.speed > 1, 'keyboard accelerator drives the car');
      await page.locator('#gear-reverse').click();
      assert.equal((await snapshot(page)).gear, 'D', 'reverse interlock refuses gear change while moving');
      await page.keyboard.up('w');
      await page.keyboard.down('s');
      await waitSpeed(page, () => Math.abs(window.indiaLife.player.speed) < 0.1);
      await page.keyboard.up('s');
      assert.ok(Math.abs((await snapshot(page)).speed) < 0.1, 'keyboard service brake stops without reversing');
    }

    await page.locator('#gear-reverse').click();
    assert.equal((await snapshot(page)).gear, 'R', 'reverse selects when stopped');
    await page.locator('#gear-drive').click();
    // Exercise the visible handbrake control with actual captured pointer input.
    await page.evaluate(() => {window.indiaLife.player.speed = 3;});
    const handbrake = await page.locator('#handbrake').boundingBox();
    await page.mouse.move(handbrake.x + handbrake.width / 2, handbrake.y + handbrake.height / 2);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.indiaLife.controls.held.handbrake), 1, 'handbrake button captures its pointer');
    await waitSpeed(page, () => Math.abs(window.indiaLife.player.speed) < 0.1);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.indiaLife.controls.held.handbrake), 0, 'handbrake releases when its pointer lifts');
    await page.keyboard.down('w');
    await waitSpeed(page, () => window.indiaLife.player.speed > 1);
    await page.keyboard.press('Escape');
    assert.equal((await snapshot(page)).paused, true, 'pause button/escape pauses');
    const paused = await snapshot(page);
    await delay(250);
    assert.equal((await snapshot(page)).z, paused.z, 'paused car does not move');
    await page.locator('#resume-button').click();
    await waitSim(page, 0.8);
    // Allow the short physical throttle ramp to decay; a held input would add >2m/s.
    assert.ok((await snapshot(page)).speed <= paused.speed + 0.65, 'pause releases held accelerator input');
    await page.keyboard.up('w');
    await page.keyboard.down('s');
    await waitSpeed(page, () => Math.abs(window.indiaLife.player.speed) < 0.1);
    await page.keyboard.up('s');

    await page.locator('#jobs-button').click();
    console.log(`${profile.name}: controls passed; checking jobs and saving`);
    await page.locator('#jobs-dialog').waitFor({state: 'visible'});
    assert.equal(await page.locator('#jobs-list button').count(), 6, 'job board has six working offers, including workplace jobs');
    await page.locator('#jobs-list button').first().click();
    let state = await snapshot(page);
    assert.equal(state.job, 'chai-run', 'job selection accepts offer');
    assert.equal(state.stage, 'pickup');
    assert.ok(state.routeLength > 1, 'job selection creates GPS route');
    await page.locator('#job-panel').waitFor({state: 'visible'});
    const walletBefore = state.wallet;
    const completedBefore = state.completed;
    await page.evaluate(() => {
      const sim = window.indiaLife;
      Object.assign(sim.player, {x: sim.state.job.pickup.x, z: sim.state.job.pickup.z, speed: 0});
      sim.interact();
    });
    assert.equal((await snapshot(page)).stage, 'dropoff', 'stopped pickup advances delivery and GPS');
    await page.evaluate(() => {
      const sim = window.indiaLife;
      Object.assign(sim.player, {x: sim.state.job.dropoff.x, z: sim.state.job.dropoff.z, speed: 0});
      sim.interact();
    });
    state = await snapshot(page);
    assert.equal(state.job, undefined, 'delivery completes active job');
    assert.equal(state.wallet, walletBefore + 320, 'delivery earns displayed rupee reward');
    assert.equal(state.completed, completedBefore + 1, 'completed job count increments');
    await capture(page, `${profile.name}-game`);

    if (profile.hasTouch) {
      await page.setViewportSize({width: 768, height: 1024});
      await delay(300);
      await checkLayout(page, 'ipad-portrait');
      await capture(page, 'ipad-portrait-game');
    }
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForFunction(() => !!window.indiaLife);
    assert.equal((await snapshot(page)).wallet, state.wallet, 'earned wallet survives reload');
    assert.equal((await snapshot(page)).completed, state.completed, 'completed jobs survive reload');
    results.push(`${profile.name}: controls, traffic, gear interlock, pause, job GPS, pickup/dropoff, money, persistence, responsive layout passed`);
    await context.close();
  }
  assert.deepEqual(errors, [], 'no runtime/module/render errors');
  console.log(results.join('\n'));
  console.log('Performance evidence:', JSON.stringify(performanceResults));
  console.log('Screenshot evidence:', JSON.stringify(screenshotResults));
  console.log(`Screenshots: ${screenshotPath}`);
} finally {
  await browser.close();
}
