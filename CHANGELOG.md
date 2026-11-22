# Changelog

## 2026-11-22 — Klax: After Hours
- Fix Right being dispatched as rotation, which crashed Klax and stopped the animation loop.
- Add WASD and Enter gameplay bindings, canvas lane selection, empty-stack feedback and focus-pause recovery.
- Replace the flat Klax view with an instanced 3D WebGL cabinet, beveled tumbling tiles, shadows, bloom, animated drops, landing preview and match particles.
- Enlarge the phone playfield, show keyboard hints, and add tile pips.
- Version the changed browser entry modules so existing visitors receive the control fix.


## 2026-11-22 — Classic arcade variants
- Add a Klax-style tile ramp with catch/stack/drop/toss, four matching directions, gravity cascades, wave progression and miss limits.
- Add a Blockout-style true 3D voxel pit with three-axis rotation, collision checks, ghost landing positions, complete-layer clearing and top-out.
- Add dedicated mobile controls with separated rotation and hard-drop zones, keyboard/gamepad inputs, pause/restart, and per-mode local records.
- Add direct links for both modes and cache their modules for offline use.


## 2026-11-22 — Driving and job return
- Start free driving on a flat road facing the city rather than across a curved mountain road.
- Replace excessive uphill damping with bounded slope gravity.
- Park at the exact job-entry position; stop moving the car backwards at markers.
- Clear eight lines to finish a driving job; automatically resume driving after success or a busted stack.
- Preserve driving pose, camera, wanted level and pickups across jobs.

## 2026-11-22
- Fixed lingering phone-call messages; expire calls independently of mission progress.
- Clear overlays on mode changes and replace banners instead of stacking them.
- Separate rotate controls from hard drop with a labelled drop zone.
- Add Midnight Getaway: three radar checkpoints, 90 seconds, $1,500 reward.
- Add Revolutions 3D: line clears trigger a full camera revolution, with falling and input held until the turn ends.
