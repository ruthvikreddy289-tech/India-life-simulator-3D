// Standalone integration QA for timed workplace jobs. Requires a running local static server.
// The initial glTF/shader boot uses real rendering; subsequent interaction QA suppresses GPU draws.
import assert from 'node:assert/strict';
import {chromium} from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});
const errors = [];
try {
  const context = await browser.newContext({viewport: {width: 1024, height: 768}});
  await context.addInitScript(() => {
    if (!/^https?:$/.test(location.protocol)) return;
    localStorage.setItem('india-life-navapur-v1', JSON.stringify({version: 1, wallet: 1250, completed: 0,
      sound: false, quality: 'low', car: {x: -5, z: 55, heading: 0, damage: 0}}));
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon/.test(message.text() + message.location().url)) errors.push(message.text());
  });
  await page.goto(process.argv[2] || 'http://127.0.0.1:8765', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.indiaLife?.vehicle?.loadedAsset, null, {timeout: 60000});
  assert.deepEqual(errors, [], 'real model/shader startup has no runtime errors');
  await page.evaluate(() => {
    for (const type of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      const prototype = window[type]?.prototype;
      if (!prototype) continue;
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        if (typeof prototype[name] === 'function') Object.defineProperty(prototype, name, {configurable: true, writable: true, value() {}});
      }
    }
  });
  await page.locator('#start-button').click();
  const snapshot = () => page.evaluate(() => ({job: window.indiaLife.state.job?.id,
    stage: window.indiaLife.state.stage, wallet: window.indiaLife.state.wallet,
    completed: window.indiaLife.state.completed, elapsed: window.indiaLife.state.elapsed}));
  const interactAt = stage => page.evaluate(which => {
    const sim = window.indiaLife;
    const target = sim.state.job[which];
    Object.assign(sim.player, {x: target.x, z: target.z, speed: 0});
    sim.interact();
  }, stage);
  const waitStage = stage => page.waitForFunction(expected => window.indiaLife.state.stage === expected,
    stage, {timeout: 30000, polling: 50});
  const waitCompleted = count => page.waitForFunction(expected => window.indiaLife.state.completed === expected,
    count, {timeout: 30000, polling: 50});

  await page.evaluate(() => window.indiaLife.acceptJob('airport-cargo'));
  const beforeCargo = await snapshot();
  await interactAt('pickup');
  assert.equal((await snapshot()).stage, 'pickup', 'cargo collection requires a timed service visit');
  assert.equal((await snapshot()).wallet, beforeCargo.wallet, 'starting work does not pay immediately');
  await waitStage('dropoff');
  const cargoCollected = await snapshot();
  assert.ok(cargoCollected.elapsed - beforeCargo.elapsed >= 2.8, 'cargo manifest work occupies approximately three simulation seconds');
  await interactAt('dropoff');
  assert.equal((await snapshot()).job, 'airport-cargo', 'cargo handoff also takes time');
  await waitCompleted(1);
  assert.equal((await snapshot()).wallet, 1810, 'airport delivery pays ₹560 after its final service visit');

  await page.evaluate(() => window.indiaLife.acceptJob('station-parcels'));
  await interactAt('pickup');
  const beforeLeaving = await snapshot();
  await page.evaluate(() => {window.indiaLife.player.z += 30;});
  await page.waitForFunction(start => window.indiaLife.state.elapsed > start + 0.3,
    beforeLeaving.elapsed, {timeout: 30000, polling: 50});
  assert.equal((await snapshot()).stage, 'pickup', 'leaving the marker does not complete workplace service');
  assert.equal((await snapshot()).wallet, 1810, 'interrupted work has no payment');
  await interactAt('pickup');
  const restarted = await snapshot();
  await waitStage('dropoff');
  assert.ok((await snapshot()).elapsed - restarted.elapsed >= 2.3, 'returning to work requires the full station service duration');
  await interactAt('dropoff');
  await waitCompleted(2);
  const finished = await snapshot();
  assert.equal(finished.wallet, 2320, 'station delivery pays ₹510');
  assert.equal(finished.job, undefined, 'completed workplace job clears the active offer');
  assert.deepEqual(errors, [], 'workplace interactions have no runtime errors');
  console.log('Workplace integration passed: airport manifest/loading dwell, timed delivery, leaving cancels work, returning restarts full dwell, ₹560+₹510 rewards and two completed jobs.');
  console.log('Interaction phase suppressed GPU raster after actual asset/shader startup; this test makes no FPS or visual claim.');
  await context.close();
} finally {
  await browser.close();
}
