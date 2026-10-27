"""
ASSAULT RIFLE: the RIVALS assault rifle, imported from the OBJ the player supplied (_models/assault-rifle/AssualtRifle.obj, a Roblox Studio
export: 10 mesh parts, 5 flat colours). It is an orange SCAR-style rifle with a dark navy frame, two flip-up RING sights (the rear one is the
one circle you look through; the front ring and its spike stand inside it) and a ribbed black magazine.
(The first procedural version of this rifle is kept in _archive/build_rifle_procedural.py.)

What this script does: reads the OBJ itself (no importer: the transform is exact and the mesh stays one-sided), turns it into game coordinates
(x right, y up, z BACKWARDS: the muzzle is at -z) and fits it to the old rifle's size (1.13 long, muzzle at z = -0.66, barrel axis y = 0.022),
gives every Roblox colour a game material, and splits two parts off as animated parts: the magazine (`mag`) and the CHARGING HANDLE (`bolt`),
the little stick that comes out of the side of the handguard (Meshpart10): it slides back along the rifle and returns on every shot (the rifle
as a whole shakes in the viewmodel animation too, see js/vmanim.js).
Run inside Blender after lib.py (exec of lib.py happens below).
Anchors the game reads from this model (see SPEC.rifle in js/vmanim.js):
    rear ring centre   (0, 0.1265, 0.153)      front ring centre (0, 0.1265, -0.360)      muzzle (0, 0.022, -0.66)
    (both rings are octagons: top y_obj -83.354, widest -83.441, bottom -83.529, so the centre is -83.4415 -> 0.022 + S * 0.356 = 0.1265)
Parts: body, mag (pivot 0, -0.0078, -0.0434), bolt = the charging handle (pivot -0.0376, 0.0682, -0.0949)
Materials (game names): rvDark (navy frame, rings, barrel), rvOrange (the shell), rvOrangeDark (lower receiver + grip), rvGrey (trim), rvBlack (magazine)
"""
import os

exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

OBJ = r'C:\Users\ryder\Downloads\Rivel\_models\assault-rifle\AssualtRifle.obj'

# OBJ (Roblox studs, long axis x, muzzle at the smallest x) -> game metres
LENGTH = 3.851  # stud length of the whole rifle in the OBJ
S = 1.13 / LENGTH
X0 = 172.569  # the muzzle end
ZC = -480.058  # the middle of the rifle's width: the centre line of BOTH rings (z -480.146 .. -479.970), so the sights are dead centre (x = 0)
YB = -83.7975  # the barrel axis height


def to_game(x, y, z):
    return (-S * (z - ZC), 0.022 + S * (y - YB), -0.66 + S * (x - X0))


MATERIAL = {'Meshpart1Mtl': 'rvDark', 'Meshpart4Mtl': 'rvOrange', 'Meshpart2Mtl': 'rvOrangeDark', 'Meshpart3Mtl': 'rvGrey', 'Meshpart8Mtl': 'rvBlack'}
MAG_GROUPS = ('Meshpart8', 'Meshpart9')  # the magazine and its base plate
MAG_PIVOT = (0.0, -0.0078, -0.0434)  # the top of the magazine
BOLT_GROUPS = ('Meshpart10',)  # the charging handle: a short stick that comes out of the left side of the handguard
BOLT_PIVOT = (-0.0376, 0.0682, -0.0949)


def read_obj(path):
    V, VN, groups, cur, mat = [], [], {}, None, None
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
            mat = t[1]
            groups[cur]['mat'] = mat
        elif t[0] == 'f':
            groups[cur]['faces'].append([(int(p.split('/')[0]) - 1, int(p.split('/')[2]) - 1 if p.count('/') >= 2 else -1) for p in t[1:]])
    return V, VN, groups


def group_object(col, name, V, VN, g, part):
    bm = bmesh.new()
    verts = {}

    def vert(i):
        if i not in verts:
            verts[i] = bm.verts.new(gb(*to_game(*V[i])))
        return verts[i]

    # the file's own normals say which way the faces look: flip the whole group if the winding disagrees with them
    agree = 0
    for f in g['faces']:
        if len(f) < 3 or f[0][1] < 0:
            continue
        a, b, c = [Vector(to_game(*V[i])) for i, _ in f[:3]]
        gn = (b - a).cross(c - a)
        n = VN[f[0][1]]
        # (the rotation to game axes is proper, so the normal's game version is just the rotated vector)
        ng = Vector((-n[2], n[1], n[0]))
        agree += 1 if gn.dot(ng) > 0 else -1
    flip = agree < 0
    for f in g['faces']:
        idx = [i for i, _ in f]
        if flip:
            idx.reverse()
        for k in range(1, len(idx) - 1):  # fan-triangulate quads
            try:
                bm.faces.new((vert(idx[0]), vert(idx[k]), vert(idx[k + 1])))
            except ValueError:
                pass  # a duplicate face
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.data.materials.append(get_mat(MATERIAL[g['mat']]))
    ob['part'] = part
    for p in me.polygons:
        p.use_smooth = False
    return ob, flip


sc = make_scene('DASHDUEL_Weapons')
col = make_collection(sc, 'WEAPON_rifle')
V, VN, groups = read_obj(OBJ)
flips = {}
for name, g in groups.items():
    ob, flip = group_object(col, name, V, VN, g, 'mag' if name in MAG_GROUPS else 'bolt' if name in BOLT_GROUPS else 'body')
    flips[name] = flip
pivot(col, 'mag', *MAG_PIVOT)
pivot(col, 'bolt', *BOLT_PIVOT)

result = dict(stats(col), flipped=[k for k, v in flips.items() if v])
