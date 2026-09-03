// The PRC (red) AI. It follows PLA doctrine for a Joint Island Landing
// Campaign in phases: joint fires -> sea/air control -> amphibious assault ->
// exploitation. If the landing force is destroyed it falls back to a
// blockade-and-strangle strategy. All actions run through the rules engine;
// an async `fx` interface lets the renderer animate each step.

import { key, hexDist } from './hex.js';
import { distToTaiwan } from './map.js';
import { TYPES, DIFFICULTY } from './data.js';
import { typeOf, rnd } from './state.js';
import {
  unitsAt, surfaceUnitsAt, visibleTo, weatherNow, moveTargets, doMove,
  resolveCombat, attackTargets, attackStrength, canUnload, amphibAssault,
  airdrop, missileVolley, asbmStrike, airStrikeTargets, airStrike,
  baseDamageAt, controllerOf, log, captureSweep, triggerJapan, triggerUS,
} from './rules.js';

const NULL_FX = new Proxy({}, { get: () => async () => {} });

const BEACHES = [
  { c: 10, r: 5, name: 'Taoyuan', weight: 4, objective: { c: 11, r: 5 } },   // straight for Taipei
  { c: 10, r: 6, name: 'Hsinchu', weight: 2, objective: { c: 11, r: 5 } },
  { c: 10, r: 8, name: 'Taichung', weight: 3, objective: { c: 11, r: 5 } },
  { c: 10, r: 12, name: 'Tainan', weight: 2, objective: { c: 10, r: 13 } },
  { c: 10, r: 13, name: 'Kaohsiung', weight: 2, objective: { c: 10, r: 13 } },
  { c: 13, r: 7, name: 'Yilan', weight: 1, objective: { c: 11, r: 5 } },
];

// limited-war objectives: the offshore islands, nearest staging first
const ISLANDS = [
  { c: 2, r: 9, name: 'Kinmen', weight: 3, objective: { c: 2, r: 9 } },
  { c: 6, r: 3, name: 'Matsu', weight: 2, objective: { c: 6, r: 3 } },
  { c: 7, r: 10, name: 'Penghu', weight: 1.5, objective: { c: 7, r: 10 } },
];

function aggro(game) { return DIFFICULTY[game.difficulty].redAggro; }

function aliveRed(game, pred) {
  return game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'red' && (!pred || pred(u)));
}
function aliveBlue(game, pred) {
  return game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'blue' && (!pred || pred(u)));
}

function defenseAtBeach(game, map, b) {
  return unitsAt(game, b.c, b.r)
    .filter(u => u.side === 'blue' && u.cls === 'ground')
    .reduce((s, u) => s + typeOf(u).def * (u.hp / u.maxHp), 0);
}

function pickBeach(game, map) {
  const pool = game.ai.limited
    ? ISLANDS.filter(b => controllerOf(game, map.get(b.c, b.r)) !== 'red')
    : BEACHES;
  let best = null, bestScore = -1;
  for (const b of pool) {
    const score = b.weight * (6 / (1 + defenseAtBeach(game, map, b))) * (0.8 + rnd(game) * 0.4);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

// Move a unit as far as possible toward a destination hex.
function moveToward(game, map, u, dest, keepDist = 0) {
  const opts = moveTargets(game, map, u);
  if (!opts.length) return false;
  let best = null, bestD = hexDist(u, dest);
  for (const o of opts) {
    const dd = Math.abs(hexDist(o, dest) - keepDist);
    const cur = Math.abs(bestD - keepDist);
    if (dd < cur || (best === null && dd < Math.abs(hexDist(u, dest) - keepDist))) { best = o; bestD = hexDist(o, dest); }
  }
  if (best && !(best.c === u.c && best.r === u.r)) return doMove(game, map, u, best.c, best.r);
  return false;
}

function bestAttack(game, map, u, minRatio = 0.45) {
  const targets = attackTargets(game, map, u);
  let best = null, bestScore = 0;
  for (const t of targets) {
    const a = attackStrength(game, u, t);
    const ratio = a / Math.max(1, typeOf(t).def);
    const value = (t.cls === 'amphib' ? 0.8 : t.cls === 'naval' ? 1.4 : t.cls === 'sub' ? 1.1 : 1.0)
      * (typeOf(t).carrier ? 1.8 : 1) * ratio;
    if (ratio >= minRatio && value > bestScore) { bestScore = value; best = t; }
  }
  return best;
}

// ------------------------------------------------------------- fires phase
async function firesPhase(game, map, fx) {
  const early = game.turn <= 2;
  let budget = early ? 150 : game.ai.stance === 'strangle' ? 70 : 90;
  budget = Math.min(budget, game.red.srbm + game.red.lacm);
  if (budget <= 15) return;

  const targets = [];
  // operational airbases with blue wings are the priority
  const bases = [];
  for (const h of map.hexes.values()) {
    if (!h.loc?.airbase || h.t.region === 'prc') continue;
    if (h.t.region === 'jp' || h.t.region === 'ph') continue; // handled by escalation logic
    if (controllerOf(game, h) === 'red') continue;
    const wings = unitsAt(game, h.c, h.r).filter(u => u.cls === 'air' && u.side === 'blue');
    const dmg = baseDamageAt(game, h.c, h.r);
    if (dmg < 3) bases.push({ h, score: wings.length * 3 + (3 - dmg) });
  }
  bases.sort((a, b) => b.score - a.score);
  for (const b of bases.slice(0, early ? 3 : 2)) targets.push({ hex: b.h, kind: 'airbase', n: early ? 45 : 35 });
  if (early) {
    targets.push({ hex: map.get(11, 5), kind: 'sam', n: 35 }); // IADS suppression around Taipei
    targets.push({ hex: map.get(10, 13), kind: 'port', n: 25 }); // Kaohsiung port
  } else if (game.ai.stance === 'strangle' || (game.twWill < 55 && aggro(game) >= 1.0 && game.turn > 6)) {
    targets.push({ hex: map.get(11, 5), kind: 'city', n: 30 }); // coercive strikes on the capital
  } else {
    targets.push({ hex: map.get(10, 13), kind: 'port', n: 20 });
  }
  for (const t of targets) {
    if (budget <= 0) break;
    const n = Math.min(t.n, budget);
    budget -= n;
    const res = missileVolley(game, map, n, t.hex, t.kind);
    if (res) await fx.missiles(t.hex, res);
  }
  // ASBM shots at high-value naval targets
  const carriers = aliveBlue(game, u => typeOf(u).carrier || (u.cls === 'naval' && typeOf(u).def >= 7));
  if (carriers.length && game.red.asbm > 0 && rnd(game) < 0.75) {
    const target = carriers.sort((a, b) => distToTaiwan(map, a.c, a.r) - distToTaiwan(map, b.c, b.r))[0];
    if (distToTaiwan(map, target.c, target.r) <= 8) {
      const res = asbmStrike(game, target);
      if (res) await fx.asbm(target, res);
    }
  }
  // Counter-battery hunt against Taiwan's mobile coastal-missile launchers
  if (game.turn >= 2 && game.pools.ascm > 3 && aggro(game) >= 1.0 && game.red.srbm > 200) {
    const res = missileVolley(game, map, 25, map.get(10, 9), 'ascm');
    if (res) await fx.missiles(map.get(10, 9), res);
  }
  // The Kadena dilemma: once US airpower is in the fight, striking Okinawa
  // is doctrinally sound — but it guarantees Japanese entry.
  if (aggro(game) >= 1.1 && game.usEntered && !game.jpEntered && rnd(game) < 0.25) {
    const kadena = map.get(17, 0);
    const res = missileVolley(game, map, 40, kadena, 'airbase');
    if (res) await fx.missiles(kadena, res);
  }
}

// --------------------------------------------------------------- air phase
async function airPhase(game, map, fx) {
  if (weatherNow(game).id === 'typhoon') return;
  for (const wing of aliveRed(game, u => u.cls === 'air')) {
    if (!typeOf(wing).strike || wing.attacked) continue;
    const targets = airStrikeTargets(game, map, wing);
    if (!targets.length) continue;
    let best = null, bestScore = 0;
    for (const t of targets) {
      let score = 0;
      if (typeOf(t).carrier) score = 9;
      else if (t.cls === 'naval') score = typeOf(t).def >= 7 ? 6 : 8;
      else if (t.cls === 'sub') score = 5;
      else if (t.cls === 'ground' && game.ai.beach && hexDist(t, game.ai.beach) <= 1) score = 7.5;
      else if (t.cls === 'ground') score = 2.5;
      score *= 0.8 + rnd(game) * 0.4;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best && bestScore > 2) {
      const res = airStrike(game, map, wing, best);
      await fx.strike(wing, best, res);
    }
  }
}

// -------------------------------------------------------------- subs phase
async function subPhase(game, map, fx) {
  for (const sub of aliveRed(game, u => u.cls === 'sub')) {
    const t = bestAttack(game, map, sub, 0.5);
    if (t) { const res = resolveCombat(game, map, sub, t); await fx.attack(sub, t, res); continue; }
    const prey = aliveBlue(game, u => u.cls === 'naval' || u.cls === 'amphib');
    if (prey.length) {
      prey.sort((a, b) => hexDist(sub, a) - hexDist(sub, b));
      moveToward(game, map, sub, prey[0]);
      await fx.moved(sub);
      const t2 = bestAttack(game, map, sub, 0.5);
      if (t2) { const res = resolveCombat(game, map, sub, t2); await fx.attack(sub, t2, res); }
    }
  }
}

// -------------------------------------------------------------- navy phase
async function navyPhase(game, map, fx) {
  const beach = game.ai.beach;
  for (const ship of aliveRed(game, u => u.cls === 'naval')) {
    const isCV = typeOf(ship).carrier;
    // shoot first if something juicy is in range
    let t = bestAttack(game, map, ship, isCV ? 0.7 : 0.5);
    if (t) { const res = resolveCombat(game, map, ship, t); await fx.attack(ship, t, res); continue; }
    // otherwise position
    if (game.ai.stance === 'strangle') {
      // enforce the blockade ring
      moveToward(game, map, ship, { c: 10, r: 9 }, isCV ? 5 : 2);
    } else if (beach) {
      const standoff = landingReady(game) || game.ai.landed ? 1 : 4;
      moveToward(game, map, ship, beach, isCV ? 4 : standoff);
    }
    await fx.moved(ship);
    t = bestAttack(game, map, ship, isCV ? 0.7 : 0.55);
    if (t) { const res = resolveCombat(game, map, ship, t); await fx.attack(ship, t, res); }
  }
}

// ------------------------------------------------------------ amphib phase
function escortsNear(game, hex, d = 2) {
  return aliveRed(game, u => u.cls === 'naval' && !typeOf(u).carrier).filter(s => hexDist(s, hex) <= d).length;
}

// Is the invasion window open? Shared by the navy (escort posture) and the
// amphibious group (commit decision). Until it opens, the fleet stages
// outside Taiwan's coastal-missile envelope (range 3).
function landingReady(game) {
  const commitTurn = aggro(game) >= 1.15 ? 2 : 3;
  return game.turn >= commitTurn && weatherNow(game).amphib &&
    game.airSup >= (aggro(game) >= 1.1 ? 0 : 1);
}

async function amphibPhase(game, map, fx) {
  if (game.ai.stance === 'strangle') return;
  const beach = game.ai.beach && map.get(game.ai.beach.c, game.ai.beach.r);
  if (!beach) return;
  const loaded = aliveRed(game, u => u.cls === 'amphib' && u.cargo.length > 0);

  const islandSpot = spots => spots.find(s => s.loc?.island && controllerOf(game, s) !== 'red');
  for (const flot of loaded) {
    // Can we assault this turn?
    const spots = canUnload(game, map, flot);
    const target = game.ai.limited ? islandSpot(spots) : (
      spots.find(s => s.c === beach.c && s.r === beach.r) ||
      spots.find(s => map.isTaiwanMain(s)) ||
      (aggro(game) >= 0.95 ? islandSpot(spots) : null));
    // a limited war doesn't wait for air superiority — speed is the whole point
    const ready = game.ai.limited ? (game.turn >= 2 && weatherNow(game).amphib) : landingReady(game);
    // islands under the mainland's guns need no escort; Penghu, in reach of Taiwan's
    // missiles and jets, gets the full package
    const unescorted = t => game.ai.limited && distToTaiwan(map, t.c, t.r) > 4;
    if (target && ready && (escortsNear(game, flot, 2) >= 1 || aggro(game) >= 1.1 || unescorted(target))) {
      log(game, `${flot.name} commits to the landing at ${target.loc?.name || key(target.c, target.r)}!`, 'alert', 'red');
      const results = amphibAssault(game, map, flot, target);
      await fx.landing(flot, target, results);
      continue;
    }
    // Close for the run-in when the window is open; otherwise stage outside
    // the coastal-missile envelope
    if (game.turn >= 2) {
      moveToward(game, map, flot, beach, ready ? 1 : 4);
      await fx.moved(flot);
      // try again after the move
      const spots2 = canUnload(game, map, flot);
      const t2 = game.ai.limited ? islandSpot(spots2)
        : (spots2.find(s => s.c === beach.c && s.r === beach.r) || spots2.find(s => map.isTaiwanMain(s)));
      if (t2 && ready && (escortsNear(game, flot, 2) >= 1 || unescorted(t2))) {
        log(game, `${flot.name} commits to the landing at ${t2.loc?.name || key(t2.c, t2.r)}!`, 'alert', 'red');
        const results = amphibAssault(game, map, flot, t2);
        await fx.landing(flot, t2, results);
      }
    }
  }
  // Empty flotillas loiter at the beachhead as the supply train
  for (const flot of aliveRed(game, u => u.cls === 'amphib' && u.cargo.length === 0)) {
    if (hexDist(flot, beach) > 1) { moveToward(game, map, flot, beach, 1); await fx.moved(flot); }
  }
}

// ---------------------------------------------------------- airborne phase
async function airbornePhase(game, map, fx) {
  if (game.airSup < 1 && aggro(game) < 1.1) return;
  const troops = aliveRed(game, u => typeOf(u).airborne && !u.attacked && map.get(u.c, u.r).t.region === 'prc');
  if (!troops.length) return;
  // Kinmen coup de main early; main-island drops once the landing is in
  for (const u of troops) {
    const coupWindow = game.ai.limited ? game.turn >= 2 : (game.turn === 2 && aggro(game) >= 0.95);
    if (coupWindow && !game.kinmenTaken) {
      const kinmen = map.get(2, 9);
      if (controllerOf(game, kinmen) !== 'red' && hexDist(u, kinmen) <= 4) {
        const res = airdrop(game, map, u, kinmen);
        await fx.drop(u, kinmen, res);
        const gar = unitsAt(game, kinmen.c, kinmen.r).find(x => x.side === 'blue' && x.cls === 'ground');
        if (gar && u.alive) { const r2 = resolveCombat(game, map, u, gar); await fx.attack(u, gar, r2); }
        continue;
      }
    }
    if (game.ai.landed && game.ai.beach) {
      const beach = game.ai.beach;
      // drop on a lightly-defended objective near the beachhead
      let best = null, bestScore = -1;
      for (const h of map.hexes.values()) {
        if (!h.t.land || !map.isTaiwanMain(h)) continue;
        if (hexDist(h, beach) > 2) continue;
        if (h.t.mountain) continue;
        const defs = unitsAt(game, h.c, h.r).filter(x => x.side === 'blue' && x.cls === 'ground');
        const defPow = defs.reduce((s, x) => s + typeOf(x).def * (x.hp / x.maxHp), 0);
        if (defPow > 4) continue;
        const score = (h.loc?.airbase ? 3 : 0) + (h.loc?.city ? 2 : 0) + (h.loc?.capital ? 6 : 0) - defPow + rnd(game);
        if (score > bestScore) { bestScore = score; best = h; }
      }
      if (best) {
        const res = airdrop(game, map, u, best);
        await fx.drop(u, best, res);
        const def = unitsAt(game, best.c, best.r).find(x => x.side === 'blue' && x.cls === 'ground');
        if (def && u.alive) { const r2 = resolveCombat(game, map, u, def); await fx.attack(u, def, r2); }
      }
    }
  }
}

// ------------------------------------------------------------ ground phase
async function groundPhase(game, map, fx) {
  const objectiveFor = (u) => {
    if (game.ai.beach?.objective) return game.ai.beach.objective;
    return { c: 11, r: 5 }; // Taipei
  };
  for (const u of aliveRed(game, x => x.cls === 'ground' && map.get(x.c, x.r).t.region !== 'prc')) {
    if (u.attacked) continue;
    let t = bestAttack(game, map, u, 0.4);
    if (t) { const res = resolveCombat(game, map, u, t); await fx.attack(u, t, res); continue; }
    const beachHexKey = game.ai.beach && key(game.ai.beach.c, game.ai.beach.r);
    const holdBeach = beachHexKey === key(u.c, u.r) &&
      surfaceUnitsAt(game, u.c, u.r).filter(x => x.side === 'red' && x.cls === 'ground').length <= 1 &&
      game.units.some(x => x.alive && x.embarkedIn); // hold the door open for the follow-on echelon
    if (!holdBeach) {
      moveToward(game, map, u, objectiveFor(u));
      await fx.moved(u);
      t = bestAttack(game, map, u, 0.45);
      if (t) { const res = resolveCombat(game, map, u, t); await fx.attack(u, t, res); }
    }
  }
  captureSweep(game, map);
}

// --------------------------------------------------------------- strategy
function updateStance(game, map) {
  if (game.ai.blockadeOnly) { game.ai.stance = 'strangle'; return; }
  if (game.ai.limited) {
    // the next island still in ROC hands is always the objective
    const cur = game.ai.beach && map.get(game.ai.beach.c, game.ai.beach.r);
    if (!cur || controllerOf(game, cur) === 'red') game.ai.beach = pickBeach(game, map);
    game.ai.stance = game.ai.beach ? 'seaControl' : 'strangle';
    return;
  }
  const amphAlive = game.units.some(u => u.alive && u.cls === 'amphib');
  const troopsAtSea = game.units.some(u => u.alive && u.embarkedIn);
  const ashore = game.units.some(u => u.alive && u.side === 'red' && u.cls === 'ground' &&
    map.isTaiwanMain(map.get(u.c, u.r)));
  if (!amphAlive && !troopsAtSea && !ashore) {
    if (game.ai.stance !== 'strangle') {
      game.ai.stance = 'strangle';
      log(game, 'With the landing force lost, Beijing shifts to blockade and bombardment: the strangulation strategy.', 'alert', 'red');
    }
  } else if (game.ai.landed) {
    game.ai.stance = 'exploit';
  } else if (game.turn >= 3) {
    game.ai.stance = 'seaControl';
  }
  // If the chosen beach turned into a fortress, reconsider once
  if (!game.ai.landed && game.ai.beach && game.turn >= 4 && !game.ai.rebeached) {
    const b = game.ai.beach;
    if (defenseAtBeach(game, map, b) >= 9) {
      game.ai.rebeached = true;
      game.ai.beach = pickBeach(game, map);
      log(game, 'PLA reconnaissance reports the landing zone heavily reinforced. The invasion fleet shifts axis.', 'info', 'red');
    }
  }
}

export async function runRedTurn(game, map, fx) {
  const F = fx || NULL_FX;
  game.phase = 'red';
  if (!game.ai.beach) {
    game.ai.beach = pickBeach(game, map);
    log(game, game.ai.blockadeOnly
      ? 'PLA Eastern Theater Command declares a maritime quarantine of Taiwan.'
      : game.ai.limited ? 'PLA Eastern Theater Command orders the seizure of the offshore islands.'
        : 'PLA Eastern Theater Command finalizes the landing plan.', 'info', 'red');
  }
  if (game.revealRedPlan && !game.ai.planRevealed) {
    game.ai.planRevealed = true;
    log(game, `INTELLIGENCE: the defector confirms the PLA main landing is aimed at ${game.ai.beach.name}.`, 'event', 'blue');
  }
  await F.banner('PRC TURN — PLA Joint Operations');
  await firesPhase(game, map, F);
  await airPhase(game, map, F);
  await subPhase(game, map, F);
  await navyPhase(game, map, F);
  await amphibPhase(game, map, F);
  await airbornePhase(game, map, F);
  await groundPhase(game, map, F);
  updateStance(game, map);
  game.phase = 'blue';
}
