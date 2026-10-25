"""
HANDS in the Roblox RIVALS look: the fists are two BLOCKY Roblox arms - a long black sleeve block, then a skin-tone block hand with a
curled fist block and a thumb block (reference: the wiki's Fists model: black sleeve, tan block fist). Built facing -z with the palm
down (-y); the right hand has its thumb on the left (inside), the left hand is the mirror image. Both hands are used for every weapon
(the game poses them).
Materials (game names): skin, skinDark, sleeve (black), cuff
"""
exec(open(r'C:\Users\ryder\Downloads\Rivel\tools\blender\lib.py').read())

sc = make_scene('DASHDUEL_Weapons')
col = make_collection(sc, 'WEAPON_hands')


def hand(side, name):
    s = side  # +1 right hand, -1 left hand
    p = lambda n: name + '_' + n
    # the hand: a back-of-hand block and a curled-fingers block in front of it, with three finger grooves and a knuckle line
    box(col, p('back'), 0.062, 0.04, 0.064, 0, 0, 0, 'skin', bevel=0.004, part=name)
    box(col, p('fingers'), 0.062, 0.052, 0.044, 0, -0.006, -0.05, 'skin', bevel=0.004, part=name)
    for i in range(3):
        box(col, p('groove%d' % i), 0.003, 0.034, 0.0442, (-0.0155 + i * 0.0155) * s, -0.012, -0.0505, 'skinDark', part=name)
    box(col, p('knuckles'), 0.064, 0.006, 0.046, 0, 0.022, -0.05, 'skinDark', part=name)
    # thumb (inside): one chunky block lying along the index finger
    box(col, p('thumb'), 0.02, 0.022, 0.052, -0.04 * s, 0.001, -0.032, 'skin', bevel=0.003, part=name)
    # a short skin wrist, then the black sleeve block straight away (a Roblox arm: the hand is the only skin you see)
    box(col, p('cuff'), 0.07, 0.068, 0.012, 0, 0.002, 0.038, 'cuff', bevel=0.002, part=name)
    box(col, p('sleeve'), 0.068, 0.066, 0.36, 0, 0.002, 0.224, 'sleeve', bevel=0.003, part=name)


hand(+1, 'handR')
hand(-1, 'handL')
result = stats(col)
