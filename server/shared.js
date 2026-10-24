'use strict';
/*
 * Loads the game's pure simulation modules from ../js/ (collision world, maps, weapon data, grenade
 * physics, movement physics, the shared part of the protocol). They are the SAME files the browser runs, so the server validates
 * with exactly the rules the client plays by. They only need a `window` object, so we alias it.
 *
 * Deployment note: the backend therefore needs the repository's js/ folder next to server/ (deploy the
 * whole repo; the frontend host only needs the static files).
 */
const path = require('path');

global.window = global;
const JS = path.join(__dirname, '..', 'js');
for (const f of ['util', 'weapondata', 'collision', 'grensim', 'maps', 'player', 'netproto']) require(path.join(JS, f + '.js'));

const RV = global.RV;
const worlds = {};

module.exports = {
  RV,
  /** One read-only collision world per map, shared by every room on that map. */
  worldFor(mapId) {
    if (!RV.maps[mapId]) return null;
    return worlds[mapId] || (worlds[mapId] = new RV.World(RV.maps[mapId]));
  },
};
