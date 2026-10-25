"""
BRIDGE - an original city-crossing duel map (metres, 80 x 60). Not a copy of any existing map.
  * a N-S avenue and an E-W street cross under a raised BRIDGE DECK (y 4.6, 11 m wide, ramps at both ends, stairs in the middle),
  * a yellow city BUS stopped in the middle of the bridge is the central landmark (cover on the high route, visible from everywhere),
  * parked cars, jersey barriers, planters and bus shelters are the cover; buildings with windows close the map in.
Rotationally symmetric (180 degrees about the centre), so both spawns (north / south end) see the same map.
Routes: the avenue (open, short), both sidewalks, under the bridge (tight), the bridge itself (high, long) and the stairs shortcuts.
Run inside Blender; writes js/mesh-bridge.js + js/mapdata-bridge.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())
import random

K = Kit('bridge', 'Bridge', 'BRIDGE', scene_name='DASHDUEL_Bridge')
K.script = 'build_bridge.py'
S = Sym(K, 'rot')
rng = random.Random(11)
for n, h in {
    'sidewalk': 0xc9c4b4, 'curb': 0x9b9689, 'asphalt': 0x4b5160, 'line': 0xf5f1d8, 'lineY': 0xf2c230, 'concrete': 0xb7b2a6, 'concreteDark': 0x8f8a80,
    'deck': 0x9aa2ae, 'deckDark': 0x6f7a8b, 'rail': 0x5a6577, 'pillar': 0xa8a395,
    'busY': 0xffc533, 'busBlack': 0x23272f, 'busWin': 0x2b3a52, 'busWheel': 0x1b1d22, 'busRoof': 0xe6e9ef,
    'carB': 0x3b82f6, 'carR': 0xe5484d, 'carW': 0xeef1f6, 'carG': 0x4cc86a, 'carGlass': 0x2d3f57,
    'planter': 0x7a8566, 'bush': 0x4cc86a, 'barrier': 0xd9d4c7, 'barrierR': 0xe5484d,
    'bld1': 0xe8d8c4, 'bld2': 0xcfd8e6, 'bld3': 0xe9b8a0, 'bld4': 0xb8d4c8, 'bld5': 0xd9c7e6, 'roofline': 0x7d8798, 'glass': 0x35506e, 'frame': 0xf4f1e8,
    'shelter': 0x3d8c8f, 'bench': 0x7c5cff, 'signPost': 0x56627a,
}.items():
    K.mat(n, h)
for n, h in {'lamp': 0xfff3b0, 'signB': 0x3ec5ff, 'tail': 0xff4d4d, 'headL': 0xfff6c8}.items():
    K.mat(n, h, 'emit')

W, D = 40.0, 30.0          # inner half extents of the playable area
DECK_Y = 4.6               # bridge deck top

# ---- ground + markings --------------------------------------------------------------------------------------------------------
K.box(-W - 8, -3, -D - 8, W + 8, 0, D + 8, 'sidewalk', 'Ground')
K.top(-8, 8, -D, D, 0.015, 'asphalt', 'Roads')            # N-S avenue
K.top(-W, W, -6, 6, 0.015, 'asphalt', 'Roads')            # E-W street under the bridge
for z in range(-int(D) + 3, int(D), 6):                              # avenue centre dashes
    if abs(z) > 6:
        K.top(-0.15, 0.15, z, z + 3, 0.03, 'lineY', 'Roads')
for x in range(-int(W) + 3, int(W), 6):                              # street centre dashes
    if abs(x) > 8:
        K.top(x, x + 3, -0.15, 0.15, 0.03, 'lineY', 'Roads')
for zc in (-11.5, 11.5):                                   # zebra crossings on the avenue
    for i in range(-6, 7):
        K.top(i * 1.1 - 0.35, i * 1.1 + 0.35, zc - 1.4, zc + 1.4, 0.03, 'line', 'Roads')
for xs in (-8.0, 8.0):                                     # kerb lines
    K.box(xs - 0.12, 0, -D, xs + 0.12, 0.1, -6.0, 'curb', 'Roads', solid=False)
    K.box(xs - 0.12, 0, 6.0, xs + 0.12, 0.1, D, 'curb', 'Roads', solid=False)
for zs in (-6.0, 6.0):
    K.box(-W, 0, zs - 0.12, -8.0, 0.1, zs + 0.12, 'curb', 'Roads', solid=False)
    K.box(8.0, 0, zs - 0.12, W, 0.1, zs + 0.12, 'curb', 'Roads', solid=False)

# ---- perimeter: buildings with windows (north / west rows, the south / east rows are their rotated images) ---------------------------
bmats = ['bld1', 'bld2', 'bld3', 'bld4', 'bld5']
x = -W - 6
k = 0
while x < W + 6 - 1e-6:
    w = rng.choice([7.0, 8.0, 9.0, 10.0])
    w = min(w, W + 6 - x)
    h = rng.choice([9.0, 11.0, 13.0, 15.0])
    S.box(x, 0, -D - 7, x + w, h, -D, bmats[k % 5], 'Buildings', mat2=bmats[(k + 2) % 5])
    S.box(x, h, -D - 7.2, x + w, h + 0.4, -D + 0.2, 'roofline', 'Buildings', solid=False)
    wx = x + 1.5
    while wx + 1.2 < x + w - 0.8:
        for wy in (2.2, 5.2) + ((8.2,) if h > 10 else ()) + ((11.2,) if h > 13 else ()):
            if wy + 1.5 < h:
                S.box(wx, wy, -D, wx + 1.2, wy + 1.5, -D + 0.07, 'glass', 'Windows', solid=False)
                S.box(wx - 0.1, wy - 0.1, -D, wx + 1.3, wy, -D + 0.1, 'frame', 'Windows', solid=False)
        wx += 3.0
    x += w
    k += 1
z = -D
k = 3
while z < D - 1e-6:
    w = min(rng.choice([7.0, 8.0, 9.0, 10.0]), D - z)
    h = rng.choice([9.0, 11.0, 13.0, 15.0])
    S.box(-W - 7, 0, z, -W, h, z + w, bmats[k % 5], 'Buildings', mat2=bmats[(k + 2) % 5])
    S.box(-W - 7.2, h, z, -W + 0.2, h + 0.4, z + w, 'roofline', 'Buildings', solid=False)
    wz = z + 1.5
    while wz + 1.2 < z + w - 0.8:
        for wy in (2.2, 5.2) + ((8.2,) if h > 10 else ()):
            if wy + 1.5 < h:
                S.box(-W, wy, wz, -W + 0.07, wy + 1.5, wz + 1.2, 'glass', 'Windows', solid=False)
                S.box(-W, wy - 0.1, wz - 0.1, -W + 0.1, wy, wz + 1.3, 'frame', 'Windows', solid=False)
        wz += 3.0
    z += w
    k += 1

# ---- the bridge ---------------------------------------------------------------------------------------------------------------------
BX = 30.0   # the deck runs x -30 .. 30, ramps continue to the walls
S.box(-BX, DECK_Y - 0.6, -5.5, BX, DECK_Y, 5.5, 'deck', 'Bridge')
for xc in (-26.0, -14.0):                                  # piers (4 per side of the street, rotated copies)
    for zc in (-4.6,):
        S.boxc(xc, 0, zc, 2.0, DECK_Y - 0.6, 2.0, 'pillar', 'Bridge')
        S.boxc(xc, 0, zc, 2.4, 0.5, 2.4, 'concreteDark', 'Bridge', solid=False)
for xc in (-20.0, 20.0):                                   # cross beams
    K.box(xc - 0.5, DECK_Y - 1.0, -5.5, xc + 0.5, DECK_Y - 0.6, 5.5, 'deckDark', 'Bridge', solid=False)
S.ramp(-W, -2.5, -BX, 2.5, 0.0, DECK_Y, '+x', 'deck', 'Bridge', bottom=0.0)   # ramps up to the deck from the walls
S.box(-W, 0, -2.6, -BX, 0.15, 2.6, 'deckDark', 'Bridge', solid=False)
S.stairs(16.0, 5.5, 19.5, 12.0, 0.0, DECK_Y, '-z', 11, 'concrete', 'Bridge')     # stairs shortcut (and its rotated twin on the far side)
# deck parapets (1.1 m) with the stair gaps and the ramp mouths left open
for (x0, x1) in ((-BX, 15.9), (19.6, BX)):          # +z edge: open where the stairs arrive (x 16 .. 19.5)
    K.box(x0, DECK_Y, 5.1, x1, DECK_Y + 1.1, 5.5, 'rail', 'Bridge')
for (x0, x1) in ((-BX, -19.6), (-15.9, BX)):        # -z edge: the rotated twin (x -19.5 .. -16)
    K.box(x0, DECK_Y, -5.5, x1, DECK_Y + 1.1, -5.1, 'rail', 'Bridge')
# the sidewalk edges of the ramps get low walls so nobody steps off the side
S.box(-W, 0, -2.5, -BX, 1.1, -2.1, 'concrete', 'Bridge', solid=False)
S.box(-W, 0, 2.1, -BX, 1.1, 2.5, 'concrete', 'Bridge', solid=False)

# ---- the BUS (central landmark): parked on the middle of the bridge, x -6.5..6.5, z -1.4..1.4, 0.55 above the deck ------------------------------
BY = DECK_Y   # deck level
K.box(-6.5, BY + 0.55, -1.4, 6.5, BY + 3.25, 1.4, 'busY', 'Bus')
K.box(-6.52, BY + 0.9, -1.42, 6.52, BY + 1.25, 1.42, 'busBlack', 'Bus', solid=False)       # lower stripe
K.box(-6.52, BY + 2.9, -1.42, 6.52, BY + 3.0, 1.42, 'busBlack', 'Bus', solid=False)
K.box(-5.0, BY + 3.25, -1.2, -2.2, BY + 3.65, 1.2, 'busRoof', 'Bus', solid=False)          # roof AC units
K.box(1.5, BY + 3.25, -1.2, 4.2, BY + 3.65, 1.2, 'busRoof', 'Bus', solid=False)
for xc in (-5.2, -3.0, -0.8, 1.4, 3.6):                                                    # side windows (both sides)
    K.box(xc, BY + 1.7, -1.44, xc + 1.7, BY + 2.7, -1.4, 'busWin', 'Bus', solid=False)
    K.box(xc, BY + 1.7, 1.4, xc + 1.7, BY + 2.7, 1.44, 'busWin', 'Bus', solid=False)
K.box(-6.56, BY + 1.6, -1.2, -6.5, BY + 2.9, 1.2, 'busWin', 'Bus', solid=False)            # windscreens
K.box(6.5, BY + 1.6, -1.2, 6.56, BY + 2.9, 1.2, 'busWin', 'Bus', solid=False)
for xc in (-4.3, 4.3):                                                                     # wheels
    for zs in (-1.7, 1.7):
        K.prism('z', xc, BY + 0.5, zs, 0.5, 0.35, 'busWheel', 'Bus', solid=False)
K.box(-6.62, BY + 0.7, -0.9, -6.5, BY + 0.95, -0.4, 'headL', 'Bus', solid=False)
K.box(-6.62, BY + 0.7, 0.4, -6.5, BY + 0.95, 0.9, 'headL', 'Bus', solid=False)
K.box(6.5, BY + 0.7, -0.9, 6.62, BY + 0.95, -0.4, 'tail', 'Bus', solid=False)
K.box(6.5, BY + 0.7, 0.4, 6.62, BY + 0.95, 0.9, 'tail', 'Bus', solid=False)
K.box(-6.52, BY + 2.95, -1.1, -6.5, BY + 3.2, 1.1, 'signB', 'Bus', solid=False)           # destination board

# ---- cars, barriers, planters, bus shelters (rotated pairs) ---------------------------------------------------------------------------
def car(cx, cz, mat, g='Cars', along='z'):
    L, Wd = 4.2, 1.9
    if along == 'z':
        x0, x1, z0, z1 = cx - Wd / 2, cx + Wd / 2, cz - L / 2, cz + L / 2
        S.box(x0, 0.3, z0, x1, 1.05, z1, mat, g)
        S.box(x0 + 0.1, 1.05, z0 + 0.9, x1 - 0.1, 1.6, z1 - 0.7, 'carGlass', g)
        S.box(x0 + 0.1, 1.6, z0 + 1.0, x1 - 0.1, 1.68, z1 - 0.8, mat, g, solid=False)
        for zz in (z0 + 0.8, z1 - 0.8):
            for xx in (x0, x1):
                S.prism('x', xx, 0.32, zz, 0.32, 0.3, 'busWheel', g, solid=False)
    else:
        x0, x1, z0, z1 = cx - L / 2, cx + L / 2, cz - Wd / 2, cz + Wd / 2
        S.box(x0, 0.3, z0, x1, 1.05, z1, mat, g)
        S.box(x0 + 0.7, 1.05, z0 + 0.1, x1 - 0.9, 1.6, z1 - 0.1, 'carGlass', g)
        S.box(x0 + 0.8, 1.6, z0 + 0.1, x1 - 1.0, 1.68, z1 - 0.1, mat, g, solid=False)
        for xx in (x0 + 0.8, x1 - 0.8):
            for zz in (z0, z1):
                S.prism('z', xx, 0.32, zz, 0.32, 0.3, 'busWheel', g, solid=False)
car(-5.0, -14.5, 'carB')
car(5.0, -20.5, 'carW')
car(-5.2, -24.0, 'carR')
car(-20.0, -9.3, 'carG', along='x')       # parked on the street
car(-31.0, 9.3, 'carB', along='x')
car(24.0, -9.4, 'carW', along='x')
# jersey barriers on the avenue
for zc in (-17.0, -9.0):
    S.boxc(2.6, 0, zc, 0.8, 1.15, 3.2, 'barrier', 'Cover')
    S.boxc(2.6, 1.15, zc, 0.8, 0.12, 3.2, 'barrierR', 'Cover', solid=False)
# planters + shrubs on the sidewalks
for (px, pz) in ((-12.0, -12.0), (-13.5, 16.0), (-24.0, 12.0), (-34.0, -16.0)):
    S.boxc(px, 0, pz, 2.4, 0.9, 2.4, 'planter', 'Cover')
    S.boxc(px, 0.9, pz, 1.9, 0.9, 1.9, 'bush', 'Cover', solid=False)
# crate-like concrete blocks to hide behind on the sidewalks
for (px, pz, w, h, d) in ((-14.0, -22.0, 2.4, 1.3, 2.4), (-26.0, -24.0, 3.0, 2.2, 1.6), (-34.0, 20.0, 2.0, 1.3, 2.0)):
    S.boxc(px, 0, pz, w, h, d, 'concrete', 'Cover')
    S.boxc(px, h, pz, w + 0.15, 0.12, d + 0.15, 'concreteDark', 'Cover', solid=False)
# bus shelters near both spawns: a roof on two walls that shield the spawn from the far end
S.box(-6.0, 0, -22.2, -3.6, 2.0, -21.8, 'shelter', 'Cover')
S.box(-6.2, 2.4, -23.4, -3.4, 2.6, -21.6, 'shelter', 'Cover', solid=False)
S.box(-6.0, 0, -23.4, -5.8, 2.4, -22.2, 'shelter', 'Cover', solid=False)
S.boxc(-4.8, 0, -22.9, 2.2, 0.5, 0.6, 'bench', 'Cover', solid=False)
# lamp posts
for (lx, lz) in ((-8.6, -26.0), (-8.6, -2.0), (-34.0, 6.6), (-22.0, 6.6), (-8.6, 22.0), (-8.6, 12.0)):
    S.prism('y', lx, 3.0, lz, 0.15, 6.0, 'signPost', 'Props', solid=False)
    S.box(lx - 0.5, 5.9, lz - 0.25, lx + 0.5, 6.1, lz + 0.25, 'lamp', 'Props', solid=False)

# ---- spawns (rotated pairs: north end / south end) ---------------------------------------------------------------------------------------
for (sx, sz) in ((0.0, -26.5), (-7.0, -26.8), (6.5, -27.0), (-19.0, -26.0), (-30.0, -9.0)):
    S.spawn(sx, 0.0, sz)
K.dummy(-4, 0, -17, 0.0)
K.dummy(4, 0, 17, 3.14159)

sc, root = K.build()
K.camera('top', (0, 130, 0.01), (0, 0, 0), ortho=96)
K.camera('iso', (-52, 40, 52), (0, 0, 0), lens=26)
K.camera('iso2', (52, 40, -52), (0, 0, 0), lens=26)
K.camera('spawnN', (0, 1.62, -26.5), (0, 1.6, 0))
K.camera('bridge', (-34, 6.3, 0), (20, 5.5, 0))
K.camera('street', (-38, 1.62, 3), (30, 1.6, 3))
result = {'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data()}
