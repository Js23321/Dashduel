# DASHDUEL — movement-first arena shooter

Fast first-person duels in colourful low-poly block arenas (Three.js / WebGL). Inspired by the quick, competitive
feel of Roblox-style arena shooters. The code, characters, weapons, UI and name are original; the weapon numbers follow Roblox
RIVALS, and the **Arena** map's layout is converted from the public-domain (CC0) "Rivals Arena Map" 3D-print model on
Printables (a copy of a layout from the Roblox game RIVALS, so keep that in mind before publishing the game widely). The other
five maps and the **3D lobby** are original designs made in Blender for this game.

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
* **You always run (there is no sprint key); `Shift` slides, and so does `C`.** `Ctrl+W` closes a tab and `Ctrl+1…8` switches
  browser tabs (Chrome reserves those; no web page can block them), so the game needs no Ctrl: the **mouse wheel** and **`F`**
  (previous weapon) switch weapons without it, and *Settings → Graphics → Fullscreen* additionally asks Chrome to deliver those combos to the game.
* Gameplay keys never scroll the page, and **nothing is intercepted outside a running game**. Leaving or closing the
  tab mid-match shows a "Leave site?" confirmation.
* Losing focus (Alt-Tab, another tab, DevTools) pauses the game, releases the mouse, clears every held key and mutes
  sound, so nothing can get "stuck".
* Both **fullscreen and windowed** play work (pause menu → *Fullscreen*, or `F11`).
* Weak hardware? *Settings → Graphics → Quality: **Potato*** (the cheapest look: 40% resolution, no shadows, particles, outlines, clouds, reflections or interface animations; about 3-7× the frame rate of Medium in my software-rendering test) or *Low* (the first run auto-picks a preset from your device), or set
  **Target frame rate: 30 FPS**. The game also watches its own frame times and, if it can't hold the frame rate, removes
  expensive visuals one step at a time (particles → resolution → shadows → outlines and clouds).

---

## Game modes

| Mode | What you do |
|------|-------------|
| **Online 1v1** | **A real match against another player.** Press *Online 1v1*, wait in the queue, and you are paired with whoever else is searching. First to **5 rounds**, 150 health each, every round starts with a **3 second countdown** during which both players are locked in their own spawn. See *Online 1v1* below. |
| **Duel** | 1v1 against an AI. Each round ends on an elimination, then everything resets automatically (sides alternate). First to **3 / 5 / 7** round wins. 75 s round limit: most health wins. Maps: Arena, Bridge, Crossroads, Docks, Station, Backrooms. |
| **Deathmatch** | Free-for-all against 1–7 AI opponents (easy / normal / hard). First to **10 / 15 / 25** eliminations within 5 minutes. ~1 s respawns, regenerating health. |
| **Time Trial** | Race through glowing checkpoint rings on the **Gauntlet**. Splits compare with your best; falling respawns you at the last checkpoint (`Q`). |
| **Practice** | Free play on every map with target dummies (also from the lobby's practice range). The **Yard** has a shooting range, slide hills, wall-run fields, launch pads, a bunny-hop lane and stairs. `E` sets a spawn point, `Q` returns to it, `T` resets. |

**Everyone — you and every bot — has 150 health and no shield.** Opponents' weapons are never announced: not in the
round-start text, not on the death screen, not in the kill feed.

Personal bests, win streaks, accuracy, top speeds and eliminations are saved in your browser (*Records*).

### Maps (the active pool; every one is modelled in Blender, see *Maps and the lobby* below)
| # | Map | Size | Idea |
|---|-----|------|------|
| 1 | **Arena** | compact (28 x 44 m, 10 m walls) | a walled rectangle of white panelled concrete in the style of the RIVALS Arena: a long **ramp up to a high ledge** on each side wall (the pocket under each ledge is a covered corridor), a **catwalk** at ledge height bridging the middle over a low plinth, **turned slabs** and a tall bar on the diagonal, low blocks, and a **hollowed gate** (arch + windows, blue / red) that hides each team's spawn pad from the middle. A second **ramp at each spawn end** leads onto the ledge, and each team has six spawn points that rotate between rounds. 180-degree symmetric, so neither spawn has an advantage |
| 2 | **Bridge** | medium (80 x 60 m) | a city crossing: a raised bridge deck (ramps at both ends, stairs in the middle) over an avenue and a street, a **yellow bus stopped on the bridge** as the landmark, parked cars, jersey barriers, planters, buildings with windows around. Routes: avenue, sidewalks, under the bridge, over it |
| 3 | **Crossroads** | large (92 x 92 m) | open air: two roads cross at a stepped stone **monument** (jumpable tiers, an obelisk); a stone **fort** and a **warehouse** with windows, doors, interiors and ramp / stairs to their roofs (rotated twins on the other side), rock outcrops at the road ends, hay, walls, crates, wells and trees |
| 4 | **Docks** | large (96 x 76 m) | waterfront cargo yard: container alleys (single and double stacks), a gantry crane, a dockmaster's hut, a harbour office and a warehouse (two floors, windows, stairs, interiors). The north side and the piers are **open water: falling in is lethal** (the kill height sits 3 m under the surface) |
| 5 | **Station** | large (78 x 60 m) | a stylised Western railway station: two steam trains (locomotive + three carriages each, with door and window openings: fight through them) either side of an island platform with a canopy; the station hall and the depot (two floors, a stair, a balcony over an open double-height hall) |
| 6 | **Backrooms** | medium (56 x 56 m, 3.4 m ceiling) | an enclosed maze of 4 m yellow-office corridors, two red-carpet rooms (spawns), two pool-tile rooms and a lit atrium with a 1.2 m platform on ramps and a central column. Bright ceiling lights and a short yellow haze, so it is never too dark |
| - | **The Yard** | huge | practice field with a station for every mechanic (Practice mode) |
| - | **Gauntlet** | course | one-way time-trial course (Time Trial mode) |

Every duel map is symmetric (Arena / Bridge / Crossroads / Station / Backrooms: 180-degree rotation, Docks: left-right mirror), so
neither spawn has an advantage. The four earlier maps (Toybox, Skybridge, Pinwheel, Vertigo) were retired from the pool; they are
kept in `_archive/maps-legacy.js` (how to bring them back is in that file's header) and the git branch
`backup/pre-rivals-overhaul` holds the complete game as it was before the change.

**About "Arena" and what is assumed.** RIVALS' Arena is described publicly as a "clean grid design" with angled blocks and cover, a
ramp up to a centre platform, a tall wall and a hollowed-out wall, mirrored with identical spawns (the RIVALS wiki lists no
dimensions). The Arena here is **modelled from scratch** in Blender (`tools/blender/build_testarena.py`) from those descriptions and
reference screenshots: the layout, sizes and details are *ours* (nothing is copied from the game or from the CC0 3D-print replica
that an earlier version of this project used; that version is kept in `_archive/arena-stl/`), and no official dimensions are claimed.
Bridge, Crossroads, Docks, Station and Backrooms are **original designs** (they only take their theme and name from the RIVALS
map list: a bus on a bridge, a crossroads, docks with water, a Western station, an office maze); no layout or asset was copied.

## Username
The first time you start the game it asks for a **username** (3–16 characters: letters, numbers, spaces, `_` and `-`).
It is shown to opponents in Online 1v1, on the score row and in the kill feed. Change it any time from the main menu
(*Change name*). Names received from other players are filtered the same way before they are displayed.

## Online 1v1 (real players, authoritative server)
* **Needs the game server.** Online 1v1 talks to a small Node.js server (`server/`, no dependencies). Locally:
  `cd server && SERVE_STATIC=1 node server.js`, then open `http://localhost:8787/` in two browser windows. For a public
  game deploy the server and set its address in `js/config.js` (`SERVER_URL`; it is now `wss://server.sciencerevisions.online/ws`, and that server's `ALLOWED_ORIGINS` must list the address the game is served from). Everything else (Duel, Deathmatch, Time
  Trial, Practice) works without it. **If the server cannot be reached the game says so; it never fakes an opponent.**
  Setup, trade-offs (serverless vs persistent server) and deployment steps: **[docs/ONLINE_BACKEND.md](docs/ONLINE_BACKEND.md)**.
* **Queue:** *Online 1v1* → the queue screen (connecting / searching / matched, with connection status and a retry button
  if the server is unreachable) → when two players are searching they are matched into their own isolated room and each
  the match **starts by itself** (no confirm screen). The browser only lets a page capture the mouse after a click, so if
  it has not been captured yet a "Click to capture the mouse" prompt shows; one click and you are in.
* **Rules:** first to **5 round wins**, 150 health each. Each round: both players spawn on opposite sides (a **different pair of spawn points each round**), a **3 second
  countdown** with movement and shooting locked (this is the spawn protection: nobody can move, shoot or be hurt before "FIGHT"), then the fight; a round ends on an elimination (or after 90 s: most
  health wins). Between rounds nobody is frozen. Maps: Arena, Bridge, Crossroads, Docks, Station, Backrooms (a random one per match).
* **Who decides what:** your browser sends *input* (keys + view angles, numbered) and *requests* ("fire", "reload",
  "throw": no direction, no damage). The **server** simulates your movement with the same physics, so your position is
  whatever the rules allow for that input; your browser predicts it locally so it feels instant, and the server corrects
  it (with a replay of the input it has not simulated yet) if the two ever differ. The server decides every hit
  (with lag compensation capped at 400 ms: the opponent's box is rewound to where you saw them, tried at three nearby moments and made 10 cm wider / 8 cm taller, so a shot that was on the drawn body is never lost to ping jitter) and owns health, ammo, deaths, rounds, score, the countdown and grenade
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

## 3D models, maps and the lobby (made in Blender)
The four weapons are modelled in Blender in the **Roblox RIVALS look** (chunky, flat-shaded, saturated; the shapes follow RIVALS' own
default models, the real-world bases are the ones the RIVALS wiki names): the **Assault Rifle** is an *orange* FN SCAR-L with
black vent slots, a black rail, flip-up ring sights, a black curved magazine and a block flash hider; the **Handgun** is an all-black
USP-style slab with a square bore, three vents and two pins on the slide; the **Grenade** is a faceted dark-green M67 with a gold
collar and a navy fuze and lever; the **Fists** are two blocky Roblox arms (black sleeves, block hands). They are exported as
data (`js/models-weapons.js`). Animated pieces (magazine, slide, charging handle, trigger, grenade lever and pin) are separate
parts with pivots, so every animation works on them. Opponents hold simpler low-poly versions of the weapons (drawn small and
far away).

### Maps and the lobby
Everything lives in `_models/dashduel-models.blend` (one Blender scene per map: *DASHDUEL_Lobby, _Arena, _Bridge, _Crossroads,
_Docks, _Station, _Backrooms, _Shared* (the reusable pieces), _Weapons). Each scene has a top-level collection named after the
map (`BRIDGE`, `DOCKS`, ...) with one sub-collection per kind of object (Buildings, Cover, Cars, Containers, Signs...), a
`<MAP>_COLLISION` proxy collection (wire boxes) and a `<MAP>_PREVIEW` collection (sun + cameras for inspection). All objects sit
at the origin with identity transforms, materials are `DD_<map>_<name>`, units are metres at game scale.

One script per map describes it as boxes / ramps / octagonal prisms (`tools/blender/build_bridge.py`, `build_crossroads.py`,
`build_docks.py`, `build_station.py`, `build_backrooms.py`, `build_testarena.py`, `build_lobby.py`, shared helpers in `mapkit.py`) and, run inside
Blender, writes **both halves of the map from the same scene**:

| file | what | loaded by |
|------|------|-----------|
| `js/mapdata-<id>.js` | collision boxes / ramps + spawns (a few KB) | the browser **and the server** |
| `js/mesh-<id>.js` | the triangles of the picture, read back from the Blender objects (130-850 KB; fetched in the background while you are in the lobby, or on demand when a match starts) | the browser |
| `_models/exports/<id>.glb` | the same geometry as glTF binary, for other tools / engines (the game itself needs no glTF loader) | nobody at runtime |

So what you see is what you collide with: there is no hand-copied collision to drift. Hidden faces (box sides inside or touching
another box) are not exported. Window and door openings are real holes (you can shoot and walk through them).

* **Rebuild a map:** open the .blend in Blender (with the Blender MCP add-on, or Text editor > Open `build_<map>.py` > Run). Each
  script ends by exporting its two JS files. `export_glb.py` writes the GLBs, `preview.py` renders multi-view Workbench previews.
* **Add a map:** copy a `build_*.py`, change the layout, run it, then add one `fromData('<id>', ...)` entry (name, palette, sky,
  kill height, nav step) in `js/maps.js`, a `<script src="js/mapdata-<id>.js">` tag in `index.html` and the id to `MAPS` in
  `server/config.js`. A map whose data file is missing is simply not offered.
* **Weapons:** `build_rifle.py` ... `build_hands.py`, then `export_models.py` (-> `js/models-weapons.js`). The Arena is a normal map script, `build_testarena.py` (its id is `testarena`: `arena` is already the name of a game mode).
* Maps can have **water** (`water: {y, color}` in the map entry; Docks) and can be **indoor** (`sky.indoor`: no sun, hills or clouds;
  Backrooms). Runnable walls (`wall` flag in the data) are supported but unused by the pool.

### First-person weapon position
The hip pose follows the RIVALS first-person view (reference screenshots, solved numerically in `tools/solve-hip-pose.js`): the gun sits low
on the right, large, and tilts in so its muzzle points just right of and below the crosshair (`hipYaw` / `hipPitch` in `js/vmanim.js`,
blended out while aiming), which keeps the middle of the screen clear. The right hand is on the grip, the supporting hand under the handguard;
while aiming the supporting forearm tips down out of the sight picture.

**Aiming down sights** (right mouse) is **camera-driven**, like a real raised rifle: the weapon is drawn by its own camera, and sliding it from
the low hip position to the middle of the screen over a still world looked like a gun floating across the picture. Now the *view* turns
toward the sight (the world pans, the gun stays where it is relative to it) and the gun only makes the small remaining adjustment, so
the **front sight ends exactly on the crosshair**. How it works (`js/vmanim.js`, `js/modes.js`):
* Each weapon has a sight anchor in its `SPEC` (`post` = front sight, else `sight` = rear sight), an eye relief `er` / `erCentre`, a sight
  yaw `adsYaw`, a share `camShare` (how much of the aiming movement the camera does, default 0.6) and, in `js/weapondata.js`, its own
  `adsFovMul` (ADS zoom), `adsIn` / `adsOut` (blend times). Nothing is hard-coded per weapon: `adsCamera(spec)` measures the angle between
  the anchor in the hip pose and the middle of the screen, turns the camera by `camShare` of it, and defines the gun's pose in the
  turned view so that at full ADS the anchor is on the crosshair for any share (rifle: the view turns 7.2° / 2.3°, the gun itself moves 11 cm
  instead of sliding 19 cm; handgun 5.2° / 2.9°). It is computed once per weapon and setting, then blended with the eased ADS progress.
* The turn is added to the player's yaw / pitch as an **increment** (target minus what was already added), so mouse look stays fully
  additive and never fights it, releasing aim hands back exactly what aiming took (also when interrupted by a weapon switch, a reload,
  a respawn / new round), and the shot and the network input follow the turned view, so the server agrees with what you see.
* **The default sight picture is centred**: the gun points straight down the view and the hole of the rear sight sits dead on the
  crosshair (*Settings → Mouse & ADS → Centre the sights while aiming*, on by default; off = the gun stays to the right and turns in so its
  front sight is on the crosshair). Aiming also **zooms in** (rifle about 1.7x, handgun about 1.4x; `adsFovMul` in `js/weapondata.js`;
  *ADS zoom* scales it, and look speed is scaled with the zoom so aiming stays 1:1).
* *Settings → Mouse & ADS → ADS camera pull* scales the camera's share: 100% = each weapon's own amount, 0% = the old behaviour (the view
  never turns and the gun slides). Limits: aiming turns the view by a few degrees (so the movement direction follows it, like any mouse turn), and there
  is no scoped weapon in the game, so the scope overlay is not used (`sight: 'iron'` weapons only).

## Weapons — exactly four (keys 1–4, mouse wheel, `F` = previous weapon)

The numbers follow **Roblox RIVALS** (community wiki / weapon database, checked October 2026; RIVALS is patched often, so
treat them as "as of then"). Everything is in one table, `js/weapondata.js`, shared with the server.

| Slot | Weapon | Role | Damage | Rate | Ammo |
|------|--------|------|--------|------|------|
| 1 | **Assault Rifle** (SCAR-style model) | full-auto hitscan | 12 up close, falling to 3 at range (headshot 15 → 4) | 0.10 s between shots | 20 in the magazine / 100 spare, reload 1.56 s |
| 2 | **Handgun** | semi-auto hitscan | 12 → 3 (headshot 15 → 4) | 0.13 s between shots | 13 / 91 spare, reload 1.06 s |
| 3 | **Fists** | melee, 2.4 m reach. **Unlocks the double jump** | 30 | 0.35 s | ∞ |
| 4 | **Grenade** | hold to aim, release to throw, or let the circle reach you to boost | 75 blast | 30 s cooldown, 2 s fuse | 1 |

Notes on the conversion: RIVALS measures distance in studs; here one stud is 0.36 m (RIVALS' avatar is ~5.2 studs tall, this
one is 1.85 m), so the rifle's 50 → 200 stud falloff is **18 → 71 m** and the grenade's 16 stud blast is ~6 m. **Health is
still 150** (RIVALS uses 100: set `RV.MAX_HP = 100` in `js/weapondata.js` for its exact time-to-kill). RIVALS' per-weapon
move-speed changes are **not** copied: weapons never slow your movement here, by design. Spare rounds are refilled every
round / respawn; Practice has unlimited ammunition. With no rounds left the HUD says NO AMMO.

### Spawn protection
A deathmatch respawn takes **no damage for 2 seconds, or until you attack** (fire, punch or throw), whichever comes first. A readout under the crosshair counts it
down; a protected opponent glows faintly teal; shots at them are absorbed (no hit marker, a short "Spawn protected" note).
Falling out of the map still kills. In **Duel and Online 1v1 there is no invulnerability after "FIGHT"**: the frozen 3 s countdown is the
protection (an invulnerable opponent made shots "do nothing", which looked like a hit-registration bug; the server's `SPAWN_PROTECT_S`
is now 0 by default). The 2 s respawn protection stays in **Deathmatch** (`RV.SPAWN_PROTECT_S` in `js/weapondata.js`).

### Guns
* **Hitscan.** The instant you click, a ray is cast from the camera through the exact centre of the screen — a click is
  resolved inside the mouse-down event itself, with the pose that is on screen. Walls block it; opponents are tested
  against their *current* hitboxes in that same moment. Animations, hands and sounds are cosmetic and never change a hit.
* **Headshots:** a hit on the head deals ×1.25 damage (RIVALS' crit: 12 → 15). **Damage numbers** pop up beside the crosshair: **white for a body
  shot, red for a headshot** (kills are drawn a little larger).
* Tracers, sparks, muzzle flash and shell casings are created *after* the hit is resolved. Right mouse aims down sights
  (hold, or toggle in settings): the gun turns in so its front sight is on the crosshair (see *First-person weapon position*). Only the picture
  changes: the shot leaves through the crosshair either way.

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
dark sleeve, sized so they never cover the crosshair). They follow every animation: idle, run, slide, jump,
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
| Slide / crouch | **Shift** or **C** |
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

## Interface, the 3D lobby and the classic menu
Two interface styles, switchable in *Settings -> Interface -> Interface style* (instant, remembered, never touches a match):
* **RIVALS** (default, `css/rivals-ui.css`): chunky rounded panels with thick dark outlines and a hard button shadow, heavy rounded
  lettering (no italics), a **graphite** base with **orange** as the primary colour (the colours of the assault rifle) and **cyan** for
  information and for you. Its **layout** is its own: in the lobby a **dock of five big buttons along the bottom** (PLAY in the middle, keys
  `1`-`5`), your name and the server status top-left, Records / How to play top-right and the details of the focused spot (the game modes, the weapons...) in a **sheet that rises from the dock**, centred above it; in a match the **score card is top-left** (timer, you, opponent, round), **one long health bar** (number on its left, colour from green through yellow and orange to red as health drops) sits **bottom-left**, the **four weapon slots** bottom-centre, the **big white ammo count with the weapon name** is bottom-right and the kill feed
  top-right.
* **Arcade** (`css/theme-arcade.css`): the earlier deep-navy, angled (chamfered) look with a cyan accent and italic numerals.
Both styles use the same components and ids; the RIVALS one is an `<html data-ui="rivals">` layer on top. (The earlier Tactical theme and
its switch were removed at your request; its stylesheet is kept in `_archive/` if you ever want it back.)

### The 3D lobby (the way into the game)
The game opens in a small blocky plaza (`js/lobby.js`, modelled in Blender as `js/mesh-lobby.js`) drawn by the game's own
renderer. It has a **PLAY gate** in the middle (an animated portal on a stepped dais) with a **MATCHMAKING board** beside it, your
**PLAYER podium** (your avatar, the game's own blocky character, holding your start weapon, with your name over it), the **LOADOUT
rack** (the four weapons, the same Blender models as in first person, slowly turning), the **PRACTICE range** (lane, booth and
targets) and the **SETTINGS** control panel. Click a zone in the plaza or a button in the dock (RIVALS style: along the bottom; Arcade style: the side panel on the left; keys `1`-`5`); the camera glides
to it (fixed cinematic stops with a little sway and mouse parallax: it can never clip a wall) and the panel shows what
the zone really does. The portal is a animated vortex (a noise-bent spiral with a hot core and drifting stars) that turns
violet/cyan when idle, orange while searching and green when a match is found:

| Zone | Real actions |
|------|--------------|
| Play | *Find online match* (the Online 1v1 queue), Duel / Deathmatch / Time Trial against bots (the normal map picker), a live server status line |
| Loadout | click a weapon on the rack (or its button): sets the weapon you spawn holding; *Full weapon stats* opens the Loadout screen |
| Practice | *Enter the practice range* (the Yard, free play), or pick another map |
| Settings | Mouse & aiming, Keybinds, Graphics (Potato mode), Network, and the *3D lobby* switch |
| You | change name, your online record, Records |

* **Matchmaking status is real**: the board and the side panel show `Server online · 42 ms · 3 online` from a live probe of the game server,
  `Server not reachable (offline modes still work)` if it is down, or `No game server configured (offline modes only)` in dev mode.
  Nothing in the lobby is a decoration: every button calls the same handler the classic menu used.
* **Flow:** lobby -> *Find online match* -> the matchmaking screen over the lobby -> the match starts by itself, the picture fades
  in -> first person -> match -> results -> *Rematch* or *Return to lobby* (also in the pause menu).
* **Performance:** about 70 draw calls and 13 k triangles, drawn only while a lobby screen is showing (20 fps on Potato, 30 on Low).
  If the lobby cannot be built (no model data, an error) the **classic flat menu** takes over automatically; you can also
  choose it in *Settings -> Interface -> 3D lobby*, or with `?classic` in the address.

### Classic main menu (fallback)
**HUD:** small exact crosshair; one top-centre bar `you score | timer | opponent score`; kill feed top-right; health
bottom-left; the four-slot hotbar bottom-centre (the selected slot lifts; grenade cooldown and double-jump pips on their
slots); weapon, ammunition and grenade count bottom-right; hit markers with an expanding ring, an elimination strip, damage
arcs and a quiet death screen. The HUD scales with the window (`--hs`) from 1024 x 600 to 4K; animations only touch
`transform` / `opacity`, and `prefers-reduced-motion` is respected.

**Classic main menu - two switchable layouts** (used when the 3D lobby is off; a slow 3D arena drifts behind the menu in both):

| | **B - Cinematic** | **D - Arcade Lobby** |
|---|---|---|
| Idea | A launch screen: attention goes to one large Play button | A multiplayer lobby: everything one click away |
| Play | Large *Online 1v1* hero in the middle of the screen with the other four modes in a row under it | *Online 1v1* hero and a 2 x 2 mode grid in a panel on the right |
| Navigation | Slim bar (Loadout / Settings / Records / How to play) between the header and the hero | Vertical button column down the left |
| Loadout | Reachable from the bar (the weapon list is left out to keep the screen clean) | Your four weapons as a strip bottom-left, under the Loadout button |
| Mood | Centred, symmetrical, lots of space | Side-weighted, compact, energetic |

**How to switch (instant, no reload, never touches a match, the connection or your progress):**
* **Main menu, top right:** `Menu layout  [ B - Cinematic | D - Arcade Lobby ]`; the current one is highlighted.
* **Settings -> Interface -> "Classic menu layout".**

The choice is saved in your browser (`localStorage`, key `rivel.menuLayout`) and applied before the first paint next time.
Implementation: `<html data-menu="b|d">`, set by `js/menulayout.js`; both layouts are CSS grids over the **same** buttons
(`css/theme-arcade.css`, section *MAIN MENU LAYOUTS*), so there is exactly one set of handlers. The 3D backdrop is
`js/menubg.js`: it reuses the game's renderer and the Arena map, renders at a capped 30 fps (20 on the Low preset),
and stops completely on every other screen, in a hidden tab and during a match. Below 901 px width both layouts fall
back to one stacked column.

**Menus:** main menu, map select, **Loadout**, pause (Resume / Quit full width, the rest in two columns), settings (tabs in
a side column), records, how to play, queue, username, match-end banner and results screens. **Keyboard:** arrow keys / `Tab`
move, `Enter` selects, `Esc` goes back.

## Settings
* **Mouse & ADS:** sensitivity, invert Y, auto-hop, wheel weapon switching, aim hold/toggle, ADS
  sensitivity, scoped look speed, results screen on/off.
* **Keybinds:** every action, two slots each.
* **View:** FOV (80–125°), speed FOV kick, wall-run tilt, weapon/hands on/off, crosshair size / gap / thickness / dot / colour.
* **Graphics:** **Potato / Low / Medium / High / Cinematic presets** (render resolution, shadows, effects), *Smooth edges*, individual overrides, target FPS
  (60/30), auto quality, FPS counter, fullscreen. **Cinematic** is the highest preset: 4x multisampling, 4096 px shadows and a shader pipeline
  (`js/post.js`: HDR light, screen-space ambient occlusion, bloom glow, soft highlight roll-off, colour grade, sharpening, vignette and film
  grain). It needs a good GPU and WebGL2 with float render targets (a device without them quietly draws High); the auto-quality governor switches
  the effects off first when the frame rate drops. **Smooth edges**: hardware multisampling from Medium up (applies when the page loads), a cheap
  FXAA filter on Low.
* **Audio:** master volume.
* **Interface:** *3D lobby* on / off; *Classic menu layout* - B (Cinematic) or D (Arcade Lobby) when the lobby is off.
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
js/mapdata-<id>.js   collision + spawns of a map made in Blender (bridge, crossroads, docks, station, backrooms), loaded by browser AND server
js/mesh-<id>.js      the picture of a map / the lobby (testarena, lobby, bridge, ...), exported from Blender; maps' pictures load on demand
js/lobby.js          the 3D lobby: scene, camera stops, avatar, rack, matchmaking board, zone cards, real server status
css/lobby.css        the lobby's interface layer
js/models-weapons.js the four weapons' first-person models (rifle, handgun, grenade, hands), exported from Blender by tools/blender/export_models.py
tools/blender/       the Blender scripts that build and export models, maps and the lobby (run inside Blender); the .blend is _models/dashduel-models.blend
_models/exports/     glTF (.glb) copies of the lobby, maps and the shared kit
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
server/              the authoritative game server (Node.js, no dependencies) + 90 tests + .env.example: see server/README.md
docs/ONLINE_BACKEND.md   backend choice, architecture, anti-cheat rules, configuration, deployment, limitations
Dockerfile           container image for the server (Fly.io etc.)
_archive/            retired code (the old peer-to-peer transport, the Tactical theme and its switcher, the four retired maps)
```

## Testing
```bash
cd server && npm test            # 90 server tests (serial, ~6 min): movement prediction == simulation, combat, anti-cheat rules,
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
