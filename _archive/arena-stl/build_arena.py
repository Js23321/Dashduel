"""
RIVALS ARENA (the CC0 "Rivals Arena Map" 3D-print model, _models/rivals-arena-map.stl) modelled in Blender:
  1. the STL is read exactly (358 triangles, millimetre-ish units, Z up, floor at Z = 20) into the ARENA collection,
  2. the shape is cleaned (doubled vertices merged, normals made outward) and its edges get a small chamfer,
  3. surfaces get three neutral greys by direction (floor, tops, walls, undersides) - everything stays grey,
  4. non-colliding detail is added: floor grid lines, wall panel seams and base / top trim on the perimeter wall.
The collision in js/maps.js stays the exact STL shapes; this only improves the picture (chamfers are 0.5 model units = 6 cm).
Model units are kept (the exporter applies the game transform  x=(X-8)*0.12, y=(Z-20)*0.12, z=-(Y+26)*0.12).
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())
import struct

COLOURS.update({'greyMid': (0.66, 0.68, 0.72)})
STL = r'C:\Users\ryder\Downloads\Rivel\_models\rivals-arena-map.stl'

sc = make_scene('DASHDUEL_Arena')
col = make_collection(sc, 'ARENA')

# ---- 1. read the STL exactly -------------------------------------------------------------------------------------------------------
data = open(STL, 'rb').read()
n = struct.unpack('<I', data[80:84])[0]
bm = bmesh.new()
for i in range(n):
    o = 84 + i * 50
    v = struct.unpack('<12f', data[o:o + 48])
    vs = [bm.verts.new(Vector(v[3 + 3 * k:6 + 3 * k])) for k in range(3)]
    try:
        bm.faces.new(vs)
    except ValueError:
        pass
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0005)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
info = {'stl_tris': n, 'faces': len(bm.faces)}

# ---- 3. grey by direction (done before the chamfer so the chamfer faces inherit it) --------------------------------------------------
mats = ['greyMid', 'greyLight', 'grey', 'greyDark']
me = bpy.data.meshes.new('arena_shell')
slot = {}
for nme in mats:
    me.materials.append(get_mat(nme))
    slot[nme] = len(me.materials) - 1
for f in bm.faces:
    c = f.calc_center_median()
    if f.normal.z > 0.9:
        nm = 'greyMid' if abs(c.z - 20) < 0.5 else 'greyLight'
    elif f.normal.z < -0.9:
        nm = 'greyDark'
    else:
        nm = 'grey'
    f.material_index = slot[nm]

# ---- 2. small chamfer on the hard edges ------------------------------------------------------------------------------------------------
edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > 0.5]
try:
    bmesh.ops.bevel(bm, geom=edges, offset=0.5, segments=1, affect='EDGES', loop_slide=True)
    info['beveled_edges'] = len(edges)
except Exception as ex:  # a bevel can fail on awkward geometry: the exact shell is still fine without it
    info['bevel_failed'] = str(ex)[:80]
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = False
shell = bpy.data.objects.new('arena_shell', me)
col.objects.link(shell)
shell['part'] = 'shell'


# ---- 4. non-colliding detail (model units; protrudes at most 0.3 units = 3.6 cm) -----------------------------------------------------
# NOTE: lib.box() works in GAME axes (x, y up, z back). These details are authored in STL axes (X, Y forward, Z up), so build
# them with a tiny local helper that writes straight into Blender coordinates.
def slab(name, x0, x1, y0, y1, z0, z1, mat):
    b = bmesh.new()
    bmesh.ops.create_cube(b, size=1.0)
    bmesh.ops.scale(b, vec=(x1 - x0, y1 - y0, z1 - z0), verts=b.verts)
    bmesh.ops.translate(b, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=b.verts)
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    m = bpy.data.meshes.new(name)
    b.to_mesh(m)
    b.free()
    ob = bpy.data.objects.new(name, m)
    col.objects.link(ob)
    ob.data.materials.append(get_mat(mat))
    ob['part'] = 'detail'
    return ob


X0, X1, Y0, Y1 = -98.2, 114.3, -174.8, 122.8  # inner faces of the perimeter wall
Z_FLOOR, Z_TOP = 20.0, 120.0
# floor grid every 20 units (thin dark lines just above the floor)
for k, x in enumerate([x for x in range(-90, 114, 20)]):
    slab('grid_x%d' % k, x - 0.25, x + 0.25, Y0, Y1, Z_FLOOR, Z_FLOOR + 0.12, 'greyDark')
for k, y in enumerate([y for y in range(-170, 122, 20)]):
    slab('grid_y%d' % k, X0, X1, y - 0.25, y + 0.25, Z_FLOOR, Z_FLOOR + 0.12, 'greyDark')
# perimeter wall: base and top trim, vertical panel seams every 30 units
slab('trim_base_W', X0, X0 + 0.4, Y0, Y1, Z_FLOOR, Z_FLOOR + 10, 'greyDark')
slab('trim_base_E', X1 - 0.4, X1, Y0, Y1, Z_FLOOR, Z_FLOOR + 10, 'greyDark')
slab('trim_base_S', X0, X1, Y0, Y0 + 0.4, Z_FLOOR, Z_FLOOR + 10, 'greyDark')
slab('trim_base_N', X0, X1, Y1 - 0.4, Y1, Z_FLOOR, Z_FLOOR + 10, 'greyDark')
slab('trim_top_W', X0, X0 + 0.4, Y0, Y1, Z_TOP - 8, Z_TOP - 4, 'greyLight')
slab('trim_top_E', X1 - 0.4, X1, Y0, Y1, Z_TOP - 8, Z_TOP - 4, 'greyLight')
slab('trim_top_S', X0, X1, Y0, Y0 + 0.4, Z_TOP - 8, Z_TOP - 4, 'greyLight')
slab('trim_top_N', X0, X1, Y1 - 0.4, Y1, Z_TOP - 8, Z_TOP - 4, 'greyLight')
for k, y in enumerate(range(-150, 122, 30)):
    slab('seam_W%d' % k, X0, X0 + 0.3, y - 0.3, y + 0.3, Z_FLOOR + 10, Z_TOP - 8, 'greyDark')
    slab('seam_E%d' % k, X1 - 0.3, X1, y - 0.3, y + 0.3, Z_FLOOR + 10, Z_TOP - 8, 'greyDark')
for k, x in enumerate(range(-80, 114, 30)):
    slab('seam_S%d' % k, x - 0.3, x + 0.3, Y0, Y0 + 0.3, Z_FLOOR + 10, Z_TOP - 8, 'greyDark')
    slab('seam_N%d' % k, x - 0.3, x + 0.3, Y1 - 0.3, Y1, Z_FLOOR + 10, Z_TOP - 8, 'greyDark')

info.update(stats(col))
result = info
