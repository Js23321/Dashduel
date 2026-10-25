"""
SHARED - the reusable modular pieces the DASHDUEL maps are made from, laid out in a row in the Blender scene DASHDUEL_Shared
(collection SHARED, one sub-collection per piece). Every piece is built at its own origin (floor level, centred) in metres at game
scale, so it can be dropped into any map script. The map scripts build these same designs procedurally (so one map file is still a single
script); this scene is the catalogue to look at, reuse and extend, and it is exported as _models/exports/shared-kit.glb.
Run inside Blender.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())

K = Kit('shared', 'Shared', 'SHARED', scene_name='DASHDUEL_Shared', collide=False)
K.script = 'build_shared.py'
for n, h in {
    'crate': 0xc99a5b, 'crateD': 0x9a7440, 'barrel': 0xd04a3a, 'steel': 0x6a7a8c, 'steelDark': 0x465362, 'cRed': 0xc0392b, 'cBlue': 0x2e6db4, 'cDoor': 0x3a2a24,
    'barrier': 0xd9d4c7, 'barrierR': 0xe5484d, 'carB': 0x3b82f6, 'glass': 0x2d3f57, 'tyre': 0x1b1d22, 'busY': 0xffc533, 'busBlack': 0x23272f,
    'train': 0xb23a32, 'trainRoof': 0x3a3f47, 'trainDark': 0x2b2f37, 'plaster': 0xf1e6cf, 'frame': 0x6d4a2b, 'trunk': 0x7a5a3a, 'leaf': 0x3fae52, 'leaf2': 0x5fcc6c,
    'cactus': 0x4f9a52, 'planter': 0x7a8566, 'bush': 0x4cc86a, 'bench': 0x7c5cff, 'wood': 0xc89a63, 'stone': 0xb9b3a6, 'stoneDark': 0x8b857a, 'hay': 0xe3c35b,
    'tank': 0x8d6e4b, 'pole': 0x56627a, 'bollard': 0xe5484d,
}.items():
    K.mat(n, h)
for n, h in {'lamp': 0xfff3b0}.items():
    K.mat(n, h, 'emit')

def crate(x):
    K.box(x - 1, 0, -1, x + 1, 2, 1, 'crate', 'Crate')
    K.box(x - 1.05, 0, -1.05, x + 1.05, 0.15, 1.05, 'crateD', 'Crate', solid=False)
    K.box(x - 1.05, 1.85, -1.05, x + 1.05, 2.0, 1.05, 'crateD', 'Crate', solid=False)
def barrel(x):
    K.prism('y', x, 0.55, 0, 0.55, 1.1, 'barrel', 'Barrel')
    K.prism('y', x, 0.8, 0, 0.58, 0.08, 'steelDark', 'Barrel', solid=False)
def container(x):
    L, W, H = 12.2, 2.45, 2.6
    K.box(x - L / 2, 0, -W / 2, x + L / 2, H, W / 2, 'cRed', 'Container')
    for i in range(1, 12):
        xx = x - L / 2 + L * i / 12
        K.box(xx - 0.05, 0.12, -W / 2 - 0.04, xx + 0.05, H - 0.1, -W / 2, 'steelDark', 'Container', solid=False)
        K.box(xx - 0.05, 0.12, W / 2, xx + 0.05, H - 0.1, W / 2 + 0.04, 'steelDark', 'Container', solid=False)
    K.box(x + L / 2, 0.2, -W / 2 + 0.15, x + L / 2 + 0.05, H - 0.2, W / 2 - 0.15, 'cDoor', 'Container', solid=False)
def barrier(x):
    K.box(x - 0.4, 0, -1.6, x + 0.4, 1.15, 1.6, 'barrier', 'Barrier')
    K.box(x - 0.4, 1.15, -1.6, x + 0.4, 1.27, 1.6, 'barrierR', 'Barrier', solid=False)
def car(x):
    K.box(x - 0.95, 0.3, -2.1, x + 0.95, 1.05, 2.1, 'carB', 'Car')
    K.box(x - 0.85, 1.05, -1.2, x + 0.85, 1.6, 1.4, 'glass', 'Car')
    for zz in (-1.3, 1.3):
        for xs in (-0.95, 0.95):
            K.prism('x', x + xs, 0.32, zz, 0.32, 0.3, 'tyre', 'Car', solid=False)
def bus(x):
    K.box(x - 1.4, 0.55, -6.5, x + 1.4, 3.25, 6.5, 'busY', 'Bus')
    K.box(x - 1.42, 0.9, -6.52, x + 1.42, 1.25, 6.52, 'busBlack', 'Bus', solid=False)
    for zc in (-5.2, -3.0, -0.8, 1.4, 3.6):
        K.box(x - 1.44, 1.7, zc, x - 1.4, 2.7, zc + 1.7, 'glass', 'Bus', solid=False)
        K.box(x + 1.4, 1.7, zc, x + 1.44, 2.7, zc + 1.7, 'glass', 'Bus', solid=False)
    for zc in (-4.3, 4.3):
        for xs in (-1.7, 1.7):
            K.prism('x', x + xs, 0.5, zc, 0.5, 0.35, 'tyre', 'Bus', solid=False)
def carriage(x):
    z0, z1 = -5.5, 5.5
    K.box(x - 1.6, 0.75, z0, x + 1.6, 1.0, z1, 'trainDark', 'Carriage')
    K.wall('z', z0, z1, x + 1.45, 0.3, 1.0, 3.5, 'train', 'Carriage', holes=[(-3.5, -2.1, 1.0, 3.1), (2.1, 3.5, 1.0, 3.1), (-5.0, -4.0, 1.9, 2.9), (-0.7, 0.7, 1.9, 2.9)], frame='frame')
    K.wall('z', z0, z1, x - 1.45, 0.3, 1.0, 3.5, 'train', 'Carriage', holes=[(-4.9, -3.7, 1.9, 2.9), (-0.6, 0.6, 1.9, 2.9), (3.7, 4.9, 1.9, 2.9)], frame='frame')
    for zz in (z0 + 0.15, z1 - 0.15):
        K.wall('x', x - 1.6, x + 1.6, zz, 0.3, 1.0, 3.5, 'train', 'Carriage', holes=[(x - 0.6, x + 0.6, 1.0, 3.0)], frame='frame')
    K.box(x - 1.65, 3.5, z0, x + 1.65, 3.8, z1, 'trainRoof', 'Carriage')
def window_wall(x):
    K.wall('x', x - 2.5, x + 2.5, 0, 0.5, 0, 4.0, 'plaster', 'WindowWall', holes=[(x - 1.8, x - 0.4, 1.2, 2.6), (x + 0.4, x + 1.8, 1.2, 2.6), (x - 0.7, x + 0.7, 0, 2.6)], frame='frame')
def lamp(x):
    K.prism('y', x, 3.0, 0, 0.15, 6.0, 'pole', 'LampPost', solid=False)
    K.box(x - 0.5, 5.9, -0.25, x + 0.5, 6.1, 0.25, 'lamp', 'LampPost', solid=False)
def tree(x):
    K.prism('y', x, 2.0, 0, 0.45, 4.0, 'trunk', 'Tree')
    K.box(x - 2.4, 3.8, -2.4, x + 2.4, 5.8, 2.4, 'leaf', 'Tree', solid=False)
    K.box(x - 1.6, 5.8, -1.6, x + 1.6, 7.2, 1.6, 'leaf2', 'Tree', solid=False)
def cactus(x):
    K.prism('y', x, 1.2, 0, 0.35, 2.4, 'cactus', 'Cactus')
    K.box(x - 0.9, 1.0, -0.15, x - 0.3, 1.3, 0.15, 'cactus', 'Cactus', solid=False)
    K.box(x - 0.9, 1.3, -0.15, x - 0.6, 2.2, 0.15, 'cactus', 'Cactus', solid=False)
def planter(x):
    K.box(x - 1.2, 0, -1.2, x + 1.2, 0.9, 1.2, 'planter', 'Planter')
    K.box(x - 0.95, 0.9, -0.95, x + 0.95, 1.8, 0.95, 'bush', 'Planter', solid=False)
def bench(x):
    K.box(x - 1.4, 0, -0.4, x + 1.4, 0.6, 0.4, 'bench', 'Bench')
    K.box(x - 1.4, 0.6, -0.5, x + 1.4, 1.2, -0.3, 'bench', 'Bench', solid=False)
def stairs(x):
    K.stairs(x - 1.5, -3.0, x + 1.5, 3.0, 0.0, 4.4, '+z', 10, 'wood', 'Stairs')
def ramp(x):
    K.ramp(x - 2.0, -4.0, x + 2.0, 4.0, 0.0, 2.4, '+z', 'stone', 'Ramp', bottom=0.0)
def bollard(x):
    K.prism('y', x, 0.3, 0, 0.3, 0.6, 'bollard', 'Bollard')
def water_tower(x):
    for dx in (-1.2, 1.2):
        for dz in (-1.2, 1.2):
            K.box(x + dx - 0.25, 0, dz - 0.25, x + dx + 0.25, 8.0, dz + 0.25, 'frame', 'WaterTower')
    K.prism('y', x, 9.6, 0, 2.2, 3.2, 'tank', 'WaterTower')
def hay(x):
    K.box(x - 1.1, 0, -0.7, x + 1.1, 1.3, 0.7, 'hay', 'Hay')
    K.box(x - 1.1, 1.3, -0.7, x + 1.1, 2.4, 0.7, 'hay', 'Hay')
def monument(x):
    K.prism('y', x, 0.45, 0, 5.2, 0.9, 'stoneDark', 'Monument')
    K.prism('y', x, 1.45, 0, 3.6, 1.1, 'stone', 'Monument')
    K.prism('y', x, 2.6, 0, 2.2, 1.2, 'stone', 'Monument')
    K.prism('y', x, 6.2, 0, 1.0, 6.0, 'stone', 'Monument')

pieces = [crate, barrel, barrier, bollard, bench, planter, hay, cactus, tree, lamp, car, window_wall, stairs, ramp, water_tower, container, bus, carriage, monument]
xs, x = [], 0.0
widths = {'container': 14, 'bus': 5, 'carriage': 5, 'monument': 12, 'water_tower': 6, 'window_wall': 6, 'tree': 6, 'stairs': 5, 'ramp': 5, 'car': 3.5}
for fn in pieces:
    w = widths.get(fn.__name__, 3.5)
    x += w / 2 + 1.5
    fn(x)
    xs.append((fn.__name__, round(x, 1)))
    x += w / 2
sc, root = K.build()
K.camera('overview', (x / 2, 38, 60), (x / 2, 2, 0), lens=22)
result = {'pieces': xs, 'stats': K.stats()}
