"""Kael - broad armoured brawler, molten-cracked charcoal plate, oversized gauntlets, torn red half-cape.
Blender -b --factory-startup --python tools/blender/build_kael.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, common
importlib.reload(common)
from common import *

reset()
ACC = '#ff6a2b'
rnd = random.Random(3)

# ---------------------------------------------------------------- materials
art = art_image('kael')
M_ARM = material('armor', rgb('#6a696c'), rgb('#343336'), rough=0.42, metal=0.85, nscale=5, var=0.7,
                 edge=rgb('#c9c2b8'), edge_amt=0.8, bump=0.12, bscale=26,
                 cracks=dict(color=rgb('#ff6a2b'), scale=2.2, width=0.016, coverage=0.0, mscale=1.4),
                 emit_strength=5.0)
M_ARM2 = material('armor_dark', rgb('#454448'), rgb('#232225'), rough=0.5, metal=0.8, nscale=7, var=0.5,
                  edge=rgb('#8a847e'), edge_amt=0.6, bump=0.1, bscale=30)
M_SKIN = material('skin', rgb('#a8735a'), rgb('#7a4c3a'), rough=0.6, nscale=9, var=0.35, bump=0.04, bscale=80)
M_FACE = material('face', rgb('#a8735a'), rgb('#7a4c3a'), rough=0.6, nscale=9, var=0.35, bump=0.03, bscale=80,
                  art=dict(image=art, f0=0.05, f1=0.45, gain=1.25), uvscale=3.0)
M_HAIR = material('hair', rgb('#d9d6d0'), rgb('#8f8b86'), rough=0.7, nscale=12, var=0.6, bump=0.25, bscale=90,
                  streak=(40.0, (6.0, 6.0, 1.0), rgb('#f2f0ec')))
M_CAPE = material('cape', rgb('#6b1a12'), rgb('#2e0a07'), rough=0.9, nscale=4, var=0.7, bump=0.2, bscale=140,
                  edge=rgb('#1c0604'), edge_amt=0.6)
M_LEATH = material('leather', rgb('#3a2a22'), rgb('#1b120e'), rough=0.75, nscale=8, var=0.6, bump=0.15, bscale=60,
                   edge=rgb('#6a5240'), edge_amt=0.4)
M_GLOW = material('glow', rgb('#ff8a3a'), emit=rgb('#ff7a30'), rough=0.4, emit_strength=6.0, bump=0)

X = 1  # character's left side = +X (screen right)

# ---------------------------------------------------------------- torso & armour
loft('torso', [(0, 0.03, 2.3), (0, 0.0, 2.75), (0, -0.02, 3.2), (0, 0.0, 3.6), (0, 0.03, 3.95), (0, 0.03, 4.12)],
     [(0.44, 0.3), (0.42, 0.29), (0.55, 0.36), (0.62, 0.38), (0.5, 0.32), (0.2, 0.2)], M_LEATH, segs=20, power=2.4)
loft('neck', [(0, 0.04, 3.95), (0, 0.02, 4.32)], [0.17, 0.15], M_SKIN, segs=14)

# breastplate (closed shell, keel ridge at the front)
keel = lambda a: (1.0, 1.0 + 0.12 * max(0.0, -math.sin(a)) ** 6)
loft('breast', [(0, 0.0, 3.22), (0, -0.03, 3.45), (0, -0.01, 3.72), (0, 0.03, 3.96)],
     [(0.6, 0.42), (0.68, 0.45), (0.68, 0.43), (0.52, 0.36)], M_ARM, segs=28, power=2.6, prof=keel,
     caps=(False, False), sub=1)
bevel(bpy.data.objects['breast'], 0.01)
# lower chest rim plate
loft('chestrim', [(0, -0.02, 3.2), (0, -0.03, 3.3)], [(0.62, 0.45), (0.66, 0.47)], M_ARM2, arc_dir=((0, -1, 0), 220),
     segs=20, res=1, solid=0.035, power=2.6)
# abdomen lames (overlapping shingles)
for i, z in enumerate((2.86, 3.0, 3.14)):
    loft(f'lame{i}', [(0, -0.01, z - 0.08), (0, -0.02, z + 0.07)],
         [(0.53 - i * 0.0, 0.4), (0.55, 0.42)], M_ARM, arc_dir=((0, -1, 0), 230), segs=20, res=1,
         solid=0.04, sub=1, power=2.4)
# belt + buckle
loft('belt', [(0, 0.02, 2.62), (0, 0.02, 2.76)], [(0.52, 0.38), (0.53, 0.39)], M_LEATH, segs=24, res=1,
     caps=(False, False), solid=0.05)
rbox('buckle', (0, -0.42, 2.69), (0.2, 0.06, 0.16), M_ARM, bev=0.02)
# faulds (hip lames) and tassets
for i, z in enumerate((2.5, 2.38)):
    loft(f'fauld{i}', [(0, 0.02, z + 0.12), (0, 0.02, z - 0.05)], [(0.54 + i * 0.03, 0.42 + i * 0.02),
                                                                 (0.6 + i * 0.03, 0.47 + i * 0.02)],
         M_ARM, arc_dir=((0, -1, 0), 300), segs=24, res=1, solid=0.035, power=2.4)
# central ventral plate (pointed)
surface('ventral', lambda u, v: ((u - 0.5) * 0.36 * (1 - 0.65 * v), -0.5 - 0.06 * math.sin(u * math.pi) + 0.08 * v,
                                 2.36 - 0.5 * v), 6, 6, M_ARM, solid=0.04)
for s in (-1, 1):
    surface(f'tasset{s}', lambda u, v, s=s: (s * (0.3 + 0.28 * u + 0.06 * v), -0.4 + 0.25 * u * u - 0.05 * math.sin(u * 3.14)
                                             + 0.1 * v, 2.32 - 0.62 * v - 0.06 * u), 7, 6, M_ARM, solid=0.04)
# back tassets
for s in (-1, 1):
    surface(f'btasset{s}', lambda u, v, s=s: (s * (0.05 + 0.5 * u), 0.42 - 0.1 * (u - 0.5) ** 2 + 0.08 * v,
                                              2.34 - 0.5 * v), 7, 5, M_ARM2, solid=0.04)
# gorget / high collar
loft('gorget', [(0, 0.03, 3.93), (0, 0.03, 4.05), (0, 0.04, 4.17)], [(0.4, 0.33), (0.3, 0.26), (0.28, 0.25)],
     M_ARM, segs=24, caps=(False, False), solid=0.04, power=2.2)
# back plate details: spine ridge
loft('spine', [(0, 0.43, 3.85), (0, 0.47, 3.5), (0, 0.44, 3.15)], [(0.06, 0.04)] * 3, M_ARM2, segs=10)

# ---------------------------------------------------------------- tabard (torn loin cloth front/back)
def torn_sheet(name, top_l, top_r, length, mat, ndrop=0.18, cols=10, rows=9, bulge=(0, -1, 0), bamp=0.05,
               seed=1, swing=(0, 0, 0)):
    r = random.Random(seed)
    cuts = [length * (1 - ndrop * r.random() ** 0.7) for _ in range(cols)]
    cuts = [c * (0.82 if i % 3 == 1 else 1.0) for i, c in enumerate(cuts)]
    tl, tr = V(top_l), V(top_r)
    bv = V(bulge)
    sw = V(swing)

    def fn(u, v):
        i = min(int(u * (cols - 1) + 0.5), cols - 1)
        L = cuts[i]
        p = tl.lerp(tr, u)
        p = p + V((0, 0, -L * v))
        p = p + bv * (bamp * math.sin(u * math.pi * 3.0 + 0.5) * (0.4 + v))
        p = p + sw * (v * v)
        return p
    return surface(name, fn, cols, rows, mat, solid=0.025, sub=1)

torn_sheet('tabard_f', (-0.2, -0.5, 2.6), (0.2, -0.5, 2.6), 1.15, M_CAPE, seed=4, swing=(0.03, -0.12, 0))
torn_sheet('tabard_b', (0.22, 0.47, 2.6), (-0.22, 0.47, 2.6), 1.25, M_CAPE, seed=5, bulge=(0, 1, 0),
           swing=(0, 0.15, 0))

# ---------------------------------------------------------------- legs
def leg(s, hip, knee, ankle, foot_dir):
    hip, knee, ankle = V(hip), V(knee), V(ankle)
    loft(f'thigh{s}', [hip, hip.lerp(knee, 0.5), knee], [0.26, 0.24, 0.18], M_LEATH, segs=16)
    loft(f'shin{s}', [knee, knee.lerp(ankle, 0.5), ankle], [0.19, 0.18, 0.14], M_LEATH, segs=16)
    # cuisse: front/outer plate over thigh
    out = V((s, -0.6, 0)).normalized()
    loft(f'cuisse{s}', [hip + V((0, 0, -0.1)), hip.lerp(knee, 0.55), knee + (hip - knee).normalized() * 0.18],
         [0.31, 0.29, 0.24], M_ARM, arc_dir=(out, 210), segs=16, solid=0.045, ref=(0, -1, 0), res=3)
    # knee cop
    ellipsoid(f'knee{s}', knee + V((0, -0.17, 0.02)), (0.2, 0.15, 0.2), M_ARM, sub=0)
    surface(f'kneewing{s}', lambda u, v: knee + V((s * (0.12 + 0.12 * u), -0.1 + 0.18 * u - 0.03 * math.sin(v * 3.14),
                                                    0.14 - 0.3 * v)), 5, 5, M_ARM, solid=0.035)
    # greave (closed, flared at top)
    loft(f'greave{s}', [knee + V((0, 0, -0.12)), knee.lerp(ankle, 0.45), ankle + V((0, 0, 0.12))],
         [(0.24, 0.24), (0.23, 0.24), (0.2, 0.21)], M_ARM, segs=20, caps=(False, False), solid=0.04,
         ref=(1, 0, 0), power=2.3)
    # boot / sabaton
    f = V(foot_dir).normalized()
    side = f.cross(V((0, 0, 1))).normalized()
    base = V((ankle.x, ankle.y, 0.0))
    loft(f'boot{s}', [base + V((0, 0, 0.42)), base + V((0, 0, 0.2)) + f * 0.05, base + V((0, 0, 0.13)) + f * 0.26,
                      base + V((0, 0, 0.11)) + f * 0.44],
         [(0.2, 0.2), (0.22, 0.22), (0.19, 0.13), (0.15, 0.1)], M_ARM, segs=18, ref=side, power=2.6, capd=0.6)
    rbox(f'sole{s}', base + V((0, 0, 0.04)) + f * 0.16, (0.38, 0.62, 0.08), M_LEATH, bev=0.03,
         rot=(0, 0, math.degrees(math.atan2(-f.x, -f.y)) * -1 + 0))
    for k, t in enumerate((0.22, 0.34)):
        loft(f'toe{s}{k}', [base + V((0, 0, 0.2)) + f * t, base + V((0, 0, 0.17)) + f * (t + 0.1)],
             [(0.22, 0.17), (0.21, 0.15)], M_ARM, arc_dir=((0, 0, 1), 220), segs=14, res=1, solid=0.03, ref=side)
    loft(f'cuff{s}', [ankle + V((0, 0, -0.06)), ankle + V((0, 0, 0.1))], [(0.25, 0.25), (0.24, 0.24)], M_ARM2,
         segs=20, res=1, caps=(False, False), solid=0.035)

leg(-1, (-0.3, 0.02, 2.42), (-0.6, -0.12, 1.42), (-0.68, 0.02, 0.45), (-0.25, -1, 0))
leg(1, (0.3, 0.02, 2.42), (0.62, -0.06, 1.45), (0.88, 0.06, 0.45), (0.3, -1, 0))

# ---------------------------------------------------------------- arms
def fist(name, mat, glow=True):
    """Armoured fist in local frame: +Z forearm direction, curled fingers facing -Y."""
    parts = [rbox(name + '_palm', (0, 0.02, 0.18), (0.36, 0.3, 0.3), mat, bev=0.06)]
    for i in range(4):
        x = -0.135 + i * 0.09
        parts.append(rbox(f'{name}_f{i}a', (x, -0.06, 0.36), (0.085, 0.2, 0.11), mat, bev=0.025))
        parts.append(rbox(f'{name}_f{i}b', (x, -0.17, 0.27), (0.08, 0.1, 0.17), mat, bev=0.025))
        parts.append(rbox(f'{name}_f{i}c', (x, -0.15, 0.14), (0.075, 0.09, 0.09), mat, bev=0.02))
    parts.append(rbox(name + '_thumb', (0.14, -0.17, 0.1), (0.1, 0.1, 0.2), mat, bev=0.03, rot=(0, -20, 30)))
    parts.append(rbox(name + '_back', (0, 0.17, 0.2), (0.38, 0.06, 0.3), mat, bev=0.025, rot=(-8, 0, 0)))
    if glow:  # molten seams between knuckles
        parts.append(rbox(name + '_kg', (0, -0.08, 0.37), (0.34, 0.16, 0.06), M_GLOW, bev=0.02))
    return parts


def arm(s, sh, el, wr, front, raised):
    sh, el, wr = V(sh), V(el), V(wr)
    loft(f'uarm{s}', [sh, sh.lerp(el, 0.5) + V((0, 0, 0)), el], [0.2, 0.21, 0.17], M_SKIN, segs=16)
    ellipsoid(f'elbow{s}', el, (0.2, 0.2, 0.2), M_ARM2)
    d = (wr - el).normalized()
    # oversized gauntlet: flared cuff to wrist
    loft(f'gaunt{s}', [el - d * 0.02, el + d * 0.12, el.lerp(wr, 0.6), wr], [(0.31, 0.31), (0.28, 0.28),
                                                                          (0.25, 0.25), (0.22, 0.22)],
         M_ARM, segs=18, res=3, caps=(False, True), capd=0.3, power=2.4)
    loft(f'gcuff{s}', [el - d * 0.06, el + d * 0.08], [(0.34, 0.34), (0.33, 0.33)], M_ARM2, segs=22, res=1,
         caps=(False, False), solid=0.05)
    for k, t in enumerate((0.35, 0.65)):
        loft(f'gband{s}{k}', [el.lerp(wr, t) - d * 0.03, el.lerp(wr, t) + d * 0.03],
             [(0.29 - t * 0.05,) * 2] * 2, M_ARM2, segs=22, res=1, caps=(False, False), solid=0.02)
    g = group(f'fistgrp{s}', fist(f'fist{s}', M_ARM), wr + d * 0.02, d, front)
    return g


arm(-1, (-0.68, 0.02, 3.82), (-1.12, -0.18, 3.3), (-1.0, -0.42, 3.9), (0.15, -1, 0.0), True)
arm(1, (0.68, 0.02, 3.82), (1.08, 0.04, 3.28), (1.2, -0.12, 2.6), (0.1, -1, 0.1), False)

# pauldrons: big dome + lames + neck flange
def pauldron(s, c, tilt):
    c = V(c)
    R = Matrix.Rotation(math.radians(s * tilt), 3, 'Y')

    def dome(rx, ry, rz, pol, off):
        def fn(u, v):
            az = 2 * math.pi * u
            p = math.radians(pol) * v
            return c + R @ (V((rx * math.sin(p) * math.cos(az), ry * math.sin(p) * math.sin(az), rz * math.cos(p))) + V(off))
        return fn
    surface(f'paul{s}', dome(0.46, 0.44, 0.34, 105, (0, 0, 0)), 22, 8, M_ARM, solid=0.05, closed_u=True)
    for k in range(2):
        surface(f'paullame{s}{k}', dome(0.47 - k * 0.03, 0.45 - k * 0.03, 0.3, 112, (s * 0.06 * (k + 1), 0, -0.13 * (k + 1))),
                24, 3, M_ARM, solid=0.04, closed_u=True)
        clip(bpy.data.objects[f'paullame{s}{k}'], [(c + V((0, 0, 0.0 - 0.1 * k)), (0, 0, 1)),
                                                   (c + V((-s * 0.1, 0, 0)), (-s, 0, 0))])
    # tall neck flange
    surface(f'flange{s}', lambda u, v: c + V((-s * 0.3 + s * 0.08 * v, -0.28 + 0.56 * u, 0.22 + 0.24 * v
                                              - 0.14 * (2 * u - 1) ** 2)), 9, 4, M_ARM, solid=0.04)
    for k in range(5):  # rivets
        a = 2 * math.pi * k / 5 + 0.4
        p = c + R @ V((0.43 * math.cos(a) * 0.55, 0.41 * math.sin(a) * 0.55, 0.3 * 0.82))
        ellipsoid(f'rivet{s}{k}', p, (0.03, 0.03, 0.025), M_ARM2, segs=10, rings=6)


pauldron(-1, (-0.7, 0.02, 3.92), 22)
pauldron(1, (0.72, 0.02, 3.92), 22)

# ---------------------------------------------------------------- head
HB = dict(img_size=(896, 1200), crop=(0, 0, 896, 1200))
k = 0.00467
box = ((0 - 450) * k, (1145 - 1200) * k, (896 - 450) * k, 1145 * k)
head = head_mesh('head', (0, -0.01, 4.5), (0.245, 0.275, 0.33), M_FACE, jaw=1.4, chin=0.6, brow=1.3, nose=1.1)
add_art_uv(head, HB['img_size'], HB['crop'], box)
for s_ in (-1, 1):
    ellipsoid(f'ear{s_}', (s_ * 0.232, 0.03, 4.48), (0.02, 0.045, 0.065), M_SKIN, segs=12, rings=8)

# hair: scalp shell + short swept-back clumps
HC = V((0, 0.02, 4.55))
hair_shell('hair', HC, (0.265, 0.3, 0.31), M_HAIR,
           [((0, 0, 4.36), (0, -0.45, -0.9)), ((0, -0.2, 4.66), (0, -0.82, -0.57)),
            ((0.2, -0.12, 4.5), (0.6, -0.65, -0.45)), ((-0.2, -0.12, 4.5), (-0.6, -0.65, -0.45))],
           disp=0.07, dsize=0.06, thick=0.03, stretch=(1.0, 3.0, 2.0))
# short swept-up tufts along the hairline / crown for a rough silhouette
for i in range(12):
    a = -1.2 + 2.4 * i / 11
    root = HC + V((0.24 * math.sin(a), -0.21 * math.cos(a) + 0.02, 0.19 + 0.05 * math.cos(a)))
    d = (V((math.sin(a) * 0.4, 0.9, 0.55))).normalized()
    L = rnd.uniform(0.1, 0.15)
    loft(f'tuft{i}', [root, root + d * L * 0.5 + V((0, 0.02, 0.0)), root + d * L + V((0, 0.06, -0.01))],
         [(0.05, 0.03), (0.035, 0.02), (0.004, 0.003)], M_HAIR, segs=6, res=2, caps=(True, False), ref=(1, 0, 0))
for i in range(10):
    a = rnd.uniform(-2.6, 2.6)
    el = rnd.uniform(0.2, 0.75)
    n = V((math.sin(a) * math.sin(el), -math.cos(a) * math.sin(el), math.cos(el)))
    if n.y < -0.3:
        continue
    root = HC + V((n.x * 0.27, n.y * 0.3, n.z * 0.31))
    d = (n * 0.6 + V((0, 0.8, 0.35))).normalized()
    L = rnd.uniform(0.12, 0.18)
    loft(f'ctuft{i}', [root - n * 0.02, root + d * L * 0.5, root + d * L], [(0.055, 0.03), (0.035, 0.02), (0.004, 0.003)],
         M_HAIR, segs=6, res=2, caps=(True, False), ref=n.cross(d))

# ---------------------------------------------------------------- torn half-cape (right shoulder, sweeping left/back)
def cape_fn(u, v):
    # u across (0 = his right/-X shoulder front, 1 = his left shoulder back), v down
    x0 = -0.78 + 1.3 * u
    yb = 0.36 + 0.12 * math.sin(u * math.pi)
    top = V((x0, yb if u > 0.15 else 0.36 - 0.5 * (0.15 - u) / 0.15 * 0.6, 3.98 - 0.08 * u))
    L = 2.75 - 0.9 * u
    folds = 0.07 * math.sin(u * math.pi * 6.0 + 0.6) * (0.2 + v)
    sweep = V((-0.75 * v * v * (1.1 - u), 0.32 * v + 0.25 * v * v, 0))
    return top + V((0, folds, -L * v)) + sweep


r = random.Random(11)
cuts = [r.uniform(0.72, 1.0) for _ in range(16)]
cape = surface('cape', lambda u, v: cape_fn(u, v * (1 - (1 - cuts[min(int(u * 15 + 0.5), 15)]) * max(0.0, (v - 0.4) / 0.6))), 16, 14,
               M_CAPE, solid=0.03, sub=1)
# clasp at right shoulder
cylinder('clasp', (-0.62, -0.25, 3.95), 0.08, 0.05, M_ARM2, rot=(80, 0, 20), segs=16, bev=0.01)

out = finish('kael', ACC)
