"""Convert Mixamo FBX files (character with skin + one animation) to GLB.
Any media-src/mixamo/<name>_idle.fbx becomes public/models/mixamo/<name>.glb; an optional
<name>_attack.fbx is merged in as a second animation named "Attack".
Run: /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/convert_mixamo.py
"""
import bpy, os, json, glob
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {}
for idle_path in sorted(glob.glob(f"{P}/media-src/mixamo/*_idle.fbx")):
    name = os.path.basename(idle_path)[:-9]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=idle_path)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    keep = set(bpy.context.scene.objects)
    acts = [arm.animation_data.action]
    acts[0].name = "Idle"
    atk = idle_path.replace("_idle.fbx", "_attack.fbx")
    if os.path.exists(atk):
        bpy.ops.import_scene.fbx(filepath=atk)
        new = [o for o in bpy.context.scene.objects if o not in keep]
        a = next(o for o in new if o.type == 'ARMATURE').animation_data.action
        a.name = "Attack"; a.use_fake_user = True
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        acts.append(a)
    ad = arm.animation_data
    ad.action = None
    for act in acts:
        tr = ad.nla_tracks.new(); tr.name = act.name
        tr.strips.new(act.name, int(act.frame_range[0]), act)
    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, max(1, int(img.size[1] * 1024 / img.size[0])))
    path = f"{P}/public/models/mixamo/{name}.glb"
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_yup=True)
    out[name] = {"kb": os.path.getsize(path) // 1024, "anims": [a.name for a in acts],
                 "tris": sum(len(o.data.loop_triangles) or len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'),
                 "images": [(i.name, i.size[0]) for i in bpy.data.images][:8]}
print("BV_RESULT " + json.dumps(out))
