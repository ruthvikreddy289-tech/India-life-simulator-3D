# Verification

Final source: six glTF architecture archetypes with high/medium LODs, three car LODs, animated citizens, parked vehicles, street furniture, coordinated signals, curve-aware traffic, and curb-crossing rules.

- `npm test`: all four test files pass (asset validation, touch input, driving/suspension/GPS/jobs, and traffic rules).
- JavaScript syntax checks pass for the game and world modules.
- Desktop and 1024×768 touch Chromium interaction checks passed for circular steering with simultaneous pedals, reverse interlocks, handbrake, horn, cameras, settings, pause, job pickup/payment, save restoration, repair, and recovery. These interaction checks ran before the final world-variety additions; the controls/save/economy code remains unchanged in that pass.
- Workplace integration passed timed pickups/deliveries, cancellation on leaving, restart, payouts, and completed-job counts.
- Actual assets/shaders were rendered and captured in the browser. Interaction tests then suppressed GPU raster calls to keep software rendering practical; they used real DOM/pointer input and game simulation, and do not establish graphics performance.
- The software renderer measured about 0.8–1 FPS in the earlier detailed scene. This is not physical iPad performance. The final additions have static/logic validation, but a complete final visual/device regression is outstanding.
- Physical iPad Safari testing and a sustained 30 FPS result are NOT verified. A WebKit browser was downloaded for an engine test, but that test was not completed. Test on the target iPad before treating this as a production-ready Safari release.

Run locally with `npm start` or `python3 -m http.server 8765 --directory dist`. Use the same origin to retain the existing `india-life-navapur-v1` save. Set Graphics to Low for older devices. Asset attribution is in `dist/assets/CREDITS.md`.
