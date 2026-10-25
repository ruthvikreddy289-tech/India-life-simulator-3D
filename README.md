# India Life Simulator 3D

Drive and work in **Navapur**, a fictional Indian coastal city. This release includes left-side traffic on curved paths, animated pedestrians, collisions, road-following GPS, six paid jobs, a saved wallet, and chase, interior, and city cameras.

## Run

From this project directory:

```sh
python3 -m http.server 8765 --directory dist
```

Open **http://localhost:8765** on that computer. On an iPad using the same Wi-Fi network, open `http://<computer-LAN-IP>:8765` in Safari; the computer's firewall must allow the connection. Static hosting should serve the contents of `dist/` over HTTPS.

Use HTTP or HTTPS: Safari cannot load this project's JavaScript modules correctly through `file://`. Three.js, models, textures, and lighting assets are bundled locally. There are no runtime CDN, font, API, or account dependencies. Loading still requires the served files; this release has no service worker or guaranteed offline cache.

## Drive and work

Use a recent Safari on iPadOS 16 or newer with WebGL 2 available. Landscape is recommended. Physical iPad Safari testing and a measured device performance guarantee are still outstanding.

- Drag around the steering wheel's rim to turn, up to 135° each way. Release to center it. Separate pointer capture lets another finger hold a pedal while steering.
- Hold the accelerator to drive, release to coast, and hold the brake to stop. Stop before holding **R / Reverse** to back up. Stop again before using the accelerator to return to drive. Explicit **D** and **R** gear buttons remain available.
- Use **Camera** to switch among chase, interior, and city views. Horn and handbrake have separate controls.
- Choose **Find a job**, accept work, and follow the saffron GPS route. Stop inside the pickup/delivery marker and press the action button. The original chai, parcel, and grocery deliveries are joined by airport cargo, station parcels, and residential maintenance work. Workplace actions require staying parked for **2.5–4 seconds**; completion pays the listed reward.

| Keyboard action | Keys |
| --- | --- |
| Accelerate / brake | W / S or Up / Down arrows |
| Steer | A / D or Left / Right arrows |
| Change drive / reverse | R, while stopped |
| Hold handbrake | Space |
| Pickup / work / delivery | E |
| Horn / camera | H / C |
| Pause / resume | Escape |

If stuck, use **Settings → Return car to the road**. **Reset saved progress** starts over. Asset credits and licenses are linked from Settings.

## Graphics and scope

The detailed core district uses six original authored glTF architecture types—corner shop, heritage shop, apartment, and station—with four reduced medium-detail variants. The Blender generator is [`tools/build-district.py`](tools/build-district.py). Beaches, airport, railway/station, and residential areas extend the map with lighter outer-area detail. This is a focused district, not a fully photorealistic city or a reproduction of a real place.

Licensed assets include Eric Chadwick / Darmstadt Graphics Group's **Car Concept** (CC BY 4.0), **Cesium Man** animated pedestrians (CC BY 4.0), and photographed **Poly Haven** PBR surfaces and image-based lighting (CC0). Vehicle asset variants contain approximately **75,000 / 22,000 / 6,700 triangles**. Up to six nearby pedestrians use pooled animated characters. Sources, modifications, attribution, and license terms are in [`dist/assets/CREDITS.md`](dist/assets/CREDITS.md).

Rendering targets about **30 FPS** with a frame cap and adaptive pixel ratio, which can fall to **0.75**. Medium uses 1024-pixel shadows; Low disables shadows and reduces detail. Select **Settings → Graphics quality → Low** for older iPads. These are rendering budgets, not a guaranteed frame rate; model, temperature, browser, and scene complexity affect performance.

Driving and workplace interactions remain game simulations. Player walking, enterable workplace interiors, homes/property ownership, buying cars, multiplayer, and a full life/career simulation are outside this release. GPS provides in-game directions only.

## Saves

The upgrade preserves the existing **v1 save key and format** (`india-life-navapur-v1`), including wallet, completed-job count, supported active jobs, vehicle state, and preferences. Storage is local to this browser and site origin; there is no cloud sync. Private browsing, blocked storage, clearing website data, or changing the site address may remove or separate saves. An interrupted workplace timer must be started again.

## Source and checks

- `dist/index.html`, `styles.css` — interface and responsive HUD.
- `dist/game.js`, `controls.js`, `simulation.js` — rendering/integration, multitouch input, physics, routes, and jobs.
- `dist/world.js`, `district-layout.js`, `vehicle.js`, `characters.js` — city, vehicle, and character systems.
- `dist/assets/`, `dist/vendor/` — bundled art and renderer dependencies with license records.
- `tools/` — asset fetch and Blender generation/LOD scripts; not needed to play.

Run **`npm test`** for simulation, multitouch-control, and asset validation tests. Browser smoke testing is separate (`tests/browser-smoke.mjs`) and currently uses environment-specific Chromium/Playwright paths. Final upgrade browser verification is pending; Chromium emulation does not establish physical iPad Safari compatibility or performance.

City life update: distinct office and hotel glTFs, per-building facade colors and dimensions, 14 parked glTF cars with collision bounds, 18 compound trees/palms with foliage LODs, additional shopfront signs, benches, vendors and utility wires. Four-direction signal heads share the red/amber/green phases used by vehicle path rules; vehicles sweep their route for traffic, people and obstacles, while walkers wait at curbs.
