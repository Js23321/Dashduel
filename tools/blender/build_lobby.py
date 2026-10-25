"""
DASHDUEL 3D LOBBY (original blocky design, no collision: the lobby camera is a fixed set of cinematic stops).

Zones (game coordinates, camera looks along -z from +z):
   centre    PLAY gate on a stepped dais (the focal point) + the MATCHMAKING board beside it
   front-L   PLAYER podium (your avatar stands here, spotlit)
   front-R   LOADOUT rack: four pedestals, one per weapon
   back-R    SETTINGS control panel with a big gear
   back-L    PRACTICE range: booth, lane, targets, backstop
   around    toy-block skyline, trees, lamps, clouds
Anchors the Three.js lobby needs (portal plane, screen, avatar, weapon stands, targets, camera stops) go into mesh meta.
Run inside Blender; writes js/mesh-lobby.js. Preview cameras are created for multi-view checks.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())
import random

K = Kit('lobby', 'Lobby', 'LOBBY', scene_name='DASHDUEL_Lobby', collide=False)
K.script = 'build_lobby.py'
M = K.mat
rng = random.Random(7)

# ---- materials ---------------------------------------------------------------------------------------------------------------
for n, h in {
    'ground': 0x9bdad2, 'tileA': 0xf7f2e4, 'tileB': 0xcfe3f5, 'ringA': 0xffb347, 'ringB': 0xffd966, 'kerb': 0x5b6f9e,
    'daisA': 0xff8a5b, 'daisB': 0xffd23f, 'daisC': 0xfff4d6, 'pillarA': 0xff5d73, 'pillarB': 0xffffff, 'beam': 0x2f3b73, 'trim': 0x6c5ce7,
    'podA': 0x6c5ce7, 'podB': 0xb8a9ff, 'backdrop': 0x4b3fa8, 'banner': 0xff5d73,
    'rackWall': 0x3a7bd5, 'rackDark': 0x2a5aa8, 'pedestal': 0xe9eef7, 'pedCap': 0x2f3b73, 'carpet': 0xff7aa8,
    'panelBody': 0x2bb3a8, 'panelDark': 0x177e76, 'trackW': 0xf4f7fb, 'knobR': 0xff5d5d, 'knobY': 0xffd23f, 'knobB': 0x3ec5ff,
    'gear': 0xffc300, 'gearDark': 0xe29a00,
    'counter': 0xff5d5d, 'stall': 0x394567, 'canopy': 0x2f3b73, 'laneA': 0x9aa6b8, 'laneB': 0xb7c1d1, 'backstop': 0x56627a,
    'dummy': 0xff9f43, 'board': 0xffffff, 'boardRed': 0xe63946, 'post': 0x56627a,
    'sky1': 0x7c5cff, 'sky2': 0x38bdf8, 'sky3': 0xff7b54, 'sky4': 0x2dd4bf, 'sky5': 0xf472b6, 'sky6': 0xfacc15,
    'trunk': 0x8d6e4b, 'leaf': 0x4cc86a, 'leaf2': 0x7ee081, 'planter': 0xff9f43, 'flowerA': 0xff5d73, 'flowerB': 0xffd23f, 'bench': 0x7c5cff,
    'screenFrame': 0x1d2442, 'screenPost': 0x56627a,
}.items():
    M(n, h, 'main')
for n, h in {'signY': 0xffe066, 'signC': 0x6be3ff, 'lamp': 0xfff7c2, 'glowC': 0x38e1ff, 'glowP': 0xff7aa8}.items():
    M(n, h, 'emit')
M('cloud', 0xffffff, 'prop')

# ---- ground ------------------------------------------------------------------------------------------------------------------------
K.box(-60, -2, -60, 60, -0.05, 60, 'ground', 'Ground')
T = 4
for ix in range(-9, 9):
    for iz in range(-9, 9):
        x0, z0 = ix * T, iz * T
        d = max(abs(x0 + T / 2), abs(z0 + T / 2))
        if d <= 16:
            K.top(x0, x0 + T, z0, z0 + T, 0.0, 'tileA' if (ix + iz) % 2 == 0 else 'tileB', 'Ground')
        elif d <= 20:
            K.top(x0, x0 + T, z0, z0 + T, 0.0, 'ringA' if (ix + iz) % 2 == 0 else 'ringB', 'Ground')
# low kerb around the plaza (back and sides)
for (a0, a1, b0, b1) in [(-36, 36, -37, -36), (-37, -36, -36, 36), (36, 37, -36, 36)]:
    K.box(a0, 0, b0, a1, 0.9, b1, 'kerb', 'Ground', solid=False)

# ---- PLAY gate on a stepped dais (centre) --------------------------------------------------------------------------------------
cx, cz = 0.0, -8.0
K.box(cx - 9, 0, cz - 7, cx + 9, 0.5, cz + 7, 'daisA', 'Play')
K.box(cx - 6.4, 0.5, cz - 6.4, cx + 6.4, 0.9, cz + 6.4, 'daisB', 'Play', yaw=math.pi / 4)
K.box(cx - 6, 0.9, cz - 5, cx + 6, 1.3, cz + 5, 'daisC', 'Play')
for i in range(9):  # candy-striped pillars
    for sx in (-1, 1):
        K.box(cx + sx * 4.6 - 0.8, 1.3 + i * 1.0, cz - 0.8, cx + sx * 4.6 + 0.8, 2.3 + i * 1.0, cz + 0.8, 'pillarA' if i % 2 == 0 else 'pillarB', 'Play')
K.box(cx - 6.2, 10.3, cz - 1.1, cx + 6.2, 11.6, cz + 1.1, 'beam', 'Play')
K.box(cx - 6.4, 11.6, cz - 1.3, cx + 6.4, 12.0, cz + 1.3, 'trim', 'Play')
K.box(cx - 3.8, 1.3, cz - 0.35, cx + 3.8, 1.5, cz + 0.35, 'beam', 'Play')  # threshold
K.text('PLAY', cx, 12.5, cz + 0.2, 0.5, 'signY', 'Play')
for sx in (-1, 1):  # lamps on the dais corners
    for sz in (-1, 1):
        K.box(cx + sx * 8.2 - 0.4, 0.5, cz + sz * 6.2 - 0.4, cx + sx * 8.2 + 0.4, 1.7, cz + sz * 6.2 + 0.4, 'lamp', 'Play')

# ---- MATCHMAKING board (right of the gate) -------------------------------------------------------------------------------------
bx0, bx1, bz = -17.0, -8.5, -12.0
for px in (bx0 + 0.6, bx1 - 0.6):
    K.box(px - 0.3, 0, bz - 0.3, px + 0.3, 4.4, bz + 0.3, 'screenPost', 'Play')
K.box(bx0, 4.0, bz - 0.4, bx1, 11.2, bz + 0.1, 'screenFrame', 'Play')
K.box(bx0 + 0.35, 4.35, bz + 0.1, bx1 - 0.35, 10.85, bz + 0.16, 'screenFrame', 'Play', solid=False)
K.box(bx0 - 0.2, 11.2, bz - 0.5, bx1 + 0.2, 11.6, bz + 0.2, 'trim', 'Play')
K.meta['screen'] = {'x': (bx0 + bx1) / 2, 'y': 7.6, 'z': bz + 0.2, 'w': bx1 - bx0 - 0.7, 'h': 6.5}
K.meta['portal'] = {'x': cx, 'y': 1.5, 'z': cz, 'w': 7.6, 'h': 8.8}

# ---- PLAYER podium (front left) ------------------------------------------------------------------------------------------------
px, pz = -12.0, 6.0
K.box(px - 4, 0, pz - 3.5, px + 4, 0.6, pz + 3.5, 'podA', 'Player')
K.box(px - 3, 0.6, pz - 2.5, px + 3, 1.2, pz + 2.5, 'podB', 'Player')
for (a0, a1, b0, b1) in [(px - 3, px + 3, pz + 2.35, pz + 2.5), (px - 3, px + 3, pz - 2.5, pz - 2.35), (px - 3, px - 2.85, pz - 2.35, pz + 2.35), (px + 2.85, px + 3, pz - 2.35, pz + 2.35)]:
    K.box(a0, 1.2, b0, a1, 1.28, b1, 'glowC', 'Player', solid=False)
K.box(px - 4.5, 0, pz - 5.4, px + 4.5, 7.0, pz - 4.6, 'backdrop', 'Player')
for i, c in enumerate(['banner', 'signY', 'glowC']):
    K.box(px - 3.0 + i * 3.0 - 0.25, 0.4, pz - 4.6, px - 3.0 + i * 3.0 + 0.25, 6.6, pz - 4.45, c, 'Player', solid=False)
K.box(px - 4.7, 7.0, pz - 5.6, px + 4.7, 7.5, pz - 4.4, 'trim', 'Player')
K.meta['avatar'] = {'x': px, 'y': 1.2, 'z': pz}

# ---- LOADOUT rack (front right) -------------------------------------------------------------------------------------------------
rx0, rx1, rz = 4.5, 19.5, 6.0
K.box(rx0, 0, rz - 3.0, rx1, 3.6, rz - 2.2, 'rackWall', 'Loadout')
K.box(rx0 - 0.3, 3.6, rz - 3.2, rx1 + 0.3, 4.0, rz - 2.0, 'rackDark', 'Loadout')
K.box(rx0, 0.0, rz - 2.2, rx1, 0.4, rz + 3.4, 'carpet', 'Loadout')
K.text('LOADOUT', (rx0 + rx1) / 2, 4.5, rz - 2.6, 0.32, 'signC', 'Loadout')
stands = []
for i in range(4):
    x = rx0 + 2.4 + i * 3.55
    K.box(x - 1.2, 0.4, rz - 0.9, x + 1.2, 1.6, rz + 1.5, 'pedestal', 'Loadout')
    K.box(x - 1.4, 1.6, rz - 1.1, x + 1.4, 1.85, rz + 1.7, 'pedCap', 'Loadout')
    K.text(str(i + 1), x, 0.65, rz + 1.5, 0.16, 'pedCap', 'Loadout')
    K.box(x - 1.0, 1.85, rz - 0.8, x + 1.0, 1.9, rz + 1.4, 'glowP', 'Loadout', solid=False)
    stands.append({'x': x, 'y': 3.2, 'z': rz + 0.3})
K.meta['stands'] = stands

# ---- SETTINGS panel (back right) ------------------------------------------------------------------------------------------------
sx0, sx1, sz = 17.0, 31.0, -19.0
K.box(sx0, 0, sz - 1.4, sx1, 6.2, sz, 'panelBody', 'Settings')
K.box(sx0 - 0.3, 6.2, sz - 1.6, sx1 + 0.3, 6.7, sz + 0.2, 'panelDark', 'Settings')
for i, (frac, knob) in enumerate([(0.3, 'knobR'), (0.7, 'knobY'), (0.45, 'knobB'), (0.8, 'knobR')]):
    y = 1.2 + i * 1.15
    K.box(sx0 + 1.2, y, sz, sx1 - 1.2, y + 0.28, sz + 0.1, 'trackW', 'Settings')
    kx = sx0 + 1.2 + (sx1 - sx0 - 2.4) * frac
    K.box(kx - 0.45, y - 0.25, sz, kx + 0.45, y + 0.53, sz + 0.35, knob, 'Settings')
# big gear above the panel
gz = sz + 0.2
gcx, gcy = (sx0 + sx1) / 2, 13.2
for k in range(12):
    a = k * math.pi / 6
    K.box(gcx + math.cos(a) * 2.9 - 0.55, gcy + math.sin(a) * 2.9 - 0.55, gz - 0.3, gcx + math.cos(a) * 2.9 + 0.55, gcy + math.sin(a) * 2.9 + 0.55, gz + 0.3, 'gear', 'Settings', yaw=0.0)
for k in range(8):
    a = (k + 0.5) * math.pi / 4
    K.box(gcx + math.cos(a) * 1.9 - 0.7, gcy + math.sin(a) * 1.9 - 0.7, gz - 0.3, gcx + math.cos(a) * 1.9 + 0.7, gcy + math.sin(a) * 1.9 + 0.7, gz + 0.3, 'gearDark', 'Settings')
K.prism('z', gcx, gcy, gz, 0.9, 0.9, 'gear', 'Settings', solid=False)
K.text('SETTINGS', (sx0 + sx1) / 2, 7.0, sz + 0.2, 0.34, 'signC', 'Settings')
for (x, z, w, h) in [(sx0 - 2.2, sz + 2.6, 1.8, 1.2), (sx0 - 2.2, sz + 4.8, 1.4, 0.9), (sx1 + 0.8, sz + 3.0, 2.0, 1.4)]:
    K.box(x, 0, z, x + w, h, z + w, 'knobY' if h > 1.1 else 'knobB', 'Settings')

# ---- PRACTICE range (back left) -------------------------------------------------------------------------------------------------
lx0, lx1 = -30.0, -18.0
lc = (lx0 + lx1) / 2
for iz in range(0, 7):
    K.top(lx0, lx1, -8 - iz * 4, -4 - iz * 4, 0.02, 'laneA' if iz % 2 == 0 else 'laneB', 'Practice')
K.box(lx0 - 0.7, 0, -36, lx0, 1.2, -4.5, 'backstop', 'Practice', solid=False)
K.box(lx1, 0, -36, lx1 + 0.7, 1.2, -4.5, 'backstop', 'Practice', solid=False)
K.box(lx0 - 0.7, 0, -37.5, lx1 + 0.7, 7.0, -36, 'backstop', 'Practice', solid=False)
K.box(lx0 - 0.4, 0, -6.4, lx1 + 0.4, 1.4, -4.8, 'counter', 'Practice')
for i in range(5):
    x = lx0 - 0.2 + i * (lx1 - lx0 + 0.4) / 4
    K.box(x - 0.2, 1.4, -6.4, x + 0.2, 4.4, -5.0, 'stall', 'Practice')
K.box(lx0 - 0.8, 4.4, -7.2, lx1 + 0.8, 4.9, -3.8, 'canopy', 'Practice')
K.text('PRACTICE', lc, 3.2, -35.9, 0.3, 'signY', 'Practice')
targets = []
for z in (-15.0, -22.0, -29.0):
    K.box(lc - 0.2, 0, z - 0.2, lc + 0.2, 2.0, z + 0.2, 'post', 'Practice')
    K.prism('z', lc, 3.1, z + 0.45, 1.3, 0.2, 'boardRed', 'Practice', solid=False, seg=8)
    K.prism('z', lc, 3.1, z + 0.58, 0.9, 0.12, 'board', 'Practice', solid=False, seg=8)
    K.prism('z', lc, 3.1, z + 0.68, 0.45, 0.1, 'boardRed', 'Practice', solid=False, seg=8)
    targets.append({'x': lc, 'y': 3.1, 'z': z + 0.6})
K.meta['targets'] = targets

# ---- scenery: skyline ring, trees, lamps, benches, clouds ----------------------------------------------------------------------
cols = ['sky1', 'sky2', 'sky3', 'sky4', 'sky5', 'sky6']
k = 0
for edge in range(4):
    for i in range(-9, 10):
        t = i * 7.0
        w = 4.5 + rng.random() * 2.5
        h = 8 + rng.random() * 18
        d = 38.5 + rng.random() * 3
        if edge == 0:    # back
            K.box(t - w / 2, 0, -d - w, t + w / 2, h, -d, cols[k % 6], 'Scenery', solid=False)
        elif edge == 1:  # left
            K.box(-d - w, 0, t - w / 2, -d, h, t + w / 2, cols[k % 6], 'Scenery', solid=False)
        elif edge == 2:  # right
            K.box(d, 0, t - w / 2, d + w, h, t + w / 2, cols[k % 6], 'Scenery', solid=False)
        else:            # front
            K.box(t - w / 2, 0, d, t + w / 2, h, d + w, cols[k % 6], 'Scenery', solid=False)
        k += 1
        if rng.random() < 0.5:  # a slimmer second block in front for depth
            ww = 2.2
            hh = h * 0.55
            if edge == 0:
                K.box(t - ww / 2, 0, -d + 0.2, t + ww / 2, hh, -d + 0.2 + ww, cols[(k + 2) % 6], 'Scenery', solid=False)
            elif edge == 1:
                K.box(-d + 0.2, 0, t - ww / 2, -d + 0.2 + ww, hh, t + ww / 2, cols[(k + 2) % 6], 'Scenery', solid=False)
            elif edge == 2:
                K.box(d - 0.2 - ww, 0, t - ww / 2, d - 0.2, hh, t + ww / 2, cols[(k + 2) % 6], 'Scenery', solid=False)
for (x, z) in [(-27, 20), (27, 22), (-31, -2), (33, 6), (-8, -33), (10, -33), (-34, -26), (36, -34)]:
    K.box(x - 0.35, 0, z - 0.35, x + 0.35, 3.0, z + 0.35, 'trunk', 'Scenery')
    K.box(x - 1.8, 3.0, z - 1.8, x + 1.8, 5.4, z + 1.8, 'leaf', 'Scenery')
    K.box(x - 1.1, 5.4, z - 1.1, x + 1.1, 6.8, z + 1.1, 'leaf2', 'Scenery')
for (x, z) in [(-23, 6), (24, 4), (-17, -2), (-2, -34), (34, 20), (-34, 20)]:
    K.box(x - 0.2, 0, z - 0.2, x + 0.2, 5.0, z + 0.2, 'post', 'Scenery')
    K.box(x - 0.6, 5.0, z - 0.6, x + 0.6, 6.2, z + 0.6, 'lamp', 'Scenery')
for (x, z) in [(-4, 14), (4, 14), (-2, -1), (3, -16)]:
    K.box(x - 1.4, 0, z - 0.4, x + 1.4, 0.6, z + 0.4, 'bench', 'Scenery')
    K.box(x - 1.4, 0.6, z - 0.5, x + 1.4, 1.2, z - 0.3, 'bench', 'Scenery')
for (x, z, c) in [(-8, 22, 'flowerA'), (8, 22, 'flowerB'), (-22, 12, 'flowerB'), (26, 12, 'flowerA')]:
    K.box(x - 1.3, 0, z - 1.3, x + 1.3, 0.9, z + 1.3, 'planter', 'Scenery')
    for (dx, dz) in [(-0.6, -0.6), (0.6, -0.4), (0, 0.6), (-0.4, 0.5)]:
        K.box(x + dx - 0.25, 0.9, z + dz - 0.25, x + dx + 0.25, 1.5, z + dz + 0.25, c, 'Scenery')
for i in range(9):  # blocky clouds
    a = rng.random() * math.pi * 2
    r = 70 + rng.random() * 40
    x, z, y = math.cos(a) * r, math.sin(a) * r, 38 + rng.random() * 30
    for j in range(3 + int(rng.random() * 3)):
        w, h, d = 10 + rng.random() * 12, 3 + rng.random() * 3, 6 + rng.random() * 6
        ox, oz = (rng.random() - 0.5) * 18, (rng.random() - 0.5) * 8
        K.box(x + ox - w / 2, y + (rng.random() - 0.5) * 2, z + oz - d / 2, x + ox + w / 2, y + 3 + h, z + oz + d / 2, 'cloud', 'Sky', solid=False)

# ---- camera stops (position, look-at) for the Three.js lobby (tuned against screenshots of the real thing) ------------------------------
K.meta['cams'] = {
    'hub':      {'eye': [0.0, 19.0, 37.0], 'at': [0.0, 2.0, -5.0]},
    'play':     {'eye': [-2.0, 9.0, 22.0], 'at': [-3.0, 5.0, -9.0]},
    'avatar':   {'eye': [-4.5, 4.8, 19.0], 'at': [-12.0, 3.2, 6.0]},
    'loadout':  {'eye': [12.0, 4.8, 17.0], 'at': [12.0, 3.0, 6.0]},
    'settings': {'eye': [28.0, 11.0, 9.0], 'at': [24.0, 8.0, -19.0]},
    'practice': {'eye': [-28.0, 11.0, 4.0], 'at': [-24.0, 1.0, -21.0]},
}
K.meta['zones'] = {
    'play': {'min': [-7, 0, -14], 'max': [7, 13, 0]},
    'board': {'min': [-17.5, 4, -13], 'max': [-8, 12, -11]},
    'avatar': {'min': [-16, 0, 2], 'max': [-8, 6, 10]},
    'loadout': {'min': [4, 0, 3], 'max': [20, 5, 11]},
    'settings': {'min': [16, 0, -21], 'max': [32, 14, -17]},
    'practice': {'min': [-31, 0, -37], 'max': [-17, 8, -3]},
}

sc, root = K.build()
K.camera('top', (0, 120, 0.01), (0, 0, 0), ortho=95)
K.camera('hub', (0, 19, 37), (0, 2, -5), lens=22)
K.camera('range', (-28, 11, 4), (-24, 1, -21), lens=30)
K.camera('rack', (12, 4.8, 17), (12, 3, 6), lens=30)
K.camera('panel', (28, 11, 9), (24, 8, -19), lens=30)
info = {'stats': K.stats(), 'mesh': K.export_mesh()}
result = info
