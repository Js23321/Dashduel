"""
HANDGUN: the pistol from the OBJ the player supplied (_models/handgun/Handgun.obj, a Roblox Studio export: 9 mesh parts, 4 flat colours).
It is a chunky dark pistol: a navy frame with a big grip, a dark slate slide with three vent slits at the front, a black barrel, a black side
plate with a grey rivet, and a block rear sight with a small front wedge.
(The first, blocky procedural version of this pistol is kept in _archive/build_pistol_blocky.py.)

What this script does: reads the OBJ itself (no importer: the transform is exact and the mesh stays one-sided), turns it into game coordinates
(x right, y up, z BACKWARDS: the muzzle is at -z) and fits it to the old pistol's size (0.348 long, muzzle at z = -0.2, barrel axis y = 0.045),
gives every Roblox colour a game material, and splits two parts off as animated parts: the SLIDE (`slide`: slide body, sights and its rivet: it
cycles on every shot) and the MAGAZINE (`mag`: it drops out on a reload). The barrel, the frame and the side plate stay fixed.
Run inside Blender after lib.py (exec of lib.py happens below).
Anchors the game reads from this model (see SPEC.pistol in js/vmanim.js):
    front sight tip (0, 0.0822, -0.1664)   rear sight top (0, 0.0858 .. 0.0882, 0.0945)   muzzle (0, 0.045, -0.2)   ejection window (0.03, 0.068, -0.021)
Parts: body, slide (pivot 0, 0.0434, -0.0286), mag (pivot 0, -0.0784, 0.0883)
Materials (game names): rvDark (navy frame + grip), rvSlide (dark slate slide), rvBlack (barrel, side plate, sights, magazine), rvGrey (the rivets)
"""
import os

exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

OBJ = r'C:\Users\ryder\Downloads\Rivel\_models\handgun\Handgun.obj'

# OBJ (Roblox studs, long axis x, muzzle at the smallest x) -> game metres
S = 0.12  # 2.9 studs long -> 0.348 m: the rear sight lands where the old pistol's notch was (z 0.0945, y 0.0858)
X0 = -48.3648  # the muzzle end
ZC = 1097.345  # the middle of the pistol's width (z 1097.10 .. 1097.59): the sights are dead centre (x = 0)
YB = -366.872  # the barrel axis height


def to_game(x, y, z):
    return (-S * (z - ZC), 0.045 + S * (y - YB), -0.2 + S * (x - X0))


MATERIAL = {'Meshpart1Mtl': 'rvBlack', 'Meshpart4Mtl': 'rvGrey', 'Meshpart5Mtl': 'rvDark', 'Meshpart8Mtl': 'rvSlide'}
MAG_GROUPS = ('Meshpart1',)  # the magazine and its base plate (the part inside the grip)
MAG_PIVOT = (0.0, -0.0784, 0.0883)
SLIDE_GROUPS = ('Meshpart7', 'Meshpart8', 'Meshpart9')  # rear-sight rivet, the slide itself, and the sights / vent slits on top of it
SLIDE_PIVOT = (0.0, 0.0434, -0.0286)


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
col = make_collection(sc, 'WEAPON_pistol')
V, VN, groups = read_obj(OBJ)
flips = {}
for name, g in groups.items():
    ob, flip = group_object(col, 'pistol_' + name, V, VN, g, 'mag' if name in MAG_GROUPS else 'slide' if name in SLIDE_GROUPS else 'body')
    flips[name] = flip
pivot(col, 'mag', *MAG_PIVOT)
pivot(col, 'slide', *SLIDE_PIVOT)

result = dict(stats(col), flipped=[k for k, v in flips.items() if v])
