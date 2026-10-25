"""
ARENA - the RIVALS-style duel arena, modelled from scratch (metres, 28 x 44 inside, 10 m walls). Original layout in the spirit of the map
(white panelled concrete, a walled rectangle, turned slabs, a long ramp to a high ledge, central blocks); it is not a copy of any model.
Rotationally symmetric (180 degrees), so both players get the same fight. Routes:
  * the floor      - open lanes between low blocks, two turned slabs and a tall bar in front of each spawn gate;
  * the ledges     - a long high deck on each side wall, reached by a ramp from the middle or by a second ramp at the spawn end;
                     the pocket under each deck is a covered corridor;
  * the catwalk    - a bridge at ledge height over the central plinth that links the two ledges;
  * the gates      - a tall hollowed wall (arch + windows) hides each spawn pad from the middle.
Run inside Blender; writes js/mesh-testarena.js + js/mapdata-testarena.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())

K = Kit('testarena', 'Arena', 'ARENA', scene_name='DASHDUEL_Arena')
K.script = 'build_testarena.py'
S = Sym(K, 'rot')
for n, h in {
    'floor': 0xc6ccd7, 'floorB': 0xb0b8c6, 'wall': 0xe9ecf1, 'wallSeam': 0xc3c9d3, 'plinth': 0x8b94a4, 'cap': 0xf8f9fb,
    'glass': 0x2a3345, 'deck': 0xd3d8e1, 'rampG': 0xb4bbc8, 'pillar': 0xa7afbd, 'parapet': 0xe6e8ed, 'slab': 0xe2e5eb, 'slabEdge': 0x98a1b1,
    'block': 0xcdd2dc, 'blockTop': 0xe3e6ec, 'stair': 0xc3c9d5, 'catwalk': 0xdcdfe6, 'rail': 0x8b94a4, 'frame': 0x7d8697,
    'blue': 0x4a7bd6, 'blueD': 0x3a63b0, 'red': 0xe5484d, 'redD': 0xb8353a, 'orange': 0xf0883a, 'sign': 0xf6f7fa,
}.items():
    K.mat(n, h)
for n, h in {'strip': 0xfff3d0, 'stripB': 0xa9c9ff, 'stripR': 0xffb0b8}.items():
    K.mat(n, h, 'emit')

HX, HZ, WH, WT = 14.0, 22.0, 10.0, 1.2    # inner half sizes, wall height / thickness


def T(x0, x1, z0, z1, y, mat, g='Ground'):
    """A flat tile and its 180-degree twin."""
    K.top(x0, x1, z0, z1, y, mat, g)
    K.top(-x1, -x0, -z1, -z0, y, mat, g)


# ---- floor ----------------------------------------------------------------------------------------------------------------------------
K.box(-HX - WT, -1.0, -HZ - WT, HX + WT, 0, HZ + WT, 'floor', 'Ground')
for ix in range(-int(HX), int(HX), 2):                      # 2 m checker
    for iz in range(-int(HZ), int(HZ), 2):
        if ((ix // 2) + (iz // 2)) % 2 == 0:
            K.top(ix, ix + 2, iz, iz + 2, 0.012, 'floorB', 'Ground')
K.top(-HX, HX, -0.12, 0.12, 0.02, 'orange', 'Ground')       # centre line
K.top(-11.0, -1.4, 16.8, 21.4, 0.03, 'blueD', 'Spawns')      # team pads (blue at +z, red at -z)
K.top(-10.6, -1.8, 17.2, 21.0, 0.04, 'blue', 'Spawns')
K.top(1.4, 11.0, -21.4, -16.8, 0.03, 'redD', 'Spawns')
K.top(1.8, 10.6, -21.0, -17.2, 0.04, 'red', 'Spawns')

# ---- the perimeter wall: panels, windows, plinth, cornice, light strip ------------------------------------------------------------------
K.box(-HX - WT, 0, -HZ - WT, -HX, WH, HZ + WT, 'wall', 'Walls')
K.box(HX, 0, -HZ - WT, HX + WT, WH, HZ + WT, 'wall', 'Walls')
K.box(-HX, 0, -HZ - WT, HX, WH, -HZ, 'wall', 'Walls')
K.box(-HX, 0, HZ, HX, WH, HZ + WT, 'wall', 'Walls')
SEAMS_Z = [-HZ + 5.5 * k for k in range(1, 8)]
SEAMS_X = [-HX + 4.0 * k for k in range(1, 7)]
for sx in (-1, 1):                                           # long walls (x = +-HX)
    xi = sx * HX
    xo = xi - sx * 0.07
    for z in SEAMS_Z:
        K.box(min(xi, xo), 0.7, z - 0.05, max(xi, xo), WH - 0.55, z + 0.05, 'wallSeam', 'WallDetail', solid=False)
    zs = [-HZ] + SEAMS_Z + [HZ]
    for i in range(0, len(zs) - 1):
        if i % 2 == 0:                                       # dark observation windows high up
            xo2 = xi - sx * 0.05
            K.box(min(xi, xo2), 6.3, zs[i] + 0.7, max(xi, xo2), 8.5, zs[i + 1] - 0.7, 'glass', 'WallDetail', solid=False)
            K.box(min(xi, xo2) - (0.0 if sx < 0 else 0.0), 6.18, zs[i] + 0.55, max(xi, xo2), 6.3, zs[i + 1] - 0.55, 'frame', 'WallDetail', solid=False)
    xo3 = xi - sx * 0.12
    K.box(min(xi, xo3), 0, -HZ, max(xi, xo3), 0.7, HZ, 'plinth', 'WallDetail', solid=False)
    xo4 = xi - sx * 0.35
    K.box(min(xi, xo4), WH - 0.55, -HZ, max(xi, xo4), WH, HZ, 'cap', 'WallDetail', solid=False)
    xo5 = xi - sx * 0.06
    K.box(min(xi, xo5), 9.0, -HZ + 1.0, max(xi, xo5), 9.2, HZ - 1.0, 'strip', 'Lights', solid=False)
for sz in (-1, 1):                                           # end walls (z = +-HZ)
    zi = sz * HZ
    for x in SEAMS_X:
        zo = zi - sz * 0.07
        K.box(x - 0.05, 0.7, min(zi, zo), x + 0.05, WH - 0.55, max(zi, zo), 'wallSeam', 'WallDetail', solid=False)
    zo3 = zi - sz * 0.12
    K.box(-HX, 0, min(zi, zo3), HX, 0.7, max(zi, zo3), 'plinth', 'WallDetail', solid=False)
    zo4 = zi - sz * 0.35
    K.box(-HX, WH - 0.55, min(zi, zo4), HX, WH, max(zi, zo4), 'cap', 'WallDetail', solid=False)
    zo5 = zi - sz * 0.06
    K.box(-HX + 1.0, 9.0, min(zi, zo5), HX - 1.0, 9.2, max(zi, zo5), 'stripB' if sz > 0 else 'stripR', 'Lights', solid=False)
K.text('ARENA', 0, 6.1, HZ - 0.45, 0.45, 'blue', 'Signs', facing='-z')
K.text('ARENA', 0, 6.1, -HZ, 0.45, 'red', 'Signs', facing='+z')

# ---- the ledges: a ramp from the middle, a high deck on the side wall with a covered pocket under it -------------------------------------
DECK = 4.2
S.ramp(8.0, -12.0, 14.0, 0.0, 0.0, DECK, '+z', 'rampG', 'Ledges', bottom=0.0)
S.box(8.0, DECK - 0.6, 0.0, 14.0, DECK, 22.0, 'deck', 'Ledges')                         # the deck slab (hollow below)
S.box(8.0, 0.0, 7.4, 8.8, DECK - 0.6, 8.2, 'pillar', 'Ledges')                          # two columns on the open edge
S.box(8.0, 0.0, 14.6, 8.8, DECK - 0.6, 15.4, 'pillar', 'Ledges')
S.box(8.0, DECK, 6.0, 8.5, DECK + 1.2, 17.0, 'parapet', 'Ledges')                       # cover along the edge (entries at both ends)
S.box(10.6, DECK, 11.4, 11.8, DECK + 3.6, 12.6, 'pillar', 'Ledges')                     # a tall pillar splits the deck
T(8.0, 8.5, 0.0, 6.0, DECK + 0.012, 'orange', 'Ledges')                                 # edge stripes at the entries
T(8.0, 8.5, 17.0, 22.0, DECK + 0.012, 'orange', 'Ledges')
K.under(10.4, 11.6, 1.0, 21.0, DECK - 0.62, 'strip', 'Lights')                          # lamp panels under the deck
K.under(-11.6, -10.4, -21.0, -1.0, DECK - 0.62, 'strip', 'Lights')
# a ramp at the spawn end (beside the spawn pads, against the end wall) up to the deck: 9 m long, the same walk-up as the long ramp, only steeper
S.ramp(-1.0, 18.0, 8.0, 22.0, 0.0, DECK, '+x', 'rampG', 'Ledges', bottom=0.0)
T(-1.25, -0.95, 18.0, 22.0, 0.02, 'orange', 'Ledges')                                  # a stripe marks the foot of the ramp

# ---- the centre: a low plinth, a catwalk bridge across the middle linking the two decks --------------------------------------------------
K.box(-3.2, 0.0, -2.2, 3.2, 1.2, 2.2, 'block', 'Centre')
K.top(-3.0, 3.0, -2.0, 2.0, 1.214, 'blockTop', 'Centre')
S.box(3.2, 0.0, -1.2, 4.2, 0.6, 1.2, 'stair', 'Centre')                                 # a step on each end of the plinth
K.box(-8.0, 3.6, -1.5, 8.0, DECK, 1.5, 'catwalk', 'Centre')
S.box(-8.0, DECK, -1.5, 8.0, DECK + 1.0, -1.15, 'rail', 'Centre')                      # rails along both sides
K.box(-0.6, 1.2, -0.6, 0.6, 3.6, 0.6, 'pillar', 'Centre')                               # the column that carries the middle
K.under(-6.0, 6.0, -0.4, 0.4, 3.58, 'strip', 'Lights')

# ---- the gates: tall hollowed walls in front of the spawn pads -----------------------------------------------------------------------------
for (zc, fm) in ((15.5, 'blueD'), (-15.5, 'redD')):                                       # blue gate behind the blue pad, red behind the red one
    K.wall('x', -6.0, 6.0, zc, 0.8, 0.0, 6.0, 'wall', 'Gates',
           holes=[(-1.6, 1.6, 0.0, 3.4), (-4.9, -3.5, 2.2, 4.6), (3.5, 4.9, 2.2, 4.6)], frame=fm)
S.box(-6.2, 6.0, 15.05, 6.2, 6.35, 15.95, 'cap', 'Gates')
S.box(-6.0, 0.0, 15.05, 6.0, 0.55, 15.95, 'plinth', 'Gates', solid=False)

# ---- turned slabs (cover on the diagonal), a tall bar, low blocks ---------------------------------------------------------------------------
for (cx, cz, ln, yaw) in ((-5.8, 11.6, 6.4, 0.62), (4.5, 9.5, 6.4, -0.62)):
    S.slab(cx, cz, ln, 0.9, yaw, 0.0, 2.8, 'slab', 'Slabs')
    S.box(cx - ln / 2 - 0.08, 2.8, cz - 0.53, cx + ln / 2 + 0.08, 3.0, cz + 0.53, 'slabEdge', 'Slabs', yaw=yaw, solid=False)
    S.box(cx - ln / 2 - 0.02, 0.0, cz - 0.47, cx + ln / 2 + 0.02, 0.35, cz + 0.47, 'plinth', 'Slabs', yaw=yaw, solid=False)
S.box(-1.4, 0.0, 10.4, 0.0, 7.5, 11.8, 'pillar', 'Cover')                               # tall bar between the slabs
S.box(-1.5, 7.5, 10.3, 0.1, 7.8, 11.9, 'cap', 'Cover', solid=False)
S.box(-2.2, 0.0, 5.0, 2.2, 1.2, 6.2, 'block', 'Cover')                                  # low wall across the middle
S.box(-2.3, 1.2, 4.9, 2.3, 1.3, 6.3, 'blockTop', 'Cover', solid=False)
S.box(-13.0, 0.0, 15.0, -11.0, 1.2, 17.2, 'block', 'Cover')                             # a corner stack by the spawn
S.box(-13.0, 1.2, 15.0, -11.9, 2.4, 16.1, 'block', 'Cover')

# ---- spawns (three behind each gate + the twins), dummies ------------------------------------------------------------------------------------
for (sx, sz) in ((-10.2, 19.2), (-7.6, 20.6), (-5.2, 18.4), (-2.9, 20.5), (-8.0, 17.2), (-3.9, 17.5)):
    S.spawn(sx, 0.0, sz)
K.dummy(-5.5, 0, 3.4, 0.0)
K.dummy(5.5, 0, -3.4, 3.14159)

sc, root = K.build()
K.camera('top', (0, 130, 0.01), (0, 0, 0), ortho=56)
K.camera('iso', (-34, 30, 36), (0, 2, 0), lens=24)
K.camera('iso2', (34, 30, -36), (0, 2, 0), lens=24)
K.camera('spawn', (-4.0, 1.62, 19.9), (0, 1.6, -10))
K.camera('deck', (11.5, 5.8, 20.0), (-4, 3.0, -8))
K.camera('mid', (0, 1.62, 8.0), (0, 2.0, -20))
result = {'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data()}
