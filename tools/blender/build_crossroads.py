"""
CROSSROADS - an original open-air duel map (metres, 92 x 92). Not a copy of any existing map.
Two roads cross in a field. At the junction a stepped stone MONUMENT (a jumpable 3-tier plinth with an obelisk) is the landmark and the
sightline breaker; a STONE FORT (north-west) and a WAREHOUSE (north-east) - with their rotated twins in the south-east and south-west -
give interiors, windows and roof positions; rock outcrops shield both road ends where the spawns are; hay, walls, crates and trees are the
cover in the fields. Rotationally symmetric (180 degrees), cliffs close the map in.
Routes: the two roads (open, fast), the fields (cover hopping), through the buildings (enclosed), over the roofs (ramp / stairs).
Run inside Blender; writes js/mesh-crossroads.js + js/mapdata-crossroads.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())
import random

K = Kit('crossroads', 'Crossroads', 'CROSSROADS', scene_name='DASHDUEL_Crossroads')
K.script = 'build_crossroads.py'
S = Sym(K, 'rot')
rng = random.Random(23)
for n, h in {
    'grass': 0x7fcf6a, 'grassDark': 0x62bb5c, 'dirt': 0xc8a574, 'road': 0x555b66, 'roadLine': 0xf3e9a6, 'roadEdge': 0xd9d2bd,
    'stone': 0xb9b3a6, 'stoneDark': 0x8b857a, 'stoneLight': 0xd3cdbf, 'rock': 0x8f8b86, 'rockLight': 0xb0aba3, 'rockDark': 0x6e6a66,
    'wood': 0x9b6a3c, 'woodDark': 0x6d4a2b, 'woodLight': 0xc89a63, 'roofR': 0xc7553d, 'roofD': 0x9b3f2e,
    'plaster': 0xf1e6cf, 'brick': 0xb8654a, 'hay': 0xe3c35b, 'hayDark': 0xc9a63f, 'trunk': 0x7a5a3a, 'leaf': 0x3fae52, 'leaf2': 0x5fcc6c,
    'crate': 0xc99a5b, 'crateDark': 0x9a7440, 'metal': 0x6a7a8c, 'barrel': 0xd04a3a, 'flagR': 0xe5484d, 'flagB': 0x3b82f6, 'glassD': 0x2d3f57,
    'door': 0x6d4a2b, 'shelf': 0x8a6b45,
}.items():
    K.mat(n, h)
for n, h in {'lamp': 0xfff3b0, 'goldCap': 0xffd23f}.items():
    K.mat(n, h, 'emit')

H = 46.0   # half size of the playable field

# ---- ground, roads ------------------------------------------------------------------------------------------------------------------
K.box(-H - 8, -3, -H - 8, H + 8, 0, H + 8, 'grass', 'Ground')
for ix in range(-H.__int__(), H.__int__(), 8):             # darker grass patches (checker) for scale
    for iz in range(-int(H), int(H), 8):
        if ((ix // 8) + (iz // 8)) % 2 == 0:
            K.top(ix, ix + 8, iz, iz + 8, 0.012, 'grassDark', 'Ground')
K.top(-5, 5, -H, H, 0.02, 'road', 'Roads')
K.top(-H, H, -5, 5, 0.02, 'road', 'Roads')
for z in range(-int(H), int(H), 6):
    if abs(z + 1.5) > 7:
        K.top(-0.15, 0.15, z, z + 3, 0.04, 'roadLine', 'Roads')
for x in range(-int(H), int(H), 6):
    if abs(x + 1.5) > 7:
        K.top(x, x + 3, -0.15, 0.15, 0.04, 'roadLine', 'Roads')
for s in (-5.0, 5.0):
    K.top(s - 0.12, s + 0.12, -H, -5, 0.04, 'roadEdge', 'Roads')
    K.top(s - 0.12, s + 0.12, 5, H, 0.04, 'roadEdge', 'Roads')

# ---- the monument at the junction -------------------------------------------------------------------------------------------------------
K.prism('y', 0, 0.45, 0, 5.2, 0.9, 'stoneDark', 'Monument')      # plinth, 0.9 high
K.prism('y', 0, 1.45, 0, 3.6, 1.1, 'stone', 'Monument')          # second tier (top 2.0)
K.prism('y', 0, 2.6, 0, 2.2, 1.2, 'stoneLight', 'Monument')      # third tier (top 3.2): a small high platform in the middle of the map
K.prism('y', 0, 6.2, 0, 1.0, 6.0, 'stone', 'Monument')           # obelisk
K.prism('y', 0, 9.45, 0, 1.3, 0.5, 'stoneDark', 'Monument', solid=False)
K.prism('y', 0, 9.9, 0, 0.7, 0.45, 'goldCap', 'Monument', solid=False)

# ---- stone FORT (north-west; twin in the south-east) ----------------------------------------------------------------------------------------
fx0, fx1, fz0, fz1 = -38.0, -24.0, -38.0, -26.0   # 14 x 12
WT, WH = 0.8, 4.2
S.wall('x', fx0, fx1, fz1 - WT / 2, WT, 0, WH, 'stone', 'Fort', holes=[(-33.0, -30.6, 0, 2.8), (-28.0, -26.5, 1.3, 2.6)], frame='stoneDark')       # south wall (towards the road) : a door and a window
S.wall('x', fx0, fx1, fz0 + WT / 2, WT, 0, WH, 'stone', 'Fort', holes=[(-32.0, -29.6, 0, 2.8)], frame='stoneDark')                                 # north wall: back door
S.wall('z', fz0, fz1, fx0 + WT / 2, WT, 0, WH, 'stone', 'Fort', holes=[(-34.0, -32.6, 1.3, 2.6)], frame='stoneDark')                               # west wall
S.wall('z', fz0, fz1, fx1 - WT / 2, WT, 0, WH, 'stone', 'Fort', holes=[(-33.5, -31.0, 0, 2.8), (-29.5, -28.3, 1.3, 2.6)], frame='stoneDark')       # east wall (the road side)
S.box(fx0, WH, fz0, fx1, WH + 0.5, fz1, 'stoneDark', 'Fort')                                                                                        # roof slab
S.box(fx0 - 0.2, WH + 0.5, fz0 - 0.2, fx1 + 0.2, WH + 1.5, fz0 + 0.5, 'stoneLight', 'Fort')                                                          # roof parapet (3 sides: the east side stays open for the ramp)
S.box(fx0 - 0.2, WH + 0.5, fz1 - 0.5, fx1 + 0.2, WH + 1.5, fz1 + 0.2, 'stoneLight', 'Fort')
S.box(fx0 - 0.2, WH + 0.5, fz0 + 0.5, fx0 + 0.5, WH + 1.5, fz1 - 0.5, 'stoneLight', 'Fort')
S.ramp(fx1, -36.5, -15.0, -33.0, 0.0, WH + 0.5, '-x', 'stoneDark', 'Fort', bottom=0.0)         # ramp up to the roof from the east (rises towards the fort)
for (cx, cz, w, h, d) in ((-34.0, -34.0, 2.0, 1.2, 2.0), (-28.0, -31.5, 3.0, 1.0, 0.8), (-36.0, -29.0, 1.6, 2.0, 1.6)):    # interior cover
    S.boxc(cx, 0, cz, w, h, d, 'crate', 'Fort')
for xc in (fx0 + 1.5, fx1 - 1.5):                                                                                                                      # corner turrets (visual)
    S.box(xc - 1.0, WH + 1.5, fz0 - 0.2, xc + 1.0, WH + 2.4, fz0 + 0.5, 'stoneLight', 'Fort', solid=False)

# ---- WAREHOUSE (north-east; twin in the south-west) --------------------------------------------------------------------------------------------
wx0, wx1, wz0, wz1 = 18.0, 38.0, -38.0, -26.0     # 20 x 12
WHH = 5.0
S.wall('x', wx0, wx1, wz1 - 0.3, 0.6, 0, WHH, 'brick', 'Warehouse', holes=[(21.0, 24.2, 0, 3.2), (26.2, 27.4, 2.4, 3.8), (30.2, 31.4, 2.4, 3.8), (33.2, 34.4, 2.4, 3.8)], frame='woodDark')   # south wall: a big door, three high windows
S.wall('x', wx0, wx1, wz0 + 0.3, 0.6, 0, WHH, 'brick', 'Warehouse', holes=[(24.0, 27.2, 0, 3.2), (28.0, 31.2, 0, 3.2)], frame='woodDark')                                           # north wall
S.wall('z', wz0, wz1, wx0 + 0.3, 0.6, 0, WHH, 'brick', 'Warehouse', holes=[(-33.0, -30.4, 0, 2.8), (-35.5, -34.3, 2.4, 3.8)], frame='woodDark')                                    # west end
S.wall('z', wz0, wz1, wx1 - 0.3, 0.6, 0, WHH, 'brick', 'Warehouse', holes=[(-32.4, -30.0, 0, 2.8)], frame='woodDark')                                                                 # east end
S.box(wx0, WHH, wz0, wx1, WHH + 0.4, wz1, 'roofD', 'Warehouse')
S.box(wx0 - 0.3, WHH + 0.4, wz0 - 0.3, wx1 + 0.3, WHH + 0.9, wz0 + 0.1, 'roofR', 'Warehouse', solid=False)
S.stairs(wx1 - 10.0, wz1, wx1, wz1 + 3.0, 0.0, WHH + 0.4, '-x', 12, 'woodLight', 'Warehouse')    # stairs along the south wall up to the roof (turn north at the top)
for (sx, sz) in ((22.5, -34.0), (22.5, -29.0), (30.0, -34.0), (30.0, -29.0)):                      # shelf blocks inside
    S.boxc(sx, 0, sz, 5.0, 2.2, 1.4, 'shelf', 'Warehouse')
    S.boxc(sx, 2.2, sz, 5.0, 0.15, 1.5, 'woodDark', 'Warehouse', solid=False)
for (sx, sz) in ((35.0, -33.0), (35.0, -30.5)):
    S.boxc(sx, 0, sz, 2.0, 1.8, 2.0, 'crate', 'Warehouse')

# ---- rock outcrops that shield the road ends (spawn alleys) --------------------------------------------------------------------------------------
for (x0, x1, z0, z1) in ((-44.0, -33.0, -14.0, -8.0), (-44.0, -33.0, 8.0, 14.0)):
    h = 1.2
    S.box(x0, 0, z0, x1, h, z1, 'rock', 'Rocks')
    S.box(x0 + 1.5, h, z0 + 1.0, x1 - 1.5, h * 2, z1 - 1.0, 'rockLight', 'Rocks')
    S.box(x0 + 3.0, h * 2, z0 + 2.0, x1 - 3.0, h * 3, z1 - 2.0, 'rock', 'Rocks')
# ---- field cover: hay, low walls, crates, wells, trees -------------------------------------------------------------------------------------------
for (cx, cz) in ((-14.0, -14.0), (-20.0, 18.0), (12.0, 22.0), (-12.0, 32.0)):
    S.boxc(cx, 0, cz, 2.2, 1.3, 1.4, 'hay', 'Cover')
    S.boxc(cx + 2.4, 0, cz + 0.3, 2.2, 1.3, 1.4, 'hayDark', 'Cover')
    S.boxc(cx + 1.2, 1.3, cz + 0.1, 2.2, 1.1, 1.4, 'hay', 'Cover')
for (x0, x1, z0, z1) in ((-18.0, -8.0, -28.0, -27.2), (8.0, 18.0, 12.0, 12.8), (-30.0, -29.2, 4.0, 12.0)):
    S.box(x0, 0, z0, x1, 1.0, z1, 'stone', 'Cover')
    S.box(x0 - 0.1, 1.0, z0 - 0.1, x1 + 0.1, 1.15, z1 + 0.1, 'stoneLight', 'Cover', solid=False)
for (cx, cz) in ((-10.0, 8.0), (14.0, -14.0), (-26.0, 24.0), (30.0, 6.0)):                       # crate stacks
    S.boxc(cx, 0, cz, 2.0, 2.0, 2.0, 'crate', 'Cover')
    S.boxc(cx, 0.0, cz, 2.2, 0.15, 2.2, 'crateDark', 'Cover', solid=False)
    S.boxc(cx + 0.3, 2.0, cz - 0.2, 1.4, 1.2, 1.4, 'crateDark', 'Cover')
for (cx, cz) in ((-20.0, -10.0), (22.0, -2.0), (4.0, 36.0)):                                     # wells / water troughs
    S.prism('y', cx, 0.6, cz, 1.2, 1.2, 'stone', 'Cover')
    S.prism('y', cx, 1.3, cz, 0.9, 0.2, 'woodDark', 'Cover', solid=False)
for (cx, cz) in ((-30.0, -12.0), (-12.0, -36.0), (24.0, 18.0), (36.0, -16.0), (-6.0, 22.0), (14.0, 36.0)):     # trees: solid trunk, leafy canopy you can duck under
    S.prism('y', cx, 2.0, cz, 0.45, 4.0, 'trunk', 'Trees')
    S.box(cx - 2.4, 3.8, cz - 2.4, cx + 2.4, 5.8, cz + 2.4, 'leaf', 'Trees', solid=False)
    S.box(cx - 1.6, 5.8, cz - 1.6, cx + 1.6, 7.2, cz + 1.6, 'leaf2', 'Trees', solid=False)
for (cx, cz) in ((-24.0, 8.0), (26.0, -28.0), (6.0, 14.0)):                                    # barrels
    S.prism('y', cx, 0.55, cz, 0.55, 1.1, 'barrel', 'Cover')
    S.prism('y', cx + 1.2, 0.55, cz + 0.3, 0.55, 1.1, 'woodDark', 'Cover')
# flags on poles at the road ends (landmarks)
for (fx, fz, m) in ((-42.0, -6.0, 'flagB'), ):
    S.prism('y', fx, 3.0, fz, 0.12, 6.0, 'metal', 'Props', solid=False)
    S.box(fx, 4.4, fz - 0.05, fx + 2.2, 5.9, fz + 0.05, m, 'Props', solid=False, mat2='flagR')

# ---- cliffs around the field (solid; stepped silhouette) --------------------------------------------------------------------------------------
def cliff_row():
    x = -H - 4
    k = 0
    while x < H + 4 - 1e-6:
        w = min(rng.choice([6.0, 8.0, 10.0, 12.0]), H + 4 - x)
        h = rng.choice([6.0, 7.5, 9.0, 10.5, 12.0])
        S.box(x, 0, -H - 6, x + w, h, -H, 'rock' if k % 2 else 'rockDark', 'Cliffs', mat2='rockLight' if k % 2 else 'rock')
        S.box(x + 1.0, h, -H - 5.0, x + w - 1.0, h + 1.2, -H - 1.0, 'rockLight', 'Cliffs', solid=False)
        x += w
        k += 1
    z = -H
    k = 1
    while z < H - 1e-6:
        w = min(rng.choice([6.0, 8.0, 10.0, 12.0]), H - z)
        h = rng.choice([6.0, 7.5, 9.0, 10.5, 12.0])
        S.box(-H - 6, 0, z, -H, h, z + w, 'rock' if k % 2 else 'rockDark', 'Cliffs', mat2='rockLight' if k % 2 else 'rock')
        S.box(-H - 5.0, h, z + 1.0, -H - 1.0, h + 1.2, z + w - 1.0, 'rockLight', 'Cliffs', solid=False)
        z += w
        k += 1
cliff_row()

# ---- spawns: both road ends (and their rotated twins) --------------------------------------------------------------------------------------------
for (sx, sz) in ((-42.0, 0.0), (-40.0, -3.4), (-40.0, 3.4), (0.0, -42.0), (3.4, -40.0), (-3.4, -40.0)):
    S.spawn(sx, 0.0, sz)
K.dummy(-14, 0, 5, 0.0)
K.dummy(14, 0, -5, 3.14159)

sc, root = K.build()
K.camera('top', (0, 160, 0.01), (0, 0, 0), ortho=120)
K.camera('iso', (-70, 55, 70), (0, 0, 0), lens=26)
K.camera('iso2', (70, 55, -70), (0, 0, 0), lens=26)
K.camera('fort', (-14, 3.0, -28), (-30, 3.0, -32))
K.camera('road', (-42, 1.62, 0), (40, 1.6, 0))
result = {'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data()}
