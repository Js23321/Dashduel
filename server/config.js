'use strict';
/*
 * Server configuration. Everything comes from environment variables, so there is nothing to edit in the
 * code and NO secret ever has to be (or should be) put in the browser files. The game itself needs no
 * secrets at all: the only things you may want to set are the origins allowed to connect and the port.
 *
 *   PORT              port to listen on                          (default 8787; hosts like Render/Fly set it for you)
 *   HOST              interface to bind                          (default 0.0.0.0)
 *   ALLOWED_ORIGINS   comma separated list of website origins that may open a WebSocket, e.g.
 *                     "https://mygame.netlify.app,https://play.example.com". "*" allows any origin.
 *                     Empty (default) = local development only: no Origin header (command line tools),
 *                     "null" (file:// pages) and http://localhost / http://127.0.0.1 on any port.
 *   SERVE_STATIC      "1" = also serve the game files (index.html, css/, js/, vendor/) over HTTP from the
 *                     parent folder. Convenient for local play and single-service hosting.
 *   TRUST_PROXY       "1" = take the client IP from X-Forwarded-For (set this behind Render/Fly/nginx)
 *   MAX_CONNECTIONS   total simultaneous sockets                 (default 400)
 *   MAX_PER_IP        simultaneous sockets per IP address        (default 6)
 *   LOG_LEVEL         "info" (default), "debug" or "quiet"
 *   TEST_MODE         "1" = tests only: disables movement validation. Never enable on a public server.
 */
const env = process.env;

const list = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean);

module.exports = {
  PORT: +env.PORT || 8787,
  HOST: env.HOST || '0.0.0.0',
  ALLOWED_ORIGINS: list(env.ALLOWED_ORIGINS),
  SERVE_STATIC: env.SERVE_STATIC === '1',
  TRUST_PROXY: env.TRUST_PROXY === '1',
  MAX_CONNECTIONS: +env.MAX_CONNECTIONS || 400,
  MAX_PER_IP: +env.MAX_PER_IP || 6,
  LOG_LEVEL: env.LOG_LEVEL || 'info',
  TEST_MODE: env.TEST_MODE === '1', // TESTS ONLY: skips movement validation so test clients can teleport. Never set in production.

  PROTOCOL: 1, // bump when the client/server messages change incompatibly
  TICK_HZ: 30, // snapshots and simulation steps per second
  MAX_MESSAGE: 4096, // bytes per client message
  MAPS: ['toybox', 'skybridge', 'pinwheel', 'vertigo'], // online 1v1 maps (compact duel maps)
  TO: 5, // rounds to win a match
  COUNTDOWN: 3, // seconds locked in the spawn at the start of every round
  ROUND_TIME: 90, // seconds per round (then most health wins)
  LOADING_TIMEOUT: 25, // seconds both players get to load the map
  ENDED_PAUSE: 1.9, // seconds between a round ending and the next countdown
  OVER_PAUSE: 1.6, // seconds between the last round ending and the match-end screen
};
