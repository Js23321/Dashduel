"""
DARK ARENA - the dark duel arena, imported from the OBJ the player supplied (_models/dark-arena/Dark arena.obj, a Roblox Studio export: 219 parts).
A walled rectangle (the OBJ is 100 x 140 studs, 35 tall) with slate-blue floor and walls, brown showing through the cracks of the walls and grey
cover: four turned slabs and two turned windowed arches around a central table on four legs, low blocks on the sides, a tall wall in front of each
spawn end, an arch and a big block in the end corners and a steep ramp up to a high perch in one corner of each end.
The layout is rotationally symmetric (180 degrees), so both players get the same fight.

SCALE 0.3 m per stud: 27 x 39 m inside, 9 m walls (the Arena is 28 x 44 inside with 10 m walls), floor surface at y = 0.
What this script does: reads the OBJ itself (no importer) and turns its parts into the map kit's primitives, so the collision is exactly the picture:
  * axis-aligned boxes      -> kit boxes (solid)      * the 10 turned boxes (30 degrees) -> kit slabs (picture exact, collision a staircase inside it)
  * the two wedge parts     -> kit ramps              * the perimeter: four brown full-height wall boxes are the collision; the slate wall layers and
    the cracked-wall meshes of the OBJ are drawn as a skin 4 cm in front of them (visual only, so no coplanar faces), and the brown shows through the gaps
  * the 146 transparent black decal quads and the 21 crack decals of the OBJ are not used (nothing in the game draws transparency)
Added: light strips along the top of the walls, a blue pad and a red pad behind the end walls, lighter tops on the cover.
Spawns: SIX behind the tall wall at EACH end (a tall wall 6 m high and 6 m wide hides the pocket from the middle); the pair of a round is always one at
each end (the game picks the second point far from the first).
Run inside Blender (after mapkit.py, loaded below); writes js/mesh-darkarena.js + js/mapdata-darkarena.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())

OBJ = r'C:\Users\ryder\Downloads\Rivel\_models\dark-arena\Dark arena.obj'
S = 0.3  # metres per stud
CX, CY, CZ = 7000.0, 6017.155, 2000.0  # the middle of the OBJ's bounding box (studs)
FLOOR = -12.5  # the floor surface, in studs above CY
TRANSPARENT = ('Part2Mtl', 'Mesheswallcracks02a12Mtl')  # decals: not used
GAME_MAT = {'Part1Mtl': 'block', 'Mesheswallcracks02a11Mtl': 'slate', 'Part148Mtl': 'brown'}
SKIN = 0.04  # metres: how far the slate wall layers stand in front of the brown wall boxes


def G(p):
    """OBJ stud coordinates -> game metres (the OBJ is y up and right handed like the game: no mirroring)."""
    return ((p[0] - CX) * S, (p[1] - CY - FLOOR) * S, (p[2] - CZ) * S)


def read_obj(path):
    V, VN, groups, cur = [], [], {}, None
    for line in open(path, encoding='utf-8'):
        t = line.split()
        if not t:
            continue
        if t[0] == 'v':
            V.append(tuple(float(a) for a in t[1:4]))
        elif t[0] == 'vn':
            VN.append(tuple(float(a) for a in t[1:4]))
        elif t[0] == 'g':
            cur = t[1]
            groups[cur] = {'mat': None, 'faces': []}
        elif t[0] == 'usemtl':
            groups[cur]['mat'] = t[1]
        elif t[0] == 'f':
            groups[cur]['faces'].append([(int(p.split('/')[0]) - 1, int(p.split('/')[2]) - 1 if p.count('/') >= 2 else -1) for p in t[1:]])
    return V, VN, groups


def analyse(V, g):
    """Corner points (game metres, de-duplicated), face normals and the bounding box of one part."""
    ids = sorted({i for f in g['faces'] for i, _ in f})
    pts = sorted({tuple(round(c, 4) for c in G(V[i])) for i in ids})
    normals = []
    for f in g['faces']:
        a, b, c = [Vector(G(V[i])) for i, _ in f[:3]]
        n = (b - a).cross(c - a)
        if n.length > 1e-9:
            normals.append(n.normalized())
    lo = [min(p[k] for p in pts) for k in range(3)]
    hi = [max(p[k] for p in pts) for k in range(3)]
    return pts, normals, lo, hi


V, VN, groups = read_obj(OBJ)
boxes, turned, ramps, meshes = [], [], [], []
for name, g in groups.items():
    if g['mat'] in TRANSPARENT:
        continue
    pts, normals, lo, hi = analyse(V, g)
    axis = all(max(abs(n.x), abs(n.y), abs(n.z)) > 0.999 for n in normals)
    vertical = all(abs(n.y) < 1e-3 or abs(abs(n.y) - 1) < 1e-3 for n in normals)
    if axis and len(pts) == 8:
        boxes.append((name, g['mat'], lo, hi))
    elif vertical and len(pts) == 8:
        turned.append((name, g['mat'], pts, lo, hi))
    elif len(pts) == 6 and not vertical:
        slope = [n for n in normals if n.y > 0.05 and abs(n.y) < 0.999][0]  # the sloped face: its normal leans towards the LOW end
        rise = ('+z' if slope.z < 0 else '-z') if abs(slope.z) > abs(slope.x) else ('+x' if slope.x < 0 else '-x')
        ramps.append((name, g['mat'], lo, hi, rise))
    else:
        meshes.append((name, g, lo, hi))

K = Kit('darkarena', 'Dark Arena', 'DARKARENA', scene_name='DASHDUEL_DarkArena')
K.script = 'build_darkarena.py'
for n, h in {
    'floor': 0x1f3447, 'slate': 0x2a4660, 'brown': 0x6e5848, 'block': 0x686b6f, 'blockTop': 0x8a8e93,
    'padB': 0x2f5fb0, 'padBl': 0x4a8bff, 'padR': 0xa8333a, 'padRl': 0xf0545c,
}.items():
    K.mat(n, h)
K.mat('strip', 0x8fc0ff, 'emit')


def shift_for(lo, hi):
    """(dx, dz) in metres that moves a layer of the perimeter wall a little into the arena; (0, 0) for anything else."""
    if hi[0] <= -44.9 * S:
        return (SKIN, 0.0)
    if lo[0] >= 44.9 * S:
        return (-SKIN, 0.0)
    if hi[2] <= -64.9 * S:
        return (0.0, SKIN)
    if lo[2] >= 64.9 * S:
        return (0.0, -SKIN)
    return (0.0, 0.0)


# ---- the boxes: floor, the four brown wall boxes (collision), the slate wall layers (a skin), the cover ---------------------------------------
n_cover = 0
for name, mat, lo, hi in boxes:
    if mat == 'Part148Mtl':  # brown perimeter wall boxes
        K.box(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], 'brown', 'Walls')
    elif hi[1] <= 0.001:  # the floor slab (its top is the floor surface)
        K.box(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], 'floor', 'Ground')
    elif mat == 'Mesheswallcracks02a11Mtl':  # slate wall layers: drawn only, in front of the brown wall
        dx, dz = shift_for(lo, hi)
        K.box(lo[0] + dx, lo[1], lo[2] + dz, hi[0] + dx, hi[1], hi[2] + dz, 'slate', 'WallSkin', solid=False)
    else:  # grey cover
        K.box(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], 'block', 'Cover')
        if hi[1] > 0.3:
            K.top(lo[0], hi[0], lo[2], hi[2], hi[1] + 0.004, 'blockTop', 'Cover')
        n_cover += 1

# ---- turned boxes (30 degrees): slabs ---------------------------------------------------------------------------------------------------------
for name, mat, pts, lo, hi in turned:
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[2] for p in pts) / len(pts)
    ring = sorted({(p[0], p[2]) for p in pts}, key=lambda q: math.atan2(q[1] - cz, q[0] - cx))  # the four corners of the footprint, in order
    e1 = (ring[1][0] - ring[0][0], ring[1][1] - ring[0][1])
    e2 = (ring[2][0] - ring[1][0], ring[2][1] - ring[1][1])
    long_e, short_e = (e1, e2) if math.hypot(*e1) >= math.hypot(*e2) else (e2, e1)
    if long_e[0] < 0:
        long_e = (-long_e[0], -long_e[1])
    yaw = math.atan2(-long_e[1], long_e[0])  # the kit's yaw: the slab's own x axis points to (cos yaw, -sin yaw)
    K.slab(cx, cz, math.hypot(*long_e), math.hypot(*short_e), yaw, lo[1], hi[1], 'block', 'Cover')

# ---- ramps ----------------------------------------------------------------------------------------------------------------------------------
for name, mat, lo, hi, rise in ramps:
    K.ramp(lo[0], lo[2], hi[0], hi[2], lo[1], hi[1], rise, 'block', 'Cover')

# ---- light strips along the top of the walls, pads behind the end walls ---------------------------------------------------------------------
HX, HZ = 45.0 * S, 65.0 * S  # inner half sizes (13.5 x 19.5 m)
SY = 8.2  # the strips' height above the floor
K.box(-HX + SKIN, SY, -HZ, -HX + SKIN + 0.07, SY + 0.14, HZ, 'strip', 'Lights', solid=False)
K.box(HX - SKIN - 0.07, SY, -HZ, HX - SKIN, SY + 0.14, HZ, 'strip', 'Lights', solid=False)
K.box(-HX, SY, -HZ + SKIN, HX, SY + 0.14, -HZ + SKIN + 0.07, 'strip', 'Lights', solid=False)
K.box(-HX, SY, HZ - SKIN - 0.07, HX, SY + 0.14, HZ - SKIN, 'strip', 'Lights', solid=False)
K.top(-3.3, 3.3, 15.5, 18.9, 0.03, 'padB', 'Spawns')  # blue behind the +z wall, red behind the -z wall
K.top(-3.0, 3.0, 15.8, 18.6, 0.04, 'padBl', 'Spawns')
K.top(-3.3, 3.3, -18.9, -15.5, 0.03, 'padR', 'Spawns')
K.top(-3.0, 3.0, -18.6, -15.8, 0.04, 'padRl', 'Spawns')

# ---- spawns: six right behind the tall wall at each end (the wall is 6 m wide, at z = +-13.5 .. 15; the end wall is at +-19.5), dummies for Practice ----
for (sx, sz) in ((-1.5, 16.1), (0.0, 16.1), (1.5, 16.1), (-1.5, 17.5), (0.0, 17.5), (1.5, 17.5)):
    K.spawn(sx, 0.0, sz)
    K.spawn(-sx, 0.0, -sz)
K.dummy(-4.5, 0, 3.0, 0.0)
K.dummy(4.5, 0, -3.0, 3.14159)

sc, root = K.build()


# ---- the cracked wall meshes of the OBJ: drawn only, as part of the skin ----------------------------------------------------------------------
def add_mesh(name, g, lo, hi):
    dx, dz = shift_for(lo, hi)
    bm = bmesh.new()
    verts = {}

    def vert(i):
        if i not in verts:
            x, y, z = G(V[i])
            verts[i] = bm.verts.new(gb(x + dx, y, z + dz))
        return verts[i]

    agree = 0
    for f in g['faces']:
        if len(f) < 3 or f[0][1] < 0:
            continue
        a, b, c = [Vector(G(V[i])) for i, _ in f[:3]]
        agree += 1 if (b - a).cross(c - a).dot(Vector(VN[f[0][1]])) > 0 else -1
    flip = agree < 0
    for f in g['faces']:
        idx = [i for i, _ in f]
        if flip:
            idx.reverse()
        for k in range(1, len(idx) - 1):
            try:
                bm.faces.new((vert(idx[0]), vert(idx[k]), vert(idx[k + 1])))
            except ValueError:
                pass  # a duplicate face
    me = bpy.data.meshes.new('skin_' + name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('skin_' + name, me)
    root.objects.link(ob)
    ob.data.materials.append(bpy.data.materials['DD_darkarena_' + GAME_MAT[g['mat']]])
    for p in me.polygons:
        p.use_smooth = False
    return flip


flips = [n for (n, g, lo, hi) in meshes if add_mesh(n, g, lo, hi)]

K.camera('top', (0, 90, 0.01), (0, 0, 0), ortho=48)
K.camera('iso', (-24, 22, 40), (0, 2, 0), lens=24)
K.camera('iso2', (24, 22, -40), (0, 2, 0), lens=24)
K.camera('spawn', (0.0, 1.62, 17.3), (0, 1.6, -10))
K.camera('mid', (0, 1.62, 6.0), (0, 2.0, -20))
result = {'parts': {'boxes': len(boxes), 'turned': len(turned), 'ramps': len(ramps), 'skin meshes': len(meshes), 'cover boxes': n_cover},
          'flipped': flips, 'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data()}
