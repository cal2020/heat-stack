# HEAT STACK

An original falling-block game set in a ray-traced neon city. You stack and clear lines, build **heat**, grab **cash**, survive the **pursuit** and pull off the **getaway**. Everything is plain web standards, with no build step and no dependencies, so it runs the same way on a Mac, Android, any modern browser and a Raspberry Pi.

## Run it

```bash
python3 scripts/serve.py            # http://127.0.0.1:8137
python3 scripts/serve.py 8137 --lan # let phones / a Pi on your Wi-Fi connect
```

| Platform | How |
| --- | --- |
| **Mac** | Open it in Safari or Chrome. Safari: File › Add to Dock. Chrome: Install app. It runs full screen and offline. |
| **Android** | Open the LAN URL in Chrome, then choose **Install app**. Use touch gestures or the on-screen pad. Haptics work. |
| **Raspberry Pi 4/5** | `./scripts/pi-kiosk.sh` starts the server and Chromium in kiosk mode. On slow hardware the game lowers its own quality, down to Canvas 2D. |
| **Any browser** | Open the URL. A gamepad, keyboard or touch screen all work. |

Install and offline use need a secure context (`localhost`, or HTTPS when hosted).

## What makes it different

- **Heat (0–5★).** Quads, T-spins, combos, back-to-backs, perfect clears and cash grabs build heat. Each star multiplies score by +30% and speeds gravity. At 3★ a pursuit meter starts raising roadblock rows. At 5★ a **GETAWAY** begins: clear 6 lines in 25 seconds to escape with a large bonus. Going quiet for 8 seconds cools the heat.
- **Cash and districts.** Some pieces carry a gold **$** mino. Clear its row to grab the cash. The amount you bank depends on how the run ends (100% for a rival win, 75% if you escaped, 50% if busted). Spend it to unlock five districts, each with its own block palette, skyline tint and accent colour.
- **Crew Rival.** An AI opponent plays the same seed in a **Web Worker** and trades garbage with you. It reacts to your emotes. There are three skill levels.
- **Crew emotions.** Your crewmate reacts to what happens in the run: hype, smug, nervous, shocked, angry, mind-blown, party or busted. Four emotes are on keys 1–4 or the emote buttons.
- **Social.** **Daily Heist** gives everyone the same daily seed. **Challenge links** carry your seed and score timeline, so a friend races your live **ghost** on identical pieces. **Photo mode** shares a branded screenshot through the Web Share API.

## Rendering engines

| Engine | Technique |
| --- | --- |
| **WebGPU** (WGSL) | Real ray tracing of the board's voxel grid using a DDA traversal. It casts a primary ray, a shadow ray toward the key light, and one reflection bounce. The procedural night city has two parallax skyline layers, plus sirens that follow the heat level. |
| **WebGL2** (GLSL ES 3.0) | The same tracer ported to GLSL, for browsers without WebGPU. |
| **Canvas 2D** | Cached bevelled block sprites and a pre-rendered city. Built for the Raspberry Pi and other low-power devices. |

**Auto** picks the best available engine. The adaptive governor then trades ray-tracing quality (reflections → shadows → primary only), then render scale, and finally falls back to Canvas 2D to hold the frame rate. You can override all of this in Settings.

## Platform tech used

ES modules, WebGPU, WebGL2, a module Web Worker, Web Audio (a synthesised adaptive soundtrack whose layers follow the heat), the Gamepad API (standard mapping plus rumble), Pointer Events gestures, the Vibration API, the Screen Wake Lock API, the Web Share API with files, a Service Worker for offline play, a Web App Manifest, and `prefers-reduced-motion`.

## Honest notes

- **Apple Neural Engine:** web pages can't target the Neural Engine directly. On Apple Silicon, WebGPU runs on the Apple GPU through Metal, and that's where the ray tracing happens. The rival AI is a fast heuristic search on its own CPU thread, not a neural network.
- The game uses genre mechanics only (open-world-crime-style heat, cash and getaways). It uses no names, art, music or characters from any existing game or franchise.

## Tests

```bash
node --test test/*.test.mjs   # Node 18+
```
