"""Bramm - towering stone golem: mossy slabs bound with riveted bronze bands, glowing emerald runes on
chest and forearms, small green eyes, huge fists. Rocks are faceted convex-hull slabs over a dark core
whose green fissures glow through the gaps.
Blender -b --factory-startup --python tools/blender/build_bramm.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, common
importlib.reload(common)
from common import *

reset()
ACC = '#4dff9a'
rnd = random.Random(21)

M_ROCK = material('stone', rgb('#8a867c'), rgb('#4b4943'), rough=0.9, nscale=3.5, var=0.8,
                  edge=rgb('#b9b4a8'), edge_amt=0.55, bump=0.45, bscale=14,
                  moss=(rgb('#5d7a2c'), 2.4))
M_ROCK2 = material('stone_dark', rgb('#6f6b63'), rgb('#3a3934'), rough=0.92, nscale=4, var=0.8,
                   edge=rgb('#a29d91'), edge_amt=0.5, bump=0.45, bscale=16, moss=(rgb('#4d6a22'), 1.2))
M_CORE = material('core', rgb('#26261f'), rgb('#121210'), rough=0.95, nscale=6, var=0.5, bump=0.3, bscale=20,
                  cracks=dict(color=rgb('#4dff9a'), scale=2.5, width=0.02, coverage=-0.02, mscale=1.2),
                  emit_strength=2.5, moss=(rgb('#3d5a1e'), 1.0))
M_BRONZE = material('bronze', rgb('#c4834a'), rgb('#6e4220'), rough=0.38, metal=0.9, nscale=10, var=0.6,
                    edge=rgb('#f0b878'), edge_amt=0.8, bump=0.25, bscale=50, moss=(rgb('#3f7a62'), 0.6))
M_RUNE = material('rune', rgb('#9dffc8'), emit=rgb('#4dff9a'), rough=0.4, emit_strength=7.0, bump=0)
M_ROOT = material('root', rgb('#4a3826'), rgb('#21170e'), rough=0.85, nscale=20, var=0.6, bump=0.3, bscale=80)

rocks = []


def R(name, c, size, rot=(0, 0, 0), mat=None, seed=None, sq=3.0):
    o = rock(name, c, size, mat or M_ROCK, seed=seed if seed is not None else len(rocks) * 13 + 5, n=34,
             rot=rot, bev=0.035, squarish=sq)
    rocks.append(o)
    return o


def band(name, a, b, r, w=0.2, n_rivets=10, ref=(1, 0, 0)):
    a, b = V(a), V(b)
    d = (b - a).normalized()
    c = a.lerp(b, 0.5)
    ry = r if isinstance(r, (int, float)) else r[1]
    rx = r if isinstance(r, (int, float)) else r[0]
    o = loft(name, [c - d * w / 2, c + d * w / 2], [(rx, ry), (rx, ry)], M_BRONZE, segs=28, res=1,
             caps=(False, False), solid=0.045, ref=ref, power=2.4, sub=0)
    bevel(o, 0.012, 2, 30)
    T, N, B = frames([c - d, c + d], ref)
    for i in range(n_rivets):
        a_ = 2 * math.pi * i / n_rivets
        ca, sa = math.cos(a_), math.sin(a_)
        e = 2 / 2.4
        x = math.copysign(abs(ca) ** e, ca)
        y = math.copysign(abs(sa) ** e, sa)
        p = c + N[0] * (rx + 0.045) * x + B[0] * (ry + 0.045) * y
        ellipsoid(f'{name}_rv{i}', p, (0.032, 0.032, 0.032), M_BRONZE, segs=8, rings=6)


# ---------------------------------------------------------------- core body (glowing fissures behind slabs)
loft('core', [(0, 0.05, 2.05), (0, 0.0, 2.5), (0, -0.05, 3.3), (0, 0.05, 4.0), (0, 0.15, 4.3)],
     [(0.62, 0.45), (0.65, 0.48), (0.85, 0.55), (0.9, 0.55), (0.5, 0.4)], M_CORE, segs=16, sub=1)
for s in (-1, 1):
    loft(f'corearm{s}', [(s * 0.75, 0.05, 4.05), (s * 1.2, 0.0, 3.4), (s * 1.42, -0.05, 2.5), (s * 1.38, -0.12, 1.75)],
         [0.3, 0.3, 0.3, 0.28], M_CORE, segs=12)
    loft(f'coreleg{s}', [(s * 0.4, 0.05, 1.9), (s * 0.78, 0.0, 1.3), (s * 0.88, 0.03, 0.7), (s * 0.98, 0.0, 0.3)],
         [0.33, 0.33, 0.3, 0.28], M_CORE, segs=12)

# ---------------------------------------------------------------- torso slabs
chestL = R('chestL', (-0.42, -0.42, 3.45), (0.46, 0.3, 0.4), rot=(4, -6, 4), sq=3.4)
chestR = R('chestR', (0.42, -0.42, 3.42), (0.46, 0.3, 0.4), rot=(-3, 8, -5), sq=3.4)
R('sternum', (0.0, -0.28, 3.9), (0.42, 0.3, 0.22), rot=(-10, 0, 2))
R('belly1', (-0.25, -0.33, 2.82), (0.3, 0.26, 0.26), rot=(0, 0, 12))
R('belly2', (0.27, -0.32, 2.8), (0.3, 0.26, 0.27), rot=(0, 0, -8))
R('belly3', (0.0, -0.3, 2.42), (0.36, 0.26, 0.24), rot=(0, 0, 3))
R('belly4', (-0.45, -0.25, 2.55), (0.24, 0.26, 0.3), rot=(0, 0, 18), mat=M_ROCK2)
R('belly5', (0.47, -0.24, 2.58), (0.24, 0.26, 0.3), rot=(0, 0, -15), mat=M_ROCK2)
R('flankL', (-0.62, 0.2, 2.6), (0.24, 0.32, 0.35), rot=(0, 0, 0), mat=M_ROCK2)
R('flankR', (0.62, 0.2, 2.6), (0.24, 0.32, 0.35), rot=(0, 0, 0), mat=M_ROCK2)
R('pelvis', (0.0, -0.05, 1.9), (0.62, 0.45, 0.32), rot=(0, 0, 0), mat=M_ROCK2)
R('crotch', (0.0, 0.0, 1.62), (0.3, 0.3, 0.2), mat=M_ROCK2)
R('hipL', (-0.5, -0.05, 1.86), (0.3, 0.32, 0.24), rot=(0, 10, 0), mat=M_ROCK2)
R('hipR', (0.5, -0.05, 1.86), (0.3, 0.32, 0.24), rot=(0, -10, 0), mat=M_ROCK2)
R('sideL', (-0.78, 0.0, 3.25), (0.25, 0.4, 0.42), rot=(0, 8, 0), mat=M_ROCK2)
R('sideR', (0.78, 0.0, 3.25), (0.25, 0.4, 0.42), rot=(0, -8, 0), mat=M_ROCK2)
# hunched back: big slabs rising behind the head
R('back1', (-0.38, 0.42, 3.4), (0.42, 0.3, 0.5), rot=(10, 0, 5), mat=M_ROCK2)
R('back2', (0.38, 0.42, 3.42), (0.42, 0.3, 0.5), rot=(10, 0, -5), mat=M_ROCK2)
R('back3', (0.0, 0.42, 2.65), (0.55, 0.3, 0.38), rot=(5, 0, 0), mat=M_ROCK2)
R('hump1', (-0.4, 0.3, 4.25), (0.42, 0.42, 0.36), rot=(-10, 0, 10))
R('hump2', (0.42, 0.3, 4.27), (0.42, 0.42, 0.36), rot=(-10, 0, -8))
R('hump3', (0.0, 0.48, 4.05), (0.38, 0.3, 0.38), rot=(-15, 0, 0), mat=M_ROCK2)
band('waistband', (0, -0.05, 2.15), (0, -0.05, 2.28), (0.72, 0.52), w=0.14, n_rivets=14)

# ---------------------------------------------------------------- head
head = R('head', (-0.06, -0.42, 4.12), (0.25, 0.24, 0.27), rot=(0, 0, 4), sq=2.6)
R('brow', (-0.06, -0.55, 4.24), (0.26, 0.1, 0.07), rot=(-8, 0, 3))
R('jaw', (-0.06, -0.5, 3.92), (0.22, 0.16, 0.11), rot=(8, 0, 2), mat=M_ROCK2)
for s in (-1, 1):
    ellipsoid(f'eye{s}', (-0.06 + s * 0.1, -0.61, 4.16), (0.045, 0.02, 0.03), M_RUNE, segs=12, rings=8)

# ---------------------------------------------------------------- arms
def arm(s, sh, el, wr, fist_c, fist_dir):
    sh, el, wr, fist_c = V(sh), V(el), V(wr), V(fist_c)
    R(f'shoulder{s}', sh + V((0, 0, 0.12)), (0.55, 0.5, 0.48), rot=(0, s * -12, 0))
    R(f'shoulder2{s}', sh + V((s * 0.25, 0.1, -0.25)), (0.36, 0.42, 0.34), rot=(0, s * -30, 0), mat=M_ROCK2)
    band(f'shband{s}', sh + V((s * 0.18, 0, -0.32)), sh + V((s * 0.25, 0, -0.45)), (0.48, 0.45), w=0.13, ref=(0, 1, 0))
    u = el - sh
    R(f'uarm{s}', sh.lerp(el, 0.55), (0.36, 0.36, 0.44), rot=(0, s * -20, 0))
    R(f'elbow{s}', el + V((s * 0.05, 0.22, 0.05)), (0.3, 0.26, 0.3), rot=(15, 0, 0), mat=M_ROCK2)
    R(f'uarmb{s}', sh.lerp(el, 0.4) + V((-s * 0.18, 0.1, 0)), (0.26, 0.3, 0.32), rot=(0, 0, s * 10), mat=M_ROCK2)
    band(f'uband{s}', sh.lerp(el, 0.75), sh.lerp(el, 0.85), (0.36, 0.36), w=0.12, ref=(0, 1, 0))
    # massive forearm (runes on the front)
    fa = R(f'farm{s}', el.lerp(wr, 0.5), (0.45, 0.44, 0.6), rot=(0, s * 5, s * 6), sq=2.8)
    R(f'farmb{s}', el.lerp(wr, 0.5) + V((s * 0.05, 0.25, 0)), (0.36, 0.3, 0.5), rot=(0, 0, s * 8), mat=M_ROCK2)
    band(f'fband1{s}', el.lerp(wr, 0.08), el.lerp(wr, 0.2), (0.46, 0.45), w=0.15, n_rivets=12)
    band(f'fband2{s}', el.lerp(wr, 0.78), el.lerp(wr, 0.9), (0.45, 0.44), w=0.15, n_rivets=12)
    # fist: knuckle slabs + palm block + thumb
    fd = V(fist_dir).normalized()
    R(f'palm{s}', fist_c, (0.36, 0.34, 0.3), rot=(0, 0, s * 4), mat=M_ROCK2)
    for i in range(4):
        x = (-0.24 + i * 0.16) * 1.0
        R(f'knuck{s}{i}', fist_c + V((x, -0.2, -0.18 - 0.02 * abs(i - 1.5))), (0.1, 0.16, 0.14),
          rot=(rnd.uniform(-8, 8), 0, rnd.uniform(-8, 8)))
        R(f'fing{s}{i}', fist_c + V((x, -0.3, 0.0)), (0.09, 0.1, 0.13), rot=(rnd.uniform(-8, 8), 0, 0), mat=M_ROCK2)
    R(f'thumb{s}', fist_c + V((-s * 0.33, -0.18, 0.08)), (0.1, 0.18, 0.12), rot=(0, 0, s * 20))
    return fa


faL = arm(-1, (-1.12, 0.05, 4.3), (-1.3, 0.0, 3.35), (-1.45, -0.08, 2.0), (-1.4, -0.12, 1.55), (0, 0, -1))
faR = arm(1, (1.15, 0.05, 4.28), (1.32, 0.0, 3.33), (1.4, -0.12, 2.0), (1.32, -0.16, 1.55), (0, 0, -1))

# ---------------------------------------------------------------- legs
def leg(s, hip, knee, ankle, fdir):
    hip, knee, ankle = V(hip), V(knee), V(ankle)
    R(f'thigh{s}', hip.lerp(knee, 0.55), (0.36, 0.36, 0.36), rot=(0, s * -10, 0))
    R(f'thighb{s}', hip.lerp(knee, 0.4) + V((s * 0.1, 0.2, 0)), (0.3, 0.26, 0.3), rot=(10, 0, s * 10), mat=M_ROCK2)
    R(f'thighc{s}', hip.lerp(knee, 0.75) + V((-s * 0.12, -0.1, 0)), (0.24, 0.24, 0.24), rot=(0, 0, s * 20))
    R(f'shinb{s}', knee.lerp(ankle, 0.6) + V((0, 0.18, 0)), (0.28, 0.24, 0.3), rot=(0, 0, s * 12), mat=M_ROCK2)
    R(f'shinc{s}', knee.lerp(ankle, 0.75) + V((s * 0.1, -0.12, 0)), (0.27, 0.24, 0.22), rot=(5, 0, -s * 8))
    R(f'knee{s}', knee + V((0, -0.22, 0)), (0.2, 0.15, 0.18), mat=M_ROCK2)
    R(f'shin{s}', knee.lerp(ankle, 0.42), (0.36, 0.34, 0.36), rot=(0, s * 6, 0))
    band(f'lband{s}', knee.lerp(ankle, 0.25), knee.lerp(ankle, 0.38), (0.37, 0.36), w=0.13, n_rivets=10)
    f = V(fdir).normalized()
    R(f'foot{s}', V((ankle.x, ankle.y, 0.2)) + f * 0.15, (0.4, 0.45, 0.2), mat=M_ROCK2,
      rot=(0, 0, math.degrees(math.atan2(f.x, -f.y))))
    side = f.cross(V((0, 0, 1))).normalized()
    for i in range(3):
        R(f'toe{s}{i}', V((ankle.x, ankle.y, 0.1)) + f * 0.55 + side * (i - 1) * 0.22, (0.11, 0.14, 0.1))
    band(f'aband{s}', V((ankle.x, ankle.y, 0.36)), V((ankle.x, ankle.y, 0.46)), (0.37, 0.4), w=0.1, n_rivets=10)


leg(-1, (-0.45, 0.0, 1.8), (-0.75, -0.05, 1.15), (-0.9, 0.0, 0.42), (-0.25, -1, 0))
leg(1, (0.45, 0.0, 1.8), (0.82, -0.05, 1.12), (1.0, 0.0, 0.42), (0.3, -1, 0))

# ---------------------------------------------------------------- runes (strokes projected onto slab fronts)
GLYPHS = {
    'F': [[(0, 0), (0, 1)], [(0, 0.78), (0.5, 1.0)], [(0, 0.5), (0.5, 0.75)]],
    'R': [[(0, 0), (0, 1)], [(0, 1), (0.45, 0.78), (0, 0.55)], [(0, 0.55), (0.5, 0)]],
    'K': [[(0, 0), (0, 1)], [(0.5, 1), (0, 0.5), (0.5, 0)]],
    'H': [[(0, 0), (0, 1)], [(0.5, 0), (0.5, 1)], [(0, 0.65), (0.5, 0.35)]],
    'N': [[(0.25, 0), (0.25, 1)], [(0, 0.65), (0.5, 0.35)]],
    'M': [[(0, 0), (0, 1)], [(0.6, 0), (0.6, 1)], [(0, 1), (0.6, 0.5)], [(0.6, 1), (0, 0.5)]],
    'S': [[(0.4, 1), (0, 0.65), (0.4, 0.35), (0, 0)]],
    'T': [[(0.25, 0), (0.25, 1)], [(0, 0.7), (0.25, 1), (0.5, 0.7)]],
}
depsgraph = None


def project_word(name, target, word, center, height, spacing=0.62, tilt=0.0, direction=(0, 1, 0)):
    """Lay glyph strokes on `target`'s surface by ray casting from the front (-Y) toward +Y."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    c = V(center)
    w = len(word) * height * spacing
    d = V(direction).normalized()
    up = V((0, 0, 1))
    right = up.cross(d).normalized() * -1 if abs(d.z) < 0.9 else V((1, 0, 0))
    up = d.cross(right).normalized() * -1
    rot = Matrix.Rotation(math.radians(tilt), 3, d)
    for gi, ch in enumerate(word):
        for si, stroke in enumerate(GLYPHS[ch]):
            dense = []
            for a, b in zip(stroke[:-1], stroke[1:]):
                for t in (0, 0.25, 0.5, 0.75):
                    dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            dense.append(stroke[-1])
            pts = []
            for (u, v) in dense:
                off = right * ((gi * spacing + u * 0.8) * height - w / 2) + up * ((v - 0.5) * height)
                off = rot @ off
                o = c + off - d * 2.0
                hit, loc, nrm, idx, ob, mw = sc.ray_cast(dg, o, d)
                if hit and ob is not None and ob.name == target.name:
                    pts.append(loc - nrm * 0.004)
            if len(pts) >= 2:
                loft(f'{name}_{gi}_{si}', pts, [(0.03, 0.022)] * len(pts), M_RUNE, segs=6, res=1, sub=0,
                     ref=d, power=2.0)


project_word('runeL', chestL, 'FRKN', (-0.42, -0.42, 3.47), 0.2, tilt=6)
project_word('runeR', chestR, 'RHSM', (0.42, -0.42, 3.42), 0.2, tilt=-4)
project_word('runeFL', faL, 'SKRN', (-1.45, -0.3, 2.68), 0.17, direction=(0.25, 1, 0), tilt=-8)
project_word('runeFR', faR, 'TKHM', (1.38, -0.3, 2.68), 0.17, direction=(-0.25, 1, 0), tilt=8)
project_word('runeB', bpy.data.objects['back3'], 'FNT', (0.0, 0.8, 2.65), 0.18, direction=(0, -1, 0))

# ---------------------------------------------------------------- hanging roots / moss strands
for i in range(9):
    sx = rnd.uniform(-0.7, 0.7)
    top = V((sx, -0.5 - rnd.uniform(0, 0.1), rnd.uniform(3.0, 3.85)))
    pts = [top, top + V((rnd.uniform(-0.05, 0.05), -0.03, -0.15)), top + V((rnd.uniform(-0.1, 0.1), -0.02, -0.32)),
           top + V((rnd.uniform(-0.12, 0.12), 0.0, -rnd.uniform(0.4, 0.6)))]
    loft(f'root{i}', pts, [0.018, 0.014, 0.01, 0.003], M_ROOT, segs=5, res=3, caps=(True, False), sub=0)

out = finish('bramm', ACC)
