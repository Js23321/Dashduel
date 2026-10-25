"""
GRENADE in the Roblox RIVALS look: a round dark-GREEN body (slightly squashed) with a lower seam, a GOLD collar at the neck, a chunky
NAVY fuze housing and a big navy lever ("spoon") that hugs the body, plus a gold pull-pin ring.
Built around the origin (it is parented to the right hand). Parts: body, spoon (pivot 0.04,0.03,0), pin (pivot 0.004,0.062,0.02)
Materials (game names): green, greenDark, brass (gold), navy, steel
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

sc = make_scene('DASHDUEL_Weapons')
col = make_collection(sc, 'WEAPON_grenade')
R0 = 0.038

# the body: a chunky 10-sided sphere (faceted on purpose), a darker belt around the equator, the gold collar and the navy fuze
sphere(col, 'body', R0, 0, 0, 0, 'green', seg=10, rings=7, scale=(1, 0.96, 1))
cyl_y(col, 'belt', R0 * 0.985, R0 * 0.985, 0.01, 0, -0.012, 0, 'greenDark', seg=10)
cyl_y(col, 'collar', 0.02, 0.0245, 0.011, 0, 0.0355, 0, 'brass', seg=10)
cyl_y(col, 'fuze', 0.0185, 0.0185, 0.022, 0, 0.0505, 0, 'navy', seg=8)
cyl_y(col, 'cap', 0.0135, 0.0185, 0.008, 0, 0.0655, 0, 'navy', seg=8)
box(col, 'fuze_clip', 0.036, 0.008, 0.01, 0, 0.05, 0.0, 'navy')

# the lever: a wide, chunky navy panel from the fuze down the right side of the body, hinged at the fuze - animated
pivot(col, 'spoon', 0.04, 0.03, 0)
box(col, 'spoon_top', 0.036, 0.014, 0.03, 0.026, 0.05, 0, 'navy', bevel=0.0015, part='spoon')
pts = [(0.0445 * math.sin(math.radians(a)), 0.0445 * math.cos(math.radians(a))) for a in (16, 38, 60, 82, 104, 126)]
for i in range(len(pts) - 1):
    (x0, y0), (x1, y1) = pts[i], pts[i + 1]
    L = math.hypot(x1 - x0, y1 - y0)
    box(col, 'spoon_%d' % i, 0.007, L + 0.003, 0.03, (x0 + x1) / 2, (y0 + y1) / 2, 0, 'navy', rot=(0, 0, -math.atan2(x1 - x0, y1 - y0)), part='spoon')
box(col, 'spoon_tip', 0.007, 0.012, 0.03, pts[-1][0] - 0.003, pts[-1][1] - 0.005, 0, 'navy', rot=(0, 0, -2.2), part='spoon')

# pull pin: a gold shaft through the fuze and a ring - animated (the pin comes out first)
pivot(col, 'pin', 0.004, 0.056, 0)
box(col, 'pin_shaft', 0.034, 0.005, 0.005, 0.01, 0.056, 0, 'brass', part='pin')
ring(col, 'pin_ring', 0.012, 0.0035, 0.03, 0.056, 0, 'brass', seg=8, part='pin')

result = stats(col)
