"""
BACKROOMS - an original enclosed duel map (metres, 56 x 56, ceiling 3.4). Endless-looking yellow offices: a maze of 4 m corridors,
four coloured landmark rooms and a lit atrium in the middle with a raised platform and a column.
  * generated maze (seeded, so identical every build) carved on the left half and rotated 180 degrees onto the right half: both sides are
    the same, the halves are joined by doorways, loops are braided in so there is always a second way round;
  * two RED rooms (north-west / south-east) are the spawn rooms, two POOL-tile rooms (south-west / north-east) are landmarks;
  * the ATRIUM (16 x 16) with a 1.2 m platform on four ramps and a central column is the crossing point of the map;
  * bright ceiling light panels in most cells (not too dark: the renderer uses a strong ambient and a short yellow fog).
Run inside Blender; writes js/mesh-backrooms.js + js/mapdata-backrooms.js.
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\mapkit.py').read())
import random

K = Kit('backrooms', 'Backrooms', 'BACKROOMS', scene_name='DASHDUEL_Backrooms')
K.script = 'build_backrooms.py'
S = Sym(K, 'rot')
rng = random.Random(3)
for n, h in {
    'carpetA': 0x9c8a46, 'carpetB': 0x948340, 'wall': 0xd6c46a, 'wallB': 0xcdbb62, 'base': 0x8a7a3a, 'ceil': 0xe8e1b5,
    'redCarpet': 0x8e2b2b, 'redCarpetB': 0x842626, 'redWall': 0xb04040, 'redBase': 0x5f1c1c,
    'poolA': 0x9fd8e0, 'poolB': 0xbfe8ee, 'poolWall': 0xcdeff2, 'poolBase': 0x6fb4c2,
    'pillar': 0xcdbb6a, 'platform': 0xb8a64e, 'platformB': 0xc9b85c, 'column': 0xe0d089, 'frame': 0x7a6a30,
}.items():
    K.mat(n, h)
for n, h in {'light': 0xfffbe0, 'core': 0xfff3a8}.items():
    K.mat(n, h, 'emit')

N = 14            # cells per side
C = 4.0           # cell size (metres)
O = -N * C / 2    # world coordinate of the grid's corner (-28)
WT = 0.4          # wall thickness
WH = 3.4          # wall height (= ceiling)

def twin_cell(i, j):
    return (N - 1 - i, N - 1 - j)

# ---- regions ------------------------------------------------------------------------------------------------------------------------------
red = {(i, j) for i in (1, 2, 3) for j in (1, 2, 3)}
red |= {twin_cell(i, j) for (i, j) in red}
pool = {(i, j) for i in (1, 2, 3) for j in (10, 11, 12)}
pool |= {twin_cell(i, j) for (i, j) in pool}
atrium = {(i, j) for i in range(5, 9) for j in range(5, 9)}
rooms = {'red': red, 'pool': pool, 'atrium': atrium}
room_of = {}
for k, cells in rooms.items():
    for c in cells:
        room_of[c] = k

# ---- walls: open_h[(i, j)] = no wall on the horizontal line j (z = O + j*C) over column i; open_v[(i, j)] likewise for vertical lines ------------
open_h, open_v = set(), set()
def carve_h(i, j):
    if 0 < j < N:
        open_h.add((i, j))
        open_h.add((N - 1 - i, N - j))
def carve_v(i, j):
    if 0 < i < N:
        open_v.add((i, j))
        open_v.add((N - i, N - 1 - j))
def cells_connected(a, b):
    (i0, j0), (i1, j1) = a, b
    if j0 == j1:
        return (max(i0, i1), j0) in open_v
    return (i0, max(j0, j1)) in open_h

# 1. rooms: no walls inside
for cells in rooms.values():
    for (i, j) in cells:
        if (i + 1, j) in cells:
            carve_v(i + 1, j)
        if (i, j + 1) in cells:
            carve_h(i, j + 1)
# 2. maze (depth-first) over the free cells of the left half
free = {(i, j) for i in range(0, 7) for j in range(N) if (i, j) not in room_of}
start = (0, 0)
seen = {start}
stack = [start]
while stack:
    c = stack[-1]
    nb = []
    for (di, dj) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (c[0] + di, c[1] + dj)
        if n in free and n not in seen:
            nb.append(n)
    if not nb:
        stack.pop()
        continue
    n = rng.choice(nb)
    if n[0] != c[0]:
        carve_v(max(n[0], c[0]), c[1])
    else:
        carve_h(c[0], max(n[1], c[1]))
    seen.add(n)
    stack.append(n)
# free cells the DFS could not reach (separated by rooms): join them to a neighbour
for c in sorted(free - seen):
    for (di, dj) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (c[0] + di, c[1] + dj)
        if n in seen:
            if di:
                carve_v(max(n[0], c[0]), c[1])
            else:
                carve_h(c[0], max(n[1], c[1]))
            seen.add(c)
            break
# 3. doorways: halves joined, rooms and the atrium opened to the corridors
for j in (0, 3, 4):
    carve_v(7, j)
carve_v(4, 2)      # red room (east side)
carve_h(2, 4)      # red room (south side)
carve_v(4, 11)     # pool room (east side)
carve_h(2, 10)     # pool room (north side)
carve_v(5, 6)      # atrium doorways, two per side
carve_v(5, 8)
carve_h(6, 5)
carve_h(8, 5)
# 4. braid: remove some extra walls between free cells so there are loops
for _ in range(34):
    i, j = rng.randrange(0, 6), rng.randrange(0, N)
    a = (i, j)
    if rng.random() < 0.5:
        b = (i + 1, j)
        if a in free and b in free:
            carve_v(i + 1, j)
    else:
        b = (i, min(N - 1, j + 1))
        if a in free and b in free and b != a:
            carve_h(i, j + 1)

# 5. connectivity check over the cell graph (the maze must be one piece)
def neighbours(c):
    i, j = c
    out = []
    if i + 1 < N and cells_connected(c, (i + 1, j)):
        out.append((i + 1, j))
    if i > 0 and cells_connected((i - 1, j), c):
        out.append((i - 1, j))
    if j + 1 < N and cells_connected(c, (i, j + 1)):
        out.append((i, j + 1))
    if j > 0 and cells_connected((i, j - 1), c):
        out.append((i, j - 1))
    return out
def component(c0):
    seen_c = {c0}
    st = [c0]
    while st:
        c = st.pop()
        for n in neighbours(c):
            if n not in seen_c:
                seen_c.add(n)
                st.append(n)
    return seen_c
allc = {(i, j) for i in range(N) for j in range(N)}
comp = component((0, 0))
guard = 0
while comp != allc and guard < 200:
    guard += 1
    done = False
    for c in sorted(comp):
        for (di, dj) in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            n = (c[0] + di, c[1] + dj)
            if n in allc and n not in comp:
                if di:
                    carve_v(max(n[0], c[0]), c[1])
                else:
                    carve_h(c[0], max(n[1], c[1]))
                done = True
                break
        if done:
            break
    comp = component((0, 0))
connected = comp == allc

# ---- floor, ceiling, lights --------------------------------------------------------------------------------------------------------------
half = N * C / 2
K.box(-half - 2, -2, -half - 2, half + 2, 0, half + 2, 'carpetA', 'Floor')
K.box(-half - 2, WH, -half - 2, half + 2, WH + 0.4, half + 2, 'ceil', 'Ceiling')
def cell_centre(i, j):
    return O + C * (i + 0.5), O + C * (j + 0.5)
for i in range(N):
    for j in range(N):
        x0, z0 = O + C * i, O + C * j
        r = room_of.get((i, j))
        if r == 'red':
            K.top(x0, x0 + C, z0, z0 + C, 0.012, 'redCarpet' if (i + j) % 2 == 0 else 'redCarpetB', 'Floor')
        elif r == 'pool':
            for a in range(2):
                for b in range(2):
                    K.top(x0 + a * C / 2, x0 + (a + 1) * C / 2, z0 + b * C / 2, z0 + (b + 1) * C / 2, 0.012, 'poolA' if (a + b + i + j) % 2 == 0 else 'poolB', 'Floor')
        elif r == 'atrium':
            K.top(x0, x0 + C, z0, z0 + C, 0.012, 'platformB' if (i + j) % 2 == 0 else 'carpetB', 'Floor')
        else:
            K.top(x0, x0 + C, z0, z0 + C, 0.012, 'carpetA' if (i + j) % 2 == 0 else 'carpetB', 'Floor')
        cx, cz = cell_centre(i, j)
        if rng.random() < 0.72 or r in ('atrium', 'red'):
            K.under(cx - 0.8, cx + 0.8, cz - 0.5, cz + 0.5, WH - 0.001, 'light', 'Lights')

# ---- wall runs ------------------------------------------------------------------------------------------------------------------------------
def seg_mat(ca, cb):
    for c in (ca, cb):
        if c is not None and room_of.get(c) in ('red', 'pool'):
            return room_of[c]
    return 'plain'
MAT = {'plain': ('wall', 'base'), 'red': ('redWall', 'redBase'), 'pool': ('poolWall', 'poolBase')}
def run_boxes(horizontal):
    out = []
    for line in range(N + 1):
        runs = []
        cur = None
        for k in range(N):
            if horizontal:
                opened = (k, line) in open_h and 0 < line < N
                ca = (k, line - 1) if line > 0 else None
                cb = (k, line) if line < N else None
            else:
                opened = (line, k) in open_v and 0 < line < N
                ca = (line - 1, k) if line > 0 else None
                cb = (line, k) if line < N else None
            if opened:
                cur = None
                continue
            m = seg_mat(ca, cb)
            if cur and cur[2] == m:
                cur[1] = k + 1
            else:
                cur = [k, k + 1, m]
                runs.append(cur)
        for (k0, k1, m) in runs:
            out.append((line, k0, k1, m))
    return out
ext = WT / 2
for (line, k0, k1, m) in run_boxes(True):       # walls running along x at z = O + line*C
    z = O + line * C
    t = WT * (2.0 if line in (0, N) else 1.0)
    x0, x1 = O + k0 * C - ext, O + k1 * C + ext
    K.box(x0, 0, z - t / 2, x1, WH, z + t / 2, MAT[m][0], 'Walls')
    K.box(x0, 0, z - t / 2 - 0.03, x1, 0.18, z - t / 2, MAT[m][1], 'Baseboards', solid=False)
    K.box(x0, 0, z + t / 2, x1, 0.18, z + t / 2 + 0.03, MAT[m][1], 'Baseboards', solid=False)
for (line, k0, k1, m) in run_boxes(False):      # walls running along z at x = O + line*C
    x = O + line * C
    t = WT * (2.0 if line in (0, N) else 1.0)
    z0, z1 = O + k0 * C - ext, O + k1 * C + ext
    K.box(x - t / 2, 0, z0, x + t / 2, WH, z1, MAT[m][0], 'Walls')
    K.box(x - t / 2 - 0.03, 0, z0, x - t / 2, 0.18, z1, MAT[m][1], 'Baseboards', solid=False)
    K.box(x + t / 2, 0, z0, x + t / 2 + 0.03, 0.18, z1, MAT[m][1], 'Baseboards', solid=False)

# ---- atrium: platform, ramps, column, pillars -------------------------------------------------------------------------------------------------
PH = 1.2
K.box(-4.0, 0, -4.0, 4.0, PH, 4.0, 'platform', 'Atrium')
K.box(-4.1, PH - 0.12, -4.1, 4.1, PH, 4.1, 'frame', 'Atrium', solid=False)
for i in range(-3, 3):
    K.top(i * 1.333, i * 1.333 + 1.333, -4.0, 4.0, PH + 0.012, 'platformB' if i % 2 else 'platform', 'Atrium')
S.ramp(-7.0, -2.0, -4.0, 2.0, 0.0, PH, '+x', 'platformB', 'Atrium', bottom=0.0)
S.ramp(-2.0, -7.0, 2.0, -4.0, 0.0, PH, '+z', 'platformB', 'Atrium', bottom=0.0)
K.box(-0.8, PH, -0.8, 0.8, WH, 0.8, 'column', 'Atrium')                          # the central column
K.box(-1.0, PH, -1.0, 1.0, PH + 0.3, 1.0, 'frame', 'Atrium', solid=False)
K.box(-1.0, WH - 0.3, -1.0, 1.0, WH, 1.0, 'frame', 'Atrium', solid=False)
for (px, pz) in ((-6.0, -6.0), (6.0, -6.0)):                                     # corner pillars of the atrium
    S.boxc(px, 0, pz, 1.2, WH, 1.2, 'pillar', 'Atrium')
# pillars in the red rooms (cover), at the cell corners
for (px, pz) in ((-20.0, -16.0), (-16.0, -20.0), (-22.0, -12.5), (-12.5, -22.0)):      # (off the spawn diagonal, so a spawn never faces a pillar)
    S.boxc(px, 0, pz, 1.1, WH, 1.1, 'pillar', 'Rooms')
# cover in the pool rooms: low tiled blocks
for (px, pz) in ((-18.0, 18.0), (-22.0, 14.0), (-14.0, 22.0)):
    S.boxc(px, 0, pz, 1.6, 1.2, 1.6, 'poolWall', 'Rooms')
    S.boxc(px, 1.2, pz, 1.7, 0.1, 1.7, 'poolBase', 'Rooms', solid=False)

# ---- spawns (red rooms, rotated twins) -------------------------------------------------------------------------------------------------------
for (sx, sz) in ((-22.0, -22.0), (-18.0, -18.0), (-14.0, -22.0), (-22.0, -14.0)):
    S.spawn(sx, 0.0, sz)
K.dummy(-6, 0, -10, 0.0)
K.dummy(6, 0, 10, 3.14159)

K.meta['maze'] = {'connected': bool(connected), 'cells': N}
sc, root = K.build()
K.camera('top', (0, 130, 0.01), (0, 0, 0), ortho=70)
K.camera('iso', (-45, 50, 45), (0, 0, 0), lens=26)
K.camera('red', (-26, 1.62, -26), (-10, 1.6, -10))
K.camera('atrium', (-10, 1.62, 0), (10, 1.6, 0))
K.camera('pool', (-26, 1.62, 26), (-10, 1.6, 10))
result = {'stats': K.stats(), 'mesh': K.export_mesh(), 'data': K.export_data(), 'connected': connected}
