"""
STATION - an original stylised Western railway-station duel map (metres, 78 x 60). Not a copy of any existing map.
Two tracks run north-south with an island PLATFORM and its canopy between them. A steam TRAIN stands on each track (a locomotive and three
carriages with door and window openings: you can fight inside them and walk through the whole train). West of the tracks is the STATION HALL,
east of them the DEPOT: two-floor buildings with doors, windows, a stair, a balcony and an open double-height hall (mirror images of each
other, so the map is fair). A water tower, cacti, crates and troughs fill the yards.
Routes: the aprons (open), the platform (long, canopy cover), through the trains (enclosed), through the buildings and up to their upper floors.
Rotationally symmetric (180 degrees about the centre). Run inside Blender; writes js/mesh-station.js + js/mapdata-station.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())
import random

K = Kit('station', 'Station', 'STATION', scene_name='DASHDUEL_Station')
K.script = 'build_station.py'
S = Sym(K, 'rot')
rng = random.Random(31)
for n, h in {
    'dirt': 0xd9b77e, 'dirtDark': 0xc7a068, 'gravel': 0x8e8576, 'tie': 0x5a3d26, 'rail': 0x6f7680, 'wood': 0x9b6a3c, 'woodDark': 0x6d4a2b, 'woodLight': 0xc89a63, 'plank': 0xb98550, 'plankB': 0xa4723f,
    'brick': 0xb5553a, 'plasterC': 0xf0e2c0, 'plasterB': 0xdfc79a, 'roofR': 0x9b3f2e, 'roofB': 0x4a3b32, 'trainA': 0xb23a32, 'trainA2': 0x7d2420, 'trainB': 0x2f5d8a, 'trainB2': 0x1f3f5e,
    'trainDark': 0x2b2f37, 'trainRoof': 0x3a3f47, 'brass': 0xc9a23a, 'glass': 0x2d3f57, 'frame': 0xf4f1e8, 'barrel': 0x8d5a34, 'crate': 0xc99a5b, 'crateD': 0x9a7440, 'metal': 0x6a7a8c, 'cactus': 0x4f9a52,
    'rock': 0xa88e6e, 'rockD': 0x8a7255, 'hay': 0xe3c35b, 'tank': 0x8d6e4b, 'floorI': 0xc9a46d, 'bunting1': 0xe5484d, 'bunting2': 0x3b82f6, 'bunting3': 0xffd23f,
}.items():
    K.mat(n, h)
for n, h in {'lamp': 0xffd98a, 'sign': 0xfff0b0}.items():
    K.mat(n, h, 'emit')

XB, ZB = 38.0, 30.0   # inner half extents

# ---- ground, tracks, platform ----------------------------------------------------------------------------------------------------------------
K.box(-XB - 8, -3, -ZB - 8, XB + 8, 0, ZB + 8, 'dirt', 'Ground')
for ix in range(-38, 38, 6):
    for iz in range(-30, 30, 6):
        if (ix // 6 + iz // 6) % 2 == 0:
            K.top(ix, ix + 6, iz, iz + 6, 0.012, 'dirtDark', 'Ground')
for xt in (-6.4, 6.4):
    K.top(xt - 2.0, xt + 2.0, -ZB, ZB, 0.02, 'gravel', 'Tracks')
    for z in range(-ZB.__int__(), ZB.__int__(), 1):
        K.top(xt - 1.5, xt + 1.5, z + 0.15, z + 0.55, 0.035, 'tie', 'Tracks')
    for dx in (-0.72, 0.72):
        K.box(xt + dx - 0.07, 0.0, -ZB, xt + dx + 0.07, 0.17, ZB, 'rail', 'Tracks', solid=False)
K.box(-4.5, 0, -27, 4.5, 1.0, 27, 'plank', 'Platform')                              # island platform (top 1.0)
for i in range(-4, 4):
    K.top(i * 1.125, i * 1.125 + 1.125, -27, 27, 1.012, 'plank' if i % 2 else 'plankB', 'Platform')
K.box(-4.6, 0.85, -27.1, 4.6, 1.0, 27.1, 'woodDark', 'Platform', solid=False)
K.ramp(-2.5, 27.0, 2.5, 30.0, 0.0, 1.0, '-z', 'plank', 'Platform', bottom=0.0)        # walk-on ramps at both ends of the platform (jumping up from the apron also works: 1 m)
K.ramp(-2.5, -30.0, 2.5, -27.0, 0.0, 1.0, '+z', 'plank', 'Platform', bottom=0.0)
# canopy over the platform
K.box(-5.6, 4.4, -20, 5.6, 4.7, 20, 'roofR', 'Platform')
K.box(-5.8, 4.7, -20, -5.6, 5.0, 20, 'woodDark', 'Platform', solid=False)
K.box(5.6, 4.7, -20, 5.8, 5.0, 20, 'woodDark', 'Platform', solid=False)
for z in (-18.0, -9.0, 0.0, 9.0, 18.0):
    S.box(3.6, 1.0, z - 0.25, 4.1, 4.4, z + 0.25, 'woodDark', 'Platform')
for z in (-14.0, 0.0, 14.0):                                                          # hanging lamps + benches on the platform
    K.box(-0.3, 4.0, z - 0.3, 0.3, 4.4, z + 0.3, 'lamp', 'Platform', solid=False)
    K.box(-0.5, 1.0, z - 1.2, 0.5, 1.45, z + 1.2, 'woodLight', 'Platform')
    K.box(-0.5, 1.45, z - 1.2, -0.3, 2.0, z + 1.2, 'woodLight', 'Platform', solid=False)

# ---- trains (train A on the west track, its rotated twin on the east track) -----------------------------------------------------------------------
XT = -6.4
def carriage(z0, z1, mat, mat2, trim, trim2):
    x0, x1 = XT - 1.6, XT + 1.6
    S.box(x0, 0.75, z0, x1, 1.0, z1, 'trainDark', 'Trains')
    S.box(x0 + 0.3, 0.35, z0 + 0.6, x1 - 0.3, 0.75, z1 - 0.6, 'trainDark', 'TrainDetail', solid=False)
    for zz in (z0 + 1.5, z0 + 2.8, z1 - 2.8, z1 - 1.5):
        for xs in (XT - 1.25, XT + 1.25):
            S.prism('x', xs, 0.45, zz, 0.45, 0.22, 'trainDark', 'TrainDetail', solid=False)
    pl = [(z0 + 2.0, z0 + 3.4, 1.0, 3.1), (z0 + 7.6, z0 + 9.0, 1.0, 3.1)] + [(z0 + a, z0 + b, 1.9, 2.9) for (a, b) in ((0.5, 1.5), (4.2, 5.4), (5.8, 7.0), (9.5, 10.5))]
    ot = [(z0 + a, z0 + b, 1.9, 2.9) for (a, b) in ((0.6, 1.8), (3.0, 4.2), (5.2, 6.4), (7.0, 8.2), (9.2, 10.4))]
    S.wall('z', z0, z1, x1 - 0.15, 0.3, 1.0, 3.5, mat, 'Trains', holes=pl, frame=trim, mat2=mat2)        # platform side: doors + windows
    S.wall('z', z0, z1, x0 + 0.15, 0.3, 1.0, 3.5, mat, 'Trains', holes=ot, frame=trim, mat2=mat2)        # far side: windows
    for zz in (z0 + 0.15, z1 - 0.15):
        S.wall('x', x0, x1, zz, 0.3, 1.0, 3.5, mat, 'Trains', holes=[(XT - 0.6, XT + 0.6, 1.0, 3.0)], frame=trim, mat2=mat2)   # end walls with a door through the train
    S.box(x0 - 0.05, 3.5, z0, x1 + 0.05, 3.8, z1, 'trainRoof', 'Trains')
    S.box(XT - 0.8, 3.8, z0 + 0.4, XT + 0.8, 4.05, z1 - 0.4, 'trainRoof', 'TrainDetail', solid=False)
    S.box(x0 - 0.06, 0.95, z0, x1 + 0.06, 1.2, z1, trim, 'TrainDetail', solid=False, mat2=trim2)            # skirt line
    for zc in (z0 + 4.0, z1 - 4.0):                                                                           # benches inside
        S.box(XT - 1.35, 1.0, zc - 1.2, XT - 0.85, 1.5, zc + 1.2, 'woodDark', 'Trains')
    S.box(XT + 0.85, 1.0, z0 + 5.0, XT + 1.35, 1.5, z0 + 6.4, 'woodDark', 'Trains')
carriage(-13.8, -2.8, 'trainA', 'trainB', 'trainA2', 'trainB2')
carriage(-1.6, 9.4, 'trainA', 'trainB', 'trainA2', 'trainB2')
carriage(10.6, 21.6, 'trainA', 'trainB', 'trainA2', 'trainB2')
# locomotive on z -27 .. -15
S.box(XT - 1.6, 0.75, -27.0, XT + 1.6, 1.0, -15.0, 'trainDark', 'Trains')
S.prism('z', XT, 2.45, -22.5, 1.5, 8.0, 'trainA2', 'Trains')                            # boiler
S.prism('z', XT, 2.45, -27.0, 1.5, 0.6, 'trainDark', 'TrainDetail', solid=False)       # smoke-box front
S.prism('y', XT, 5.0, -25.2, 0.45, 2.3, 'trainDark', 'TrainDetail', solid=False)       # chimney
S.prism('y', XT, 4.15, -25.2, 0.7, 0.3, 'brass', 'TrainDetail', solid=False)
S.prism('y', XT, 4.3, -20.8, 0.6, 0.8, 'brass', 'TrainDetail', solid=False)            # dome
S.box(XT - 1.6, 1.0, -17.5, XT + 1.6, 3.6, -15.0, 'trainA', 'Trains', mat2='trainB')    # cab
S.box(XT - 1.8, 3.6, -17.8, XT + 1.8, 3.9, -14.8, 'trainRoof', 'Trains')
S.box(XT - 1.58, 1.8, -17.0, XT - 1.5, 2.9, -15.5, 'glass', 'TrainDetail', solid=False)
S.box(XT + 1.5, 1.8, -17.0, XT + 1.58, 2.9, -15.5, 'glass', 'TrainDetail', solid=False)
S.box(XT - 1.2, 0.4, -28.0, XT + 1.2, 1.0, -27.0, 'trainDark', 'TrainDetail', solid=False)   # cow-catcher
for zz in (-25.0, -22.0, -19.0):
    for xs in (XT - 1.45, XT + 1.45):
        S.prism('x', xs, 0.9, zz, 0.9, 0.25, 'trainDark', 'TrainDetail', solid=False)
        S.prism('x', xs, 0.9, zz, 0.35, 0.3, 'brass', 'TrainDetail', solid=False)

# ---- the two buildings (station hall on the west; its rotated twin, the depot, on the east) ---------------------------------------------------------
bx0, bx1, bz0, bz1 = -38.0, -20.0, -13.0, 13.0
T = 0.5
FH, BH = 4.0, 8.4
def holes_along(a0, a1, skip=(), floors=(1.2, 5.2), ww=1.4):
    out = []
    u = a0 + 1.4
    while u + ww < a1 - 1.0:
        if not any(s0 - 0.8 < u < s1 + 0.8 for (s0, s1) in skip):
            for fy in floors:
                out.append((u, u + ww, fy, fy + 1.4))
        u += 3.0
    return out
S.wall('z', bz0, bz1, bx1 - T / 2, T, 0, BH, 'plasterC', 'Buildings', holes=[(-8.6, -6.2, 0, 3.0), (6.2, 8.6, 0, 3.0)] + holes_along(bz0, bz1, ((-8.6, -6.2), (6.2, 8.6))), frame='woodDark', mat2='wood')     # facade towards the tracks
S.wall('z', bz0, bz1, bx0 + T / 2, T, 0, BH, 'plasterC', 'Buildings', holes=holes_along(bz0, bz1), frame='woodDark', mat2='wood')
S.wall('x', bx0, bx1, bz0 + T / 2, T, 0, BH, 'plasterC', 'Buildings', holes=[(-31.0, -28.6, 0, 3.0)] + holes_along(bx0, bx1, ((-31.0, -28.6),)), frame='woodDark', mat2='wood')
S.wall('x', bx0, bx1, bz1 - T / 2, T, 0, BH, 'plasterC', 'Buildings', holes=[(-27.0, -24.6, 0, 3.0)] + holes_along(bx0, bx1, ((-27.0, -24.6),)), frame='woodDark', mat2='wood')
S.box(bx0, BH, bz0, bx1, BH + 0.4, bz1, 'roofR', 'Buildings', mat2='roofB')
S.box(bx0 - 0.3, BH + 0.4, bz0 - 0.3, bx1 + 0.3, BH + 0.8, bz0 + 0.1, 'woodDark', 'Buildings', solid=False)
S.box(bx0 - 0.3, BH + 0.4, bz1 - 0.1, bx1 + 0.3, BH + 0.8, bz1 + 0.3, 'woodDark', 'Buildings', solid=False)
# upper floor on the west half, stairs along the west wall, balcony rail towards the double-height hall
S.box(bx0 + T, FH, -6.0, bx0 + T + 2.2, FH + 0.4, bz1 - T, 'floorI', 'Buildings')
S.box(bx0 + T + 2.2, FH, bz0 + T, -28.0, FH + 0.4, bz1 - T, 'floorI', 'Buildings')
S.stairs(bx0 + T, bz0 + T, bx0 + T + 2.2, -6.0, 0.0, FH + 0.4, '+z', 10, 'woodLight', 'Buildings')
S.box(-28.2, FH + 0.4, bz0 + T, -27.8, FH + 1.5, -1.0, 'woodDark', 'Buildings')
S.box(-28.2, FH + 0.4, 1.0, -27.8, FH + 1.5, bz1 - T, 'woodDark', 'Buildings')
# hall furniture: ticket counter, benches, luggage
S.box(-25.0, 0, -3.0, -23.8, 1.15, 3.0, 'woodDark', 'Interior')
S.box(-25.2, 1.15, -3.2, -23.6, 1.3, 3.2, 'woodLight', 'Interior', solid=False)
for (cx, cz) in ((-31.0, -8.0), (-31.0, 8.0), (-33.0, 0.0)):
    S.boxc(cx, 0, cz, 0.6, 0.5, 3.0, 'woodLight', 'Interior')
    S.boxc(cx - 0.3, 0.5, cz, 0.15, 0.6, 3.0, 'woodLight', 'Interior', solid=False)
for (cx, cz) in ((-22.5, -10.0), (-22.5, 10.5)):
    S.boxc(cx, 0, cz, 1.6, 1.1, 1.2, 'crate', 'Interior')
    S.boxc(cx + 0.2, 1.1, cz, 1.0, 0.8, 0.9, 'crateD', 'Interior')
S.boxc(-33.0, FH + 0.4, 8.0, 3.0, 1.0, 1.0, 'woodDark', 'Interior')                    # upstairs counters
S.boxc(-31.0, FH + 0.4, -4.0, 1.0, 1.0, 3.4, 'woodDark', 'Interior')
# signs on the facades (the tall false fronts are decoration)
S.box(bx1 - 0.1, BH, -9.0, bx1 + 0.4, BH + 3.6, 9.0, 'plasterB', 'Signs', solid=False)
K.text('STATION', bx1 + 0.4, BH + 0.6, 0.0, 0.34, 'sign', 'Signs', facing='+x')
K.text('DEPOT', -bx1 - 0.4 - 0.34, BH + 0.6, 0.0, 0.34, 'sign', 'Signs', facing='-x')
# the clock tower on the hall roof (decoration above the reachable heights)
S.box(-30.0, BH + 0.4, -2.0, -26.0, BH + 4.4, 2.0, 'plasterB', 'Signs', solid=False)
S.box(-28.4, BH + 3.0, 2.0, -27.6, BH + 4.0, 2.05, 'frame', 'Signs', solid=False)

# ---- yards: water tower, cacti, troughs, crates, fences, poles --------------------------------------------------------------------------------------
for (dx, dz) in ((-1.2, -1.2), (1.2, -1.2), (-1.2, 1.2), (1.2, 1.2)):                 # water tower legs (solid), tank on top
    S.box(-24 + dx - 0.25, 0, -24 + dz - 0.25, -24 + dx + 0.25, 8.0, -24 + dz + 0.25, 'woodDark', 'Tower')
S.prism('y', -24, 9.6, -24, 2.2, 3.2, 'tank', 'Tower')
S.prism('y', -24, 11.6, -24, 2.3, 0.6, 'woodDark', 'Tower', solid=False, r_top=0.3)
S.box(-25.2, 0, -25.2, -22.8, 0.4, -22.8, 'woodDark', 'Tower', solid=False)
for (cx, cz) in ((-30.0, -20.0), (-14.0, 22.0), (-16.0, -26.0), (-34.0, 22.0)):        # cacti
    S.prism('y', cx, 1.2, cz, 0.35, 2.4, 'cactus', 'Cover')
    S.box(cx - 0.9, 1.0, cz - 0.15, cx - 0.3, 1.3, cz + 0.15, 'cactus', 'Cover', solid=False)
    S.box(cx - 0.9, 1.3, cz - 0.15, cx - 0.6, 2.2, cz + 0.15, 'cactus', 'Cover', solid=False)
    S.box(cx + 0.3, 1.5, cz - 0.15, cx + 0.9, 1.8, cz + 0.15, 'cactus', 'Cover', solid=False)
    S.box(cx + 0.6, 1.8, cz - 0.15, cx + 0.9, 2.6, cz + 0.15, 'cactus', 'Cover', solid=False)
for (cx, cz) in ((-15.5, -16.0), (-16.5, 17.0)):                                         # water troughs
    S.boxc(cx, 0, cz, 3.0, 0.9, 1.0, 'woodDark', 'Cover')
for (cx, cz) in ((-12.5, -3.0), (-17.5, 4.0), (-12.5, 12.0), (-11.0, -22.0)):          # crates / barrels on the aprons
    S.boxc(cx, 0, cz, 1.6, 1.3, 1.6, 'crate', 'Cover')
    S.prism('y', cx - 1.4, 0.55, cz + 1.0, 0.5, 1.1, 'barrel', 'Cover')
for (x0, x1, z0, z1) in ((-19.0, -19.0 + 0.2, -29.5, -17.0), (-19.0, -19.0 + 0.2, 17.0, 29.5)):      # picket fences screening the yards from the aprons
    S.box(x0, 0, z0, x1, 1.2, z1, 'woodLight', 'Cover')
for z in range(-29, -17, 2):
    S.box(-19.1, 0, z, -18.9, 1.5, z + 0.2, 'woodDark', 'Cover', solid=False)
for (px, pz) in ((-10.5, -26.0), (-10.5, 4.0), (-10.5, 26.0)):                          # telegraph poles
    S.prism('y', px, 3.5, pz, 0.14, 7.0, 'woodDark', 'Props', solid=False)
    S.box(px - 1.0, 6.4, pz - 0.05, px + 1.0, 6.6, pz + 0.05, 'woodDark', 'Props', solid=False)
for (lx, lz) in ((-15.0, -10.0), (-15.0, 10.0)):                                          # apron lamps
    S.prism('y', lx, 2.0, lz, 0.1, 4.0, 'metal', 'Props', solid=False)
    S.box(lx - 0.3, 4.0, lz - 0.3, lx + 0.3, 4.4, lz + 0.3, 'lamp', 'Props', solid=False)
# bunting across the apron
for z in (-10.0, 10.0):
    for i in range(12):
        x = -19.5 + i * 0.95
        S.box(x, 5.0 - 0.05 * (i % 6), z - 0.12, x + 0.5, 5.4 - 0.05 * (i % 6), z + 0.12, ['bunting1', 'bunting2', 'bunting3'][i % 3], 'Props', solid=False)

# ---- perimeter: fence walls north / south, a rock wall behind the buildings ------------------------------------------------------------------------------
for (x0, x1) in ((-XB - 1.5, XB + 1.5),):
    K.box(x0, 0, -ZB - 1.0, x1, 5.0, -ZB, 'woodDark', 'Perimeter')
    K.box(x0, 0, ZB, x1, 5.0, ZB + 1.0, 'woodDark', 'Perimeter')
    K.box(-XB - 1.5, 0, -ZB, -XB, 6.0, ZB, 'rockD', 'Perimeter')
    K.box(XB, 0, -ZB, XB + 1.5, 6.0, ZB, 'rockD', 'Perimeter')
for x in range(-38, 38, 4):                                                               # fence posts + boards
    K.box(x, 5.0, -ZB - 1.0, x + 0.3, 5.9, -ZB, 'woodLight', 'Perimeter', solid=False)
    K.box(x, 5.0, ZB, x + 0.3, 5.9, ZB + 1.0, 'woodLight', 'Perimeter', solid=False)
for i in range(18):                                                                         # distant mesas (visual)
    a = i / 18 * math.pi * 2
    r = 95 + rng.random() * 25
    w, h = 18 + rng.random() * 18, 14 + rng.random() * 22
    K.box(math.cos(a) * r - w / 2, 0, math.sin(a) * r - w / 2, math.cos(a) * r + w / 2, h, math.sin(a) * r + w / 2, 'rock' if i % 2 else 'rockD', 'Scenery', solid=False)

# ---- spawns ----------------------------------------------------------------------------------------------------------------------------------------
for (sx, sy, sz) in ((-16.5, 0.0, 0.0), (-16.5, 0.0, -9.0), (-16.5, 0.0, 9.0), (-27.0, 0.0, -19.0), (0.0, 1.0, -24.0)):
    S.spawn(sx, sy, sz)
K.dummy(-14, 0, -12, 0.0)
K.dummy(14, 0, 12, 3.14159)

sc, root = K.build()
K.camera('top', (0, 150, 0.01), (0, 0, 0), ortho=110)
K.camera('iso', (-60, 50, 60), (0, 0, 0), lens=26)
K.camera('iso2', (60, 50, -60), (0, 0, 0), lens=26)
K.camera('apron', (-17, 1.62, 0), (17, 1.6, 0))
K.camera('platform', (0, 2.62, -26), (0, 2.5, 26))
K.camera('hall', (-35, 1.62, 0), (-22, 1.6, 0))
result = {'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data()}
