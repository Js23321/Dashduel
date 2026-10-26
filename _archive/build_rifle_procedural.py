"""
ASSAULT RIFLE in the Roblox RIVALS look: a chunky, flat-shaded SCAR-style rifle in ORANGE with BLACK parts (the RIVALS Assault Rifle's colours),
redone to be slimmer and rounder than the first version: an octagonal handguard with black vent slots, a slim sloped receiver, a short thin
rail, an angular grip and stock, a curved ribbed magazine, a thin barrel with a round flash hider.
THE SIGHT IS ONE CIRCLE: a single thin rear ring on a low base is the only thing in the way when you aim - there is no rear block, no ears and
no long slab behind it (the old rail ran back to the camera and filled the lower half of the aiming view) - and a thin front bead stands in the
middle of that ring when the sights are lined up.
Run inside Blender after lib.py.  Game coordinates: muzzle at -z, +y up, sight line y = 0.1.
Anchors the game relies on:  rear ring centre (0, 0.1, 0.11)   front bead tip (0, 0.1, -0.41)   muzzle (0, 0.022, -0.66)
Parts: body, mag (pivot 0,-0.07,-0.05), bolt (pivot 0.037,0.047,0.085), trigger (pivot 0,-0.045,0.085)
Materials (game names): orange, orangeDark, black, dark, gun, steel
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

sc = make_scene('DASHDUEL_Weapons')
col = make_collection(sc, 'WEAPON_rifle')
B = 0.003  # the facet chamfer that gives the toy-block look
OCT = math.pi / 8  # turns an 8-sided tube so it has a flat on top

# ---- receiver (orange): slim, sloping down to the stock so nothing tall is left behind the sight --------------------------------------
prof(col, 'receiver', [(-0.14, -0.012), (-0.14, 0.064), (0.1, 0.064), (0.2, 0.056), (0.31, 0.046), (0.31, -0.012)], 0.064, 0, 'orange', bevel=B)
box(col, 'side_panel', 0.0665, 0.02, 0.1, 0, 0.03, 0.07, 'black')                           # the black recess behind the ejection port
box(col, 'side_panel_front', 0.0665, 0.014, 0.04, 0, 0.03, -0.02, 'black')
box(col, 'selector', 0.0685, 0.016, 0.016, 0, 0.01, 0.165, 'black', rot=(0, 0, 0.785))      # the diamond button

# ---- handguard (orange, 8-sided tube) with three black vent slots; a short thin rail on top -----------------------------------------
cyl(col, 'handguard', 0.036, 0.036, 0.34, 0, 0.028, -0.31, 'orange', seg=8, rot=(0, 0, OCT))   # z -0.48 .. -0.14, top flat at y 0.063
for i in range(3):
    box(col, 'slot%d' % i, 0.0715, 0.02, 0.07, 0, 0.03, -0.4 + i * 0.1, 'black')
box(col, 'guard_step', 0.072, 0.03, 0.016, 0, 0.0, -0.485, 'orangeDark')
box(col, 'top_rail', 0.024, 0.01, 0.62, 0, 0.069, -0.17, 'black', bevel=0.0012)           # top at y 0.074, z -0.48 .. 0.14: it ends at the rear sight

# ---- barrel, gas block, round flash hider (black) --------------------------------------------------------------------------------------
cyl(col, 'barrel', 0.0115, 0.0115, 0.13, 0, 0.022, -0.545, 'black', seg=8)
box(col, 'gas_block', 0.028, 0.028, 0.036, 0, 0.034, -0.495, 'black', bevel=0.002)
cyl(col, 'hider', 0.02, 0.02, 0.07, 0, 0.022, -0.627, 'black', seg=8, rot=(0, 0, OCT))   # z -0.662 .. -0.592
for i in range(2):
    box(col, 'hider_slot%d' % i, 0.044, 0.007, 0.014, 0, 0.022, -0.632 - i * 0.02, 'gun')
box(col, 'hider_slot_v', 0.007, 0.044, 0.014, 0, 0.022, -0.642, 'gun')

# ---- sights: ONE ring at the back, a thin bead at the front. Rear ring centre (0, 0.1, 0.11); bead tip at (0, 0.1, -0.41) -------------
box(col, 'rear_base', 0.016, 0.007, 0.03, 0, 0.0775, 0.11, 'black', bevel=0.001)
ring(col, 'rear_ring', 0.0185, 0.0036, 0, 0.1, 0.11, 'black', seg=28)
box(col, 'front_base', 0.012, 0.01, 0.026, 0, 0.079, -0.41, 'black', bevel=0.001)
box(col, 'front_bead', 0.003, 0.016, 0.003, 0, 0.092, -0.41, 'black')

# ---- magwell + pistol grip (orange), trigger guard ---------------------------------------------------------------------------------------
box(col, 'magwell', 0.066, 0.072, 0.1, 0, -0.048, -0.05, 'orange', bevel=B)                  # y -0.084 .. -0.012, z -0.1 .. 0.0
box(col, 'magwell_cut', 0.0685, 0.012, 0.07, 0, -0.07, -0.05, 'orangeDark')
prof(col, 'grip', [(0.098, -0.05), (0.168, -0.05), (0.205, -0.19), (0.122, -0.19), (0.108, -0.13)], 0.052, 0, 'orange', bevel=B)
box(col, 'grip_back', 0.054, 0.14, 0.012, 0, -0.12, 0.172, 'black', rot=(-0.26, 0, 0))
box(col, 'grip_base', 0.056, 0.012, 0.09, 0, -0.192, 0.163, 'black')
box(col, 'guard_bottom', 0.018, 0.016, 0.09, 0, -0.092, 0.057, 'orange', bevel=0.002)
box(col, 'guard_front', 0.018, 0.04, 0.016, 0, -0.07, 0.014, 'orange', bevel=0.002)
box(col, 'mag_release', 0.074, 0.012, 0.016, 0, -0.038, -0.108, 'black')

# ---- stock (orange, angular, low) with a thin black buffer strip and butt pad ---------------------------------------------------------
box(col, 'hinge', 0.06, 0.09, 0.028, 0, 0.0, 0.315, 'black', bevel=0.002)
prof(col, 'stock', [(0.33, 0.05), (0.41, 0.044), (0.458, 0.022), (0.458, -0.076), (0.405, -0.092), (0.352, -0.04), (0.33, -0.04)], 0.052, 0, 'orange', bevel=B)
box(col, 'buffer', 0.02, 0.01, 0.15, 0, 0.052, 0.395, 'black', bevel=0.0012)
box(col, 'stock_cut', 0.0545, 0.014, 0.07, 0, -0.026, 0.395, 'orangeDark')
box(col, 'butt_pad', 0.056, 0.12, 0.018, 0, -0.012, 0.467, 'black', bevel=0.003)

# ---- magazine (black, curved, ribbed) - animated part: pivot at its top ---------------------------------------------------------------------
pivot(col, 'mag', 0, -0.07, -0.05)
prof(col, 'mag', [(-0.088, -0.07), (-0.1, -0.12), (-0.128, -0.172), (-0.172, -0.21), (-0.092, -0.21), (-0.054, -0.172), (-0.03, -0.12), (-0.018, -0.07)], 0.044, 0, 'black', bevel=0.002, part='mag')
prof(col, 'mag_inset', [(-0.098, -0.1), (-0.111, -0.135), (-0.137, -0.177), (-0.157, -0.196), (-0.12, -0.196), (-0.084, -0.16), (-0.058, -0.125), (-0.046, -0.1)], 0.0462, 0, 'gun', part='mag')   # the lighter ribbed panel
box(col, 'mag_plate', 0.048, 0.012, 0.084, 0, -0.214, -0.133, 'dark', rot=(0.5, 0, 0), part='mag')

# ---- bolt / charging handle (right side) - animated: pivot at its rest position ------------------------------------------------------------
pivot(col, 'bolt', 0.037, 0.047, 0.085)
box(col, 'bolt_a', 0.014, 0.018, 0.05, 0.036, 0.047, 0.085, 'gun', part='bolt')
box(col, 'bolt_knob', 0.018, 0.02, 0.012, 0.043, 0.047, 0.115, 'gun', part='bolt')

# ---- trigger - animated --------------------------------------------------------------------------------------------------------------------------
pivot(col, 'trigger', 0, -0.045, 0.085)
box(col, 'trigger', 0.01, 0.03, 0.012, 0, -0.057, 0.085, 'gun', part='trigger')

result = stats(col)
