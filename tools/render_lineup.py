"""Render a cinematic lineup of the four fighters for the README / social preview.

Blender -b --factory-startup --python tools/render_lineup.py -- <out.png> [width height]
"""
import sys, math, os
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
W, H = (int(argv[1]), int(argv[2])) if len(argv) > 2 else (2400, 1200)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# name, fighter colour, x position, yaw towards camera (degrees)
ROSTER = [
    ('kael', (1.0, 0.42, 0.17), -2.7, 18),
    ('nyx', (0.22, 0.84, 1.0), -0.9, 6),
    ('bramm', (0.30, 1.0, 0.60), 0.95, -6),
    ('zephra', (0.78, 0.49, 1.0), 2.75, -18),
]
HEIGHT = 1.9  # every fighter normalised to this height (metres)

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
scn.render.resolution_x, scn.render.resolution_y = W, H
scn.render.film_transparent = False
vt = [v.identifier for v in scn.view_settings.bl_rna.properties['view_transform'].enum_items]
scn.view_settings.view_transform = 'AgX' if 'AgX' in vt else 'Filmic'
scn.view_settings.look = 'None'
try:
    scn.eevee.use_raytracing = True
    scn.eevee.taa_render_samples = 96
except Exception:
    pass  # older/newer EEVEE builds lack these settings; the defaults render fine

world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.006, 0.005, 0.01, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
scn.world = world


def emission_mat(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs[0].default_value = (*color, 1)
    e.inputs[1].default_value = strength
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def metal_mat(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = 0.9
    b.inputs['Roughness'].default_value = rough
    return m


# glossy dark floor so the fighters and their rims reflect
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
bpy.context.object.data.materials.append(metal_mat('floor', (0.012, 0.011, 0.016), 0.4))


def light(kind, loc, energy, color=(1, 1, 1), size=1.0, target=None, spot=None):
    L = bpy.data.objects.new(kind, bpy.data.lights.new(kind, kind))
    L.data.energy = energy
    L.data.color = color
    if kind == 'AREA':
        L.data.size = size
    if kind == 'SPOT' and spot:
        L.data.spot_size = math.radians(spot)
        L.data.spot_blend = 0.6
        L.data.shadow_soft_size = 0.2
    L.location = loc
    if target is not None:
        L.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scn.collection.objects.link(L)
    return L


for name, col, x, yaw in ROSTER:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'public/models/mixamo', name + '.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    holder = bpy.data.objects.new(name + '_holder', None)
    scn.collection.objects.link(holder)
    for r in roots:
        r.parent = holder
    scn.frame_set(12)

    def bounds():
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        pts = []
        for o in new:
            if o.type == 'MESH':
                e = o.evaluated_get(dg)
                me = e.to_mesh()
                pts += [e.matrix_world @ v.co for v in me.vertices]
                e.to_mesh_clear()
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return lo, hi

    lo, hi = bounds()
    k = HEIGHT / (hi.z - lo.z) * (1.06 if name == 'bramm' else 1.0)
    holder.scale = (k, k, k)
    holder.rotation_euler = (0, 0, math.radians(yaw))
    # measure again after scaling/turning, then move feet onto the plinth centre
    for _ in range(2):
        lo, hi = bounds()
        c = (lo + hi) / 2
        holder.location += Vector((x - c.x, -c.y, -lo.z))
    print('PLACED', name, tuple(round(v, 2) for v in bounds()[0]), tuple(round(v, 2) for v in bounds()[1]))

    # plinth with a glowing rim, like the site
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.62, depth=0.1, location=(x, 0, -0.05))
    bpy.context.object.data.materials.append(metal_mat(name + '_plinth', (0.02, 0.018, 0.026), 0.35))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.62, minor_radius=0.006, location=(x, 0, 0.002))
    bpy.context.object.data.materials.append(emission_mat(name + '_rim', col, 6))

    # top spot, coloured rim from behind, soft floor bounce
    light('SPOT', (x, -0.6, 4.4), 420, (1.0, 0.95, 0.9), target=(x, 0, 0.9), spot=34)
    light('AREA', (x - 0.9, 1.4, 2.2), 140, col, size=1.2, target=(x, 0, 1.1))
    light('AREA', (x + 0.9, 1.4, 1.6), 80, col, size=1.0, target=(x, 0, 1.0))
    light('POINT', (x, -0.7, 0.3), 6, col)

# gentle front fill so faces read
light('AREA', (0, -7, 2.4), 300, (1.0, 0.96, 0.92), size=8, target=(0, 0, 1.0))

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scn.collection.objects.link(cam)
cam.data.lens = 40
cam.location = (0, -8.6, 1.35)
cam.rotation_euler = (Vector((0, 0, 0.92)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = 8.6
cam.data.dof.aperture_fstop = 4.0
scn.camera = cam

scn.render.filepath = out
bpy.ops.render.render(write_still=True)
print('RENDERED', out)
