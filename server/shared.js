'use strict';
/*
 * Loads the game's pure simulation modules from ../js/ (collision world, maps, weapon data, grenade
 * physics, movement physics, the shared part of the protocol). They are the SAME files the browser runs, so the server validates
 * with exactly the rules the client plays by. They only need a `window` object, so we alias it.
 *
 * Deployment note: the backend therefore needs the repository's js/ folder next to server/ (deploy the
 * whole repo; the frontend host only needs the static files).
 */
const fs = require('fs');
const path = require('path');

global.window = global;
const JS = path.join(__dirname, '..', 'js');
for (const f of ['util', 'weapondata', 'collision', 'grensim']) require(path.join(JS, f + '.js'));
// the collision + spawns of every map made in Blender (tools/blender/build_*.py), before maps.js turns them into maps
for (const f of fs.readdirSync(JS).filter((n) => /^mapdata-[a-z0-9_]+\.js$/.test(n)).sort()) require(path.join(JS, f));
for (const f of ['maps', 'player', 'netproto']) require(path.join(JS, f + '.js'));

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
