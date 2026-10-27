"""
DASHDUEL Blender helpers (run inside Blender 4/5: exec(open(path).read())).

Everything is authored in GAME coordinates (the numbers the game uses): x right, y up, z BACKWARDS (a rifle's muzzle is at
negative z). The helpers convert to Blender's axes (X right, Y forward, Z up) with a proper rotation, so nothing is mirrored:
        blender = (x, -z, y)          game = (bx, bz, -by)
Models are built from chamfered boxes, cylinders and side-profile extrusions (the "low-poly hard-surface" look of the game).
Each object belongs to a PART (custom property "part"): the animated pieces of a weapon (magazine, slide, bolt, trigger,
grenade lever...) are separate parts with a pivot, the rest is the "body". export_models.py writes them to js/models-weapons.js.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

# viewport colours only (the game decides the real materials by NAME)
COLOURS = {
    'tan': (0.72, 0.64, 0.48), 'tanDark': (0.55, 0.49, 0.35), 'gun': (0.20, 0.23, 0.29), 'dark': (0.05, 0.06, 0.08),
    'poly': (0.12, 0.13, 0.16), 'rubber': (0.06, 0.07, 0.08), 'steel': (0.75, 0.78, 0.84), 'brass': (0.89, 0.67, 0.25),
    'acc': (0.18, 0.9, 1.0), 'accY': (1.0, 0.77, 0.0), 'white': (1, 1, 1), 'olive': (0.24, 0.29, 0.25), 'skin': (0.85, 0.65, 0.5),
    'sleeve': (0.13, 0.15, 0.18), 'cuff': (0.21, 0.23, 0.26), 'cuffLine': (0.18, 0.73, 0.65), 'grey': (0.66, 0.68, 0.72),
    'greyLight': (0.8, 0.82, 0.86), 'greyDark': (0.5, 0.52, 0.56),
    # RIVALS look (flat, chunky, saturated)
    'orange': (0.80, 0.30, 0.03), 'orangeDark': (0.56, 0.17, 0.01), 'black': (0.02, 0.022, 0.028), 'green': (0.03, 0.27, 0.05),
    'greenDark': (0.015, 0.14, 0.03), 'navy': (0.05, 0.065, 0.15), 'skinDark': (0.6, 0.38, 0.27),
    # the RIVALS rifle and handgun colours (flat, from their mesh exports)
    'rvDark': (0.0046, 0.0084, 0.0278), 'rvOrange': (0.77, 0.33, 0.049), 'rvOrangeDark': (0.67, 0.18, 0.04), 'rvGrey': (0.094, 0.096, 0.094),
    'rvBlack': (0.0026, 0.0026, 0.0026), 'rvSlide': (0.0072, 0.0189, 0.0316),
}


def gb(x, y, z):
    return Vector((x, -z, y))


def get_mat(name):
    m = bpy.data.materials.get('DD_' + name)
    if m:
        return m
    m = bpy.data.materials.new('DD_' + name)
    c = COLOURS.get(name, (0.5, 0.5, 0.5))
    m.diffuse_color = (c[0], c[1], c[2], 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1.0)
        bsdf.inputs['Roughness'].default_value = 0.6
    return m


def make_scene(name):
    sc = bpy.data.scenes.get(name) or bpy.data.scenes.new(name)
    return sc


def make_collection(scene, name, clear=True):
    col = bpy.data.collections.get(name)
    if col and clear:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    if not col:
        col = bpy.data.collections.new(name)
    if col.name not in [c.name for c in scene.collection.children]:
        scene.collection.children.link(col)
    return col


def _rot(rx, ry, rz):
    # three.js 'XYZ' Euler = Rx * Ry * Rz; game Y axis = Blender Z, game Z axis = Blender -Y
    return Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Z') @ Matrix.Rotation(-rz, 4, 'Y')


def _finish(col, name, bm, mat, part, x=0, y=0, z=0, rot=(0, 0, 0)):
    bm.normal_update()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(gb(x, y, z)) @ _rot(*rot), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.data.materials.append(get_mat(mat))
    ob['part'] = part
    for p in me.polygons:
        p.use_smooth = False
    return ob


def box(col, name, w, h, d, x, y, z, mat, rot=(0, 0, 0), bevel=0.0, part='body'):
    """Box: w along x, h along y, d along z (game axes), centred on (x, y, z). `bevel` chamfers every edge."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    if bevel > 0:
        b = min(bevel, min(w, h, d) * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=1, affect='EDGES')
    return _finish(col, name, bm, mat, part, x, y, z, rot)


def cyl(col, name, r_front, r_rear, length, x, y, z, mat, seg=10, rot=(0, 0, 0), part='body', cap=True):
    """Cylinder / cone along the game z axis (front = towards -z), centred on (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r_rear, radius2=r_front, depth=length)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(-math.pi / 2, 4, 'X'), verts=bm.verts)  # cone +Z -> +Y (forward)
    return _finish(col, name, bm, mat, part, x, y, z, rot)


def cyl_y(col, name, r_top, r_bottom, length, x, y, z, mat, seg=12, rot=(0, 0, 0), part='body'):
    """Cylinder along the game y axis (grenade body, fuze...)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r_bottom, radius2=r_top, depth=length)  # blender Z = game y
    return _finish(col, name, bm, mat, part, x, y, z, rot)


def sphere(col, name, r, x, y, z, mat, seg=10, rings=6, part='body', scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=(scale[0], scale[2], scale[1]), verts=bm.verts)
    return _finish(col, name, bm, mat, part, x, y, z)


def prof(col, name, pts, width, x, mat, bevel=0.0, part='body', rot=(0, 0, 0)):
    """Side-profile extrusion: `pts` = polygon of (z, y) game coordinates (a gun's side view), `width` along x, centred on x."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector((-width / 2, -pz, py))) for (pz, py) in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(width, 0, 0), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, width * 0.3), segments=1, affect='EDGES')
    return _finish(col, name, bm, mat, part, x, 0, 0, rot)


def ring(col, name, r, tube, x, y, z, mat, seg=12, part='body'):
    """A ring (peep sight hole) in the x-y plane made of `seg` small boxes: its hole looks along the z axis."""
    objs = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        w = 2 * math.pi * r / seg * 1.12
        objs.append(box(col, name + str(i), w, tube, tube, x + math.cos(a) * r, y + math.sin(a) * r, z, mat, rot=(0, 0, a + math.pi / 2), part=part))
    return objs


def pivot(col, part, x, y, z):
    col['pivot_' + part] = [x, y, z]


def stats(col):
    tris = 0
    for ob in col.objects:
        if ob.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return {'objects': len(col.objects), 'tris': tris}
