/* DASHDUEL - frontend configuration.
 *
 * This file is public (it is downloaded by every player). It must contain NO secrets: the game needs none,
 * and the server never trusts anything the browser says anyway.
 *
 * Where the game looks for the online server, in this order:
 *   1. ?server=wss://host/ws        in the page address (handy for testing)
 *   2. the "Server URL" saved in Settings > Network (stored in this browser only)
 *   3. SERVER_URL below                    <-- set this to your deployed server before you publish the game
 *   4. SAME_ORIGIN_SERVER = true           use the server that served this page (ws[s]://this-host/ws)
 *   5. LOCAL_SERVER_URL                    only when the page is opened from a file or localhost
 *
 * If none applies, Online 1v1 explains that no server is configured. There is no fake opponent and no
 * peer-to-peer fallback: online play needs the real backend (see docs/ONLINE_BACKEND.md).
 */
window.DASHDUEL_CONFIG = {
  SERVER_URL: 'wss://server.sciencerevisions.online/ws', // the deployed game server
  SAME_ORIGIN_SERVER: false, // true when the game server also serves these files (SERVE_STATIC=1 hosting)
  LOCAL_SERVER_URL: 'ws://localhost:8787/ws',
  PROTOCOL: 4, // must equal the server's protocol number
};
