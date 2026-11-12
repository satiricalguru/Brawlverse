"""Nyx - lean swordswoman: indigo high-collar long coat with silver trim, light silver plates,
long black braid, katana held low crackling with cyan lightning.
Blender -b --factory-startup --python tools/blender/build_nyx.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib, common
importlib.reload(common)
from common import *

reset()
ACC = '#39d5ff'
rnd = random.Random(5)
art = art_image('nyx')
k = 0.00471
CX, FY = 455, 1135
W = lambda px, py: ((px - CX) * k, (FY - py) * k)  # art pixel -> (x, z)

M_COAT = material('coat', rgb('#34306a'), rgb('#191733'), rough=0.85, nscale=5, var=0.6, bump=0.25, bscale=160,
                  edge=rgb('#55509a'), edge_amt=0.35)
M_TUNIC = material('tunic', rgb('#2a2550'), rgb('#141228'), rough=0.85, nscale=7, var=0.5, bump=0.2, bscale=180)
M_TRIM = material('trim', rgb('#c9ccd6'), rgb('#7d818c'), rough=0.3, metal=0.9, nscale=30, var=0.6,
                  edge=rgb('#f2f4f8'), edge_amt=0.6, bump=0.35, bscale=90)
M_PLATE = material('plate', rgb('#b4b9c4'), rgb('#6c717c'), rough=0.3, metal=0.9, nscale=9, var=0.55,
                   edge=rgb('#eef1f6'), edge_amt=0.7, bump=0.2, bscale=45)
M_PANTS = material('pants', rgb('#3b3f37'), rgb('#1d1f1b'), rough=0.9, nscale=6, var=0.6, bump=0.2, bscale=150,
                   edge=rgb('#5b6056'), edge_amt=0.3)
M_LEATH = material('leather', rgb('#2c2622'), rgb('#141110'), rough=0.7, nscale=8, var=0.55, bump=0.15, bscale=70,
                   edge=rgb('#5a4c40'), edge_amt=0.45)
M_SKIN = material('skin', rgb('#c99a7c'), rgb('#9c6d55'), rough=0.55, nscale=9, var=0.3, bump=0.02, bscale=80)
M_FACE = material('face', rgb('#c99a7c'), rgb('#9c6d55'), rough=0.55, nscale=9, var=0.3, bump=0.02, bscale=80,
                  art=dict(image=art, f0=0.05, f1=0.45, gain=1.15), uvscale=3.0)
M_HAIR = material('hair', rgb('#16161c'), rgb('#060608'), rough=0.45, nscale=14, var=0.6, bump=0.2, bscale=120,
                  streak=(50.0, (7.0, 7.0, 1.0), rgb('#2c3440')))
M_BLADE = material('blade', rgb('#dfe9ef'), rgb('#9fb3bf'), rough=0.18, metal=1.0, nscale=20, var=0.3,
                   emit=rgb('#7fe6ff', 0.35), emit_strength=2.0, bump=0)
M_BOLT = material('bolt', rgb('#bff3ff'), emit=rgb('#39d5ff'), rough=0.3, emit_strength=9.0, bump=0)
M_BOLTC = material('boltcore', rgb('#ffffff'), emit=rgb('#d8f8ff'), rough=0.3, emit_strength=9.0, bump=0)
M_WRAP = material('wrap', rgb('#1a1a20'), rgb('#08080a'), rough=0.8, nscale=40, var=0.6, bump=0.3, bscale=200)

# ---------------------------------------------------------------- body
torso = loft('torso', [(0, 0.02, 2.55), (0, 0.0, 2.9), (0, -0.03, 3.3), (0, 0.0, 3.68), (0, 0.02, 3.92),
                       (0, 0.02, 4.06)],
             [(0.33, 0.22), (0.27, 0.19), (0.31, 0.21), (0.36, 0.22), (0.33, 0.2), (0.12, 0.12)], M_TUNIC, segs=18,
             power=2.2)
loft('neck', [(0.01, 0.02, 3.95), (0.02, 0.0, 4.3)], [0.1, 0.09], M_SKIN, segs=12)

# coat upper body (slightly over the torso, open V at the front)
loft('coat_up', [(0, 0.02, 2.75), (0, 0.0, 2.95), (0, -0.03, 3.3), (0, 0.0, 3.68), (0, 0.02, 3.95)],
     [(0.31, 0.225), (0.3, 0.215), (0.34, 0.235), (0.39, 0.245), (0.35, 0.22)], M_COAT,
     arc_dir=((0, 1, 0), 300), segs=24, solid=0.03, power=2.2)
# crossed lapels (overlapping front panels with silver edge)
for s in (-1, 1):
    surface(f'lapel{s}', lambda u, v, s=s: (s * (0.03 + 0.2 * u) - s * 0.12 * v * (1 - u) + s * 0.05 * v,
                                            -0.245 + 0.05 * u * u - 0.02 * math.sin(v * 3.14),
                                            3.92 - 1.0 * v + 0.15 * u * v), 6, 8, M_COAT, solid=0.025)
    ribbon(f'lapeltrim{s}', [(s * 0.03, -0.265, 3.92), (s * 0.0, -0.262, 3.5), (-s * 0.04, -0.255, 2.95)],
           [0.045] * 3, M_TRIM, ref=(1, 0, 0), thick=0.012)
# high collar (open at front)
loft('collar', [(0.01, 0.02, 3.92), (0.01, 0.03, 4.04), (0.01, 0.04, 4.14)], [(0.2, 0.18), (0.16, 0.15), (0.175, 0.165)],
     M_COAT, arc_dir=((0, 1, 0), 290), segs=22, solid=0.03, power=2.0)
loft('collartrim', [(0.01, 0.04, 4.12), (0.01, 0.04, 4.16)], [(0.18, 0.17), (0.185, 0.175)], M_TRIM,
     arc_dir=((0, 1, 0), 290), segs=22, res=1, solid=0.02)
# chest strap (diagonal silver band) + belt
ribbon('strap', [(-0.36, -0.2, 3.75), (-0.1, -0.27, 3.55), (0.18, -0.26, 3.3), (0.33, -0.19, 3.08)],
       [0.07] * 4, M_TRIM, ref=(0.5, 0, 1), thick=0.015)
loft('belt', [(0, 0.0, 2.84), (0, 0.0, 2.96)], [(0.32, 0.235), (0.315, 0.23)], M_LEATH, segs=24, res=1,
     caps=(False, False), solid=0.03)
rbox('buckle', (0, -0.255, 2.9), (0.12, 0.04, 0.1), M_TRIM, bev=0.015)
loft('belt2', [(0, 0.0, 2.73), (0, 0.0, 2.8)], [(0.33, 0.25), (0.33, 0.25)], M_LEATH, segs=24, res=1,
     caps=(False, False), solid=0.02)

# coat skirt: long flaps from waist to knees, open at front, flared
def skirt(u, v):
    # u: 0..1 around from front-right edge (her right -X) through the back to front-left edge
    a = math.radians(-118 + 236 * u)  # angle from +Y (back) ; +-118 deg reaches the front sides
    vent = math.radians(9) * max(0.0, (v - 0.35) / 0.65) ** 1.5  # back vent opens toward the hem
    a += math.copysign(vent, u - 0.5) * max(0.0, 1 - abs(u - 0.5) * 5)
    rx = 0.34 + 1.0 * v ** 1.2
    ry = 0.25 + 0.42 * v ** 1.3
    wave = (0.09 * math.sin(u * math.pi * 9) + 0.04 * math.sin(u * math.pi * 17 + 1)) * v ** 1.3
    x = math.sin(a) * (rx + wave)
    y = math.cos(a) * (ry + wave)
    z = 2.82 - 1.72 * v - 0.18 * v * abs(math.sin(a)) ** 3
    return (x, y - 0.03 * v, z)


surface('skirtR', lambda u, v: skirt(u * 0.497, v), 17, 12, M_COAT, solid=0.03, sub=1)
surface('skirtL', lambda u, v: skirt(0.503 + u * 0.497, v), 17, 12, M_COAT, solid=0.03, sub=1)
# skirt trim (hem + front edges)
hem = [V(skirt(i / 33, 1.0)) for i in range(34)]
loft('hemtrim', hem, [0.022] * 34, M_TRIM, segs=6, res=1, sub=1)
for u in (0.0, 1.0):
    loft(f'edgetrim{u}', [V(skirt(u, j / 10)) for j in range(11)], [0.02] * 11, M_TRIM, segs=6, res=1, sub=1)


def leg(s, hip, knee, ankle, fdir):
    hip, knee, ankle = V(hip), V(knee), V(ankle)
    loft(f'thigh{s}', [hip, hip.lerp(knee, 0.5), knee], [0.17, 0.155, 0.12], M_PANTS, segs=14)
    loft(f'shin{s}', [knee, knee.lerp(ankle, 0.5), ankle], [0.12, 0.115, 0.085], M_PANTS, segs=14)
    m = hip.lerp(knee, 0.55)
    loft(f'thighstrap{s}', [m - (knee - hip).normalized() * 0.04, m + (knee - hip).normalized() * 0.04],
         [0.165, 0.165], M_LEATH, segs=16, res=1, caps=(False, False), solid=0.02)
    # greave + knee guard (silver)
    loft(f'greave{s}', [knee + (ankle - knee).normalized() * 0.08, knee.lerp(ankle, 0.5), ankle + V((0, 0, 0.05))],
         [(0.135, 0.15), (0.135, 0.15), (0.11, 0.12)], M_PLATE, arc_dir=((0.2 * s, -1, 0), 230), segs=16,
         solid=0.025, ref=(1, 0, 0))
    kd = (ankle - knee).normalized()
    surface(f'kneeg{s}', lambda u, v: knee + V((0.13 * (u - 0.5) * 2, -0.12 - 0.05 * math.sin(u * 3.14), 0.12))
            + kd * (0.28 * v) + V((0, -0.04 * math.sin(v * 3.14), 0)), 6, 6, M_PLATE, solid=0.02)
    # boot
    f = V(fdir).normalized()
    side = f.cross(V((0, 0, 1))).normalized()
    base = V((ankle.x, ankle.y, 0.0))
    loft(f'boot{s}', [base + V((0, 0, 0.42)), base + V((0, 0, 0.16)) + f * 0.03, base + V((0, 0, 0.09)) + f * 0.2,
                      base + V((0, 0, 0.07)) + f * 0.33],
         [(0.12, 0.125), (0.125, 0.135), (0.11, 0.085), (0.085, 0.06)], M_LEATH, segs=16, ref=side, capd=0.6)
    rbox(f'sole{s}', base + V((0, 0, 0.025)) + f * 0.12, (0.23, 0.48, 0.05), M_LEATH, bev=0.02,
         rot=(0, 0, math.degrees(math.atan2(f.x, -f.y))))
    loft(f'bootcuff{s}', [base + V((0, 0, 0.36)), base + V((0, 0, 0.44))], [0.135, 0.14], M_PLATE, segs=16, res=1,
         caps=(False, False), solid=0.015)


leg(-1, (-0.17, 0.0, 2.62), (-0.68, -0.12, 1.5), (-1.12, 0.06, 0.38), (-0.55, -1, 0))
leg(1, (0.18, 0.0, 2.62), (0.76, -0.08, 1.56), (1.0, 0.12, 0.36), (0.45, -1, 0))


def hand(name, mat):
    """Gripping hand, local frame: +Z = forearm dir, grip axis along X."""
    parts = [rbox(name + 'p', (0, 0, 0.1), (0.13, 0.09, 0.15), mat, bev=0.035)]
    for i in range(4):
        parts.append(rbox(f'{name}f{i}', (-0.045 + i * 0.03, -0.06, 0.16 - i * 0.008), (0.028, 0.06, 0.07), mat,
                          bev=0.012))
    parts.append(rbox(name + 't', (0.06, -0.05, 0.08), (0.04, 0.05, 0.08), mat, bev=0.015, rot=(0, -25, 0)))
    return parts


def arm(s, sh, el, wr, front, paul=False):
    sh, el, wr = V(sh), V(el), V(wr)
    loft(f'uarm{s}', [sh, sh.lerp(el, 0.5), el], [0.115, 0.11, 0.09], M_COAT, segs=14)
    d = (wr - el).normalized()
    loft(f'farm{s}', [el, el.lerp(wr, 0.5), wr], [0.095, 0.09, 0.07], M_COAT, segs=14)
    # silver vambrace with flared cuff
    loft(f'vamb{s}', [el + d * 0.06, el.lerp(wr, 0.55), wr - d * 0.03], [(0.115, 0.115), (0.105, 0.105), (0.09, 0.09)],
         M_PLATE, segs=18, caps=(False, False), solid=0.02)
    loft(f'vambtrim{s}', [el + d * 0.03, el + d * 0.09], [(0.125, 0.125), (0.12, 0.12)], M_TRIM, segs=18, res=1,
         caps=(False, False), solid=0.015)
    loft(f'cufft{s}', [wr - d * 0.06, wr], [(0.1, 0.1), (0.1, 0.1)], M_TRIM, segs=18, res=1, caps=(False, False),
         solid=0.015)
    loft(f'sleevecuff{s}', [el - d * 0.02, el + d * 0.07], [0.12, 0.13], M_COAT, segs=16, res=1, caps=(False, False),
         solid=0.02)
    group(f'hand{s}', hand(f'hand{s}', M_LEATH), wr, d, front)
    if paul:
        R = Matrix.Rotation(math.radians(s * 25), 3, 'Y')
        for k_ in range(3):
            def fn(u, v, k_=k_):
                az = 2 * math.pi * u
                p = math.radians(95) * v
                return sh + V((0, 0, 0.06 - 0.09 * k_)) + R @ V((0.2 * math.sin(p) * math.cos(az) + s * 0.04 * k_,
                                                                 0.2 * math.sin(p) * math.sin(az),
                                                                 0.15 * math.cos(p)))
            o = surface(f'paul{s}{k_}', fn, 22, 6 if k_ == 0 else 4, M_PLATE, solid=0.02, closed_u=True)
            if k_:
                clip(o, [(sh + V((0, 0, 0.08 - 0.09 * k_)), (0, 0, 1)), (sh - V((s * 0.02, 0, 0)), (-s, 0, 0))])
        loft(f'paultrim{s}', [sh + V((s * 0.0, -0.21, 0.0)), sh + V((s * 0.17, -0.12, 0.0)),
                              sh + V((s * 0.22, 0.0, -0.02)), sh + V((s * 0.17, 0.12, 0.0)), sh + V((0, 0.21, 0.0))],
             [0.016] * 5, M_TRIM, segs=6, res=3)


GRIP_TOP = V((0.4, -0.5, 2.62))
GRIP_BOT = V((0.27, -0.55, 2.42))
arm(-1, (-0.32, 0.02, 3.9), (-0.32, -0.25, 3.02), GRIP_BOT + V((0.0, 0.0, 0.05)), (0, -1, 0))
arm(1, (0.35, 0.02, 3.9), (0.66, -0.12, 3.1), GRIP_TOP + V((0.03, 0, 0.03)), (0, -1, 0), paul=True)

# ---------------------------------------------------------------- katana + lightning
bd = (V((-1.25, -0.95, 0.42)) - GRIP_BOT).normalized()  # blade direction toward the tip
hilt0 = GRIP_TOP - bd * 0.14
guard = GRIP_BOT + bd * 0.12
tip = guard + bd * 2.05
side = bd.cross(V((0, -1, 0))).normalized()  # blade edge plane normal-ish
loft('handle', [hilt0, guard - bd * 0.03], [(0.035, 0.03), (0.035, 0.03)], M_WRAP, segs=10, res=1, ref=side)
cylinder('pommel', hilt0 - bd * 0.01, 0.04, 0.04, M_TRIM, segs=14)
bpy.data.objects['pommel'].rotation_euler = bd.to_track_quat('Z', 'Y').to_euler()
tsuba = cylinder('tsuba', guard, 0.085, 0.025, M_TRIM, segs=24, bev=0.006)
tsuba.rotation_euler = bd.to_track_quat('Z', 'Y').to_euler()
cylinder('habaki', guard + bd * 0.04, 0.03, 0.06, M_TRIM, segs=12).rotation_euler = bd.to_track_quat('Z', 'Y').to_euler()
# blade: diamond section with gentle curve, edge toward -side
curve = side * 0.0
bl = [guard + bd * (0.05 + 2.0 * t) + side * (0.09 * t * t) for t in (0, 0.33, 0.66, 0.92, 1.0)]
loft('blade', bl, [(0.038, 0.009, 0.0, 0), (0.037, 0.009), (0.034, 0.008), (0.026, 0.006), (0.002, 0.002)],
     M_BLADE, segs=8, res=3, ref=side, power=1.3, caps=(True, False), sub=1)


def bolt(name, a, b, r, seed, jag=0.08, n=10, mat=M_BOLT):
    rr = random.Random(seed)
    a, b = V(a), V(b)
    pts = [a]
    for i in range(1, n):
        t = i / n
        p = a.lerp(b, t) + V((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-1, 1))) * jag
        pts.append(p)
    pts.append(b)
    loft(name, pts, [r * (1 - 0.6 * i / n) for i in range(n + 1)], mat, segs=5, res=1, sub=0)
    return pts


for i in range(5):
    t0 = 0.05 + 0.15 * i
    t1 = min(1.0, t0 + 0.55 + 0.1 * rnd.random())
    pts = bolt(f'bolt{i}', bl[0].lerp(bl[-1], t0), bl[0].lerp(bl[-1], t1) + side * 0.06, 0.011, i, jag=0.06, n=12,
               mat=M_BOLT if i % 2 else M_BOLTC)
    for j in range(2):  # small branches arcing off the blade
        p = pts[rnd.randint(3, 9)]
        dirv = V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 1))).normalized()
        bolt(f'branch{i}{j}', p, p + dirv * rnd.uniform(0.2, 0.42), 0.007, 100 + i * 7 + j, jag=0.05, n=6)

# ---------------------------------------------------------------- head + hair + braid
box = (W(0, 0)[0], W(0, 1200)[1], W(896, 0)[0], W(0, 0)[1])
HC = V((0.04, -0.01, 4.5))
head = head_mesh('head', HC, (0.2, 0.23, 0.27), M_FACE, jaw=0.85, chin=0.35, brow=0.5, nose=0.8, cheek=1.2)
add_art_uv(head, (896, 1200), (0, 0, 896, 1200), box)
hair_shell('hair', HC + V((0, 0.03, 0.03)), (0.218, 0.255, 0.28), M_HAIR,
           [(HC + V((0, 0, -0.2)), (0, 0.4, -1)), (HC + V((0, -0.17, 0.2)), (0, -0.8, -0.6)),
            (HC + V((0.15, -0.12, 0.0)), (0.5, -0.75, -0.42)), (HC + V((-0.15, -0.12, 0.0)), (-0.5, -0.75, -0.42))],
           disp=0.025, dsize=0.035, thick=0.02, stretch=(0.6, 4.0, 2.5))
# hair bun / gather at the nape where the braid starts
ellipsoid('gather', HC + V((-0.02, 0.24, -0.05)), (0.08, 0.07, 0.09), M_HAIR, segs=14, rings=10)
# loose strands framing the face
for s in (-1, 1):
    loft(f'lock{s}', [HC + V((s * 0.15, -0.17, 0.16)), HC + V((s * 0.205, -0.12, 0.0)), HC + V((s * 0.19, -0.11, -0.18)),
                      HC + V((s * 0.17, -0.1, -0.3))], [(0.04, 0.012), (0.035, 0.011), (0.025, 0.008), (0.004, 0.003)],
         M_HAIR, segs=6, res=3, ref=(0, 1, 0), caps=(True, False))
# braid: gathered at the back of the head, swung over her right shoulder, hanging to the hip
bp = catmull([HC + V((-0.02, 0.24, -0.04)), HC + V((-0.14, 0.27, -0.3)), V((-0.33, 0.2, 3.95)),
              V((-0.48, 0.02, 3.6)), V((-0.6, -0.08, 3.15)), V((-0.66, -0.06, 2.75))], 4)
loft('braidcore', bp, [0.045] * len(bp), M_HAIR, segs=8, res=1)
Tb, Nb, Bb = frames(bp, (1, 0, 0))
L = 0
segl = 0.06
import bisect
acc = [0.0]
for i in range(1, len(bp)):
    acc.append(acc[-1] + (bp[i] - bp[i - 1]).length)
nseg = int(acc[-1] / segl)
for i in range(nseg):
    d = i * segl + segl * 0.5
    j = min(bisect.bisect(acc, d), len(bp) - 1)
    t = (d - acc[j - 1]) / max(acc[j] - acc[j - 1], 1e-6)
    p = bp[j - 1].lerp(bp[j], t)
    T_, N_ = Tb[j], Nb[j]
    sgn = 1 if i % 2 else -1
    taper = 1.0 - 0.35 * (i / nseg)
    off = N_ * (0.028 * sgn * taper)
    axis = (T_ + N_ * (-0.8 * sgn)).normalized()
    o = ellipsoid(f'braid{i}', p + off, (0.052 * taper, 0.034 * taper, 0.085 * taper), M_HAIR, segs=12, rings=8)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = axis.to_track_quat('Z', 'Y')
end = bp[-1]
cylinder('braidtie', end + V((0, 0, -0.02)), 0.04, 0.05, M_TRIM, segs=14)
loft('tassel', [end + V((0, 0, -0.04)), end + V((-0.01, 0.0, -0.18)), end + V((-0.02, 0.02, -0.32))],
     [0.045, 0.04, 0.004], M_HAIR, segs=10, caps=(True, False))
for i in range(4):
    a = i * math.pi / 2 + 0.3
    loft(f'tas{i}', [end + V((0, 0, -0.05)), end + V((0.04 * math.cos(a), 0.04 * math.sin(a), -0.2)),
                     end + V((0.07 * math.cos(a), 0.07 * math.sin(a), -0.34))], [0.02, 0.015, 0.002], M_HAIR, segs=6,
         caps=(True, False))

out = finish('nyx', ACC)
