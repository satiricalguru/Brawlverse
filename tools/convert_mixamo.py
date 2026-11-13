"""Convert Mixamo FBX files to GLB.

For every media-src/mixamo/<name>_idle.fbx (character with skin + idle):
  - public/models/mixamo/<name>.glb        skinned model with "Idle" (and "Attack" from an optional
                                           <name>_attack.fbx); this is what the landing page loads
  - public/models/mixamo/<name>_moves.glb  skeleton only, one animation per other <name>_<clip>.fbx,
                                           named <clip> (e.g. kael_fsmash.fbx -> "fsmash"); the game
                                           loads it next to the model and binds clips by bone name
Download the extra clips from Mixamo "without skin" and "in place" where the option exists.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/convert_mixamo.py
"""
import bpy, os, json, glob

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = f"{P}/media-src/mixamo"
OUT = f"{P}/public/models/mixamo"
SKIP = {"idle", "attack"}


def import_action(path, keep):
    """Import an FBX, take its armature's action, delete what it added."""
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in keep]
    act = next(o for o in new if o.type == 'ARMATURE').animation_data.action
    act.use_fake_user = True
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    return act


def set_tracks(arm, acts):
    ad = arm.animation_data
    ad.action = None
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    for act in acts:
        tr = ad.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, int(act.frame_range[0]), act)


def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_yup=True)
    return os.path.getsize(path) // 1024


out = {}
for idle_path in sorted(glob.glob(f"{SRC}/*_idle.fbx")):
    name = os.path.basename(idle_path)[:-9]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=idle_path)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    keep = set(bpy.context.scene.objects)
    acts = [arm.animation_data.action]
    acts[0].name = "Idle"
    atk = f"{SRC}/{name}_attack.fbx"
    if os.path.exists(atk):
        a = import_action(atk, keep)
        a.name = "Attack"
        acts.append(a)

    moves = []
    for clip_path in sorted(glob.glob(f"{SRC}/{name}_*.fbx")):
        clip = os.path.basename(clip_path)[len(name) + 1:-4]
        if clip in SKIP:
            continue
        a = import_action(clip_path, keep)
        a.name = clip
        moves.append(a)

    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, max(1, int(img.size[1] * 1024 / img.size[0])))
    set_tracks(arm, acts)
    info = {"kb": export(f"{OUT}/{name}.glb"), "anims": [a.name for a in acts],
            "tris": sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')}

    if moves:
        # the moves file carries the skeleton and its animations only: drop the meshes
        for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
            bpy.data.objects.remove(o, do_unlink=True)
        set_tracks(arm, [acts[0]] + moves)
        info["moves_kb"] = export(f"{OUT}/{name}_moves.glb")
        info["moves"] = [a.name for a in moves]
    out[name] = info
print("BV_RESULT " + json.dumps(out))
