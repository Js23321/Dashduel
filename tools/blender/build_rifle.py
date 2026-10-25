"""
ASSAULT RIFLE in the Roblox RIVALS look: the RIVALS Assault Rifle is a chunky, flat-shaded FN SCAR-L in ORANGE with BLACK parts
(reference: the wiki's default model): orange handguard with black vent slots, orange receiver with a long black side panel,
orange angular pistol grip and stock, a black curved ribbed magazine, a thin black barrel with a block flash hider, black flip-up
ring sights front and rear, a black rail along the top.
Run inside Blender after lib.py.  Game coordinates: muzzle at -z, +y up, sight line y = 0.1.
Anchors the game relies on:  rear aperture centre (0, 0.1, 0.11)   front post tip (0, 0.1, -0.41)   muzzle (0, 0.022, -0.66)
Parts: body, mag (pivot 0,-0.07,-0.05), bolt (pivot 0.037,0.047,0.085), trigger (pivot 0,-0.045,0.085)
Materials (game names): orange, orangeDark, black, dark, gun, steel
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

sc = make_scene('DASHDUEL_Weapons')
col = make_collection(sc, 'WEAPON_rifle')
B = 0.003  # the facet chamfer that gives the toy-block look

# ---- receiver (orange) with the long black side panel -----------------------------------------------------------------------------
prof(col, 'receiver', [(-0.14, -0.012), (-0.14, 0.07), (0.27, 0.07), (0.31, 0.046), (0.31, -0.012)], 0.082, 0, 'orange', bevel=B)
box(col, 'side_panel', 0.0845, 0.024, 0.13, 0, 0.034, 0.075, 'black')                      # the black recess behind the ejection port
box(col, 'side_panel_front', 0.0845, 0.016, 0.05, 0, 0.034, -0.015, 'black')
box(col, 'selector', 0.0865, 0.018, 0.018, 0, 0.012, 0.165, 'black', rot=(0, 0, 0.785))   # the diamond button
box(col, 'rear_band', 0.0835, 0.074, 0.012, 0, 0.026, 0.285, 'black')

# ---- handguard (orange) with three black vent slots, and the black rail on top ------------------------------------------------------
box(col, 'handguard', 0.078, 0.088, 0.34, 0, 0.026, -0.31, 'orange', bevel=B)                # z -0.48 .. -0.14, y -0.018 .. 0.07
for i in range(3):
    box(col, 'slot%d' % i, 0.0805, 0.024, 0.07, 0, 0.034, -0.4 + i * 0.1, 'black')
box(col, 'guard_step', 0.0805, 0.03, 0.02, 0, -0.005, -0.485, 'orangeDark')
box(col, 'top_rail', 0.036, 0.014, 0.8, 0, 0.077, -0.09, 'black', bevel=0.0015)             # top at y = 0.084, z -0.49 .. 0.31

# ---- barrel, gas block, block flash hider (black) ----------------------------------------------------------------------------------
cyl(col, 'barrel', 0.0125, 0.0125, 0.13, 0, 0.022, -0.545, 'black', seg=8)
box(col, 'gas_block', 0.034, 0.034, 0.04, 0, 0.032, -0.495, 'black', bevel=0.002)
box(col, 'hider', 0.038, 0.038, 0.07, 0, 0.022, -0.627, 'black', bevel=0.002)                # z -0.662 .. -0.592
for i in range(2):
    box(col, 'hider_slot%d' % i, 0.04, 0.008, 0.016, 0, 0.022, -0.63 - i * 0.022, 'gun')
box(col, 'hider_slot_v', 0.008, 0.04, 0.016, 0, 0.022, -0.642, 'gun')

# ---- sights: flip-up rings. Rear ring centre (0, 0.1, 0.11); front ring + post, post tip at (0, 0.1, -0.41) ---------------------------
box(col, 'front_base', 0.028, 0.026, 0.034, 0, 0.078, -0.41, 'black', bevel=0.0015)
ring(col, 'front_ring', 0.0125, 0.0035, 0, 0.1, -0.41, 'black', seg=10)
box(col, 'front_post', 0.005, 0.014, 0.005, 0, 0.0935, -0.41, 'black')
box(col, 'rear_base', 0.04, 0.022, 0.044, 0, 0.088, 0.11, 'black', bevel=0.0015)
ring(col, 'rear_ring', 0.0165, 0.0045, 0, 0.1, 0.11, 'black', seg=12)
box(col, 'rear_earL', 0.008, 0.032, 0.03, 0.0215, 0.1, 0.11, 'black')
box(col, 'rear_earR', 0.008, 0.032, 0.03, -0.0215, 0.1, 0.11, 'black')

# ---- magwell + pistol grip (orange), trigger guard -----------------------------------------------------------------------------------
box(col, 'magwell', 0.078, 0.072, 0.1, 0, -0.048, -0.05, 'orange', bevel=B)                  # y -0.084 .. -0.012, z -0.1 .. 0.0
box(col, 'magwell_cut', 0.0805, 0.012, 0.07, 0, -0.07, -0.05, 'orangeDark')
prof(col, 'grip', [(0.098, -0.05), (0.168, -0.05), (0.205, -0.19), (0.122, -0.19), (0.108, -0.13)], 0.056, 0, 'orange', bevel=B)
box(col, 'grip_back', 0.058, 0.14, 0.012, 0, -0.12, 0.172, 'black', rot=(-0.26, 0, 0))
box(col, 'grip_base', 0.06, 0.012, 0.09, 0, -0.192, 0.163, 'black')
box(col, 'guard_bottom', 0.02, 0.016, 0.09, 0, -0.092, 0.057, 'orange', bevel=0.002)
box(col, 'guard_front', 0.02, 0.04, 0.016, 0, -0.07, 0.014, 'orange', bevel=0.002)
box(col, 'mag_release', 0.088, 0.012, 0.016, 0, -0.038, -0.108, 'black')

# ---- stock (orange, angular) with a black buffer strip and butt pad ---------------------------------------------------------------------
box(col, 'hinge', 0.07, 0.1, 0.03, 0, 0.002, 0.315, 'black', bevel=0.002)
prof(col, 'stock', [(0.33, 0.058), (0.43, 0.05), (0.458, 0.026), (0.458, -0.076), (0.405, -0.092), (0.352, -0.04), (0.33, -0.04)], 0.064, 0, 'orange', bevel=B)
box(col, 'buffer', 0.044, 0.014, 0.16, 0, 0.064, 0.4, 'black', bevel=0.0015)
box(col, 'stock_cut', 0.0665, 0.016, 0.07, 0, -0.026, 0.395, 'orangeDark')
box(col, 'butt_pad', 0.068, 0.13, 0.02, 0, -0.012, 0.469, 'black', bevel=0.003)

# ---- magazine (black, curved, ribbed) - animated part: pivot at its top ---------------------------------------------------------------------
pivot(col, 'mag', 0, -0.07, -0.05)
prof(col, 'mag', [(-0.088, -0.07), (-0.1, -0.12), (-0.128, -0.172), (-0.172, -0.21), (-0.092, -0.21), (-0.054, -0.172), (-0.03, -0.12), (-0.018, -0.07)], 0.05, 0, 'black', bevel=0.002, part='mag')
prof(col, 'mag_inset', [(-0.098, -0.1), (-0.111, -0.135), (-0.137, -0.177), (-0.157, -0.196), (-0.12, -0.196), (-0.084, -0.16), (-0.058, -0.125), (-0.046, -0.1)], 0.0522, 0, 'gun', part='mag')   # the lighter ribbed panel
box(col, 'mag_plate', 0.054, 0.012, 0.084, 0, -0.214, -0.133, 'dark', rot=(0.5, 0, 0), part='mag')

# ---- bolt / charging handle (right side) - animated: pivot at its rest position ------------------------------------------------------------
pivot(col, 'bolt', 0.037, 0.047, 0.085)
box(col, 'bolt_a', 0.014, 0.018, 0.05, 0.039, 0.047, 0.085, 'gun', part='bolt')
box(col, 'bolt_knob', 0.018, 0.02, 0.012, 0.046, 0.047, 0.115, 'gun', part='bolt')

# ---- trigger - animated --------------------------------------------------------------------------------------------------------------------------
pivot(col, 'trigger', 0, -0.045, 0.085)
box(col, 'trigger', 0.01, 0.03, 0.012, 0, -0.057, 0.085, 'gun', part='trigger')

result = stats(col)
