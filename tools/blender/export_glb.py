"""
Exports every DASHDUEL scene's visual geometry as a glTF binary (_models/exports/<id>.glb) for other tools / engines. Run inside Blender
AFTER the build_*.py scripts. The game itself loads the generated js/mesh-<id>.js / js/mapdata-<id>.js files (the game has no glTF loader and
ships none: one script tag per map is lighter, needs no async parsing and is identical to what is exported here); the GLBs are the
interchange copies. Collision proxies, cameras and lights are not exported. Y-up, metres: the same numbers the game uses.
"""
import bpy, os, io, contextlib

OUT = r'C:\Users\ryder\Downloads\Rivel\_models\exports'
SCENES = {
    'lobby': ('DASHDUEL_Lobby', 'LOBBY'), 'arena': ('DASHDUEL_Arena', 'ARENA'), 'bridge': ('DASHDUEL_Bridge', 'BRIDGE'),
    'crossroads': ('DASHDUEL_Crossroads', 'CROSSROADS'), 'docks': ('DASHDUEL_Docks', 'DOCKS'), 'station': ('DASHDUEL_Station', 'STATION'),
    'backrooms': ('DASHDUEL_Backrooms', 'BACKROOMS'), 'shared-kit': ('DASHDUEL_Shared', 'SHARED'),
}
os.makedirs(OUT, exist_ok=True)
report = {}
for key, (scene_name, coll_name) in SCENES.items():
    sc = bpy.data.scenes.get(scene_name)
    root = bpy.data.collections.get(coll_name)
    if not sc or not root:
        report[key] = 'missing'
        continue
    bpy.context.window.scene = sc
    meshes = [ob for ob in root.all_objects if ob.type == 'MESH' and not ob.name.endswith('_collision') and not ob.hide_render]
    if not meshes:
        report[key] = 'no meshes'
        continue
    path = os.path.join(OUT, key + '.glb')
    # only this scene, only what is visible (the collision proxy, cameras and lights are hidden / skipped)
    with contextlib.redirect_stdout(io.StringIO()):
        bpy.ops.export_scene.gltf(filepath=path, use_active_scene=True, use_visible=True, use_selection=False, export_format='GLB', export_apply=True, export_yup=True,
                                  export_materials='EXPORT', export_cameras=False, export_lights=False)
    report[key] = {'objects': len(meshes), 'bytes': os.path.getsize(path)}
result = {k: v for k, v in report.items()}  # (the exporter's own log is long: keep the returned value tiny)
