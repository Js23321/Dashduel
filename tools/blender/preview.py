"""Workbench preview renders for multi-view inspection: set PV_SCENE, PV_CAMS ([(camera object name, output png path)]) and exec this."""
import bpy

sc = bpy.data.scenes[PV_SCENE]
bpy.context.window.scene = sc
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = PV_W if 'PV_W' in globals() else 1280
sc.render.resolution_y = PV_H if 'PV_H' in globals() else 720
sc.render.film_transparent = False
sh = sc.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_object_outline = False
sh.show_cavity = False
sc.display.render_aa = 'FXAA'
sc.world = sc.world or bpy.data.worlds.new('pv')
sc.world.color = (0.62, 0.78, 0.95)
out = []
for name, path in PV_CAMS:
    sc.camera = bpy.data.objects[name]
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    out.append(path)
result = {'rendered': out}
