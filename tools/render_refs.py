"""Render front 3/4 reference shots of each fighter GLB (for image-gen prompts).

Blender -b --factory-startup --python tools/render_refs.py -- <out_dir> name1 name2 ...
"""
import sys, math, os
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out_dir, names = argv[0], argv[1:]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for name in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'public/models/mixamo', name + '.glb'))
    # pose at a mid-idle frame
    scn.frame_set(10)
    bpy.context.view_layer.update()
    meshes = [o for o in scn.objects if o.type == 'MESH']
    pts = []
    for o in meshes:
        dg = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        pts += [dg.matrix_world @ Vector(c) for c in dg.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    h = hi.z - lo.z

    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    cam.data.lens = 70
    ang = math.radians(-25)  # front three-quarter (model faces -Y)
    d = h * 2.6
    cam.location = (c.x + math.sin(ang) * d, c.y - math.cos(ang) * d, c.z + h * 0.08)
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam

    def light(kind, loc, energy, size=2):
        L = bpy.data.objects.new(kind, bpy.data.lights.new(kind, 'AREA'))
        L.data.energy = energy
        L.data.size = size
        L.location = loc
        L.rotation_euler = (c - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scn.collection.objects.link(L)
    light('key', (c.x - 3, c.y - 4, c.z + 3), 900)
    light('fill', (c.x + 4, c.y - 3, c.z + 1), 300)
    light('rim', (c.x + 1, c.y + 4, c.z + 3), 700)

    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.18, 0.18, 0.2, 1)
    scn.world = world
    scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scn.render.resolution_x = 1200
    scn.render.resolution_y = 1600
    scn.render.film_transparent = True
    scn.render.image_settings.color_mode = 'RGBA'
    scn.render.filepath = os.path.join(out_dir, name + '_ref.png')
    scn.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in scn.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scn.render.filepath)
