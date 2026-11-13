"""Shared modelling / material / bake / export helpers for the Brawlverse fighter builds.

Every character script (build_<name>.py) imports this module, builds its geometry in
Blender world space (character facing -Y, Z up), then calls `finish(name, accent)`
which: applies modifiers, joins, normalises to 4.9 units tall with feet at z=0,
UV-unwraps into one atlas, bakes the procedural materials (colour * AO, emission,
normal) with Cycles, swaps in simple glTF-friendly image materials, saves a .blend
under media-src/blender/ and exports public/models/<name>.glb.

Run a character:  Blender -b --factory-startup --python tools/blender/build_kael.py
"""
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix, Euler

V = Vector
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
H_TARGET = 4.9


# --------------------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(7)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_obj(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    if smooth:
        me.shade_smooth()
    return ob


def recalc_normals(ob, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def subsurf(ob, lv=1):
    m = ob.modifiers.new("sub", 'SUBSURF')
    m.levels = lv
    m.render_levels = lv
    return ob


def solidify(ob, t, offset=1.0, rim=True):
    m = ob.modifiers.new("sol", 'SOLIDIFY')
    m.thickness = t
    m.offset = offset
    m.use_rim = rim
    m.use_even_offset = True
    return ob


def bevel(ob, w, segs=2, angle=40):
    m = ob.modifiers.new("bev", 'BEVEL')
    m.width = w
    m.segments = segs
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    return ob


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    ob.location = V(loc)
    ob.rotation_euler = Euler([math.radians(a) for a in rot], 'XYZ')
    if scale is not None:
        ob.scale = V(scale) if hasattr(scale, '__len__') else V((scale,) * 3)
    return ob


def parent_keep(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


# --------------------------------------------------------------------------- curves
def catmull(pts, res):
    pts = [V(p) for p in pts]
    n = len(pts)
    if n < 2 or res <= 1:
        return pts
    out = []
    for i in range(n - 1):
        p0 = pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(i + 2, n - 1)]
        for k in range(res):
            t = k / res
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


def frames(pts, ref):
    n = len(pts)
    T = []
    for i in range(n):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        d = b - a
        T.append(d.normalized() if d.length > 1e-9 else V((0, 0, 1)))
    ref = V(ref)
    N0 = ref - T[0] * ref.dot(T[0])
    if N0.length < 1e-5:
        N0 = T[0].orthogonal()
    N = [N0.normalized()]
    for i in range(1, n):
        q = T[i - 1].rotation_difference(T[i])
        Ni = q @ N[i - 1]
        Ni = (Ni - T[i] * Ni.dot(T[i]))
        N.append(Ni.normalized() if Ni.length > 1e-6 else N[i - 1])
    B = [T[i].cross(N[i]) for i in range(n)]
    return T, N, B


def _rad4(r):
    if isinstance(r, (int, float)):
        return V((r, r, 0, 0))
    r = list(r)
    while len(r) < 4:
        r.append(0.0 if len(r) >= 2 else r[0])
    return V(r)


def loft(name, pts, rads, mat, segs=16, res=3, ref=(1, 0, 0), power=2.0, caps=(True, True),
         capd=1.0, arc=None, solid=None, sub=1, smooth=True, twist=0.0, prof=None, arc_dir=None):
    """Tube along a Catmull-Rom path with elliptical / superelliptical cross-sections.
    rads: per control point r | (rx, ry) | (rx, ry, ox, oy) in the (N, B) frame.
    arc=(a0, a1) degrees -> open shell (use solid= thickness). Angle 0 = N, 90 = B.
    prof(theta)->(sx, sy) optional extra multiplier on the profile."""
    P = catmull(pts, res)
    R = catmull([_rad4(r) for r in rads], res)
    T, N, B = frames(P, ref)
    if twist:
        L = len(P)
        for i in range(L):
            a = math.radians(twist) * i / max(L - 1, 1)
            q = Matrix.Rotation(a, 3, T[i])
            N[i] = q @ N[i]
            B[i] = q @ B[i]
    if arc_dir is not None:  # (direction vector, total spread deg): arc centred on that world direction
        d = V(arc_dir[0])
        a0 = math.degrees(math.atan2(d.dot(B[0]), d.dot(N[0])))
        arc = (a0 - arc_dir[1] / 2, a0 + arc_dir[1] / 2)
    openr = arc is not None
    if openr:
        angs = [math.radians(arc[0] + (arc[1] - arc[0]) * j / segs) for j in range(segs + 1)]
    else:
        angs = [2 * math.pi * j / segs for j in range(segs)]
    e = 2.0 / power

    def ring(c, n, b, r, s=1.0):
        out = []
        for a in angs:
            ca, sa = math.cos(a), math.sin(a)
            x = math.copysign(abs(ca) ** e, ca)
            y = math.copysign(abs(sa) ** e, sa)
            if prof:
                mx, my = prof(a)
                x *= mx
                y *= my
            out.append(c + n * (r[2] + r[0] * x * s) + b * (r[3] + r[1] * y * s))
        return out

    rings = []
    poles = [None, None]
    if not openr and caps[0]:
        r = R[0]
        rr = (r[0] + r[1]) * 0.5 * capd
        for a in (80, 60, 35):
            ar = math.radians(a)
            rings.append(ring(P[0] - T[0] * rr * math.sin(ar), N[0], B[0], r, math.cos(ar)))
        poles[0] = P[0] - T[0] * rr
    for i in range(len(P)):
        rings.append(ring(P[i], N[i], B[i], R[i]))
    if not openr and caps[1]:
        r = R[-1]
        rr = (r[0] + r[1]) * 0.5 * capd
        for a in (35, 60, 80):
            ar = math.radians(a)
            rings.append(ring(P[-1] + T[-1] * rr * math.sin(ar), N[-1], B[-1], r, math.cos(ar)))
        poles[1] = P[-1] + T[-1] * rr
    verts = []
    faces = []
    m = len(angs)
    for rg in rings:
        verts.extend(rg)
    nring = len(rings)
    jn = m if not openr else m - 1
    for i in range(nring - 1):
        for j in range(jn):
            j2 = (j + 1) % m
            faces.append((i * m + j, i * m + j2, (i + 1) * m + j2, (i + 1) * m + j))
    if poles[0] is not None:
        pi = len(verts)
        verts.append(poles[0])
        for j in range(m):
            faces.append((pi, (j + 1) % m, j))
    if poles[1] is not None:
        pi = len(verts)
        verts.append(poles[1])
        base = (nring - 1) * m
        for j in range(m):
            faces.append((pi, base + j, base + (j + 1) % m))
    if not openr and not caps[0]:
        faces.append(tuple(reversed(range(m))))
    if not openr and not caps[1]:
        base = (nring - 1) * m
        faces.append(tuple(base + j for j in range(m)))
    ob = mesh_obj(name, verts, faces, mat, smooth)
    if not openr:
        recalc_normals(ob)
    if solid:
        solidify(ob, solid)
    if sub:
        subsurf(ob, sub)
    return ob


def surface(name, fn, nu, nv, mat, solid=None, sub=1, closed_u=False, smooth=True, offset=1.0):
    """Parametric open surface fn(u, v) -> point, u,v in [0,1]."""
    verts = []
    for j in range(nv):
        for i in range(nu):
            u = i / (nu if closed_u else (nu - 1))
            verts.append(V(fn(u, j / (nv - 1))))
    faces = []
    iu = nu if closed_u else nu - 1
    for j in range(nv - 1):
        for i in range(iu):
            i2 = (i + 1) % nu
            faces.append((j * nu + i, j * nu + i2, (j + 1) * nu + i2, (j + 1) * nu + i))
    ob = mesh_obj(name, verts, faces, mat, smooth)
    if solid:
        solidify(ob, solid, offset)
    if sub:
        subsurf(ob, sub)
    return ob


def ribbon(name, pts, widths, mat, ref=(0, 0, 1), res=4, twist=0.0, thick=0.015, sub=1, segw=2):
    """Flat strip following a path; width along the N axis of the frame."""
    P = catmull(pts, res)
    W = [w[0] for w in catmull([V((w, 0, 0)) for w in widths], res)]
    T, N, B = frames(P, ref)
    verts = []
    faces = []
    L = len(P)
    for i in range(L):
        a = math.radians(twist) * i / max(L - 1, 1)
        n = Matrix.Rotation(a, 3, T[i]) @ N[i]
        for k in range(segw + 1):
            s = -0.5 + k / segw
            verts.append(P[i] + n * W[i] * s)
    m = segw + 1
    for i in range(L - 1):
        for k in range(segw):
            faces.append((i * m + k, i * m + k + 1, (i + 1) * m + k + 1, (i + 1) * m + k))
    ob = mesh_obj(name, verts, faces, mat)
    if thick:
        solidify(ob, thick, 0.0)
    if sub:
        subsurf(ob, sub)
    return ob


def ellipsoid(name, c, r, mat, rot=(0, 0, 0), segs=24, rings=14, sub=0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    me.shade_smooth()
    place(ob, c, rot, r)
    if sub:
        subsurf(ob, sub)
    return ob


def rbox(name, c, size, mat, bev=0.03, rot=(0, 0, 0), segs=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    if bev:
        m = ob.modifiers.new("bev", 'BEVEL')
        m.width = bev
        m.segments = segs
        m.limit_method = 'NONE'
    me.shade_smooth()
    place(ob, c, rot)
    return ob


def cylinder(name, c, r, depth, mat, rot=(0, 0, 0), segs=24, bev=0.0, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2,
                          depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    if bev:
        bevel(ob, bev, 2, 30)
    me.shade_smooth()
    place(ob, c, rot)
    return ob


def rock(name, c, size, mat, seed=0, n=36, rot=(0, 0, 0), bev=0.025, squarish=3.0, flat=0.0):
    """Faceted slab: convex hull of points sampled on a superellipsoid."""
    rnd = random.Random(seed)
    pts = []
    for _ in range(n):
        while True:
            p = V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
            if p.length > 0.2:
                break
        p.normalize()
        e = 2.0 / squarish
        p = V([math.copysign(abs(a) ** e, a) for a in p])
        p *= rnd.uniform(0.86, 1.0)
        pts.append(p)
    for sx in (-1, 1):  # keep the bulk boxy
        for sy in (-1, 1):
            for sz in (-1, 1):
                pts.append(V((sx, sy, sz)) * rnd.uniform(0.62, 0.74))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vs)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    for v in bm.verts:
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    me.materials.append(mat)
    recalc_normals(ob)
    if bev:
        m = ob.modifiers.new("bev", 'BEVEL')
        m.width = bev
        m.segments = 1
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(25)
    place(ob, c, rot)
    return ob


def tube_path(name, pts, r, mat, res=3, segs=8, sub=0):
    return loft(name, pts, [r] * len(pts), mat, segs=segs, res=res, sub=sub)


def clip(ob, planes):
    """Remove geometry on the positive side of each (point, normal) plane (world space, object at identity)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    mwi = ob.matrix_world.inverted()
    for co, no in planes:
        co_l = mwi @ V(co)
        no_l = (mwi.to_3x3() @ V(no)).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co_l, plane_no=no_l, clear_outer=True)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _g(x, s):
    return math.exp(-(x * x) / (2 * s * s))


def head_mesh(name, c, r, mat, jaw=1.0, chin=0.0, brow=1.0, nose=1.0, cheek=1.0, rot=(0, 0, 0), segs=40, rings=28):
    """Single sculpted head: deformed sphere in unit space (front = -Y). r = (rx, ry, rz)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        f = max(0.0, -y)  # front-ness
        # jaw / chin: lower head narrower but squared; chin forward
        if z < 0:
            t = min(1.0, -z)
            x *= 1.0 - 0.28 * t * t * (1.3 - 0.3 * jaw) + 0.06 * (jaw - 1) * t
            y = y * (1.0 - 0.18 * t * t) - chin * 0.12 * t * t * f
        # flatter face plane, rounder back
        if y < 0:
            y *= 1.0 - 0.12 * f
        # brow ridge
        y -= brow * 0.07 * _g(z - 0.22, 0.07) * f ** 3 * (1 - 0.6 * abs(x))
        # eye sockets
        for sx in (-0.36, 0.36):
            y += 0.06 * _g(x - sx, 0.13) * _g(z - 0.1, 0.08) * f ** 2
        # nose
        y -= nose * 0.2 * _g(x, 0.07 + 0.05 * max(0, -z)) * _g(z + 0.08, 0.14) * f ** 6
        y -= nose * 0.06 * _g(x, 0.12) * _g(z + 0.2, 0.05) * f ** 6
        # cheekbones
        for sx in (-0.5, 0.5):
            y -= cheek * 0.03 * _g(x - sx, 0.15) * _g(z + 0.02, 0.1) * f
        # lips / mouth crease
        y -= 0.025 * _g(x, 0.16) * _g(z + 0.42, 0.04) * f ** 4
        y += 0.015 * _g(x, 0.2) * _g(z + 0.5, 0.015) * f ** 4
        v.co = V((x * r[0], y * r[1], z * r[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    me.materials.append(mat)
    me.shade_smooth()
    place(ob, c, rot)
    return ob


def hair_clumps(prefix, c, r, mat, n=30, seed=1, front_z=0.25, length=(0.18, 0.3), width=0.07, lift=0.35,
                sweep=(0, 1, 0.25), spread=1.0, thick=0.022, zmin=-0.2, skip_face=True, segs=6, curl=0.0):
    """Flattened tapered strands lying on an ellipsoid scalp, swept along `sweep`."""
    rnd = random.Random(seed)
    c = V(c)
    out = []
    sw = V(sweep).normalized()
    tries = 0
    while len(out) < n and tries < n * 30:
        tries += 1
        u = rnd.uniform(-1, 1)
        az = rnd.uniform(0, 2 * math.pi)
        d = V((math.sqrt(1 - u * u) * math.cos(az), math.sqrt(1 - u * u) * math.sin(az), u))
        if d.z < zmin:
            continue
        if skip_face and d.y < -0.35 and d.z < front_z:
            continue
        pts = []
        L = rnd.uniform(*length)
        p = V(d)
        steps = 5
        for k in range(steps):
            q = c + V((p.x * r[0], p.y * r[1], p.z * r[2])) * (1.0 + 0.09 + lift * (k / (steps - 1)) ** 2 * 0.25)
            pts.append(q)
            nrm = V((p.x / r[0], p.y / r[1], p.z / r[2])).normalized()
            t = sw - nrm * sw.dot(nrm)
            if t.length < 1e-4:
                t = V((0, 1, 0))
            t = t.normalized()
            t = (t + V((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3))) * spread * 0.4
                 + V((0, 0, curl * k / steps))).normalized()
            p = p + V((t.x / r[0], t.y / r[1], t.z / r[2])) * (L / (steps - 1))
            p = p.normalized()
        nrm0 = V((d.x / r[0], d.y / r[1], d.z / r[2])).normalized()
        w = width * rnd.uniform(0.75, 1.25)
        o = loft(f'{prefix}{len(out)}', pts, [(w, thick), (w * 0.9, thick * 0.9), (w * 0.7, thick * 0.7),
                                               (w * 0.4, thick * 0.5), (0.005, 0.004)],
                 mat, segs=segs, res=2, caps=(True, False), capd=0.5, ref=nrm0.cross((pts[-1] - pts[0]).normalized()), sub=1)
        out.append(o)
    return out


def hair_shell(name, c, r, mat, planes, disp=0.03, dsize=0.05, thick=0.03, kind='CLOUDS', stretch=(1, 1, 1),
               segs=36, rings=22):
    """Hair volume: ellipsoid clipped by planes, subdivided and displaced into soft clumps."""
    ob = ellipsoid(name, c, r, mat, segs=segs, rings=rings)
    bpy.context.view_layer.update()
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    clip(ob, planes)
    subsurf(ob, 1)
    tex = bpy.data.textures.new(name + '_disp', kind)
    if kind == 'CLOUDS':
        tex.noise_scale = dsize
        tex.noise_depth = 2
    elif kind == 'VORONOI':
        tex.noise_scale = dsize
        tex.distance_metric = 'DISTANCE'
    em = bpy.data.objects.new(name + '_texspace', None)
    link(em)
    em.location = V(c)
    em.scale = V(stretch)
    m = ob.modifiers.new('disp', 'DISPLACE')
    m.texture = tex
    m.strength = disp
    m.mid_level = 0.35
    m.texture_coords = 'OBJECT'
    m.texture_coords_object = em
    solidify(ob, thick, -1)
    subsurf(ob, 1)
    return ob


def group(name, parts, origin, zdir, front, scale=1.0):
    """Parts built in a local frame (+Z = zdir, -Y = front) are parented to an empty placed at origin."""
    e = bpy.data.objects.new(name, None)
    link(e)
    z = V(zdir).normalized()
    f = V(front)
    y = -(f - z * f.dot(z)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = V(origin)
    e.matrix_world = m @ Matrix.Scale(scale, 4)
    for p in parts:
        p.parent = e
    return e


# --------------------------------------------------------------------------- materials
def _nodes(mat):
    try:
        mat.use_nodes = True
    except Exception:
        pass  # Blender 5 always uses nodes and makes this read-only
    return mat.node_tree.nodes, mat.node_tree.links


class NB:
    def __init__(self, mat):
        self.n, self.l = _nodes(mat)
        for nd in list(self.n):
            self.n.remove(nd)

    def new(self, t, **kw):
        nd = self.n.new(t)
        ins = kw.pop('ins', {})
        for k, v in kw.items():
            setattr(nd, k, v)
        for k, v in ins.items():
            nd.inputs[k].default_value = v
        return nd

    def ln(self, a, b):
        self.l.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        nd = self.new('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                nd.inputs[i].default_value = x
            else:
                self.ln(x, nd.inputs[i])
        return nd.outputs[0]

    def mixc(self, a, b, fac):
        nd = self.new('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
        for sock, x in ((nd.inputs[0], fac), (nd.inputs[6], a), (nd.inputs[7], b)):
            if isinstance(x, (int, float)):
                sock.default_value = x
            elif isinstance(x, tuple):
                sock.default_value = x if len(x) == 4 else (*x, 1.0)
            else:
                self.ln(x, sock)
        return nd.outputs[2]

    def mapr(self, x, a, b, c=0.0, d=1.0, smooth=False):
        nd = self.new('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR')
        self.ln(x, nd.inputs[0])
        nd.inputs[1].default_value = a
        nd.inputs[2].default_value = b
        nd.inputs[3].default_value = c
        nd.inputs[4].default_value = d
        return nd.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.55, out='Fac'):
        nd = self.new('ShaderNodeTexNoise', ins={'Scale': scale, 'Detail': detail, 'Roughness': rough})
        self.ln(vec, nd.inputs['Vector'])
        return nd.outputs[out]


def rgb(hexs, mul=1.0):
    hexs = hexs.lstrip('#')
    c = [int(hexs[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    c = [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]
    return tuple(x * mul for x in c)


def material(name, base, base2=None, rough=0.5, metal=0.0, nscale=6.0, var=0.5, edge=None, edge_amt=0.0,
             bump=0.15, bscale=40.0, cracks=None, moss=None, emit=None, emit_strength=0.0, art=None,
             streak=None, pattern=None, uvscale=1.0):
    """Procedural material for baking. Nodes named BAKE_COL / BAKE_EMIT expose colour / emission."""
    mat = bpy.data.materials.new(name)
    b = NB(mat)
    tc = b.new('ShaderNodeTexCoord')
    co = tc.outputs['Object']
    geo = b.new('ShaderNodeNewGeometry')
    n1 = b.noise(co, nscale, 6.0, 0.6)
    col = b.mixc(base, base2 or tuple(x * 0.55 for x in base), b.mapr(n1, 0.5 - var * 0.5, 0.5 + var * 0.5))
    if streak:  # stretched noise (hair strands / cloth weave): (scale, axis_stretch, colour)
        mp = b.new('ShaderNodeMapping', ins={'Scale': streak[1]})
        b.ln(co, mp.inputs['Vector'])
        s = b.noise(mp.outputs[0], streak[0], 3.0, 0.5)
        col = b.mixc(col, streak[2], b.mapr(s, 0.35, 0.75))
    if edge:
        bev = b.new('ShaderNodeBevel', samples=8, ins={'Radius': 0.025})
        dot = b.new('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        b.ln(bev.outputs[0], dot.inputs[0])
        b.ln(geo.outputs['Normal'], dot.inputs[1])
        em = b.mapr(dot.outputs['Value'], 0.995, 0.93)
        wear = b.mapr(b.noise(co, 22.0, 3.0), 0.35, 0.65)
        em = b.math('MULTIPLY', em, wear)
        col = b.mixc(col, edge, b.math('MULTIPLY', em, edge_amt))
    if moss:  # (colour, amount): up-facing + noise
        sep = b.new('ShaderNodeSeparateXYZ')
        b.ln(geo.outputs['Normal'], sep.inputs[0])
        up = b.mapr(sep.outputs['Z'], -0.1, 0.7)
        mn = b.mapr(b.noise(co, 3.5, 6.0, 0.65), 0.38, 0.62)
        mn2 = b.mapr(b.noise(co, 14.0, 4.0, 0.6), 0.3, 0.7, 0.4, 1.0)
        mm = b.math('MULTIPLY', b.math('MULTIPLY', up, mn), mn2)
        mm = b.math('MULTIPLY', mm, moss[1], clamp=True)
        mossc = b.mixc(moss[0], tuple(x * 0.5 for x in moss[0]), b.noise(co, 30.0, 2.0))
        col = b.mixc(col, mossc, mm)
    emit_sock = None
    crack_line = None
    if cracks:  # dict(color, scale, width, coverage)
        mp = b.new('ShaderNodeMapping')
        b.ln(co, mp.inputs['Vector'])
        warp = b.new('ShaderNodeTexNoise', ins={'Scale': 2.5, 'Detail': 3.0})
        b.ln(co, warp.inputs['Vector'])
        add = b.new('ShaderNodeMix', data_type='VECTOR', blend_type='MIX')
        add.inputs[0].default_value = 0.18
        b.ln(co, add.inputs[4])
        b.ln(warp.outputs['Color'], add.inputs[5])
        vor = b.new('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', ins={'Scale': cracks.get('scale', 3.0)})
        b.ln(add.outputs[1], vor.inputs['Vector'])
        line = b.mapr(vor.outputs['Distance'], 0.0, cracks.get('width', 0.035), 1.0, 0.0)
        glow = b.mapr(vor.outputs['Distance'], 0.0, cracks.get('width', 0.035) * 3.5, 1.0, 0.0)
        mask = b.mapr(b.noise(co, cracks.get('mscale', 1.6), 2.0), 0.5 - cracks.get('coverage', 0.1),
                      0.54 - cracks.get('coverage', 0.1), 0.0, 1.0)
        line = b.math('MULTIPLY', line, mask)
        glow = b.math('MULTIPLY', glow, mask)
        crack_line = line
        hot = b.mixc(cracks['color'], (1.0, 0.85, 0.45, 1), b.math('POWER', line, 3.0))
        emit_sock = b.mixc((0, 0, 0, 1), hot, b.math('ADD', line, b.math('MULTIPLY', glow, 0.25), clamp=True))
        col = b.mixc(col, (0.02, 0.012, 0.01, 1), b.math('MULTIPLY', glow, 0.7))
        col = b.mixc(col, cracks['color'], line)
    if pattern:  # emissive tattoo-like pattern: (colour, scale, mask_axis_range or None)
        mp = b.new('ShaderNodeMapping', ins={'Scale': (1.0, 1.0, 3.0)})
        b.ln(co, mp.inputs['Vector'])
        wv = b.new('ShaderNodeTexWave', wave_type='RINGS', ins={'Scale': pattern[1], 'Distortion': 6.0,
                                                               'Detail': 2.0, 'Detail Scale': 1.5})
        b.ln(mp.outputs[0], wv.inputs['Vector'])
        pl = b.mapr(wv.outputs['Fac'], 0.42, 0.5, 0.0, 1.0)
        pl2 = b.mapr(wv.outputs['Fac'], 0.5, 0.58, 1.0, 0.0)
        pline = b.math('MULTIPLY', pl, pl2)
        pm = b.mapr(b.noise(co, 2.0, 2.0), 0.4, 0.55)
        pline = b.math('MULTIPLY', pline, pm)
        col = b.mixc(col, pattern[0], pline)
        emit_sock = b.mixc((0, 0, 0, 1), pattern[0], pline)
    if art:  # projected key-art (face) on front-facing surfaces via ArtUV layer
        uvn = b.new('ShaderNodeUVMap', uv_map='ArtUV')
        img = b.new('ShaderNodeTexImage', extension='CLIP', interpolation='Cubic')
        img.image = art['image']
        b.ln(uvn.outputs[0], img.inputs['Vector'])
        sep = b.new('ShaderNodeSeparateXYZ')
        b.ln(geo.outputs['Normal'], sep.inputs[0])
        facing = b.mapr(sep.outputs['Y'], -art.get('f0', 0.2), -art.get('f1', 0.6), 0.0, 1.0, True)
        fac = b.math('MULTIPLY', facing, img.outputs['Alpha'])
        artc = img.outputs['Color']
        if art.get('gain'):
            g = b.new('ShaderNodeHueSaturation', ins={'Value': art['gain'], 'Saturation': art.get('sat', 1.0)})
            b.ln(artc, g.inputs['Color'])
            artc = g.outputs[0]
        col = b.mixc(col, artc, fac)
    if emit is not None:
        emit_sock = b.mixc((0, 0, 0, 1), emit, 1.0)
    colnode = b.new('ShaderNodeMix', data_type='RGBA', name='BAKE_COL')
    colnode.name = 'BAKE_COL'
    colnode.inputs[0].default_value = 0.0
    if isinstance(col, tuple):
        colnode.inputs[6].default_value = (*col[:3], 1.0)
    else:
        b.ln(col, colnode.inputs[6])
    emnode = b.new('ShaderNodeMix', data_type='RGBA')
    emnode.name = 'BAKE_EMIT'
    emnode.inputs[0].default_value = 0.0
    emnode.inputs[6].default_value = (0, 0, 0, 1)
    if emit_sock is not None:
        b.ln(emit_sock, emnode.inputs[6])
    bsdf = b.new('ShaderNodeBsdfPrincipled', ins={'Roughness': rough, 'Metallic': metal})
    bsdf.name = 'BSDF'
    b.ln(colnode.outputs[2], bsdf.inputs['Base Color'])
    b.ln(emnode.outputs[2], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    if bump:
        bn = b.new('ShaderNodeBump', ins={'Strength': bump, 'Distance': 0.02})
        h = b.noise(co, bscale, 8.0, 0.62)
        if crack_line is not None:
            h = b.math('SUBTRACT', h, b.math('MULTIPLY', crack_line, 0.6))
        if moss:
            h = b.math('ADD', h, b.math('MULTIPLY', b.noise(co, 60.0, 2.0), 0.3))
        b.ln(h, bn.inputs['Height'])
        b.ln(bn.outputs[0], bsdf.inputs['Normal'])
    out = b.new('ShaderNodeOutputMaterial')
    b.ln(bsdf.outputs[0], out.inputs['Surface'])
    mat['rough'] = rough
    mat['metal'] = metal
    mat['emit_strength'] = float(emit_strength)
    mat['uvscale'] = float(uvscale)
    mat.diffuse_color = (*((base[:3]) if isinstance(base, tuple) else (0.5, 0.5, 0.5)), 1)
    return mat


# --------------------------------------------------------------------------- art projection
def art_image(name):
    p = f"{ROOT}/media-src/flow/fighter_{name}.jpg"
    img = bpy.data.images.load(p, check_existing=True)
    return img


def add_art_uv(ob, img_size, crop, box):
    """Planar front projection: world-space rectangle box=(x0, z0, x1, z1) -> image pixel rect
    crop=(px0, py0, px1, py1) (y down)."""
    bpy.context.view_layer.update()
    me = ob.data
    if 'UVMap' not in me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uvl = me.uv_layers.new(name='ArtUV')
    W, Hh = img_size
    mw = ob.matrix_world
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = mw @ me.vertices[me.loops[li].vertex_index].co
            fx = (v.x - box[0]) / (box[2] - box[0])
            fz = (v.z - box[1]) / (box[3] - box[1])
            px = crop[0] + fx * (crop[2] - crop[0])
            py = crop[3] - fz * (crop[3] - crop[1])
            uvl.data[li].uv = (px / W, 1.0 - py / Hh)
    me.uv_layers.active = me.uv_layers['UVMap']


# --------------------------------------------------------------------------- finish pipeline
def _select_only(obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def _setup_gpu():
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        bpy.context.scene.cycles.device = 'GPU'
    except Exception as e:
        print("GPU setup failed", e)


def bake_image(name, size, nonc=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if nonc:
        img.colorspace_settings.name = 'Non-Color'
    return img


def _set_target(mats, img):
    for m in mats:
        n, _ = _nodes(m)
        t = n.get('BAKE_TARGET')
        if t is None:
            t = n.new('ShaderNodeTexImage')
            t.name = 'BAKE_TARGET'
        t.image = img
        n.active = t
        t.select = True


def _route(mats, what):
    """what = 'COL' | 'EMIT' | None (restore BSDF)."""
    for m in mats:
        n, l = _nodes(m)
        out = [x for x in n if x.type == 'OUTPUT_MATERIAL'][0]
        for lk in list(out.inputs['Surface'].links):
            l.remove(lk)
        if what is None:
            l.new(n['BSDF'].outputs[0], out.inputs['Surface'])
        else:
            em = n.get('BAKE_EMSHADER') or n.new('ShaderNodeEmission')
            em.name = 'BAKE_EMSHADER'
            for lk in list(em.inputs['Color'].links):
                l.remove(lk)
            l.new(n['BAKE_' + what].outputs[2], em.inputs['Color'])
            em.inputs['Strength'].default_value = 1.0
            l.new(em.outputs[0], out.inputs['Surface'])


def finish(name, accent, tex=2048, ntex=2048, extra_rot=0.0, emit_boost=None, tri_budget=80000, fixed_h=None):
    scene = bpy.context.scene
    tex = int(os.environ.get('TEX', tex))
    ntex = int(os.environ.get('NTEX', min(ntex, tex // 2)))
    outdir = f"{ROOT}/media-src/blender"
    texdir = f"{outdir}/tex"
    os.makedirs(texdir, exist_ok=True)
    bpy.context.view_layer.update()
    meshes = [o for o in scene.objects if o.type == 'MESH']
    # ensure UVMap exists first everywhere
    for o in meshes:
        me = o.data
        if 'UVMap' not in me.uv_layers:
            lay = me.uv_layers.new(name='UVMap')
            me.uv_layers.move(lay, 0) if hasattr(me.uv_layers, 'move') else None
        me.uv_layers.active = me.uv_layers['UVMap']
    # apply modifiers / make single
    _select_only(meshes)
    bpy.ops.object.convert(target='MESH')
    meshes = [o for o in scene.objects if o.type == 'MESH']
    stats = {}
    for o in meshes:
        key = o.name.rstrip('0123456789.-_LR')[:10]
        stats[key] = stats.get(key, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
    print('[tris]', sorted(stats.items(), key=lambda kv: -kv[1])[:25])
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    _select_only(meshes)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    # normalise: height, feet at 0, centred
    bb = [V(c) for c in ob.bound_box]
    zmin = min(c.z for c in bb)
    zmax = max(c.z for c in bb)
    s = H_TARGET / (zmax - zmin) if fixed_h is None else fixed_h
    me = ob.data
    xs = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', xs)
    xs = xs.reshape(-1, 3)
    xs *= s
    xs[:, 2] -= xs[:, 2].min()
    cx = (xs[:, 0].min() + xs[:, 0].max()) * 0.5
    cy = (xs[:, 1].min() + xs[:, 1].max()) * 0.5
    xs[:, 0] -= cx
    xs[:, 1] -= cy
    me.vertices.foreach_set('co', xs.ravel())
    me.update()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"[{name}] tris={tris} scale={s:.3f}")
    if tris > tri_budget:
        dec = ob.modifiers.new('dec', 'DECIMATE')
        dec.ratio = tri_budget / tris * 0.97
        _select_only([ob])
        bpy.ops.object.modifier_apply(modifier='dec')
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f"[{name}] decimated tris={tris}")
    # UV atlas
    _select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0015, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # enlarge islands of materials with uvscale > 1 (faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv['UVMap']
    for mi, m in enumerate(me.materials):
        k = m.get('uvscale', 1.0) if m else 1.0
        if k <= 1.0:
            continue
        loops = [l for f in bm.faces if f.material_index == mi for l in f.loops]
        if not loops:
            continue
        c = sum((l[uvl].uv for l in loops), V((0, 0))) / len(loops)
        for l in loops:
            l[uvl].uv = c + (l[uvl].uv - c) * k
    bm.to_mesh(me)
    bm.free()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.002, shape_method='CONVEX')
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    # bake
    scene.render.engine = 'CYCLES'
    _setup_gpu()
    scene.cycles.samples = 4
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = True
    mats = [m for m in me.materials if m]
    _select_only([ob])
    imgs = {}
    for key, nonc, sz in (('col', False, tex), ('emit', False, tex // 2), ('ao', True, tex // 2), ('nrm', True, ntex)):
        img = bake_image(f"{name}_{key}", sz, nonc)
        imgs[key] = img
        _set_target(mats, img)
        if key == 'col':
            _route(mats, 'COL')
            scene.cycles.samples = 4
            bpy.ops.object.bake(type='EMIT')
            chk = np.empty(sz * sz * 4, dtype=np.float32)
            img.pixels.foreach_get(chk)
            if chk.reshape(-1, 4)[:, :3].mean() < 0.03:  # GPU bake failed (e.g. out of memory): redo on CPU
                print(f"[{name}] colour bake looks empty, retrying on CPU")
                scene.cycles.device = 'CPU'
                bpy.ops.object.bake(type='EMIT')
        elif key == 'emit':
            _route(mats, 'EMIT')
            scene.cycles.samples = 4
            bpy.ops.object.bake(type='EMIT')
        elif key == 'ao':
            _route(mats, None)
            scene.cycles.samples = 48
            scene.world = scene.world or bpy.data.worlds.new('w')
            bpy.ops.object.bake(type='AO')
        else:
            _route(mats, None)
            scene.cycles.samples = 4
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        print(f"[{name}] baked {key}")
    # colour *= AO
    c = np.empty(tex * tex * 4, dtype=np.float32)
    imgs['col'].pixels.foreach_get(c)
    a = np.empty((tex // 2) ** 2 * 4, dtype=np.float32)
    imgs['ao'].pixels.foreach_get(a)
    a = a.reshape(tex // 2, tex // 2, 4)[:, :, 0]
    a = np.kron(a, np.ones((2, 2), dtype=np.float32))
    c = c.reshape(tex, tex, 4)
    c[:, :, :3] *= (0.35 + 0.65 * a)[:, :, None] ** 1.1
    imgs['col'].pixels.foreach_set(c.ravel())
    paths = {}
    for key in ('col', 'emit', 'nrm'):
        p = f"{texdir}/{name}_{key}.jpg"
        imgs[key].filepath_raw = p
        imgs[key].file_format = 'JPEG'
        imgs[key].save(filepath=p, quality=88)
        paths[key] = p
    bpy.data.images.remove(imgs['ao'])
    # rebuild materials for glTF
    for m in mats:
        b = NB(m)
        bsdf = b.new('ShaderNodeBsdfPrincipled', ins={'Roughness': m['rough'], 'Metallic': m['metal']})
        tc = b.new('ShaderNodeTexImage')
        tc.image = imgs['col']
        b.ln(tc.outputs['Color'], bsdf.inputs['Base Color'])
        tn = b.new('ShaderNodeTexImage')
        tn.image = imgs['nrm']
        nm = b.new('ShaderNodeNormalMap')
        b.ln(tn.outputs['Color'], nm.inputs['Color'])
        b.ln(nm.outputs[0], bsdf.inputs['Normal'])
        es = m['emit_strength']
        if emit_boost:
            es *= emit_boost
        if es > 0:
            te = b.new('ShaderNodeTexImage')
            te.image = imgs['emit']
            b.ln(te.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = es
        else:
            bsdf.inputs['Emission Strength'].default_value = 0.0
        out = b.new('ShaderNodeOutputMaterial')
        b.ln(bsdf.outputs[0], out.inputs['Surface'])
    if 'ArtUV' in me.uv_layers:
        me.uv_layers.remove(me.uv_layers['ArtUV'])
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    # save .blend + export glb
    bpy.ops.wm.save_as_mainfile(filepath=f"{outdir}/{name}.blend", relative_remap=True)
    glb = f"{ROOT}/public/models/{name}.glb"
    _select_only([ob])
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='JPEG', export_jpeg_quality=85,
                              export_tangents=False, export_cameras=False, export_lights=False)
    print(f"[{name}] exported {glb} {os.path.getsize(glb) / 1e6:.2f} MB tris={tris}")
    return glb

# names the build_<fighter>.py scripts take with `from common import *`
__all__ = [
    'bpy',
    'bmesh',
    'math',
    'os',
    'random',
    'np',
    'Vector',
    'Matrix',
    'Euler',
    'V',
    'ROOT',
    'H_TARGET',
    'reset',
    'link',
    'mesh_obj',
    'recalc_normals',
    'subsurf',
    'solidify',
    'bevel',
    'place',
    'parent_keep',
    'catmull',
    'frames',
    'loft',
    'surface',
    'ribbon',
    'ellipsoid',
    'rbox',
    'cylinder',
    'rock',
    'tube_path',
    'clip',
    'head_mesh',
    'hair_clumps',
    'hair_shell',
    'group',
    'NB',
    'rgb',
    'material',
    'art_image',
    'add_art_uv',
    'bake_image',
    'finish',
]
