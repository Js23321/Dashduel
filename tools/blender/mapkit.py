"""
DASHDUEL map kit (run inside Blender: exec(open(path).read()) after lib.py, which this file loads itself).

A map or the lobby is authored here as boxes / ramps / octagonal prisms in GAME coordinates (metres, +y up, the same numbers
the game uses; lib.gb converts to Blender's axes with a proper rotation). One description produces both halves of a map:

  * the Blender scene  - collections per map (LOBBY / ARENA / BRIDGE ... ) with one tidy object per group and material,
                         a collision proxy collection (wire boxes), lights and preview cameras;
  * the game files     - js/mesh-<id>.js    triangles read BACK from the Blender objects (what you see is what loads), client only
                         js/mapdata-<id>.js collision boxes / ramps, spawns, dummies (the server loads this one too)

so the collision can never drift away from the picture. Hidden faces (box sides buried in or touching another box) are not
exported. Everything sits at the origin with identity transforms; materials are named DD_<id>_<name> with custom props hex / kind.

Kinds: main (lit + tile texture) | metal (reflective) | emit (unlit, glows) | prop (lit, no tile texture)
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())
import json, os, math

ROOT = r'C:\Users\ryder\Downloads\Rivel'
KINDS = {'main': 0, 'metal': 1, 'emit': 2, 'prop': 3}

# 5x7 voxel font for signs (rows top to bottom, '#' = block)
FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#..##', '#.#.#', '#.#.#', '#.#.#', '##..#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    ' ': ['.....'] * 7,
}


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    return ((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0


def r3(v):
    v = round(v, 3)
    return 0.0 if v == 0 else v


class Kit:
    def __init__(self, mid, title, coll_name, scene_name=None, collide=True):
        self.id, self.title, self.coll_name = mid, title, coll_name
        self.scene_name = scene_name or ('DASHDUEL_' + title.replace(' ', ''))
        self.collide = collide  # False: a visual-only scene (the lobby)
        self.mats = {}
        self.boxes = []  # visual boxes (and collision when solid)
        self.ramps = []
        self.prisms = []
        self.spawns = []
        self.dummies = []
        self.pads = []
        self.meta = {}
        self.groups = []

    # ------------------------------------------------------------------ materials
    def mat(self, name, hexv, kind='main'):
        self.mats[name] = (hexv, kind)
        full = 'DD_%s_%s' % (self.id, name)
        m = bpy.data.materials.get(full) or bpy.data.materials.new(full)
        r, g, b = hex_rgb(hexv)
        m.diffuse_color = (_lin(r), _lin(g), _lin(b), 1.0)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (_lin(r), _lin(g), _lin(b), 1.0)
            bsdf.inputs['Roughness'].default_value = 0.7
        m['hex'] = hexv
        m['kind'] = kind
        return m

    def _group(self, g):
        if g not in self.groups:
            self.groups.append(g)
        return g

    # ------------------------------------------------------------------ primitives
    def box(self, x0, y0, z0, x1, y1, z1, mat, g='Main', solid=True, wall=False, yaw=0.0, vis=True):
        """Axis-aligned box from min / max corners. solid: part of the collision. yaw (radians about its centre) is visual only.
        vis=False makes it collision only (nothing drawn)."""
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if z1 < z0:
            z0, z1 = z1, z0
        solid = solid and self.collide
        if yaw and solid:
            raise ValueError('a rotated box cannot be solid')
        b = {'min': (x0, y0, z0), 'max': (x1, y1, z1), 'mat': mat, 'g': self._group(g), 'solid': solid and self.collide, 'wall': wall, 'yaw': yaw, 'vis': vis}
        self.boxes.append(b)
        return b

    def boxc(self, cx, y0, cz, w, h, d, mat, g='Main', **kw):
        """Box from centre x / z, bottom y and size."""
        return self.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat, g, **kw)

    def top(self, x0, x1, z0, z1, y, mat, g='Main'):
        """A visual-only horizontal tile (one face, facing up): floor patterns."""
        self.boxes.append({'min': (x0, y, z0), 'max': (x1, y, z1), 'mat': mat, 'g': self._group(g), 'solid': False, 'wall': False, 'yaw': 0.0, 'vis': True, 'flat': True})

    def under(self, x0, x1, z0, z1, y, mat, g='Main'):
        """A visual-only horizontal tile facing DOWN (ceiling panels, lights under a roof)."""
        self.boxes.append({'min': (x0, y, z0), 'max': (x1, y, z1), 'mat': mat, 'g': self._group(g), 'solid': False, 'wall': False, 'yaw': 0.0, 'vis': True, 'flat': True, 'down': True})

    def ramp(self, x0, z0, x1, z1, yLow, yHigh, rise, mat, g='Main', bottom=None, solid=True):
        """Wedge: height goes from yLow to yHigh in direction `rise` ('+x' | '-x' | '+z' | '-z')."""
        r = {'x0': min(x0, x1), 'x1': max(x0, x1), 'z0': min(z0, z1), 'z1': max(z0, z1), 'yLow': yLow, 'yHigh': yHigh, 'rise': rise,
             'bottom': min(yLow, yHigh) if bottom is None else bottom, 'mat': mat, 'g': self._group(g), 'solid': solid and self.collide}
        self.ramps.append(r)
        return r

    def prism(self, axis, cx, cy, cz, r, length, mat, g='Main', solid=True, seg=8, r_top=None):
        """Octagonal prism / frustum along `axis` ('y' standing, 'x' or 'z' lying), centred on (cx, cy, cz).
        The flat sides sit exactly at +-r, so the axis-aligned collision box has the same extents as the picture."""
        p = {'axis': axis, 'c': (cx, cy, cz), 'r': r, 'rt': r if r_top is None else r_top, 'len': length, 'mat': mat, 'g': self._group(g), 'solid': solid and self.collide, 'seg': seg}
        self.prisms.append(p)
        return p

    def slab(self, cx, cz, length, thick, yaw, y0, y1, mat, g='Main', step=0.4):
        """A block turned by `yaw` about its centre (length along its own x axis). The picture is the exact rotated box; the collision is a
        staircase of axis-aligned boxes that sits INSIDE it (never poking out: no invisible edges, at most `step` of picture sticks out)."""
        b = {'min': (cx - length / 2, y0, cz - thick / 2), 'max': (cx + length / 2, y1, cz + thick / 2), 'mat': mat, 'g': self._group(g), 'solid': False, 'wall': False, 'yaw': yaw, 'vis': True}
        self.boxes.append(b)
        if not self.collide:
            return b
        c, sn = math.cos(yaw), math.sin(yaw)
        pts = []
        for (u, v) in ((-length / 2, -thick / 2), (length / 2, -thick / 2), (length / 2, thick / 2), (-length / 2, thick / 2)):
            pts.append((cx + u * c + v * sn, cz - u * sn + v * c))

        def zrange(x):
            lo, hi = 1e9, -1e9
            for i in range(4):
                p, q = pts[i], pts[(i + 1) % 4]
                if (p[0] - x) * (q[0] - x) <= 0 and p[0] != q[0]:
                    z = p[1] + (x - p[0]) / (q[0] - p[0]) * (q[1] - p[1])
                    lo, hi = min(lo, z), max(hi, z)
            return lo, hi
        xs = [p[0] for p in pts]
        x0, x1 = min(xs), max(xs)
        n = max(1, int(math.ceil((x1 - x0) / step)))
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            la, ha = zrange(min(max(xa, x0 + 1e-6), x1 - 1e-6))
            lb, hb = zrange(min(max(xb, x0 + 1e-6), x1 - 1e-6))
            lo, hi = max(la, lb), min(ha, hb)
            if hi - lo > 0.08:
                self.boxes.append({'min': (xa, y0, lo), 'max': (xb, y1, hi), 'mat': mat, 'g': self._group(g), 'solid': True, 'wall': False, 'yaw': 0.0, 'vis': False})
        return b

    def stairs(self, x0, z0, x1, z1, y0, y1, rise, steps, mat, g='Main'):
        """A staircase of `steps` solid boxes rising in direction `rise` ('+x' | '-x' | '+z' | '-z') from y0 to y1."""
        for i in range(steps):
            h0, h1 = y0, y0 + (y1 - y0) * (i + 1) / steps
            f0, f1 = i / steps, (i + 1) / steps
            if rise == '+x':
                a, b = x0 + (x1 - x0) * f0, x0 + (x1 - x0) * f1
                self.box(a, h0, z0, b, h1, z1, mat, g)
            elif rise == '-x':
                a, b = x1 - (x1 - x0) * f1, x1 - (x1 - x0) * f0
                self.box(a, h0, z0, b, h1, z1, mat, g)
            elif rise == '+z':
                a, b = z0 + (z1 - z0) * f0, z0 + (z1 - z0) * f1
                self.box(x0, h0, a, x1, h1, b, mat, g)
            else:
                a, b = z1 - (z1 - z0) * f1, z1 - (z1 - z0) * f0
                self.box(x0, h0, a, x1, h1, b, mat, g)

    def wall(self, axis, a0, a1, c, thick, y0, y1, mat, g='Walls', holes=(), frame=None, frame_t=0.18):
        """A wall running along `axis` ('x' or 'z') from a0 to a1, centred on c across, `thick` thick, from y0 to y1.
        holes: (u0, u1, v0, v1) openings (u along the wall, v height). frame: material name for window / door frames (visual only)."""
        h = thick / 2.0
        us = sorted(set([a0, a1] + [x for hl in holes for x in (hl[0], hl[1])]))
        vs = sorted(set([y0, y1] + [x for hl in holes for x in (hl[2], hl[3])]))
        rows = []
        for j in range(len(vs) - 1):
            v0, v1 = vs[j], vs[j + 1]
            segs = []
            for i in range(len(us) - 1):
                u0, u1 = us[i], us[i + 1]
                cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
                if any(hl[0] < cu < hl[1] and hl[2] < cv < hl[3] for hl in holes):
                    continue
                if segs and abs(segs[-1][1] - u0) < 1e-9:
                    segs[-1][1] = u1
                else:
                    segs.append([u0, u1])
            rows.append((v0, v1, segs))
        # merge identical vertical spans
        merged = []
        for v0, v1, segs in rows:
            for s in segs:
                for m in merged:
                    if abs(m[0] - s[0]) < 1e-9 and abs(m[1] - s[1]) < 1e-9 and abs(m[3] - v0) < 1e-9:
                        m[3] = v1
                        break
                else:
                    merged.append([s[0], s[1], v0, v1])
        for u0, u1, v0, v1 in merged:
            if axis == 'x':
                self.box(u0, v0, c - h, u1, v1, c + h, mat, g)
            else:
                self.box(c - h, v0, u0, c + h, v1, u1, mat, g)
        if frame:
            t = frame_t
            e = 0.03   # the frame reaches 3 cm into the opening, so its inner faces are not coplanar (z-fighting) with the wall's own hole faces
            for (u0, u1, v0, v1) in holes:
                for (a, b, cc, d) in ((u0 - t, u0 + e, v0 - t, v1 + t), (u1 - e, u1 + t, v0 - t, v1 + t), (u0, u1, v0 - t, v0 + (e if v0 > 0.05 else 0.0)), (u0, u1, v1 - e, v1 + t)):
                    if axis == 'x':
                        self.box(a, cc, c - h - 0.04, b, d, c + h + 0.04, frame, g + 'Detail', solid=False)
                    else:
                        self.box(c - h - 0.04, cc, a, c + h + 0.04, d, b, frame, g + 'Detail', solid=False)

    def text(self, s, x, y, z, size, mat, g='Signs', facing='+z', gap=0.25):
        """Voxel lettering (5x7 blocks of `size` metres, depth `size`), the baseline at y, centred on x (or on z when facing +-x).
        Visual only. facing: '+z' reads from the front of a wall facing +z."""
        w = (5 + gap) * size
        total = len(s) * w - gap * size
        cu = -total / 2.0
        for ch in s.upper():
            rows = FONT.get(ch, FONT[' '])
            for ry, row in enumerate(rows):
                for rx, c in enumerate(row):
                    if c != '#':
                        continue
                    u = cu + rx * size
                    yy = y + (6 - ry) * size
                    if facing == '+z':
                        self.box(x + u, yy, z, x + u + size, yy + size, z + size, mat, g, solid=False)
                    elif facing == '-z':
                        self.box(x - u - size, yy, z, x - u, yy + size, z + size, mat, g, solid=False)
                    elif facing == '+x':
                        self.box(x, yy, z - u - size, x + size, yy + size, z - u, mat, g, solid=False)
                    else:
                        self.box(x, yy, z + u, x + size, yy + size, z + u + size, mat, g, solid=False)
            cu += w

    # ------------------------------------------------------------------ gameplay data
    def spawn(self, x, y, z, yaw=None):
        self.spawns.append({'x': x, 'y': y, 'z': z, 'yaw': yaw})

    def dummy(self, x, y, z, yaw=0.0):
        self.dummies.append({'x': x, 'y': y, 'z': z, 'yaw': yaw})

    # ------------------------------------------------------------------ geometry generation
    def _face_list(self):
        """All visible faces as (group, mat, [corner,...]) in game coordinates, hidden faces removed."""
        solid_boxes = [b for b in self.boxes if not b.get('flat') and not b['yaw']]
        cell = 6.0
        grid = {}
        for b in solid_boxes:
            if b['vis'] is False:
                continue
            x0, y0, z0 = b['min']
            x1, y1, z1 = b['max']
            for ix in range(int(math.floor(x0 / cell)), int(math.floor(x1 / cell)) + 1):
                for iz in range(int(math.floor(z0 / cell)), int(math.floor(z1 / cell)) + 1):
                    grid.setdefault((ix, iz), []).append(b)
        prism_boxes = []
        for p in self.prisms:
            c, r, ln = p['c'], p['r'], p['len']
            ext = {'y': (r, ln / 2, r), 'x': (ln / 2, r, r), 'z': (r, r, ln / 2)}[p['axis']]
            prism_boxes.append({'min': (c[0] - ext[0], c[1] - ext[1], c[2] - ext[2]), 'max': (c[0] + ext[0], c[1] + ext[1], c[2] + ext[2])})
        eps = 2e-4

        def inside(pt):
            for b in grid.get((int(math.floor(pt[0] / cell)), int(math.floor(pt[2] / cell))), ()):
                lo, hi = b['min'], b['max']
                if lo[0] + eps < pt[0] < hi[0] - eps and lo[1] + eps < pt[1] < hi[1] - eps and lo[2] + eps < pt[2] < hi[2] - eps:
                    return True
            return False

        faces = []
        for b in self.boxes:
            if not b['vis']:
                continue
            x0, y0, z0 = b['min']
            x1, y1, z1 = b['max']
            if b.get('flat'):
                q = [(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)]
                faces.append((b['g'], b['mat'], list(reversed(q)) if b.get('down') else q))
                continue
            if b['yaw']:
                cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
                c, s = math.cos(b['yaw']), math.sin(b['yaw'])

                def rot(p, cx=cx, cz=cz, c=c, s=s):
                    dx, dz = p[0] - cx, p[2] - cz
                    return (cx + dx * c + dz * s, p[1], cz - dx * s + dz * c)
                quads = self._box_quads(x0, y0, z0, x1, y1, z1)
                for n, q in quads:
                    faces.append((b['g'], b['mat'], [rot(p) for p in q]))
                continue
            for n, q in self._box_quads(x0, y0, z0, x1, y1, z1):
                # sample the WHOLE face (cell centres, <= 0.5 m apart, at most 40 per side), pushed a hair outwards: only a face with every
                # sample inside another box is buried (a few points at the corners and the middle would cull a big wall behind a thin seam)
                xs = [q[0][0], q[1][0], q[2][0], q[3][0]]
                ys = [q[0][1], q[1][1], q[2][1], q[3][1]]
                zs = [q[0][2], q[1][2], q[2][2], q[3][2]]
                lo3 = (min(xs), min(ys), min(zs))
                hi3 = (max(xs), max(ys), max(zs))

                def ticks(a, b):
                    if b - a < 1e-9:
                        return [a]
                    k = max(2, min(40, int(math.ceil((b - a) / 0.5))))
                    return [a + (b - a) * (i + 0.5) / k for i in range(k)]
                off = 3 * eps
                buried = True
                for px in ticks(lo3[0], hi3[0]):
                    for py in ticks(lo3[1], hi3[1]):
                        for pz in ticks(lo3[2], hi3[2]):
                            if not inside((px + n[0] * off, py + n[1] * off, pz + n[2] * off)):
                                buried = False
                                break
                        if not buried:
                            break
                    if not buried:
                        break
                if buried:
                    continue
                faces.append((b['g'], b['mat'], q))
        return faces

    @staticmethod
    def _box_quads(x0, y0, z0, x1, y1, z1):
        return [
            ((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
            ((-1, 0, 0), [(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)]),
            ((0, 1, 0), [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)]),
            ((0, -1, 0), [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]),
            ((0, 0, 1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
            ((0, 0, -1), [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)]),
        ]

    def _ramp_faces(self, r):
        x0, x1, z0, z1, yl, yh, yb = r['x0'], r['x1'], r['z0'], r['z1'], r['yLow'], r['yHigh'], r['bottom']
        rise = r['rise']

        def hgt(x, z):
            if rise == '+x':
                t = (x - x0) / (x1 - x0)
            elif rise == '-x':
                t = (x1 - x) / (x1 - x0)
            elif rise == '+z':
                t = (z - z0) / (z1 - z0)
            else:
                t = (z1 - z) / (z1 - z0)
            return yl + (yh - yl) * t
        a, b, c, d = (x0, hgt(x0, z0), z0), (x1, hgt(x1, z0), z0), (x1, hgt(x1, z1), z1), (x0, hgt(x0, z1), z1)
        polys = [
            [d, c, b, a],  # top (fixed up below)
            [(x0, yb, z0), (x1, yb, z0), (x1, yb, z1), (x0, yb, z1)],  # bottom
            [(x0, yb, z0), (x1, yb, z0), b, a],  # z0 side
            [(x1, yb, z1), (x0, yb, z1), d, c],  # z1 side
            [(x0, yb, z1), (x0, yb, z0), a, d],  # x0 side
            [(x1, yb, z0), (x1, yb, z1), c, b],  # x1 side
        ]
        outs = []
        cen = ((x0 + x1) / 2, (min(yl, yh) + max(yl, yh) + 2 * yb) / 4, (z0 + z1) / 2)
        for p in polys:
            # drop degenerate (zero-area) polygons, orient outwards (away from the wedge centre)
            n = self._normal(p)
            if n is None:
                continue
            mid = tuple(sum(q[i] for q in p) / len(p) for i in range(3))
            if (mid[0] - cen[0]) * n[0] + (mid[1] - cen[1]) * n[1] + (mid[2] - cen[2]) * n[2] < 0:
                p = list(reversed(p))
            outs.append(p)
        return outs

    @staticmethod
    def _normal(p):
        nx = ny = nz = 0.0
        for i in range(len(p)):
            a, b = p[i], p[(i + 1) % len(p)]
            nx += (a[1] - b[1]) * (a[2] + b[2])
            ny += (a[2] - b[2]) * (a[0] + b[0])
            nz += (a[0] - b[0]) * (a[1] + b[1])
        ln = math.sqrt(nx * nx + ny * ny + nz * nz)
        if ln < 1e-7:
            return None
        return (nx / ln, ny / ln, nz / ln)

    def _prism_faces(self, p):
        axis, (cx, cy, cz), r, rt, ln, seg = p['axis'], p['c'], p['r'], p['rt'], p['len'], p['seg']
        # polygon with flat sides at +-r: vertex radius r / cos(pi/seg), first vertex at pi/seg
        vr = 1.0 / math.cos(math.pi / seg)

        def pt(k, rad, t):
            a = (k + 0.5) * 2 * math.pi / seg
            u, v = math.cos(a) * rad * vr, math.sin(a) * rad * vr
            if axis == 'y':
                return (cx + u, cy + t, cz + v)
            if axis == 'x':
                return (cx + t, cy + u, cz + v)
            return (cx + u, cy + v, cz + t)
        h = ln / 2.0
        faces = []
        lo = [pt(k, r, -h) for k in range(seg)]
        hi = [pt(k, rt, h) for k in range(seg)]
        for k in range(seg):
            faces.append([lo[k], lo[(k + 1) % seg], hi[(k + 1) % seg], hi[k]])
        faces.append(list(reversed(lo)))
        faces.append(hi)
        out = []
        cen = (cx, cy, cz)
        for f in faces:
            n = self._normal(f)
            if n is None:
                continue
            mid = tuple(sum(q[i] for q in f) / len(f) for i in range(3))
            if (mid[0] - cen[0]) * n[0] + (mid[1] - cen[1]) * n[1] + (mid[2] - cen[2]) * n[2] < 0:
                f = list(reversed(f))
            out.append(f)
        return out

    # ------------------------------------------------------------------ collision
    def _prism_boxes(self, p):
        """Axis-aligned boxes that fill the INSIDE of an octagonal prism (so nothing invisible is ever hit: the boxes never poke out of the
        picture, the picture may poke out of them by at most one strip). Small prisms: a cross of two boxes; big ones: strips of the octagon."""
        axis, (cx, cy, cz), r, ln, seg = p['axis'], p['c'], p['r'], p['len'], p['seg']
        vr = r / math.cos(math.pi / seg)
        pts = [(vr * math.cos((k + 0.5) * 2 * math.pi / seg), vr * math.sin((k + 0.5) * 2 * math.pi / seg)) for k in range(seg)]

        def vrange(u):
            lo, hi = 1e9, -1e9
            for i in range(seg):
                a, b = pts[i], pts[(i + 1) % seg]
                if (a[0] - u) * (b[0] - u) <= 0 and a[0] != b[0]:
                    v = a[1] + (u - a[0]) / (b[0] - a[0]) * (b[1] - a[1])
                    lo, hi = min(lo, v), max(hi, v)
            return lo, hi
        rects = []   # (u0, u1, v0, v1) in the plane across the axis
        if r < 1.0:
            k = r * (math.sqrt(2) - 1)       # half width of the cross arms: the octagon's edge vertex
            rects = [(-r, r, -k, k), (-k, k, -r, r)]
        else:
            step = max(0.3, r * 0.1)
            n = max(2, int(math.ceil(2 * r / step)))
            for i in range(n):
                u0, u1 = -r + 2 * r * i / n, -r + 2 * r * (i + 1) / n
                l0, h0 = vrange(max(-r + 1e-6, min(r - 1e-6, u0)))
                l1, h1 = vrange(max(-r + 1e-6, min(r - 1e-6, u1)))
                lo, hi = max(l0, l1), min(h0, h1)
                if hi - lo > 0.05:
                    rects.append((u0, u1, lo, hi))
        out = []
        for (u0, u1, v0, v1) in rects:
            if axis == 'y':
                out.append((cx + u0, cy - ln / 2, cz + v0, cx + u1, cy + ln / 2, cz + v1))
            elif axis == 'x':
                out.append((cx - ln / 2, cy + u0, cz + v0, cx + ln / 2, cy + u1, cz + v1))
            else:
                out.append((cx + u0, cy + v0, cz - ln / 2, cx + u1, cy + v1, cz + ln / 2))
        return out

    def collision(self):
        sol = []
        for b in self.boxes:
            if b['solid']:
                sol.append(['b'] + [r3(v) for v in b['min']] + [r3(v) for v in b['max']] + ([1] if b['wall'] else []))
        for p in self.prisms:
            if p['solid']:
                for bx in self._prism_boxes(p):
                    sol.append(['b'] + [r3(v) for v in bx])
        for r in self.ramps:
            if r['solid']:
                sol.append(['r', r3(r['x0']), r3(r['z0']), r3(r['x1']), r3(r['z1']), r3(r['yLow']), r3(r['yHigh']), r['rise'], r3(r['bottom'])])
        return sol

    # ------------------------------------------------------------------ Blender scene
    def build(self):
        sc = make_scene(self.scene_name)
        root = bpy.data.collections.get(self.coll_name)
        if root:
            for ch in list(root.children_recursive):
                for ob in list(ch.objects):
                    bpy.data.objects.remove(ob, do_unlink=True)
                bpy.data.collections.remove(ch)
            for ob in list(root.objects):
                bpy.data.objects.remove(ob, do_unlink=True)
        else:
            root = bpy.data.collections.new(self.coll_name)
        if root.name not in [c.name for c in sc.collection.children]:
            sc.collection.children.link(root)

        faces = self._face_list()
        for r in self.ramps:
            for p in self._ramp_faces(r):
                faces.append((r['g'], r['mat'], p))
        for p in self.prisms:
            for f in self._prism_faces(p):
                faces.append((p['g'], p['mat'], f))
        self.face_count = len(faces)

        # one object per (group, material)
        buckets = {}
        for g, m, poly in faces:
            buckets.setdefault((g, m), []).append(poly)
        subs = {}
        for (g, m), polys in sorted(buckets.items()):
            if g not in subs:
                sub = bpy.data.collections.new('%s_%s' % (self.coll_name, g))
                root.children.link(sub)
                subs[g] = sub
            bm = bmesh.new()
            for poly in polys:
                vs = [bm.verts.new(gb(*p)) for p in poly]
                try:
                    bm.faces.new(vs)
                except ValueError:
                    pass
            me = bpy.data.meshes.new('%s_%s_%s' % (self.id, g, m))
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new('%s_%s_%s' % (self.id, g, m), me)
            subs[g].objects.link(ob)
            ob.data.materials.append(bpy.data.materials['DD_%s_%s' % (self.id, m)])
            for pl in me.polygons:
                pl.use_smooth = False
            ob['group'] = g

        # collision proxy: one wire mesh with every solid box / ramp
        if self.collide:
            col = bpy.data.collections.new('%s_COLLISION' % self.coll_name)
            root.children.link(col)
            bm = bmesh.new()
            for b in self.boxes:
                if b['solid']:
                    for n, q in self._box_quads(*b['min'], *b['max']):
                        bm.faces.new([bm.verts.new(gb(*p)) for p in q])
            for p in self.prisms:
                if p['solid']:
                    for bx in self._prism_boxes(p):
                        for n, q in self._box_quads(*bx):
                            bm.faces.new([bm.verts.new(gb(*pp)) for pp in q])
            for r in self.ramps:
                if r['solid']:
                    for poly in self._ramp_faces(r):
                        try:
                            bm.faces.new([bm.verts.new(gb(*pp)) for pp in poly])
                        except ValueError:
                            pass
            me = bpy.data.meshes.new('%s_collision' % self.id)
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new('%s_collision' % self.id, me)
            col.objects.link(ob)
            ob.display_type = 'WIRE'
            ob.hide_render = True
            ob.hide_viewport = True

        # lights + a sun, cameras
        lc = bpy.data.collections.new('%s_PREVIEW' % self.coll_name)
        root.children.link(lc)
        ld = bpy.data.lights.get(self.id + '_sun') or bpy.data.lights.new(self.id + '_sun', 'SUN')
        ld.energy = 3.0
        lo = bpy.data.objects.get(self.id + '_sun') or bpy.data.objects.new(self.id + '_sun', ld)
        if lo.name not in lc.objects:
            lc.objects.link(lo)
        lo.rotation_euler = (math.radians(50), 0, math.radians(35))
        return sc, root

    def camera(self, name, eye, target, lens=24.0, ortho=None):
        """Preview camera in game coordinates looking at `target`."""
        sc = bpy.data.scenes[self.scene_name]
        root = bpy.data.collections[self.coll_name]
        lc = [c for c in root.children if c.name.endswith('_PREVIEW')][0]
        nm = '%s_cam_%s' % (self.id, name)
        cd = bpy.data.cameras.get(nm) or bpy.data.cameras.new(nm)
        cd.lens = lens
        cd.clip_end = 2000
        if ortho:
            cd.type = 'ORTHO'
            cd.ortho_scale = ortho
        ob = bpy.data.objects.get(nm) or bpy.data.objects.new(nm, cd)
        if ob.name not in lc.objects:
            lc.objects.link(ob)
        ob.location = gb(*eye)
        d = gb(*target) - gb(*eye)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        return ob

    # ------------------------------------------------------------------ export
    def export_mesh(self, path=None):
        """Triangles read back from the Blender objects (game coordinates) -> js/mesh-<id>.js"""
        path = path or os.path.join(ROOT, 'js', 'mesh-%s.js' % self.id)
        root = bpy.data.collections[self.coll_name]
        dg = bpy.context.evaluated_depsgraph_get()
        names = sorted(self.mats)
        pal = [self.mats[n][0] for n in names]
        kind = [KINDS[self.mats[n][1]] for n in names]
        pos, col = [], []
        lo = [1e9] * 3
        hi = [-1e9] * 3
        for ob in root.all_objects:
            if ob.type != 'MESH' or ob.name.endswith('_collision') or ob.hide_render:
                continue
            mname = ob.material_slots[0].material.name[len('DD_%s_' % self.id):]
            ci = names.index(mname)
            eo = ob.evaluated_get(dg)
            me = eo.to_mesh()
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
            for f in bm.faces:
                tri = []
                for v in f.verts:
                    w = ob.matrix_world @ v.co
                    tri.append((w.x, w.z, -w.y))  # blender -> game
                a, b, c = tri
                e1 = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
                e2 = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
                cx = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
                if cx[0] ** 2 + cx[1] ** 2 + cx[2] ** 2 < 1e-12:
                    continue
                for p in tri:
                    pos.extend((round(x, 2) + 0.0) for x in p)
                    for i in range(3):
                        lo[i] = min(lo[i], p[i])
                        hi[i] = max(hi[i], p[i])
                col.append(ci)
            bm.free()
            eo.to_mesh_clear()
        data = {'palette': pal, 'kind': kind, 'pos': pos, 'col': col}
        if self.meta:
            data['meta'] = self.meta
        js = (
            '/* GENERATED by tools/blender/%s from the Blender scene %s (see _models/dashduel-maps.blend). Do not edit.\n'
            ' * Triangles in game coordinates (metres, y up); col = index into palette; kind = 0 lit+tiled, 1 metal, 2 glowing, 3 lit. */\n'
            '(function () {\n  const RV = (window.RV = window.RV || {});\n  RV.meshes = RV.meshes || {};\n  RV.meshes[%s] = %s;\n})();\n'
            % (getattr(self, 'script', 'build_%s.py' % self.id), self.scene_name, json.dumps(self.id), json.dumps(data, separators=(',', ':')))
        )
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(js)
        return {'tris': len(col), 'bytes': len(js), 'bounds': [[round(v, 1) for v in lo], [round(v, 1) for v in hi]]}

    def export_data(self, path=None):
        """Collision + spawns -> js/mapdata-<id>.js (loaded by the browser AND the server)"""
        path = path or os.path.join(ROOT, 'js', 'mapdata-%s.js' % self.id)
        data = {
            'solids': self.collision(),
            'spawns': [[r3(s['x']), r3(s['y']), r3(s['z'])] + ([r3(s['yaw'])] if s['yaw'] is not None else []) for s in self.spawns],
            'dummies': [[r3(d['x']), r3(d['y']), r3(d['z']), r3(d['yaw'])] for d in self.dummies],
        }
        js = (
            '/* GENERATED by tools/blender/%s (collision of the Blender scene %s). Do not edit.\n'
            ' * solids: ["b", x0,y0,z0, x1,y1,z1 (,1 = wall-runnable)] boxes and ["r", x0,z0,x1,z1, yLow,yHigh, rise, bottom] ramps. */\n'
            '(function () {\n  const RV = (window.RV = window.RV || {});\n  RV.mapdata = RV.mapdata || {};\n  RV.mapdata[%s] = %s;\n})();\n'
            % (getattr(self, 'script', 'build_%s.py' % self.id), self.scene_name, json.dumps(self.id), json.dumps(data, separators=(',', ':')))
        )
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(js)
        return {'solids': len(data['solids']), 'bytes': len(js)}

    def export_glb(self, path=None):
        """Optional interchange copy (glTF binary) of the visual geometry for other tools."""
        path = path or os.path.join(ROOT, '_models', 'exports', '%s.glb' % self.id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        root = bpy.data.collections[self.coll_name]
        bpy.ops.object.select_all(action='DESELECT')
        n = 0
        for ob in root.all_objects:
            if ob.type == 'MESH' and not ob.name.endswith('_collision'):
                ob.select_set(True)
                n += 1
        bpy.context.view_layer.objects.active = [o for o in root.all_objects if o.type == 'MESH'][0]
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_apply=True, export_yup=True)
        return {'glb': path, 'objects': n}

    def stats(self):
        return {'boxes': len(self.boxes), 'ramps': len(self.ramps), 'prisms': len(self.prisms), 'faces': getattr(self, 'face_count', 0), 'solids': len(self.collision())}


class Sym:
    """Authors a symmetric map: every call adds the shape and its image. mode 'rot' = 180 degrees about the origin (x,z -> -x,-z),
    'mirx' = mirrored left/right (x -> -x), 'mirz' = mirrored front/back (z -> -z), 'none'. Ramps and holes are transformed too."""
    FLIP = {'+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z'}

    def __init__(self, kit, mode='rot'):
        self.k, self.mode = kit, mode

    def _fx(self):
        return self.mode in ('rot', 'mirx')

    def _fz(self):
        return self.mode in ('rot', 'mirz')

    def box(self, x0, y0, z0, x1, y1, z1, mat, g='Main', mat2=None, **kw):
        self.k.box(x0, y0, z0, x1, y1, z1, mat, g, **kw)
        if self.mode != 'none':
            ax0, ax1 = (-x1, -x0) if self._fx() else (x0, x1)
            az0, az1 = (-z1, -z0) if self._fz() else (z0, z1)
            if (ax0, az0, ax1, az1) != (x0, z0, x1, z1):
                self.k.box(ax0, y0, az0, ax1, y1, az1, mat2 or mat, g, **kw)

    def boxc(self, cx, y0, cz, w, h, d, mat, g='Main', **kw):
        self.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat, g, **kw)

    def ramp(self, x0, z0, x1, z1, yLow, yHigh, rise, mat, g='Main', **kw):
        self.k.ramp(x0, z0, x1, z1, yLow, yHigh, rise, mat, g, **kw)
        if self.mode != 'none':
            r = rise
            if self._fx() and r[1] == 'x':
                r = self.FLIP[r]
            if self._fz() and r[1] == 'z':
                r = self.FLIP[r]
            ax0, ax1 = (-x1, -x0) if self._fx() else (x0, x1)
            az0, az1 = (-z1, -z0) if self._fz() else (z0, z1)
            self.k.ramp(ax0, az0, ax1, az1, yLow, yHigh, r, mat, g, **kw)

    def slab(self, cx, cz, length, thick, yaw, y0, y1, mat, g='Main', **kw):
        self.k.slab(cx, cz, length, thick, yaw, y0, y1, mat, g, **kw)
        if self.mode == 'none':
            return
        ax = -cx if self._fx() else cx
        az = -cz if self._fz() else cz
        ay = yaw if self._fx() == self._fz() else -yaw   # a 180-degree turn keeps the angle, a single mirror flips it
        if (ax, az) != (cx, cz):
            self.k.slab(ax, az, length, thick, ay, y0, y1, mat, g, **kw)

    def prism(self, axis, cx, cy, cz, r, length, mat, g='Main', **kw):
        self.k.prism(axis, cx, cy, cz, r, length, mat, g, **kw)
        if self.mode != 'none':
            ax = -cx if self._fx() else cx
            az = -cz if self._fz() else cz
            if (ax, az) != (cx, cz):
                self.k.prism(axis, ax, cy, az, r, length, mat, g, **kw)

    def stairs(self, x0, z0, x1, z1, y0, y1, rise, steps, mat, g='Main'):
        self.k.stairs(x0, z0, x1, z1, y0, y1, rise, steps, mat, g)
        if self.mode != 'none':
            r = rise
            if self._fx() and r[1] == 'x':
                r = self.FLIP[r]
            if self._fz() and r[1] == 'z':
                r = self.FLIP[r]
            ax0, ax1 = (-x1, -x0) if self._fx() else (x0, x1)
            az0, az1 = (-z1, -z0) if self._fz() else (z0, z1)
            self.k.stairs(ax0, az0, ax1, az1, y0, y1, r, steps, mat, g)

    def wall(self, axis, a0, a1, c, thick, y0, y1, mat, g='Walls', holes=(), mat2=None, **kw):
        self.k.wall(axis, a0, a1, c, thick, y0, y1, mat, g, holes, **kw)
        if self.mode == 'none':
            return
        # image of a wall along `axis` at offset c
        if axis == 'x':
            flip_u, flip_c = self._fx(), self._fz()
        else:
            flip_u, flip_c = self._fz(), self._fx()
        b0, b1 = (-a1, -a0) if flip_u else (a0, a1)
        bc = -c if flip_c else c
        bh = [((-h[1], -h[0], h[2], h[3]) if flip_u else tuple(h)) for h in holes]
        if (b0, b1, bc) != (a0, a1, c):
            self.k.wall(axis, b0, b1, bc, thick, y0, y1, mat2 or mat, g, bh, **kw)

    def spawn(self, x, y, z, yaw=None):
        """A spawn and its image (the yaw turns with the symmetry)."""
        self.k.spawn(x, y, z, yaw)
        if self.mode == 'none':
            return
        ax = -x if self._fx() else x
        az = -z if self._fz() else z
        ay = None
        if yaw is not None:
            # yaw 0 faces +z; atan2(x, z) convention: facing direction (sin yaw, cos yaw)
            fx, fz = math.sin(yaw), math.cos(yaw)
            fx = -fx if self._fx() else fx
            fz = -fz if self._fz() else fz
            ay = math.atan2(fx, fz)
        self.k.spawn(ax, y, az, ay)
