"""Build fighter meshes in Blender from key art + depth + matte and export GLB.
Run: /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_fighters.py
"""
import bpy, bmesh, numpy as np, os, json
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(P + "/public/models/relief", exist_ok=True)
STEP = 5
H = 4.9

def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4).copy()
    bpy.data.images.remove(img)
    return a

def blur(m, n):
    for _ in range(n):
        m = (m + np.roll(m, 1, 0) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)) / 5.0
    return m

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
scene = bpy.context.scene
out = {}
for name in ["kael", "nyx", "bramm", "zephra"]:
    depth = load(f"{P}/media-src/depth/fighter_{name}_depth.png")[:, :, 0]
    matte = load(f"{P}/media-src/matte/fighter_{name}_matte.png")[:, :, 0]
    ih, iw = depth.shape
    d = depth[::STEP, ::STEP]; m = matte[::STEP, ::STEP]
    gh, gw = d.shape
    inside = m > 0.5
    lo, hi = np.percentile(d[inside], [2, 98])
    dn = blur(np.clip((d - lo) / max(hi - lo, 1e-4), 0, 1), 2)
    fall = np.clip((blur(m, 14) - 0.5) * 2.2, 0, 1) ** 0.55
    W = H * iw / ih
    T = 0.95
    front = -(0.12 + 0.88 * dn) * T * fall
    back = (0.30 + 0.22 * dn) * T * fall

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    col = bm.loops.layers.color.new("Col")
    vf, vb = {}, {}
    def V(store, k, y):
        if k not in store:
            i, j = k
            store[k] = bm.verts.new(((j / (gw - 1) - 0.5) * W, float(y), (i / (gh - 1)) * H))
        return store[k]
    quad = inside[:-1, :-1] & inside[1:, :-1] & inside[:-1, 1:] & inside[1:, 1:]
    def setl(f, c):
        for l in f.loops:
            x, _, z = l.vert.co
            l[uvl].uv = (x / W + 0.5, z / H)
            l[col] = (c, c, c, 1.0)
    for i in range(gh - 1):
        for j in range(gw - 1):
            if not quad[i, j]:
                continue
            c = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            setl(bm.faces.new([V(vf, k, front[k]) for k in c]), 1.0)
            setl(bm.faces.new([V(vb, k, back[k]) for k in reversed(c)]), 0.4)
            edges = [(c[0], c[1], -1, 0), (c[1], c[2], 0, 1), (c[2], c[3], 1, 0), (c[3], c[0], 0, -1)]
            for a, b, di, dj in edges:
                ni, nj = i + di, j + dj
                if 0 <= ni < gh - 1 and 0 <= nj < gw - 1 and quad[ni, nj]:
                    continue
                try:
                    setl(bm.faces.new([V(vf, b, front[b]), V(vf, a, front[a]), V(vb, a, back[a]), V(vb, b, back[b])]), 0.6)
                except ValueError:
                    pass  # the face already exists (shared edge), nothing to add
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    me = bpy.data.meshes.new(f"BV_{name}")
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(f"BV_{name}", me)
    scene.collection.objects.link(ob)

    mat = bpy.data.materials.new(f"BV_{name}_mat"); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(f"{P}/media-src/flow/fighter_{name}.jpg")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.15
    me.materials.append(mat)

    path = f"{P}/public/models/relief/{name}.glb"
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='JPEG', export_yup=True)
    out[name] = {"verts": len(me.vertices), "kb": os.path.getsize(path) // 1024}
    bpy.data.objects.remove(ob)
print("BV_RESULT " + json.dumps(out))
