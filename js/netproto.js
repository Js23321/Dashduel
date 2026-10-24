/* DASHDUEL - the part of the network protocol both sides must agree on exactly.
 *
 * Movement is simulated by the SAME code (js/player.js) in the browser (prediction) and on the server (the
 * authority). The client sends its inputs, one "run" per stretch of identical input; the server steps its own
 * player with them, so the official position can only ever be what the physics allows.
 *
 *   run = [k, fw, sd, flags, yaw, pitch, slot]   k fixed 1/120 s steps of that input
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const RV = (root.RV = root.RV || {});

  const N = (RV.NETP = {
    HZ: 120, // simulation steps per second (must equal RV.PHYS.STEP)
    F_JUMP_DOWN: 1,
    F_JUMP_PRESS: 2,
    F_CROUCH: 4,
    F_SPRINT: 8,
    F_AUTOHOP: 16,
    MAX_RUN_STEPS: 60,
  });

  /** cmd {fwd, side, jumpDown, jumpPressed, crouch, sprint} (+ the auto-hop setting) -> flag bits. */
  N.flags = function (cmd, autoHop) {
    return (cmd.jumpDown ? 1 : 0) | (cmd.jumpPressed ? 2 : 0) | (cmd.crouch ? 4 : 0) | (cmd.sprint ? 8 : 0) | (autoHop ? 16 : 0);
  };

  /** The inverse: fills `cmd` for Player.step(). */
  N.cmdFrom = function (fw, sd, fl, cmd) {
    cmd.fwd = fw;
    cmd.side = sd;
    cmd.jumpDown = (fl & 1) !== 0;
    cmd.jumpPressed = (fl & 2) !== 0;
    cmd.crouch = (fl & 4) !== 0;
    cmd.sprint = (fl & 8) !== 0;
    return cmd;
  };
})();
