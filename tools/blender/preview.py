"""Turntable contact sheet of an exported GLB (re-imported, so it shows what ships).
Blender -b --factory-startup --python tools/blender/preview.py -- <glb> <out.png> <accent hex> [size]
Views: front, front 3/4, side, back 3/4, back, other side (model rotated, lights fixed like the site).
"""
import bpy, sys, math, os
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out, accent = argv[0], argv[1], argv[2]
S = int(argv[3]) if len(argv) > 3 else 480
ZC = float(argv[4]) if len(argv) > 4 else 2.6
VH = float(argv[5]) if len(argv) > 5 else 5.7

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in sc.objects if o.type == 'MESH']
SITE = os.environ.get('SITE', '1') == '1'  # mimic src/fighters3d.js: roughness 0.58, metalness 0.2 on every mesh
if SITE:
    for m in bpy.data.materials:
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    n.inputs['Roughness'].default_value = 0.58
                    n.inputs['Metallic'].default_value = 0.2
piv = bpy.data.objects.new('piv', None)
sc.collection.objects.link(piv)
for o in sc.objects:
    if o.parent is None and o is not piv:
        o.parent = piv


def hexc(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]


acc = hexc(accent)
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True if hasattr(w, 'use_nodes') else None
w.node_tree.nodes['Background'].inputs[0].default_value = (0.018, 0.016, 0.022, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0


def light(name, kind, loc, energy, color=(1, 1, 1), size=2.0):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    sc.collection.objects.link(ob)
    ob.location = loc
    d = ob.location.copy()
    d.z -= 2.4
    ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler() if False else (0, 0, 0)
    tgt = bpy.data.objects.new(name + '_t', None)
    sc.collection.objects.link(tgt)
    tgt.location = (0, 0, 2.3)
    c = ob.constraints.new('TRACK_TO')
    c.target = tgt
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    return ob


# site-like: key front-right-top, accent rims behind, hemi fill
light('key', 'AREA', (4, -7, 8), 1400, (1, 0.96, 0.9), 4)
light('fill', 'AREA', (-6, -5, 3), 260, (0.85, 0.88, 1.0), 6)
light('rimL', 'AREA', (-6, 6, 5), 900, acc, 3)
light('rimR', 'AREA', (6, 5, 2), 500, acc, 3)
light('top', 'AREA', (0, 2, 10), 300, (1, 1, 1), 6)

cam_d = bpy.data.cameras.new('cam')
cam_d.lens = 50
cam = bpy.data.objects.new('cam', cam_d)
sc.collection.objects.link(cam)
cam.location = (0, -15.5, ZC)
cam.rotation_euler = (math.radians(90), 0, 0)
sc.camera = cam
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = S
sc.render.resolution_y = int(S * 1.25)
sc.render.film_transparent = False
sc.eevee.taa_render_samples = 32
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy' if 'AgX - Punchy' in [i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items_static] else 'None'
cam_d.sensor_fit = 'VERTICAL'
cam_d.sensor_height = 24
cam_d.lens = 50 * (15.5 / 15.5) * (24 / 24) * 1.0
# fit 4.9 tall + margin: vertical fov
fov = 2 * math.atan((VH / 2) / 15.5)
cam_d.angle_y = fov if hasattr(cam_d, 'angle_y') else fov

angles = [0, 45, 90, 135, 180, 270]
tiles = []
tmp = os.path.splitext(out)[0]
for a in angles:
    piv.rotation_euler = (0, 0, math.radians(a))
    p = f"{tmp}_{a}.png"
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(p)
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    tiles.append(px.reshape(img.size[1], img.size[0], 4))
    bpy.data.images.remove(img)
h, wd = tiles[0].shape[:2]
sheet = np.zeros((h * 2, wd * 3, 4), dtype=np.float32)
for i, t in enumerate(tiles):
    r, c = divmod(i, 3)
    sheet[(1 - r) * h:(2 - r) * h, c * wd:(c + 1) * wd] = t
im = bpy.data.images.new('sheet', wd * 3, h * 2, alpha=True)
im.pixels.foreach_set(sheet.ravel())
im.filepath_raw = out
im.file_format = 'PNG'
im.save()
print('SHEET', out)
