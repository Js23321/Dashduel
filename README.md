# DASHDUEL — movement-first arena shooter

Fast first-person duels in colourful low-poly block arenas (Three.js / WebGL). Inspired by the quick, competitive
feel of Roblox-style arena shooters, but everything here (maps, characters, weapons, UI, name) is original.

**Movement and positioning beat aim**: the two guns are hitscan with **zero recoil, zero spread, zero bullet travel
time, no bullet drop and no camera shake**. Slide, bunny hop, air strafe, wall run, double jump and grenade-boost to
out-play the AI.

No installation and no build step (Three.js r159 is bundled in `vendor/`). The only feature that needs a server is
**Online 1v1**; everything else works offline.

---

## Run it in Chrome

**Easiest:** open `index.html` in Chrome (double-click it, or in ChromeOS open it from the Files app, or drag it
onto a Chrome window). That's it.

**Optional – tiny local server** (only if your setup blocks `file://` pages):

```bash
# in this folder
python -m http.server 8000      # then open http://localhost:8000
# or:  npx serve .
```

Pick a mode, pick a map, press **Start**. The mouse locks to the game (Pointer Lock). **Esc** releases it and pauses.

**Every Duel / Online round starts with a 3 second countdown with both fighters locked in their own spawn.** After that,
**winning or losing a Duel or Deathmatch never pauses the game or frees your mouse, and you are never frozen:** after
beating the opponent you keep full control (move, jump, slide, switch weapons) while a small summary card shows and the
next round / match starts by itself. (Prefer the old results screen? *Settings → Mouse & ADS → Results screen after matches*.)

### Chromebook / browser-safety notes
* **Ctrl is the slide key, but `Ctrl+W` closes a tab and `Ctrl+1…8` switches browser tabs** (Chrome reserves those; no
  web page can block them). So **`C` slides as well**, the **mouse wheel** and **`F`** (previous weapon) switch weapons
  without Ctrl, and *Settings → Graphics → Fullscreen* additionally asks Chrome to deliver those combos to the game.
* Gameplay keys never scroll the page, and **nothing is intercepted outside a running game**. Leaving or closing the
  tab mid-match shows a "Leave site?" confirmation.
* Losing focus (Alt-Tab, another tab, DevTools) pauses the game, releases the mouse, clears every held key and mutes
  sound, so nothing can get "stuck".
* Both **fullscreen and windowed** play work (pause menu → *Fullscreen*, or `F11`).
* Weak hardware? *Settings → Graphics → Quality: Low* (the first run auto-picks a preset from your device), or set
  **Target frame rate: 30 FPS**. The game also watches its own frame times and, if it can't hold the frame rate, removes
  expensive visuals one step at a time (particles → resolution → shadows → outlines and clouds).

---

## Game modes

| Mode | What you do |
|------|-------------|
| **Online 1v1** | **A real match against another player.** Press *Online 1v1*, wait in the queue, and you are paired with whoever else is searching. First to **5 rounds**, 150 health each, every round starts with a **3 second countdown** during which both players are locked in their own spawn. See *Online 1v1* below. |
| **Duel** | 1v1 against an AI. Each round ends on an elimination, then everything resets automatically (sides alternate). First to **3 / 5 / 7** round wins. 75 s round limit: most health wins. Maps: Toybox, Skybridge, Pinwheel, Vertigo. |
| **Deathmatch** | Free-for-all against 1–7 AI opponents (easy / normal / hard). First to **10 / 15 / 25** eliminations within 5 minutes. ~1 s respawns, regenerating health. |
| **Time Trial** | Race through glowing checkpoint rings on the **Gauntlet**. Splits compare with your best; falling respawns you at the last checkpoint (`Q`). |
| **Practice** | Free play on every map with target dummies. The **Yard** has a shooting range, slide hills, wall-run fields, launch pads, a bunny-hop lane and stairs. `E` sets a spawn point, `Q` returns to it, `T` resets. |

**Everyone — you and every bot — has 150 health and no shield.** Opponents' weapons are never announced: not in the
round-start text, not on the death screen, not in the kill feed.

Personal bests, win streaks, accuracy, top speeds and eliminations are saved in your browser (*Records*).

### Maps (all original, colourful, mirror-symmetric where it matters)
| Map | Size | Idea |
|-----|------|------|
| **Toybox** | compact | stepped centre, four corner towers, wall-run side platforms, pads onto the top tier |
| **Skybridge** | compact | long high bridge between two end platforms, fight on it, under it, or ride the pads up |
| **Pinwheel** | compact | rotational symmetry: four decks, a pinwheel of runnable walls, pads that throw you deck to deck |
| **Vertigo** | large | dusk arena: podium, corner decks, perimeter wall runs, diagonal pads |
| **The Yard** | huge | practice field with a station for every mechanic |
| **Gauntlet** | course | one-way time-trial course |

## Username
The first time you start the game it asks for a **username** (3–16 characters: letters, numbers, spaces, `_` and `-`).
It is shown to opponents in Online 1v1, on the score row and in the kill feed. Change it any time from the main menu
(*Change name*). Names received from other players are filtered the same way before they are displayed.

## Online 1v1 (real players, authoritative server)
* **Needs the game server.** Online 1v1 talks to a small Node.js server (`server/`, no dependencies). Locally:
  `cd server && SERVE_STATIC=1 node server.js`, then open `http://localhost:8787/` in two browser windows. For a public
  game deploy the server and set its address in `js/config.js` (`SERVER_URL`). Everything else (Duel, Deathmatch, Time
  Trial, Practice) works without it. **If the server cannot be reached the game says so; it never fakes an opponent.**
  Setup, trade-offs (serverless vs persistent server) and deployment steps: **[docs/ONLINE_BACKEND.md](docs/ONLINE_BACKEND.md)**.
* **Queue:** *Online 1v1* → the queue screen (connecting / searching / matched, with connection status and a retry button
  if the server is unreachable) → when two players are searching they are matched into their own isolated room and each
  clicks **Enter match** (the browser needs a click to lock the mouse).
* **Rules:** first to **5 round wins**, 150 health each. Each round: both players spawn on opposite sides, a **3 second
  countdown** with movement and shooting locked, then the fight; a round ends on an elimination (or after 90 s: most
  health wins). Between rounds nobody is frozen. Maps: Toybox, Skybridge, Pinwheel, Vertigo.
* **Who decides what:** your browser sends *input* (keys + view angles, numbered) and *requests* ("fire", "reload",
  "throw": no direction, no damage). The **server** simulates your movement with the same physics, so your position is
  whatever the rules allow for that input; your browser predicts it locally so it feels instant, and the server corrects
  it (with a replay of the input it has not simulated yet) if the two ever differ. The server decides every hit
  (with lag compensation capped at 350 ms) and owns health, ammo, deaths, rounds, score, the countdown and grenade
  flight. Hit markers, damage numbers and your health change only when the server says so. The opponent is drawn from
  30 Hz server snapshots, interpolated, and **is not sent to you at all while they are behind a wall**.
* **Connection status:** top-left of the HUD shows `Connected · <ms> · <n> online`; *Settings → Network* shows the server
  in use and has a **Test connection** button. You cannot pause an online match (the menu opens over the live match);
  *Leave match* forfeits. If the opponent leaves they forfeit. **If your connection drops** the game reconnects by
  itself (15 s grace; the opponent is told) and resumes the same round. When a match ends both players can press
  **Rematch**.
* **Anti-cheat (server side):** per-session violation score with decay (warn at 40, disconnect at 100 with a 60 s
  lockout, never permanent), speed-hack limit on input rate, view-turn limit, weapon timing in simulation time, strict
  message validation and rate limits, origin allow-list, TLS enforcement, structured security logs. Rules and limits in
  [docs/ONLINE_BACKEND.md](docs/ONLINE_BACKEND.md).
* **Honest limits:** needs the server and an internet connection (or a LAN for local tests); no accounts or ranking;
  server-side checks stop teleports, speed hacks, wall clipping, fire-rate hacks and wallhacks, but an aimbot that stays
  inside the rules cannot be detected by any server (the docs say what is logged for a human to review).

## Weapons — exactly four (keys 1–4, mouse wheel, `F` = previous weapon)

The numbers follow **Roblox RIVALS** (community wiki / weapon database, checked October 2026; RIVALS is patched often, so
treat them as "as of then"). Everything is in one table, `js/weapondata.js`, shared with the server.

| Slot | Weapon | Role | Damage | Rate | Ammo |
|------|--------|------|--------|------|------|
| 1 | **Assault Rifle** | full-auto hitscan | 12 up close, falling to 3 at range (headshot 15 → 4) | 0.10 s between shots | 20 in the magazine / 100 spare, reload 1.56 s |
| 2 | **Handgun** | semi-auto hitscan | 12 → 3 (headshot 15 → 4) | 0.13 s between shots | 13 / 91 spare, reload 1.06 s |
| 3 | **Fists** | melee, 2.4 m reach. **Unlocks the double jump** | 30 | 0.35 s | ∞ |
| 4 | **Grenade** | hold to aim, release to throw, or let the circle reach you to boost | 75 blast | 30 s cooldown, 2 s fuse | 1 |

Notes on the conversion: RIVALS measures distance in studs; here one stud is 0.36 m (RIVALS' avatar is ~5.2 studs tall, this
one is 1.85 m), so the rifle's 50 → 200 stud falloff is **18 → 71 m** and the grenade's 16 stud blast is ~6 m. **Health is
still 150** (RIVALS uses 100: set `RV.MAX_HP = 100` in `js/weapondata.js` for its exact time-to-kill). RIVALS' per-weapon
move-speed changes are **not** copied: weapons never slow your movement here, by design. Spare rounds are refilled every
round / respawn; Practice has unlimited ammunition. With no rounds left the HUD says NO AMMO.

### Spawn protection
A player who has just spawned (a duel or online round that has just gone **FIGHT**, a deathmatch respawn) takes **no damage
for 2 seconds, or until they attack** (fire, punch or throw), whichever comes first. A readout under the crosshair counts it
down; a protected opponent glows faintly teal; shots at them are absorbed (no hit marker, a short "Spawn protected" note).
Falling out of the map still kills. Online it is enforced by the server (`SPAWN_PROTECT_S`, default 2, 0 = off); against bots
it is `RV.SPAWN_PROTECT_S` in `js/weapondata.js`. The countdown at the start of a round is still locked as before.

### Guns
* **Hitscan.** The instant you click, a ray is cast from the camera through the exact centre of the screen — a click is
  resolved inside the mouse-down event itself, with the pose that is on screen. Walls block it; opponents are tested
  against their *current* hitboxes in that same moment. Animations, hands and sounds are cosmetic and never change a hit.
* **Headshots:** a hit on the head deals ×1.25 damage (RIVALS' crit: 12 → 15). **Damage numbers** pop up beside the crosshair: **white for a body
  shot, red for a headshot** (kills are drawn a little larger).
* Tracers, sparks, muzzle flash and shell casings are created *after* the hit is resolved. Right mouse aims down sights
  (hold, or toggle in settings) with the sight exactly on the shooting ray.

### Fists and the double jump
Left click punches (alternating hands, a short cooldown, one hit per punch; the hitbox is a slightly enlarged body box,
blocked by walls). **Only while the Fists are equipped:** press `Space` once more in the air for a second jump with an
upward boost. It refreshes when you touch the ground, keeps your momentum and air strafing (the held direction nudges
your course), shows a small ring effect and a hand flick, and never replaces a bunny hop or a wall jump. Switching away
turns it off at once; switching back mid-air never grants a second one if you already used it.

### Grenade
* **Hold a mouse button** (left or right) to pull the pin and aim: a dotted line shows the path and a **circle shows
  where it lands** (a faint ring shows the 6 m blast). **Release to throw** along your view. **R** (or switching weapon)
  cancels and you keep the grenade.
* **Keep holding and the circle comes for you.** It sits where it would land for the first second, then slides towards
  you — slowly at first, then faster, turning from teal to red with a faster and higher warning beep — and exactly
  3 s after the pin came out it touches you and explodes. A thin bar under the crosshair shows the 3 s (tick at 1 s).
  That is a free **grenade boost**: you are launched away from the blast (a grenade at your feet = straight up).
* It is the only projectile: a thrown one flies with gravity, bounces off walls and floors, and explodes 2 s after
  leaving your hand (restrained flash, ring, particles and a loud synthesised boom).
* **75 damage** to every enemy it can see inside the blast (including one standing next to you when it goes off on you);
  cover and walls block or reduce it. **It never damages you.**
* **One grenade, 30 s cooldown** (8 s in Practice so you can learn boosts). The cooldown shows on the HUD and on slot 4.

## First-person hands and weapon animation
All four weapons are held by the same pair of blocky, Roblox-style hands (a small block hand, a short bare forearm and a
dark sleeve, sized so they never cover the crosshair). They follow every animation: idle, walk, sprint, slide, jump,
landing dip, firing (trigger / bolt / slide — no recoil), reloads (the supporting hand pulls the magazine), weapon
switching, the grenade pin pull and throw, punches and the double-jump flick. The weapon is drawn in its own pass, so it
never clips into walls.

## Sound
Everything is synthesised (no audio files) and passes through a compressor and a small generated-room reverb. The
assault rifle has its own layered shot (crack, body, low punch, tail, bolt tick; slightly different every shot); the
handgun, reloads, punches, hit / headshot / kill ticks, grenade pin, bounce, fuse ticks, explosion and boost, footsteps,
double jump, landing and UI all have their own sounds.

## Controls (all rebindable: *Settings → Keybinds*, two keys/mouse buttons per action)

| Action | Default |
|--------|---------|
| Move | **W A S D** (arrows work too) |
| Look | Mouse (raw input, frame-rate independent) |
| Jump / wall jump / double jump (fists) | **Space** (hold for auto bunny-hop) |
| Sprint | **Shift** |
| Slide / crouch | **Ctrl** or **C** |
| Shoot / punch / hold-aim grenade | **Left mouse** |
| Aim down sights (with the grenade out: also holds it) | **Right mouse** |
| Cancel a held grenade | **R** |
| Reload | **R** |
| Weapons | **1–4**, mouse wheel, **F** previous |
| Quick restart | **T** |
| Back to checkpoint / spawn | **Q** (time trial, practice) |
| Practice: set spawn | **E** |
| Scoreboard | **Tab** (hold) |
| Pause / release mouse | **Esc** |

## Movement guide
* **Slide** – hold slide while running: instant (capped) speed boost, keeps momentum, gains speed downhill, fits under low gaps.
* **Slide jump** – press jump mid-slide to keep the speed and add a little.
* **Bunny hop** – landing with a jump queued (or auto-hop held) skips ground friction, so speed is never lost.
* **Air strafe** – in the air hold **A** or **D** and turn the mouse the same way: speed climbs with every well-timed hop.
* **Wall run** – jump alongside a **teal striped wall** while holding forward: you hold height and speed for a few seconds.
* **Wall jump** – press jump on any wall (or mid wall run) to push off towards where you're looking, keeping your speed.
* **Double jump** – fists only (see above). **Grenade boost** – see above.
* **Ramps & pads** – run up a ramp and jump off its end to carry the climb speed; launch pads throw you far.
* No fixed top speed. The physics step is a fixed 120 Hz with render interpolation, so movement is identical at 30, 60 or 144 FPS.

## Interface and main menu layouts
One interface, the **Arcade** look: deep navy surfaces, angled (chamfered) panels, a bright cyan accent against orange-red
for the opponent and damage, condensed bold type, italic numerals. (The earlier Tactical theme and its switch were removed;
its stylesheet is kept in `_archive/` if you ever want it back.)

**HUD:** small exact crosshair; one top-centre bar `you score | timer | opponent score`; kill feed top-right; health
bottom-left; the four-slot hotbar bottom-centre (the selected slot lifts; grenade cooldown and double-jump pips on their
slots); weapon, ammunition and grenade count bottom-right; hit markers with an expanding ring, an elimination strip, damage
arcs and a quiet death screen. The HUD scales with the window (`--hs`) from 1024 x 600 to 4K; animations only touch
`transform` / `opacity`, and `prefers-reduced-motion` is respected.

**Main menu - two switchable layouts** (a slow 3D arena drifts behind the menu in both):

| | **B - Cinematic** | **D - Arcade Lobby** |
|---|---|---|
| Idea | A launch screen: attention goes to one large Play button | A multiplayer lobby: everything one click away |
| Play | Large *Online 1v1* hero in the middle of the screen with the other four modes in a row under it | *Online 1v1* hero and a 2 x 2 mode grid in a panel on the right |
| Navigation | Slim bar (Loadout / Settings / Records / How to play) between the header and the hero | Vertical button column down the left |
| Loadout | Reachable from the bar (the weapon list is left out to keep the screen clean) | Your four weapons as a strip bottom-left, under the Loadout button |
| Mood | Centred, symmetrical, lots of space | Side-weighted, compact, energetic |

**How to switch (instant, no reload, never touches a match, the connection or your progress):**
* **Main menu, top right:** `Menu layout  [ B - Cinematic | D - Arcade Lobby ]`; the current one is highlighted.
* **Settings -> Interface -> "Main Menu Layout".**

The choice is saved in your browser (`localStorage`, key `rivel.menuLayout`) and applied before the first paint next time.
Implementation: `<html data-menu="b|d">`, set by `js/menulayout.js`; both layouts are CSS grids over the **same** buttons
(`css/theme-arcade.css`, section *MAIN MENU LAYOUTS*), so there is exactly one set of handlers. The 3D backdrop is
`js/menubg.js`: it reuses the game's renderer and the Toybox map, renders at a capped 30 fps (20 on the Low preset),
and stops completely on every other screen, in a hidden tab and during a match. Below 901 px width both layouts fall
back to one stacked column.

**Menus:** main menu, map select, **Loadout**, pause (Resume / Quit full width, the rest in two columns), settings (tabs in
a side column), records, how to play, queue, username, match-end banner and results screens. **Keyboard:** arrow keys / `Tab`
move, `Enter` selects, `Esc` goes back.

## Settings
* **Mouse & ADS:** sensitivity, invert Y, auto-hop, always sprint, wheel weapon switching, aim hold/toggle, ADS
  sensitivity, scoped look speed, results screen on/off.
* **Keybinds:** every action, two slots each.
* **View:** FOV (80–125°), speed FOV kick, wall-run tilt, weapon/hands on/off, crosshair size / gap / thickness / dot / colour.
* **Graphics:** **Low / Medium / High presets** (render resolution, shadows, effects), individual overrides, target FPS
  (60/30), auto quality, FPS counter, fullscreen.
* **Audio:** master volume.
* **Interface:** *Main Menu Layout* - B (Cinematic) or D (Arcade Lobby).
* **Network:** the game server in use, an optional per-browser server URL, and **Test connection**.

## Project layout
```
index.html           page + all menus / HUD markup (applies the saved main-menu layout in <head> before first paint)
css/style.css        shared layout + components, driven by CSS variables (the Arcade palette)
css/theme-arcade.css the Arcade look: shapes, HUD, menu layouts B and D
vendor/three.min.js  Three.js r159 (classic-script build, MIT licence in THREE-LICENSE.txt)
js/config.js         backend address (SERVER_URL etc.): the only thing to edit before publishing
js/util.js           helpers, storage
js/weapondata.js     weapon table + damage rules (shared with the server)
js/settings.js       settings, quality presets, key binding defaults
js/menulayout.js     main-menu layout B / D: switch, persistence
js/menubg.js         the slow 3D arena behind the main menu
js/stats.js          records / personal bests
js/maps.js           map definitions
js/collision.js      collision world (AABB + ramp wedges, spatial grid, raycasts)
js/grensim.js        grenade physics + blast damage (shared with the server)
js/player.js         movement physics (fixed 120 Hz step) incl. the fists-only double jump (also run by the server)
js/netproto.js       the wire format both sides must agree on (input runs, flags)
js/input.js          keyboard / mouse / wheel / pointer lock / rebinding / focus safety
js/audio.js          WebAudio synth (compressor + reverb, no audio files)
js/vmanim.js         first-person weapon + hands animation maths (pure, no THREE)
js/viewmodel.js      weapon models, blocky hands, muzzle flash, shell casings
js/fx.js             impact particles, decals, explosion / punch / double-jump effects
js/render.js         Three.js scene: sky pass, merged map geometry, props, characters
js/icons.js          inline SVG interface icons
js/hud.js            in-game HUD
js/weapons.js        the four weapons + loadout, headshots
js/grenades.js       thrown grenades: aiming preview, flight, blast, boost
js/bots.js           navigation graph + AI opponents
js/modes.js          session loop, Duel / Deathmatch / Time Trial / Practice
js/netclient.js      the one persistent WebSocket to the game server (handshake, heartbeat, latency, test)
js/online.js         Online 1v1 client: input stream, prediction + reconciliation, interpolation, reconnect, rematch
js/ui.js             menus, loadout, settings, records, keyboard navigation
js/main.js           boot, main loop, frame-time governor
server/              the authoritative game server (Node.js, no dependencies) + 79 tests + .env.example: see server/README.md
docs/ONLINE_BACKEND.md   backend choice, architecture, anti-cheat rules, configuration, deployment, limitations
Dockerfile           container image for the server (Fly.io etc.)
_archive/            retired code (the old peer-to-peer transport, the Tactical theme and its switcher)
```

## Testing
```bash
cd server && npm test            # 79 server tests (serial, ~5 min): movement prediction == simulation, combat, anti-cheat rules,
                                 # sessions / reconnect / rematch, information protection, lobby, WebSocket layer, load
```
The browser side was verified with headless Chrome against the real server: two real browsers queueing, playing a full
5-round match (countdown lock, prediction with zero corrections, hidden opponent, server-confirmed hits, a dropped and
resumed connection, rematch, forfeit), both main menu layouts at many window sizes, switching layouts in the middle of a
match, and the connection-failure screens. Pointer lock and fullscreen need a real window, so check those by hand:
start a match, press `Esc` (mouse released), *Resume*, then pause menu → *Fullscreen*.

## Performance design
* Each map is merged into one mesh per material, characters and weapons are merged too, and decals / particles are
  pooled: roughly **50–115 draw calls and 5–12 k triangles** depending on the map.
* **Presets:** **Low** = 60 % resolution, no shadows, fewer particles, no outlines/clouds (weapon animations are
  unchanged). **Medium** = 85 % resolution. **High** = 100 % resolution + soft sun shadows.
* **Frame-time governor:** a rolling window of real frame times is watched; if it stays bad it steps down effects →
  resolution → shadows → outlines, and gives resolution back after a long smooth stretch. It never touches gameplay.
* Everything that makes a shot (collision world, hitboxes, ray) is separate from the renderer and unaffected by quality settings.

Licence: game code is yours to use; Three.js is MIT (see `vendor/THREE-LICENSE.txt`).
