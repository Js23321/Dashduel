'use strict';
/*
 * Server configuration. Everything comes from environment variables, so there is nothing to edit in the
 * code and NO secret ever has to be (or should be) put in the browser files. The game itself needs no
 * secrets in the browser: the only server-side secret is SESSION_SECRET (signs session tokens).
 * See server/.env.example for a documented template.
 *
 * Networking / deployment
 *   PORT              port to listen on                          (default 8787; hosts like Render/Fly set it for you)
 *   HOST              interface to bind                          (default 0.0.0.0)
 *   ALLOWED_ORIGINS   comma separated list of website origins that may open a WebSocket, e.g.
 *                     "https://mygame.netlify.app,https://play.example.com". "*" allows any origin.
 *                     Empty (default) = local development only: no Origin header (command line tools),
 *                     "null" (file:// pages) and http://localhost / http://127.0.0.1 on any port.
 *   REQUIRE_TLS       "1" = refuse plain ws:// (needs TLS here, or TRUST_PROXY=1 and a proxy sending X-Forwarded-Proto)
 *   SERVE_STATIC      "1" = also serve the game files (index.html, css/, js/, vendor/) over HTTP from the
 *                     parent folder. Convenient for local play and single-service hosting.
 *   TRUST_PROXY       "1" = take the client IP from X-Forwarded-For (set this behind Render/Fly/nginx)
 *   MAX_CONNECTIONS   total simultaneous sockets                 (default 400)
 *   MAX_PER_IP        simultaneous sockets per IP address        (default 6)
 * Security
 *   SESSION_SECRET    secret used to sign session tokens (>= 32 random chars). If unset a random one is made at
 *                     start-up (tokens then stop working after a restart; fine for one instance, set it in production)
 *   DEBUG_ENDPOINTS   "1" = enable GET /debug/anticheat and /debug/rooms (validation results, no secrets / tokens)
 *   ADMIN_TOKEN       if set, the debug endpoints need "Authorization: Bearer <token>"; if empty they answer only
 *                     requests from the local machine
 *   LOG_LEVEL / LOG_FORMAT   "info"|"debug"|"quiet"  /  "json" (default) | "text"
 *   SPAWN_PROTECT_S   seconds a player cannot be hurt after a round goes live (default 0 = off: the 3 s frozen countdown IS the protection;
 *                     a value above 0 makes shots at a fresh opponent do nothing, which looks like a hit-registration bug)
 * Anti-cheat thresholds (all optional, see docs/ONLINE_BACKEND.md): AC_WARN_SCORE, AC_KICK_SCORE, AC_DECAY,
 *   AC_LOCKOUT_S, AC_MAX_TURN_RATE, AC_CLAIM_EPS, AC_INPUT_QUEUE_MAX, AC_INPUT_BURST_STEPS, LAG_MAX_REWIND_MS, ...
 *   TEST_MODE         "1" = tests only: allows the test-only teleport message. Never enable on a public server.
 */
const env = process.env;

const list = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean);
const num = (v, d) => (v !== undefined && v !== '' && isFinite(+v) ? +v : d);

module.exports = {
  PORT: +env.PORT || 8787,
  HOST: env.HOST || '0.0.0.0',
  ALLOWED_ORIGINS: list(env.ALLOWED_ORIGINS),
  REQUIRE_TLS: env.REQUIRE_TLS === '1',
  SERVE_STATIC: env.SERVE_STATIC === '1',
  TRUST_PROXY: env.TRUST_PROXY === '1',
  MAX_CONNECTIONS: +env.MAX_CONNECTIONS || 400,
  MAX_PER_IP: +env.MAX_PER_IP || 6,
  LOG_LEVEL: env.LOG_LEVEL || 'info',
  LOG_FORMAT: env.LOG_FORMAT || 'json',
  SESSION_SECRET: env.SESSION_SECRET || '',
  DEBUG_ENDPOINTS: env.DEBUG_ENDPOINTS === '1',
  ADMIN_TOKEN: env.ADMIN_TOKEN || '',
  TEST_MODE: env.TEST_MODE === '1', // TESTS ONLY: enables the test-only teleport message. Never set in production.

  PROTOCOL: 6, // bump when the client/server messages or the shared movement physics change incompatibly (3: one run speed, no sprint; 4: the free-for-all room; 5: grip, speed bleed and the wall-jump climb cap, one more player-state field; 6: the map vote, the instant grenade throw)
  TICK_HZ: 30, // snapshots and room housekeeping per second (movement is stepped at 120 Hz, see js/player.js)
  MAX_MESSAGE: 4096, // bytes per client message
  MAPS: ['testarena', 'bridge', 'crossroads', 'docks', 'station', 'backrooms'], // online 1v1 maps (Arena, Bridge, Crossroads, Docks, Station, Backrooms; ids that have no data file are skipped)
  TO: 5, // rounds to win a match
  COUNTDOWN: 3, // seconds locked in the spawn at the start of every round
  ROUND_TIME: 90, // seconds per round (then most health wins)
  SPAWN_PROTECT_S: num(env.SPAWN_PROTECT_S, 0), // a player who has just gone live takes no damage for this long, or until they attack (0 = off)
  LOADING_TIMEOUT: 25, // seconds both players get to load the map
  ENDED_PAUSE: 1.9, // seconds between a round ending and the next countdown
  OVER_PAUSE: 1.6, // seconds between the last round ending and the match-end screen
  RECONNECT_GRACE_S: num(env.RECONNECT_GRACE_S, 15), // a dropped player may come back within this time; the round clock stops
  REMATCH_WINDOW_S: num(env.REMATCH_WINDOW_S, 20), // after a match both players may agree to a rematch for this long
  SESSION_IDLE_S: num(env.SESSION_IDLE_S, 60), // a session without a connection and without a match is forgotten after this
  MAX_SESSIONS: num(env.MAX_SESSIONS, 4000),

  // ---- the free-for-all server: one always-running room per map, anyone joins or leaves at any time ----------------------
  FFA: {
    ENABLED: env.FFA !== '0',
    MAPS: list(env.FFA_MAPS), // maps that get an FFA room (default: every map of MAPS)
    MAX_PLAYERS: num(env.FFA_MAX_PLAYERS, 12), // per room: a full room says so and the player picks another map
    RESPAWN_S: num(env.FFA_RESPAWN_S, 2.5), // seconds dead before the server puts the player back on a spawn
    SPAWN_PROTECT_S: num(env.FFA_SPAWN_PROTECT_S, 2.5), // after every spawn: no damage for this long, or until the player attacks
    KILL_LIMIT: num(env.FFA_KILL_LIMIT, 25), // first to this many eliminations wins the round of the room: scores reset, nobody is thrown out
    LOAD_TIMEOUT_S: 40, // a joined player who never finishes loading the map is dropped after this
    IDLE_S: num(env.FFA_IDLE_S, 120), // no movement, aim or action for this long: moved out of the room (an AFK player must not sit there forever)
    HEAR_M: 90, // shots, punches and blasts are only sent to players closer than this
    CREDIT_S: 6, // a fall into the void within this many seconds of being hurt counts for whoever hurt the player last
  },

  // ---- the map vote (1v1): two players who have just been paired vote on the map before it loads -------------
  VOTE: {
    ENABLED: env.MAP_VOTE !== '0', // 0 = the server picks a random map, as before
    OPTIONS: num(env.VOTE_OPTIONS, 3), // maps on offer: picked at random from MAPS (fewer if the pool is smaller)
    SECONDS: num(env.VOTE_SECONDS, 12), // the vote closes after this long, or as soon as both have voted; nobody voting = one of the options at random
  },

  // ---- server-side movement simulation (the server steps js/player.js with the client's inputs) -------------
  MOVE: {
    INPUT_BURST_STEPS: num(env.AC_INPUT_BURST_STEPS, 45), // steps (1/120 s each) simulated in one go after a stall (a lag spike must not become a teleport)
    CATCHUP: num(env.AC_CATCHUP, 1.5), // a player with a backlog of input (after a stall) is simulated this much faster than real time until it is gone
    CATCHUP_MIN_STEPS: 6, // backlog below this is normal jitter: no catch-up
    INPUT_SLACK_STEPS: num(env.AC_INPUT_SLACK_STEPS, 360), // total input a player may be AHEAD of the round clock (3 s). The speed-hack limit: received <= clock*120 + this
    INPUT_QUEUE_MAX: num(env.AC_INPUT_QUEUE_MAX, 720), // queued, not yet simulated steps (6 s): memory guard against flooding
    MAX_TURN_RATE: num(env.AC_MAX_TURN_RATE, 80), // rad/s of view turning the server accepts (a very fast human flick is ~30)
    TURN_SLACK: 0.35, // rad of extra allowance per input run
    CLAIM_EPS: num(env.AC_CLAIM_EPS, 0.05), // m: client prediction vs server position before a correction is sent
    FIX_MIN_MS: 100, // never send corrections more often than this
  },
  // ---- combat ----------------------------------------------------------------------------------------------
  LAG: {
    MAX_REWIND_MS: num(env.LAG_MAX_REWIND_MS, 400), // lag compensation never rewinds further than this
    INTERP_MS: 115, // the clients draw opponents 100 ms in the past, from 30 Hz snapshots that are on average ~15 ms old when sampled
    JITTER_MS: num(env.LAG_JITTER_MS, 30), // the round trip is only an estimate: a shot also counts if it was on target this much earlier or later
    TOL_XZ: num(env.LAG_TOL_XZ, 0.1), // m: the target's box is this much wider (each side) for a rewound shot, so a shot that was on the drawn body is never lost
    TOL_Y: num(env.LAG_TOL_Y, 0.08), // m: and this much taller (head and feet)
    HIST_MS: 1500, // how much position history is kept
  },
  FIRE_INTERVAL_TOLERANCE: num(env.AC_FIRE_TOLERANCE, 0.9), // (melee) a punch may come at 90% of the weapon interval (frame granularity)
  FIRE_SLACK_S: num(env.AC_FIRE_SLACK, 0.12), // guns: a leaky bucket of owed firing time. A long frame makes the browser fire two shots at once; up to this much
  //                                              extra is forgiven, but the average rate can never beat the weapon's interval
  RELOAD_TOLERANCE_S: num(env.RELOAD_TOLERANCE_S, 0.07), // the browser's reload timer is wall-clock, the server's is in steps: a shot this early still counts as after the reload
  // ---- information protection ------------------------------------------------------------------------------
  VIS: {
    ENABLED: env.VIS_CULLING !== '0', // only send the opponent's state when they could be seen (line of sight, with margin)
    LOOKAHEAD_S: 0.25, // also count as visible if they would be within this time (no pop-in)
    HOLD_S: 0.5, // stay visible this long after the line of sight breaks (no flicker)
    NEAR: 3.0, // always visible this close
  },
  // ---- anti-cheat scoring (see anticheat.js) ---------------------------------------------------------------
  AC: {
    WARN_SCORE: num(env.AC_WARN_SCORE, 40),
    KICK_SCORE: num(env.AC_KICK_SCORE, 100),
    DECAY_PER_S: num(env.AC_DECAY, 1),
    LOCKOUT_S: num(env.AC_LOCKOUT_S, 60), // a kicked session/address cannot queue again for this long (never permanent)
    SEVERE_KICK_COUNT: 3, // this many severe events inside SEVERE_WINDOW_S also kick
    SEVERE_WINDOW_S: 60,
    EVENT_RING: 500, // security events kept in memory for the debug endpoint
  },
};
