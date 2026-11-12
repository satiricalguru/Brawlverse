"""Zephra - nimble sky-dancer in a mid-air high kick: short wind-swept silver-violet hair, white and violet
cloth wraps, glowing violet arm tattoos, a crescent ring blade in each hand, sash ribbons streaming behind.
Blender -b --factory-startup --python tools/blender/build_zephra.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, common
importlib.reload(common)
from common import *

reset()
ACC = '#c77dff'
rnd = random.Random(8)
art = art_image('zephra')
k = 0.0051
CX, FY = 450, 1110
W = lambda px, py: ((px - CX) * k, (FY - py) * k)

M_SKIN = material('skin', rgb('#e2b49c'), rgb('#b9806a'), rough=0.5, nscale=9, var=0.3, bump=0.02, bscale=80)
M_FACE = material('face', rgb('#e2b49c'), rgb('#b9806a'), rough=0.5, nscale=9, var=0.3, bump=0.02, bscale=80,
                  art=dict(image=art, f0=0.05, f1=0.45, gain=1.1), uvscale=3.0)
M_TAT = material('tattoo', rgb('#e2b49c'), rgb('#b9806a'), rough=0.5, nscale=9, var=0.3, bump=0.02, bscale=80,
                 pattern=(rgb('#c77dff'), 9.0), emit_strength=4.0)
M_WRAP = material('wrapwhite', rgb('#ece8f2'), rgb('#b7aec8'), rough=0.85, nscale=6, var=0.5, bump=0.3, bscale=170,
                  streak=(30.0, (1.0, 1.0, 9.0), rgb('#d6cfe4')), edge=rgb('#ffffff'), edge_amt=0.3)
M_VIO = material('violet', rgb('#9150e0'), rgb('#4b2290'), rough=0.6, nscale=5, var=0.6, bump=0.15, bscale=150,
                 edge=rgb('#c89bff'), edge_amt=0.4)
M_SILK = material('silk', rgb('#e4d6f6'), rgb('#a98ad6'), rough=0.45, nscale=3, var=0.8, bump=0.05, bscale=60)
M_HAIR = material('hair', rgb('#c6b4ea'), rgb('#7d68b0'), rough=0.45, nscale=10, var=0.6, bump=0.25, bscale=110,
                  streak=(45.0, (7.0, 7.0, 1.0), rgb('#efe8ff')))
M_BLADE = material('ringblade', rgb('#d9d4e8'), rgb('#8f88a6'), rough=0.2, metal=1.0, nscale=20, var=0.5,
                   edge=rgb('#ffffff'), edge_amt=0.7, bump=0.05)
M_EDGE = material('bladeglow', rgb('#e8ccff'), emit=rgb('#c77dff'), rough=0.3, emit_strength=6.0, bump=0)

# ---------------------------------------------------------------- body (pose from the key art)
HIP = V((0.02, 0.0, 2.62))
CHEST = V((0.1, -0.02, 3.5))
NECK = V((0.12, 0.0, 3.98))
loft('torso', [HIP + V((0, 0.01, -0.12)), HIP + V((0.02, 0, 0.18)), V((0.07, 0.0, 3.05)), CHEST, V((0.11, 0.0, 3.82)),
               NECK], [(0.29, 0.2), (0.26, 0.18), (0.21, 0.15), (0.27, 0.18), (0.29, 0.17), (0.09, 0.09)], M_SKIN,
     segs=18, power=2.2)
loft('neck', [NECK - V((0, 0, 0.05)), NECK + V((0.02, 0, 0.16))], [0.085, 0.078], M_SKIN, segs=12)


def limb(name, pts, rads, mat, segs=14):
    return loft(name, pts, rads, mat, segs=segs)


# arms: her left (+X) up and out, her right (-X) down and out, palms open
SHL, SHR = V((0.38, 0.0, 3.82)), V((-0.2, 0.02, 3.8))
ELL, ELR = V((0.72, -0.12, 4.08)), V((-0.62, -0.08, 3.38))
WRL, WRR = V((0.98, -0.2, 4.3)), V((-1.08, -0.15, 2.98))
limb('uarmL', [SHL, SHL.lerp(ELL, 0.5), ELL], [0.1, 0.092, 0.07], M_SKIN)
limb('uarmR', [SHR, SHR.lerp(ELR, 0.5), ELR], [0.1, 0.092, 0.07], M_SKIN)
limb('farmL', [ELL, ELL.lerp(WRL, 0.5), WRL], [0.072, 0.066, 0.05], M_TAT)
limb('farmR', [ELR, ELR.lerp(WRR, 0.5), WRR], [0.072, 0.066, 0.05], M_TAT)
for s, sh in ((1, SHL), (-1, SHR)):
    ellipsoid(f'delt{s}', sh + V((s * 0.02, 0, 0.0)), (0.115, 0.11, 0.11), M_SKIN, segs=14, rings=10)


def wraps(name, a, b, r, turns=5, w=0.035, mat=None):
    """Bandage spiral around a limb segment a->b."""
    a, b = V(a), V(b)
    d = (b - a).normalized()
    T, N, B = frames([a, b], d.orthogonal())
    pts = []
    n = turns * 10
    for i in range(n + 1):
        t = i / n
        ang = 2 * math.pi * turns * t
        rr = r(t) if callable(r) else r
        pts.append(a.lerp(b, t) + (N[0] * math.cos(ang) + B[0] * math.sin(ang)) * rr)
    return ribbon(name, pts, [w] * len(pts), mat or M_WRAP, ref=d, res=1, thick=0.008, sub=1, segw=1)


def open_hand(name, s, mat):
    """Open palm in local frame: +Z = forearm dir, palm facing -Y, thumb toward +X*s."""
    parts = [rbox(name + 'palm', (0, 0, 0.07), (0.1, 0.035, 0.11), mat, bev=0.015)]
    for i in range(4):
        x = -0.035 + i * 0.024
        L = (0.09, 0.1, 0.095, 0.075)[i]
        sp = math.radians((i - 1.5) * 9)
        p0 = V((x, 0, 0.12))
        parts.append(loft(f'{name}f{i}', [p0, p0 + V((math.sin(sp) * L * 0.5, 0.0, math.cos(sp) * L * 0.5)),
                                          p0 + V((math.sin(sp) * L, -0.01, math.cos(sp) * L))],
                          [0.013, 0.012, 0.01], mat, segs=8, res=2, sub=0))
    parts.append(loft(name + 'th', [V((0.05 * s, -0.01, 0.04)), V((0.09 * s, -0.03, 0.08)), V((0.11 * s, -0.04, 0.12))],
                      [0.017, 0.014, 0.011], mat, segs=8, res=2, sub=0))
    return parts


dl = (WRL - ELL).normalized()
dr = (WRR - ELR).normalized()
group('handL', open_hand('handL', 1, M_SKIN), WRL, dl, (0, -1, 0))
group('handR', open_hand('handR', -1, M_SKIN), WRR, dr, (0, -1, 0))
wraps('wristwrapL', WRL - dl * 0.12, WRL + dl * 0.06, 0.05, turns=4)
wraps('wristwrapR', WRR - dr * 0.12, WRR + dr * 0.06, 0.05, turns=4)
wraps('armwrapL', ELL + dl * 0.02, ELL.lerp(WRL, 0.35), lambda t: 0.064 - 0.006 * t, turns=3, w=0.03, mat=M_VIO)

# legs: left leg kicking high to +X, right leg tucked under
HL, HR = V((0.15, 0.0, 2.55)), V((-0.12, 0.02, 2.5))
KL, FL = V((0.92, -0.18, 2.98)), V((1.78, -0.35, 3.55))
KR, FR = V((0.82, -0.32, 1.45)), V((-0.32, 0.1, 0.32))
limb('thighL', [HL, HL.lerp(KL, 0.45), KL], [0.19, 0.165, 0.105], M_SKIN, segs=16)
limb('shinL', [KL, KL.lerp(FL, 0.35), FL], [0.105, 0.11, 0.06], M_SKIN, segs=16)
limb('thighR', [HR, HR.lerp(KR, 0.45), KR], [0.19, 0.165, 0.105], M_SKIN, segs=16)
limb('shinR', [KR, KR.lerp(FR, 0.35), FR], [0.105, 0.105, 0.06], M_SKIN, segs=16)
# feet (bare, wrapped): kicking foot flexed, other pointed down
fdL = (FL - KL).normalized()
loft('footL', [FL - fdL * 0.02, FL + fdL * 0.08 + V((0, -0.06, 0.04)), FL + fdL * 0.12 + V((0, -0.2, 0.1))],
     [(0.055, 0.045), (0.06, 0.035), (0.045, 0.025)], M_SKIN, segs=12, ref=(0, 0, 1))
fdR = (FR - KR).normalized()
loft('footR', [FR - fdR * 0.02, FR + fdR * 0.1 + V((0, -0.03, 0)), FR + fdR * 0.22 + V((0, -0.08, -0.02))],
     [(0.055, 0.045), (0.05, 0.035), (0.035, 0.02)], M_SKIN, segs=12, ref=(1, 0, 0))
wraps('shinwrapL', KL.lerp(FL, 0.55), FL + fdL * 0.08, lambda t: 0.09 - 0.025 * t, turns=6, w=0.04)
wraps('shinwrapR', KR.lerp(FR, 0.6), FR + fdR * 0.1, lambda t: 0.085 - 0.022 * t, turns=5, w=0.04)

# ---------------------------------------------------------------- outfit: wrap top, sash, shorts, flowing skirt panels
loft('top', [V((0.08, 0.0, 3.3)), CHEST, V((0.11, 0.0, 3.8))], [(0.215, 0.155), (0.275, 0.18), (0.285, 0.17)],
     M_WRAP, segs=22, caps=(False, False), solid=0.02, power=2.2)
for s in (-1, 1):  # crossed shoulder straps
    ribbon(f'cross{s}', [V((0.11 + s * 0.24, 0.02, 3.86)), V((0.1 + s * 0.1, -0.18, 3.7)), V((0.1 - s * 0.1, -0.2, 3.45)),
                         V((0.08 - s * 0.22, -0.12, 3.3))], [0.07] * 4, M_VIO if s > 0 else M_WRAP, ref=(1, 0, 0.3),
           thick=0.012)
loft('sash', [V((0.07, 0.0, 3.0)), V((0.05, 0.0, 3.12))], [(0.215, 0.155), (0.205, 0.15)], M_VIO, segs=22, res=1,
     caps=(False, False), solid=0.02)
loft('shorts', [HIP + V((0, 0.01, -0.22)), HIP + V((0, 0.01, 0.0)), HIP + V((0.02, 0, 0.25))],
     [(0.3, 0.215), (0.285, 0.205), (0.255, 0.18)], M_WRAP, segs=22, caps=(True, False), capd=0.35, power=2.3)
for s, h, kk in ((1, HL, KL), (-1, HR, KR)):
    loft(f'shortleg{s}', [h + (kk - h) * 0.05, h + (kk - h) * 0.32], [0.165, 0.15], M_WRAP, segs=16, res=1,
         caps=(False, False), solid=0.02)


def panel(name, top, dirs, length, width, mat, seed, flutter=0.12, twist=40):
    """Flowing cloth strip from `top` along the wind direction(s)."""
    rr = random.Random(seed)
    pts = [V(top)]
    p = V(top)
    for i, d in enumerate(dirs):
        p = p + V(d).normalized() * (length / len(dirs))
        p = p + V((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-1, 1))) * flutter
        pts.append(p)
    ws = [width * (1.0 - 0.45 * i / len(dirs)) for i in range(len(pts))]
    ws[-1] = width * 0.15
    return ribbon(name, pts, ws, mat, ref=(0, 1, 0), res=4, twist=twist, thick=0.014, sub=1, segw=4)


# waist skirt panels streaming back-left (her motion is up-right)
panel('skirt1', V((-0.2, -0.16, 2.72)), [(-0.3, -0.1, -1), (-0.6, 0.2, -0.6), (-0.8, 0.4, -0.2)], 1.1, 0.32, M_WRAP, 1)
panel('skirt2', V((0.22, -0.16, 2.72)), [(0.2, -0.2, -1), (0.0, 0.3, -1), (-0.4, 0.6, -0.5)], 1.05, 0.3, M_WRAP, 2)
panel('skirt3', V((0.0, 0.2, 2.74)), [(-0.2, 0.6, -1), (-0.5, 0.8, -0.5), (-0.7, 0.9, 0.0)], 1.25, 0.34, M_WRAP, 3)
panel('skirt4', V((-0.27, 0.05, 2.74)), [(-0.7, 0.1, -0.8), (-0.9, 0.3, -0.3), (-1.0, 0.4, 0.1)], 1.0, 0.24, M_VIO, 4)
# long violet sash ribbons from the waist knot
for i in range(3):
    panel(f'ribbon{i}', V((-0.18, -0.12, 3.06)), [(-0.6, 0.2 * i, -0.5), (-0.9, 0.4, 0.1 * i), (-0.7, 0.6, -0.3),
                                                 (-0.5, 0.8, 0.2)], 1.6 + 0.3 * i, 0.08, M_VIO, 10 + i, flutter=0.15,
          twist=160)
# silk scarf streaming from the shoulders behind her right arm
panel('scarf', V((-0.12, 0.12, 3.9)), [(-0.6, 0.4, 0.3), (-1.0, 0.5, 0.25), (-0.9, 0.6, -0.1), (-0.8, 0.5, 0.2)],
      1.9, 0.36, M_SILK, 21, flutter=0.12, twist=90)

# ---------------------------------------------------------------- ring blades (crescent, glowing inner edge)
def ring_blade(name, center, normal, r=0.36, gap=70, rot0=0.0):
    c = V(center)
    n = V(normal).normalized()
    u = n.orthogonal().normalized()
    u = Matrix.Rotation(math.radians(rot0), 3, n) @ u
    v = n.cross(u)
    pts = []
    rads = []
    N = 26
    for i in range(N + 1):
        a = math.radians(gap / 2 + (360 - gap) * i / N)
        pts.append(c + (u * math.cos(a) + v * math.sin(a)) * r)
        t = i / N
        w = 0.055 * math.sin(math.pi * t) ** 0.6 + 0.004
        rads.append((0.012, w))
    # thin blade: thickness along the ring normal, width radial (ref = normal)
    loft(name, pts, rads, M_BLADE, segs=8, res=1, ref=n, power=1.4, caps=(True, True), capd=0.2, sub=1)
    loft(name + 'edge', pts, [(0.004, w_ + 0.012) for (_, w_) in rads], M_EDGE, segs=6, res=1, ref=n, power=1.2,
         caps=(True, True), capd=0.2, sub=0)
    # grip wrapped in violet
    a = math.radians(180)
    g = c + (u * math.cos(a) + v * math.sin(a)) * r
    return g


ring_blade('ringL', WRL + dl * 0.1 + V((0.1, -0.05, 0.0)), (0.2, -1, 0.1), r=0.34, rot0=-30)
ring_blade('ringR', WRR + dr * 0.08 + V((-0.12, -0.05, 0.0)), (-0.2, -1, -0.1), r=0.34, rot0=160)

# ---------------------------------------------------------------- head + hair (wind-swept bob)
# the art's face centre (px ~466, 268) is mapped onto the head centre
FOFF = (W(466, 268)[0] - HC.x, W(466, 268)[1] - HC.z)
box = (W(0, 0)[0] - FOFF[0], W(0, 1200)[1] - FOFF[1], W(896, 0)[0] - FOFF[0], W(0, 0)[1] - FOFF[1])
HC = V((0.13, -0.02, 4.33))
head = head_mesh('head', HC, (0.19, 0.22, 0.255), M_FACE, jaw=0.8, chin=0.3, brow=0.4, nose=0.75, cheek=1.0)
add_art_uv(head, (896, 1200), (0, 0, 896, 1200), box)
hair_shell('hair', HC + V((0, 0.02, 0.05)), (0.215, 0.24, 0.25), M_HAIR,
           [(HC + V((0, 0, -0.2)), (0, 0.1, -1)), (HC + V((0, -0.17, 0.2)), (0, -0.85, -0.5)),
            (HC + V((0.16, -0.13, 0.0)), (0.5, -0.8, -0.3)), (HC + V((-0.16, -0.13, 0.0)), (-0.5, -0.8, -0.3))],
           disp=0.04, dsize=0.05, thick=0.025, stretch=(3.0, 1.5, 1.0))
# wind-swept locks: from the scalp out to her left (+X) and up, layered bob length
for i in range(16):
    az = rnd.uniform(-math.pi, math.pi)
    el = rnd.uniform(0.0, 1.1)
    n = V((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    if n.y < -0.45 and n.z < 0.6:
        continue
    root = HC + V((0, 0.02, 0.05)) + V((n.x * 0.2, n.y * 0.22, n.z * 0.23))
    wind = V((1.0, 0.45, 0.35)).normalized()
    d1 = (n * 0.25 + V((0, 0, -0.8)) + wind * 0.3).normalized()
    L = rnd.uniform(0.12, 0.2)
    p1 = root + d1 * L * 0.5 + n * 0.01
    p2 = p1 + (d1 * 0.6 + wind * 0.5).normalized() * L * 0.5 + n * 0.02
    loft(f'lock{i}', [root - n * 0.03, p1, p2], [(0.08, 0.025), (0.06, 0.02), (0.006, 0.004)], M_HAIR, segs=6, res=3,
         caps=(True, False), ref=n.cross(d1))
for i in range(6):  # fringe over the forehead
    x = -0.1 + 0.05 * i
    root = HC + V((x, -0.17, 0.2))
    loft(f'fringe{i}', [root, root + V((0.05, -0.05, -0.08)), root + V((0.11, -0.04, -0.15))],
         [(0.035, 0.012), (0.03, 0.01), (0.003, 0.002)], M_HAIR, segs=6, res=2, caps=(True, False), ref=(1, 0, 0))

out = finish('zephra', ACC)
