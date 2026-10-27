"""
HANDGUN in the Roblox RIVALS look: an all-black, chunky USP-style pistol (reference: the wiki's default model): a thick blocky slide with a
square muzzle that has a round bore, three vertical vent slits near the front, two round pins on the side, a squared trigger guard and a
big angled grip with a magazine base plate. No colour accents: it is plain black / charcoal.
Anchors:  rear sight notch centre (0, 0.082, 0.095)   muzzle (0, 0.045, -0.2)
Parts: body, slide (pivot 0,0.04,-0.02, moves back on a shot), mag (pivot 0,-0.13,0.078), trigger (pivot 0,-0.02,0.03)
Materials (game names): dark (frame / grip), poly (slide), gun (slide parts), steel (pins), black (bore)
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

sc = make_scene('DASHDUEL_Weapons')
col = make_collection(sc, 'WEAPON_pistol')
B = 0.003

# ---- frame: dust cover, main frame, hammer -------------------------------------------------------------------------------------------
box(col, 'dust_cover', 0.054, 0.044, 0.13, 0, -0.001, -0.075, 'dark', bevel=B)           # z -0.14 .. -0.01
for i in range(2):
    box(col, 'rail_slot%d' % i, 0.056, 0.008, 0.016, 0, -0.018, -0.11 + i * 0.04, 'black')
box(col, 'frame', 0.054, 0.056, 0.13, 0, -0.004, 0.05, 'dark', bevel=B)                  # z -0.015 .. 0.115
box(col, 'rear_strap', 0.03, 0.06, 0.014, 0, 0.0, 0.118, 'dark', bevel=0.002)
box(col, 'hammer', 0.014, 0.024, 0.014, 0, 0.05, 0.117, 'gun', bevel=0.0012)

# ---- big squared trigger guard ------------------------------------------------------------------------------------------------------------
box(col, 'guard_front', 0.02, 0.04, 0.012, 0, -0.05, -0.012, 'dark', bevel=0.002)
box(col, 'guard_bottom', 0.02, 0.011, 0.06, 0, -0.072, 0.014, 'dark', bevel=0.002)

# ---- grip: a big, angled, blocky grip with a curved back-strap and a flared base -------------------------------------------------------------
prof(col, 'grip', [(0.026, -0.03), (0.118, -0.03), (0.152, -0.165), (0.054, -0.165)], 0.056, 0, 'dark', bevel=B)
box(col, 'backstrap', 0.058, 0.13, 0.012, 0, -0.1, 0.136, 'black', rot=(-0.26, 0, 0))
for i in range(4):
    box(col, 'grip_tex%d' % i, 0.058, 0.006, 0.06, 0, -0.062 - i * 0.025, 0.07 + i * 0.006, 'black')
box(col, 'base_flare', 0.064, 0.012, 0.11, 0, -0.171, 0.103, 'dark', bevel=0.002)
box(col, 'lanyard', 0.012, 0.012, 0.016, 0, -0.172, 0.158, 'steel')
box(col, 'slide_stop', 0.006, 0.01, 0.03, -0.0295, 0.012, 0.0, 'steel')
box(col, 'decocker', 0.006, 0.012, 0.03, -0.0295, 0.01, 0.075, 'steel')

# ---- slide (animated): pivot at its rest position; a thick slab with the square muzzle ---------------------------------------------------------
pivot(col, 'slide', 0, 0.04, -0.02)
prof(col, 'slide', [(-0.2, 0.066), (0.108, 0.066), (0.108, 0.01), (-0.2, 0.01)], 0.06, 0, 'poly', bevel=B, part='slide')
cyl(col, 'bore', 0.0115, 0.0115, 0.03, 0, 0.04, -0.196, 'black', seg=10, part='slide')   # the round bore in the square muzzle
for i in range(3):                                                                        # three vertical vent slits near the front
    box(col, 'vent%d' % i, 0.0625, 0.04, 0.008, 0, 0.037, -0.17 + i * 0.022, 'black', part='slide')
for sx in (1, -1):                                                                        # two round pins on each side of the slide
    box(col, 'pin_a%d' % sx, 0.008, 0.012, 0.012, sx * 0.0305, 0.052, 0.05, 'steel', part='slide')
    box(col, 'pin_b%d' % sx, 0.008, 0.012, 0.012, sx * 0.0305, 0.022, 0.0, 'steel', part='slide')
for i in range(5):                                                                        # rear serrations
    box(col, 'serration%d' % i, 0.0625, 0.05, 0.005, 0, 0.037, 0.062 + i * 0.01, 'black', part='slide')
box(col, 'ejection', 0.004, 0.022, 0.05, 0.031, 0.04, 0.0, 'black', part='slide')
# blocky sights: rear blocks with the notch between them (centre y = 0.082), front post (tip y = 0.082)
box(col, 'rear_sightL', 0.014, 0.03, 0.018, 0.0155, 0.079, 0.095, 'gun', bevel=0.0015, part='slide')
box(col, 'rear_sightR', 0.014, 0.03, 0.018, -0.0155, 0.079, 0.095, 'gun', bevel=0.0015, part='slide')
box(col, 'rear_base', 0.045, 0.008, 0.018, 0, 0.066, 0.095, 'gun', part='slide')
box(col, 'front_post', 0.012, 0.022, 0.016, 0, 0.074, -0.18, 'gun', bevel=0.0015, part='slide')

# ---- magazine base (animated: drops out on a reload) ---------------------------------------------------------------------------------------------
pivot(col, 'mag', 0, -0.13, 0.078)
box(col, 'mag_body', 0.044, 0.044, 0.07, 0, -0.13, 0.078, 'gun', bevel=0.0015, part='mag')
box(col, 'mag_plate', 0.06, 0.012, 0.1, 0, -0.158, 0.1, 'dark', bevel=0.002, part='mag')

# ---- trigger (animated) ----------------------------------------------------------------------------------------------------------------------------
pivot(col, 'trigger', 0, -0.02, 0.03)
box(col, 'trigger', 0.01, 0.028, 0.012, 0, -0.03, 0.03, 'gun', part='trigger')

result = stats(col)
