"""
DOCKS - an original waterfront-industrial duel map (metres, 96 x 56). Not a copy of any existing map.
The north edge is open WATER (falling in is lethal: the map's kill height sits just below the surface). A central pier and two side piers
reach into the water. The cargo yard is a maze of stacked CONTAINERS (alleys, double stacks, open ends); the HARBOUR OFFICE and the
WAREHOUSE (mirror images of each other) are two-floor buildings with doors, windows, stairs and interiors; a DOCKMASTER'S HUT and a gantry
CRANE stand on the quay. Mirror symmetric (left/right), so both spawn ends are identical.
Routes: the open quay (fast, exposed to the water edge), the container alleys, through the buildings, over the roofs of low stacks.
Run inside Blender; writes js/mesh-docks.js + js/mapdata-docks.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())
import random

K = Kit('docks', 'Docks', 'DOCKS', scene_name='DASHDUEL_Docks')
K.script = 'build_docks.py'
S = Sym(K, 'mirx')
rng = random.Random(5)
for n, h in {
    'quay': 0xb8b5ad, 'quayDark': 0x8f8c84, 'asphalt': 0x4b5160, 'lineY': 0xf2c230, 'lineW': 0xf0f0e8, 'wood': 0x9b6a3c, 'woodDark': 0x5f4126, 'piling': 0x4a3a2a,
    'steel': 0x6a7a8c, 'steelDark': 0x465362, 'yellow': 0xe9b824, 'black': 0x23272f,
    'cRed': 0xc0392b, 'cBlue': 0x2e6db4, 'cOrange': 0xe67e22, 'cGreen': 0x2f9e6a, 'cWhite': 0xdfe6ee, 'cYellow': 0xe9b824, 'cTeal': 0x2aa6a0, 'cDoor': 0x3a2a24, 'cRib': 0x00000,
    'brickD': 0xa6563a, 'plasterD': 0xe3d2b0, 'plasterB': 0xc9d8e4, 'roofG': 0x5d6b78, 'glassD': 0x2d3f57, 'frame': 0xf4f1e8, 'floorI': 0xc9b08a, 'slab': 0x9a9a95,
    'crate': 0xc99a5b, 'crateD': 0x9a7440, 'barrel': 0xd04a3a, 'bollard': 0xe5484d, 'desk': 0x7c5cff, 'shelf': 0x8a6b45, 'fence': 0x6a7a8c, 'far1': 0x8fa0b5, 'far2': 0x7a8ba3, 'far3': 0xa7b4c6,
    'hullR': 0xc0392b, 'hullW': 0xf1f1ee,
}.items():
    K.mat(n, h)
for n, h in {'lamp': 0xfff3b0, 'warn': 0xff7a00}.items():
    K.mat(n, h, 'emit')
CONT = ['cRed', 'cBlue', 'cOrange', 'cGreen', 'cWhite', 'cYellow', 'cTeal']

XL, XR, ZN, ZS = -46.0, 46.0, -20.0, 30.0   # land: x -46..46, quay edge z=-20, south boundary z=30

# ---- ground, quay, piers ---------------------------------------------------------------------------------------------------------------
K.box(XL - 2, -8, ZN, XR + 2, 0, ZS + 2, 'quay', 'Ground')                      # the land (its north face is the quay wall)
for ix in range(-46, 46, 4):                                                       # paving pattern
    for iz in range(-20, 30, 4):
        if (ix // 4 + iz // 4) % 2 == 0:
            K.top(ix, ix + 4, iz, iz + 4, 0.012, 'quayDark', 'Ground')
K.top(-8.8, 8.8, -20, 30, 0.02, 'asphalt', 'Ground')                              # central lane
for z in range(-18, 30, 6):
    K.top(-0.15, 0.15, z, z + 3, 0.03, 'lineY', 'Ground')
K.box(XL - 2, 0, ZN, XR + 2, 0.22, ZN + 0.5, 'quayDark', 'Ground', solid=False)    # kerb along the quay edge
K.box(-3.5, -0.6, -46, 3.5, 0, -20, 'wood', 'Piers')                              # central pier
S.box(19.0, -0.6, -34, 25.0, 0, -20, 'wood', 'Piers')                              # side piers
for z in range(-44, -20, 4):                                                       # planking lines
    K.box(-3.5, 0, z, 3.5, 0.02, z + 0.12, 'woodDark', 'Piers', solid=False)
for z in range(-32, -20, 4):
    S.box(19.0, 0, z, 25.0, 0.02, z + 0.12, 'woodDark', 'Piers', solid=False)
for z in range(-44, -20, 6):                                                       # pilings (visible between the deck and the water)
    for x in (-3.0, 3.0):
        K.prism('y', x, -1.5, z, 0.35, 3.0, 'piling', 'Piers', solid=False)
for z in (-32.0, -26.0):
    S.prism('y', 19.4, -1.5, z, 0.35, 3.0, 'piling', 'Piers', solid=False)
    S.prism('y', 24.6, -1.5, z, 0.35, 3.0, 'piling', 'Piers', solid=False)
for (bx, bz) in ((-3.0, -44.0), (3.0, -44.0), (-3.0, -36.0), (3.0, -36.0), (-3.0, -28.0), (3.0, -28.0)):   # mooring bollards on the pier
    K.prism('y', bx, 0.3, bz, 0.3, 0.6, 'bollard', 'Piers', solid=False)
for z in (-32.0, -24.0):
    S.prism('y', 19.4, 0.3, z, 0.3, 0.6, 'bollard', 'Piers', solid=False)
# moored boats beside the central pier (low, not walkable)
for sx in (-1, 1):
    K.box(sx * 5.0 - 1.4, -2.6, -42, sx * 5.0 + 1.4, -1.2, -32, 'hullR' if sx < 0 else 'hullW', 'Boats', solid=False)
    K.box(sx * 5.0 - 1.0, -1.2, -38, sx * 5.0 + 1.0, 0.3, -34, 'hullW' if sx < 0 else 'hullR', 'Boats', solid=False)

# ---- containers ---------------------------------------------------------------------------------------------------------------------
def cont(x0, z0, col, along='x', level=0, col2=None):
    L, Wd, Hh = 12.2, 2.45, 2.6
    y0 = level * Hh
    if along == 'x':
        bx0, bx1, bz0, bz1 = x0, x0 + L, z0, z0 + Wd
    else:
        bx0, bx1, bz0, bz1 = x0, x0 + Wd, z0, z0 + L
    S.box(bx0, y0, bz0, bx1, y0 + Hh, bz1, col, 'Containers', mat2=col2)
    # top frame + corrugation ribs (visual)
    S.box(bx0 - 0.03, y0 + Hh - 0.1, bz0 - 0.03, bx1 + 0.03, y0 + Hh + 0.04, bz1 + 0.03, 'steelDark', 'ContDetail', solid=False)
    S.box(bx0 - 0.03, y0, bz0 - 0.03, bx1 + 0.03, y0 + 0.12, bz1 + 0.03, 'steelDark', 'ContDetail', solid=False)
    n = 10
    for i in range(1, n):
        t = i / n
        if along == 'x':
            xx = bx0 + (bx1 - bx0) * t
            S.box(xx - 0.05, y0 + 0.12, bz0 - 0.04, xx + 0.05, y0 + Hh - 0.1, bz0, 'steelDark', 'ContDetail', solid=False, mat2=None)
            S.box(xx - 0.05, y0 + 0.12, bz1, xx + 0.05, y0 + Hh - 0.1, bz1 + 0.04, 'steelDark', 'ContDetail', solid=False)
        else:
            zz = bz0 + (bz1 - bz0) * t
            S.box(bx0 - 0.04, y0 + 0.12, zz - 0.05, bx0, y0 + Hh - 0.1, zz + 0.05, 'steelDark', 'ContDetail', solid=False)
            S.box(bx1, y0 + 0.12, zz - 0.05, bx1 + 0.04, y0 + Hh - 0.1, zz + 0.05, 'steelDark', 'ContDetail', solid=False)
    # doors on the +x / +z end
    if along == 'x':
        S.box(bx1, y0 + 0.2, bz0 + 0.15, bx1 + 0.05, y0 + Hh - 0.2, bz1 - 0.15, 'cDoor', 'ContDetail', solid=False)
        S.box(bx1, y0 + 0.2, (bz0 + bz1) / 2 - 0.03, bx1 + 0.08, y0 + Hh - 0.2, (bz0 + bz1) / 2 + 0.03, 'steel', 'ContDetail', solid=False)
    else:
        S.box(bx0 + 0.15, y0 + 0.2, bz1, bx1 - 0.15, y0 + Hh - 0.2, bz1 + 0.05, 'cDoor', 'ContDetail', solid=False)

# the left half of the yard (mirrored to the right)
cont(-36.0, -6.5, 'cRed')
cont(-36.0, -6.5, 'cBlue', level=1, col2='cOrange')
cont(-20.8, -6.5, 'cGreen', col2='cTeal')
cont(-36.0, -1.2, 'cWhite', col2='cYellow')
cont(-20.8, -1.2, 'cOrange', col2='cBlue')
cont(-20.8, -1.2, 'cYellow', level=1, col2='cRed')
cont(-31.0, 5.0, 'cTeal', col2='cRed')
cont(-15.5, 5.0, 'cBlue', col2='cGreen')
cont(-43.2, -14.0, 'cGreen', along='z', col2='cOrange')            # turned ones at the edges
cont(-43.2, -14.0, 'cRed', along='z', level=1, col2='cWhite')
cont(-34.0, -17.0, 'cWhite', col2='cRed')                       # on the quay, towards the water
# smaller cover: crates, barrels, pallets
for (cx, cz, w, h, d) in ((-10.5, -10.0, 2.0, 1.3, 2.0), (-24.0, -12.0, 2.2, 2.2, 1.6), (-12.0, 12.0, 2.4, 1.2, 1.6), (-40.0, 8.0, 2.0, 1.3, 2.0), (-26.0, 12.5, 1.6, 1.6, 1.6)):
    S.boxc(cx, 0, cz, w, h, d, 'crate', 'Cover')
    S.boxc(cx, h, cz, w + 0.12, 0.1, d + 0.12, 'crateD', 'Cover', solid=False)
for (cx, cz) in ((-12.5, -14.0), (-27.0, 2.0), (-9.8, 2.0), (-38.0, -13.0)):
    S.prism('y', cx, 0.55, cz, 0.55, 1.1, 'barrel', 'Cover')
    S.prism('y', cx + 1.2, 0.55, cz + 0.2, 0.55, 1.1, 'yellow', 'Cover')

# ---- the gantry crane over the central lane ----------------------------------------------------------------------------------------------
S.box(8.3, 0, -15.0, 10.1, 11.0, -13.2, 'yellow', 'Crane')
S.box(8.0, 0, -15.3, 10.4, 0.5, -12.9, 'steelDark', 'Crane', solid=False)
K.box(-10.1, 10.2, -15.0, 10.1, 11.6, -13.2, 'yellow', 'Crane')
K.box(-10.1, 11.6, -14.6, 10.1, 11.8, -13.6, 'steelDark', 'Crane', solid=False)
K.box(-3.0, 8.0, -14.7, 3.0, 10.2, -13.5, 'steel', 'Crane', solid=False)                  # trolley / cab
for x in range(-9, 10, 3):
    K.box(x, 11.0, -13.2, x + 0.2, 11.6, -13.0, 'warn', 'Crane', solid=False)

# ---- DOCKMASTER'S HUT (on the quay, between the crane and the east pier) ------------------------------------------------------------------------
hx0, hx1, hz0, hz1 = 11.0, 18.0, -17.0, -11.0
S.wall('x', hx0, hx1, hz1 - 0.25, 0.5, 0, 3.4, 'plasterD', 'Hut', holes=[(12.2, 14.0, 0, 2.5)], frame='woodDark', mat2='plasterB')
S.wall('x', hx0, hx1, hz0 + 0.25, 0.5, 0, 3.4, 'plasterD', 'Hut', holes=[(12.6, 14.6, 1.2, 2.5), (15.4, 17.0, 1.2, 2.5)], frame='woodDark', mat2='plasterB')
S.wall('z', hz0, hz1, hx0 + 0.25, 0.5, 0, 3.4, 'plasterD', 'Hut', holes=[(-15.2, -13.2, 1.2, 2.5)], frame='woodDark', mat2='plasterB')
S.wall('z', hz0, hz1, hx1 - 0.25, 0.5, 0, 3.4, 'plasterD', 'Hut', holes=[(-14.8, -12.6, 1.2, 2.5)], frame='woodDark', mat2='plasterB')
S.box(hx0 - 0.3, 3.4, hz0 - 0.3, hx1 + 0.3, 3.9, hz1 + 0.3, 'roofG', 'Hut', mat2='roofG')
S.boxc(14.5, 0, -15.5, 2.6, 0.95, 0.9, 'desk', 'Hut', mat2='shelf')

# ---- the two TWO-FLOOR BUILDINGS (harbour office on the left, warehouse on the right: mirror images) ----------------------------------------------
bx0, bx1, bz0, bz1 = -42.0, -24.0, 17.0, 30.0
FH = 3.6      # floor to floor
BH = 7.6      # wall height
T = 0.5
def window_holes(a0, a1, skip=(), floors=(1.2, 4.8)):
    out = []
    u = a0 + 1.6
    while u + 1.4 < a1 - 1.0:
        if not any(s0 - 0.6 < u < s1 + 0.6 for (s0, s1) in skip):
            for fy in floors:
                out.append((u, u + 1.4, fy, fy + 1.4))
        u += 3.2
    return out
south_skip = ((-35.4, -33.2),)
S.wall('x', bx0, bx1, bz0 + T / 2, T, 0, BH, 'brickD', 'Buildings', holes=[(-35.4, -33.2, 0, 2.6)] + window_holes(bx0, bx1, south_skip), frame='frame', mat2='plasterB')   # facade towards the yard
S.wall('x', bx0, bx1, bz1 - T / 2, T, 0, BH, 'brickD', 'Buildings', holes=window_holes(bx0, bx1), frame='frame', mat2='plasterB')                                      # back wall (map edge)
S.wall('z', bz0, bz1, bx0 + T / 2, T, 0, BH, 'brickD', 'Buildings', holes=window_holes(bz0, bz1), frame='frame', mat2='plasterB')                                    # outer side
S.wall('z', bz0, bz1, bx1 - T / 2, T, 0, BH, 'brickD', 'Buildings', holes=[(20.4, 22.8, 0, 2.6)] + window_holes(bz0, bz1, ((20.4, 22.8),)), frame='frame', mat2='plasterB')  # side towards the central lane (door)
S.box(bx0, BH, bz0, bx1, BH + 0.5, bz1, 'roofG', 'Buildings')                                                                                                   # roof slab
S.box(bx0 - 0.2, BH + 0.5, bz0 - 0.2, bx1 + 0.2, BH + 1.2, bz0 + 0.2, 'quayDark', 'Buildings', solid=False)
# first-floor slab with the stair opening in the south-west corner of the building
S.box(bx0 + T, FH, bz0 + T + 6.0, bx0 + T + 2.2, FH + 0.4, bz1 - T, 'floorI', 'Buildings')
S.box(bx0 + T + 2.2, FH, bz0 + T, bx1 - T, FH + 0.4, bz1 - T, 'floorI', 'Buildings')
S.stairs(bx0 + T, bz0 + T, bx0 + T + 2.2, bz0 + T + 6.0, 0.0, FH + 0.4, '+z', 9, 'woodDark', 'Buildings')
# interior cover on both floors
for (cx, cz) in ((-33.0, 22.0), (-29.0, 26.0), (-37.5, 27.5)):
    S.boxc(cx, 0, cz, 2.2, 1.0, 1.0, 'desk', 'Interior', mat2='shelf')
    S.boxc(cx, FH + 0.4, cz + 0.2, 2.2, 1.0, 1.0, 'desk', 'Interior', mat2='shelf')
S.boxc(-26.8, 0, 26.0, 1.0, 2.2, 3.6, 'shelf', 'Interior')
S.boxc(-26.8, FH + 0.4, 21.0, 1.0, 2.0, 3.0, 'shelf', 'Interior')
S.boxc(-29.0, 0, 18.4, 4.0, 1.1, 0.9, 'desk', 'Interior', mat2='shelf')                     # counter next to the door

# ---- perimeter: fences along the sides, far shore across the water (visual) --------------------------------------------------------------------
S.box(XL - 1.0, 0, ZN, XL, 3.4, ZS, 'fence', 'Fences')
for z in range(-20, 30, 4):
    S.box(XL - 1.15, 0, z - 0.1, XL - 0.95, 3.7, z + 0.1, 'steelDark', 'Fences', solid=False)
# flood-light masts at the corners
for (lx, lz) in ((-45.0, 2.0), (-45.0, 16.0)):
    S.prism('y', lx, 5.5, lz, 0.2, 11.0, 'steelDark', 'Props', solid=False)
    S.box(lx - 0.6, 11.0, lz - 0.6, lx + 0.6, 11.5, lz + 0.6, 'lamp', 'Props', solid=False)
for i in range(22):                                                                                # skyline across the water
    x = -60 + i * 5.6 + rng.random() * 2
    w = 4 + rng.random() * 4
    h = 6 + rng.random() * 16
    K.box(x, 0, -88 - rng.random() * 8, x + w, h, -80 - rng.random() * 3, ['far1', 'far2', 'far3'][i % 3], 'Scenery', solid=False)
for x in (-34, -10, 14, 38):                                                                       # far cranes
    K.box(x, 0, -76, x + 1.6, 20, -74.4, 'yellow', 'Scenery', solid=False)
    K.box(x - 10, 20, -76, x + 14, 21.4, -74.4, 'yellow', 'Scenery', solid=False)

# south edge between the buildings (the map boundary), with the sign
K.box(-24.0, 0, 29.5, 24.0, 6.0, 31.0, 'plasterD', 'Buildings')
K.text('DOCKS', 0.0, 2.2, 29.5 - 0.5, 0.5, 'warn', 'Signs', facing='-z')

# ---- spawns (both ends of the yard, mirrored) --------------------------------------------------------------------------------------------------------
for (sx, sz) in ((-41.0, 2.0), (-38.5, -9.0), (-39.0, 13.0), (-21.0, -11.0)):
    S.spawn(sx, 0.0, sz)
K.dummy(-6, 0, -6, 0.0)
K.dummy(6, 0, 10, 3.14159)

sc, root = K.build()
K.camera('top', (0, 150, 4), (0, 0, 4), ortho=110)
K.camera('iso', (-60, 45, 70), (0, 0, 0), lens=26)
K.camera('iso2', (60, 40, -50), (0, 0, 5), lens=26)
K.camera('quay', (-40, 1.62, -12), (40, 1.6, -12))
K.camera('yard', (-41, 1.62, 2), (40, 1.6, 2))
result = {'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data()}
