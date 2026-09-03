// Headless smoke/balance test: builds the map, runs full games with the red
// AI against a simple scripted blue defender, and checks invariants.
// Run: node test/sim.test.js

import { buildMap } from '../src/map.js';
import { newGame, serialize, deserialize, typeOf } from '../src/state.js';
import {
  startTurn, endOfRedPhase, checkVictory, moveTargets, attackTargets,
  resolveCombat, doMove, blueSalvo, doLobby, doMobilize, doMines, doConvoy,
  airStrike, airStrikeTargets, ACTIONS, unitsAt,
} from '../src/rules.js';
import { runRedTurn } from '../src/ai.js';
import { distToTaiwan } from '../src/map.js';
import { hexDist } from '../src/hex.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

// ---- map sanity ----
{
  const map = buildMap();
  check(map.hexes.size === 20 * 22, 'map has 440 hexes');
  check(map.get(11, 5).loc?.capital, 'Taipei at 11,5');
  check(map.get(2, 9).loc?.name === 'Kinmen', 'Kinmen adjacent to Xiamen');
  const kinmenAdj = map.neighborsOf(2, 9).some(h => h.loc?.name === 'Xiamen');
  check(kinmenAdj, 'Kinmen touches Xiamen');
  check(distToTaiwan(map, 11, 5) === 0, 'distToTaiwan zero on Taiwan');
  check(distToTaiwan(map, 1, 9) > 4, 'mainland is across the strait');
  console.log('map sanity: done');
}

// ---- setup sanity ----
{
  const { game, map } = newGame('normal', 42);
  for (const u of game.units) {
    const h = map.get(u.c, u.r);
    check(h, `unit ${u.name} on map`);
    if (['naval', 'sub', 'amphib'].includes(u.cls) && !u.embarkedIn) {
      check(h.t.water, `${u.name} starts on water (${u.c},${u.r})`);
    }
    if (u.cls === 'ground' && !u.embarkedIn) check(h.t.land, `${u.name} starts on land`);
  }
  const embarked = game.units.filter(u => u.embarkedIn);
  check(embarked.length === 8, `8 embarked brigades at start (got ${embarked.length})`);
  // serialization round-trip
  const { game: g2 } = deserialize(serialize(game));
  check(g2.units.length === game.units.length, 'serialize round-trip preserves units');
  console.log('setup sanity: done');
}

// ---- scripted blue defenders of two skill levels ----

// Passive: shoots what's in range, lobbies, mobilizes at Taipei.
function bluePassive(game, map) {
  while (game.pools.ascm > 6) {
    const targets = game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'red' &&
      ['amphib', 'naval'].includes(u.cls) && distToTaiwan(map, u.c, u.r) <= 3);
    if (!targets.length) break;
    targets.sort((a, b) => (a.cls === 'amphib' ? 0 : 1) - (b.cls === 'amphib' ? 0 : 1));
    blueSalvo(game, map, 'ascm', targets[0]);
  }
  if (game.cp >= ACTIONS.lobby.cp && !game.usEntered) doLobby(game);
  if (game.cp >= ACTIONS.mobilize.cp && game.reservesLeft > 0) {
    const spot = map.get(11, 5);
    if (unitsAt(game, 11, 5).filter(u => u.side === 'blue' && u.cls !== 'air').length < 2) doMobilize(game, map, spot);
  }
  for (const u of game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'blue')) {
    const ts = attackTargets(game, map, u);
    if (ts.length) resolveCombat(game, map, u, ts[0]);
  }
}

// Competent: approximates a decent human — reads the threat axis, masses
// ground forces there, mines beaches, empties the magazines into the
// amphibious fleet and fights the CSG forward.
function blueCompetent(game, map) {
  const redAmphibs = () => game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'red' && u.cls === 'amphib');
  const loadedAmphibs = redAmphibs().filter(u => u.cargo.length);
  // threat axis: where the loaded amphibs are heading (closest Taiwan beach)
  const beaches = [[10, 5], [10, 6], [10, 8], [10, 12], [10, 13], [13, 7]].map(([c, r]) => map.get(c, r));
  let axis = map.get(10, 5);
  if (loadedAmphibs.length) {
    let bd = 99;
    for (const b of beaches) {
      const dmin = Math.min(...loadedAmphibs.map(a => hexDist(a, b)));
      if (dmin < bd) { bd = dmin; axis = b; }
    }
  }
  // CP: lobby until US in, then mines on the axis, convoy when starving
  if (!game.usEntered && game.cp >= ACTIONS.lobby.cp) doLobby(game);
  if (game.cp >= ACTIONS.mines.cp && (game.mines[`${axis.c},${axis.r}`] || 0) < 2) doMines(game, axis);
  if (game.cp >= ACTIONS.convoy.cp && game.supply < 45) doConvoy(game);
  while (game.cp >= ACTIONS.mobilize.cp && game.reservesLeft > 0) {
    const spots = [map.get(11, 5), axis, map.get(10, 8)].filter(h =>
      h.t.land && unitsAt(game, h.c, h.r).filter(u => u.side === 'blue' && u.cls !== 'air').length < 2);
    if (!spots.length) break;
    if (!doMobilize(game, map, spots[0])) break;
  }
  // magazines into the amphibious fleet
  while (game.pools.ascm > 0) {
    const t = redAmphibs().concat(game.units.filter(u => u.alive && u.side === 'red' && u.cls === 'naval'))
      .filter(u => distToTaiwan(map, u.c, u.r) <= 3)
      .sort((a, b) => (b.cls === 'amphib' ? b.cargo.length : -1) - (a.cls === 'amphib' ? a.cargo.length : -1))[0];
    if (!t) break;
    blueSalvo(game, map, 'ascm', t);
  }
  while (game.pools.lrasm > 0) {
    const t = redAmphibs().sort((a, b) => b.cargo.length - a.cargo.length)[0] ||
      game.units.find(u => u.alive && u.side === 'red' && u.cls === 'naval');
    if (!t) break;
    blueSalvo(game, map, 'lrasm', t);
  }
  // ground: units within 3 of the axis (or of any red beachhead) close on it
  const threat = game.beachheads.length
    ? (() => { const [c, r] = game.beachheads[0].split(',').map(Number); return map.get(c, r); })()
    : axis;
  for (const u of game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'blue')) {
    if (u.cls === 'ground' && typeOf(u).mov > 0 && hexDist(u, threat) <= 3 && hexDist(u, threat) >= 1) {
      const opts = moveTargets(game, map, u);
      let best = null, bd = hexDist(u, threat);
      for (const o of opts) { const dd = hexDist(o, threat); if (dd < bd) { bd = dd; best = o; } }
      if (best && bd >= 1) doMove(game, map, u, best.c, best.r);
    }
    if (u.cls === 'naval') {
      const prey = redAmphibs()[0];
      if (prey && hexDist(u, prey) > typeOf(u).rng) {
        const opts = moveTargets(game, map, u);
        let best = null, bd = hexDist(u, prey);
        for (const o of opts) { const dd = hexDist(o, prey); if (dd < bd) { bd = dd; best = o; } }
        if (best) doMove(game, map, u, best.c, best.r);
      }
    }
    if (typeOf(u).carrier) {
      // fight the carrier forward to LRASM the fleet and add air points
      const opts = moveTargets(game, map, u);
      let best = null, bd = distToTaiwan(map, u.c, u.r);
      for (const o of opts) { const dd = distToTaiwan(map, o.c, o.r); if (dd < bd && dd >= 4) { bd = dd; best = o; } }
      if (best) doMove(game, map, u, best.c, best.r);
    }
    const ts = attackTargets(game, map, u);
    if (ts.length) {
      ts.sort((a, b) => (b.cls === 'amphib' ? 2 : 1) - (a.cls === 'amphib' ? 2 : 1));
      resolveCombat(game, map, u, ts[0]);
    }
  }
  // air wings strike the fleet
  for (const w of game.units.filter(u => u.alive && u.side === 'blue' && u.cls === 'air')) {
    const ts = airStrikeTargets(game, map, w).filter(t => ['amphib', 'naval'].includes(t.cls));
    if (ts.length) {
      ts.sort((a, b) => (b.cls === 'amphib' ? 2 : 1) - (a.cls === 'amphib' ? 2 : 1));
      airStrike(game, map, w, ts[0]);
    }
  }
}

async function runGame(seed, difficulty, verbose = false, blueFn = bluePassive) {
  const { game, map } = newGame(difficulty, seed);
  while (!game.result && game.turn <= 35) {
    startTurn(game, map);
    if (game.result) break;
    blueFn(game, map);
    await runRedTurn(game, map, null);
    endOfRedPhase(game, map);
  }
  checkVictory(game, map);
  check(game.result, `game ${seed} reaches a result`);
  check(game.twWill >= 0 && game.twWill <= 100, 'twWill in range');
  check(game.prcWill >= 0 && game.prcWill <= 100, 'prcWill in range');
  check(game.red.srbm >= 0, 'srbm non-negative');
  check(game.interceptors >= 0, 'interceptors non-negative');
  for (const u of game.units) {
    if (!u.alive || u.embarkedIn) continue;
    const h = map.get(u.c, u.r);
    if (['naval', 'sub', 'amphib'].includes(u.cls)) check(h.t.water, `${u.name} on water at end (${u.c},${u.r})`);
    if (u.cls === 'ground') check(h.t.land, `${u.name} on land at end`);
  }
  if (verbose) {
    console.log(`  seed ${seed} [${difficulty}]: turn ${game.turn}, ${game.result.winner} wins (${game.result.kind}); ` +
      `tw ${game.twWill.toFixed(0)} prc ${game.prcWill.toFixed(0)} intv ${game.intervention.toFixed(0)} ` +
      `landed=${game.ai.landed} stance=${game.ai.stance}`);
  }
  return game;
}

for (const [label, fn] of [['passive blue', bluePassive], ['competent blue', blueCompetent]]) {
  const tally = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    tally[diff] = { red: 0, blue: 0, kinds: {} };
    for (let seed = 1; seed <= 12; seed++) {
      const g = await runGame(seed * 7919, diff, label === 'competent blue', fn);
      tally[diff][g.result.winner]++;
      tally[diff].kinds[g.result.kind] = (tally[diff].kinds[g.result.kind] || 0) + 1;
    }
  }
  console.log(`\nwin tally (${label}):`);
  for (const [diff, t] of Object.entries(tally)) {
    console.log(`  ${diff}: red ${t.red} / blue ${t.blue}   ${JSON.stringify(t.kinds)}`);
  }
}

// movement sanity on a fresh game
{
  const { game, map } = newGame('normal', 7);
  startTurn(game, map);
  const armor = game.units.find(u => u.tid === 'rocArm');
  const mt = moveTargets(game, map, armor);
  check(mt.length > 0, 'armor brigade has moves');
  check(mt.every(m => map.get(m.c, m.r).t.land && !map.get(m.c, m.r).t.mountain), 'armor avoids water and mountains');
  const ok = doMove(game, map, armor, mt[0].c, mt[0].r);
  check(ok, 'doMove succeeds');
  console.log('movement sanity: done');
}

// scenario smoke: the alternate wars must run to a verdict, and a passive
// defender must not be able to sit out the blockade
{
  const fxNull = new Proxy({}, { get: () => async () => {} });
  const tally = { blockade: {}, kinmen: {} };
  for (const sc of ['blockade', 'kinmen']) {
    for (let s = 1; s <= 4; s++) {
      const { game, map } = newGame('normal', s * 104729, sc);
      startTurn(game, map);
      let guard = 0;
      while (!game.result && guard++ < 40) {
        await runRedTurn(game, map, fxNull);
        endOfRedPhase(game, map);
        if (!game.result) { startTurn(game, map); checkVictory(game, map); }
      }
      if (!game.result) { failures++; console.error(`  FAIL: ${sc} seed ${s} produced no result`); }
      else tally[sc][game.result.winner] = (tally[sc][game.result.winner] || 0) + 1;
    }
  }
  console.log('scenario smoke (passive blue):', JSON.stringify(tally));
  if ((tally.blockade.blue || 0) > 1) { failures++; console.error('  FAIL: passive defender survived the blockade too often'); }
}

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall checks passed');
