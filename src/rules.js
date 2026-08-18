// The rules engine: movement, combat, fires, amphibious operations, the
// strategic tracks (intervention, political will, blockade/supply) and
// victory conditions. Pure logic — no rendering. Functions return result
// descriptors that the UI/FX layer animates.

import { key, hexDist, hexesInRange } from './hex.js';
import { distToTaiwan } from './map.js';
import { TYPES, CONST, WEATHER, EVENTS, RED_REINFORCEMENTS, US_PACKAGE, US_SECOND_CSG, JP_PACKAGE, US_KADENA_WING } from './data.js';
import { makeUnit, typeOf, rnd, d } from './state.js';

export const enemyOf = side => (side === 'red' ? 'blue' : 'red');
export const isBlueSide = side => side !== 'red'; // blue/us/jp coalition — single 'blue' side in practice

export function log(game, text, kind = 'info', side = null) {
  game.log.push({ turn: game.turn, text, kind, side });
  if (game.log.length > 400) game.log.splice(0, 100);
}

// ------------------------------------------------------------ queries
export function unitsAt(game, c, r) {
  return game.units.filter(u => u.alive && !u.embarkedIn && u.c === c && u.r === r);
}
export function surfaceUnitsAt(game, c, r) {
  return unitsAt(game, c, r).filter(u => u.cls !== 'air');
}
export function visibleTo(u, viewerSide) {
  if (u.side === viewerSide) return true;
  return !(u.cls === 'sub' && u.hidden);
}
export function weatherNow(game) {
  return WEATHER.find(w => w.id === game.weather) || WEATHER[0];
}
export function baseDamageAt(game, c, r) { return game.baseDamage[key(c, r)] || 0; }

export function controllerOf(game, hex) {
  if (!hex.loc) return null;
  const flip = game.control[key(hex.c, hex.r)];
  if (flip) return flip;
  return hex.loc.side === 'red' ? 'red' : 'blue';
}

export function friendlyAirbases(game, map, side) {
  const out = [];
  for (const h of map.hexes.values()) {
    if (!h.loc?.airbase) continue;
    const ctrl = controllerOf(game, h);
    if ((side === 'red') === (ctrl === 'red')) {
      if (side === 'blue' && (h.t.region === 'jp' || h.t.region === 'ph')) {
        // allied bases usable only once unlocked
        if (h.t.region === 'jp' && !game.jpEntered) continue;
        if (h.t.region === 'ph' && !game.usEntered) continue;
      }
      out.push(h);
    }
  }
  return out;
}

// ------------------------------------------------------------ movement
function moveCost(u, hex) {
  const t = typeOf(u);
  if (t.cls === 'air') return Infinity;
  if (t.cls === 'naval' || t.cls === 'sub' || t.cls === 'amphib') {
    return hex.t.water ? 1 : Infinity;
  }
  // ground
  if (hex.t.water) return Infinity;
  if (hex.t.mountain) return t.armor ? Infinity : 2;
  return 1;
}

export function moveTargets(game, map, u) {
  const t = typeOf(u);
  const budget = (t.mov || 0) - u.moved;
  if (budget <= 0 || u.attacked || t.cls === 'air') return [];
  const dist = new Map([[key(u.c, u.r), 0]]);
  const frontier = [{ c: u.c, r: u.r }];
  const out = [];
  while (frontier.length) {
    const cur = frontier.shift();
    const dCur = dist.get(key(cur.c, cur.r));
    for (const n of map.neighborsOf(cur.c, cur.r)) {
      const k = key(n.c, n.r);
      if (dist.has(k)) continue;
      const cost = moveCost(u, n);
      if (dCur + cost > budget) continue;
      const occ = surfaceUnitsAt(game, n.c, n.r);
      const enemyHere = occ.some(o => (o.side === 'red') !== (u.side === 'red') && visibleTo(o, u.side));
      if (enemyHere) continue;
      const friendly = occ.filter(o => (o.side === 'red') === (u.side === 'red'));
      const full = friendly.length >= 2;
      dist.set(k, dCur + cost);
      if (!full) out.push({ c: n.c, r: n.r, cost: dCur + cost });
      if (!full || occ.length === 0) frontier.push(n);
    }
  }
  return out;
}

export function doMove(game, map, u, c, r) {
  const legal = moveTargets(game, map, u).find(m => m.c === c && m.r === r);
  if (!legal) return false;
  u.c = c; u.r = r; u.moved += legal.cost;
  for (const cid of u.cargo || []) {
    const cu = game.units.find(x => x.id === cid);
    if (cu) { cu.c = c; cu.r = r; }
  }
  if (u.cls === 'sub') u.hidden = u.revealedTimer <= 0;
  return true;
}

// Air wings may redeploy between friendly airbases (uses their whole turn).
export function rebaseTargets(game, map, u) {
  if (typeOf(u).cls !== 'air' || u.attacked || u.moved) return [];
  return friendlyAirbases(game, map, u.side === 'red' ? 'red' : 'blue')
    .filter(h => key(h.c, h.r) !== key(u.c, u.r))
    .filter(h => unitsAt(game, h.c, h.r).filter(x => x.cls === 'air' && x.side === u.side).length < 2)
    .map(h => ({ c: h.c, r: h.r }));
}
export function doRebase(game, map, u, c, r) {
  if (!rebaseTargets(game, map, u).some(h => h.c === c && h.r === r)) return false;
  u.c = c; u.r = r; u.base = key(c, r); u.moved = 99; u.attacked = true;
  return true;
}

// ------------------------------------------------------------ combat
function terrainDefMod(map, def) {
  const hex = map.get(def.c, def.r);
  let m = 1.0;
  if (hex.t.urban) m = 1.5;
  else if (hex.t.mountain) m = 1.7;
  else if (hex.ch === 'h' || hex.ch === 'm') m = 1.25;
  if (typeOf(def).fortress) m *= 1.7;
  return m;
}

function supMod(game, side, forAttack) {
  // game.airSup: + favors red, - favors blue
  const adv = side === 'red' ? game.airSup : -game.airSup;
  return 1 + (forAttack ? 0.10 : 0.05) * Math.max(-3, Math.min(3, adv));
}

function frac(u) { return u.hp / u.maxHp; }

export function attackStrength(game, atk, def) {
  const t = typeOf(atk);
  const targetSea = def.cls === 'naval' || def.cls === 'sub' || def.cls === 'amphib';
  let a = targetSea ? (t.att?.sea || 0) : (t.att?.grd || 0);
  if (!a) return 0;
  a *= Math.pow(frac(atk), 0.7);
  a *= supMod(game, atk.side, true);
  if (t.cls === 'naval' || t.cls === 'sub' || t.cls === 'amphib') a *= weatherNow(game).seaMod;
  if (atk.side === 'blue' && atk.cls === 'ground' && game.supply < 25) a *= 0.8;
  if (atk.cls === 'sub') a *= 1.35; // torpedo/ASCM ambush
  if (atk.side === 'red' && atk.cls === 'ground' && isCutOff(game, atk)) a *= 0.5;
  return a;
}

export function attackTargets(game, map, u) {
  const t = typeOf(u);
  if (u.attacked || !t.rng) return [];
  const out = [];
  for (const h of hexesInRange(u.c, u.r, t.rng)) {
    if (!map.inBounds(h.c, h.r)) continue;
    for (const e of unitsAt(game, h.c, h.r)) {
      if ((e.side === 'red') === (u.side === 'red')) continue;
      if (!visibleTo(e, u.side)) continue;
      if (e.cls === 'air') continue; // aircraft are hit via strikes/missiles/base capture
      if (attackStrength(game, u, e) <= 0) continue;
      // ground units cannot fight across water
      if (u.cls === 'ground' && (e.cls !== 'ground') && !typeOf(u).coastal) continue;
      if (u.cls === 'ground' && e.cls === 'ground') {
        const eh = map.get(e.c, e.r);
        if (eh.t.water) continue;
      }
      out.push(e);
    }
  }
  return out;
}

function applyDamage(game, u, steps) {
  const lost = Math.min(u.hp, steps);
  u.hp -= lost;
  if (u.hp <= 0) {
    u.alive = false;
    for (const cid of u.cargo || []) {
      const cu = game.units.find(x => x.id === cid);
      if (cu) cu.alive = false; // embarked troops go down with the ships
    }
  }
  // political cost of losses
  const w = { naval: 1.2, amphib: 1.5, ground: 0.45, sub: 1.0, air: 0.8 }[u.cls] || 0.5;
  if (u.side === 'red') game.prcWill -= w * lost;
  else game.twWill -= w * lost * 0.45; // Taiwan absorbs losses with higher resolve
  return lost;
}

function rollSteps(game, dmg, defEff) {
  const ratio = dmg / Math.max(0.1, defEff);
  let steps = Math.floor(ratio);
  if (rnd(game) < ratio - steps) steps += 1;
  return steps;
}

export function resolveCombat(game, map, atk, def) {
  const res = { atk: atk.id, def: def.id, atkLost: 0, defLost: 0, defKilled: false, atkKilled: false };
  const a = attackStrength(game, atk, def);
  const defEff = typeOf(def).def * terrainDefMod(map, def) * Math.pow(frac(def), 0.3) * supMod(game, def.side, false);
  const dmg = a * (0.7 + rnd(game) * 0.6);
  res.defLost = applyDamage(game, def, rollSteps(game, dmg, defEff));
  atk.attacked = true; atk.moved = 99;
  if (atk.cls === 'sub') { atk.hidden = false; atk.revealedTimer = 2; }
  // counterattack
  if (def.alive && !(def.cls === 'sub' && atk.cls !== 'sub')) {
    const t = typeOf(def);
    if (t.rng && hexDist(atk, def) <= t.rng && attackStrength(game, def, atk) > 0) {
      const ca = attackStrength(game, def, atk) * 0.6;
      const atkEff = typeOf(atk).def * terrainDefMod(map, atk) * Math.pow(frac(atk), 0.3);
      res.atkLost = applyDamage(game, atk, rollSteps(game, ca * (0.7 + rnd(game) * 0.6), atkEff));
    }
  }
  res.defKilled = !def.alive; res.atkKilled = !atk.alive;
  log(game, `${atk.name} engages ${def.name}: ` +
    `${def.name} ${res.defKilled ? 'DESTROYED' : `-${res.defLost} step${res.defLost === 1 ? '' : 's'}`}` +
    (res.atkLost ? `; return fire costs ${atk.name} ${res.atkLost}` : ''),
    'combat', atk.side);
  captureSweep(game, map);
  return res;
}

// ---------------------------------------------------------- amphibious ops
export function canUnload(game, map, flot) {
  if (!flot.alive || flot.cls !== 'amphib' || !flot.cargo.length) return [];
  if (!weatherNow(game).amphib) return [];
  const out = [];
  for (const n of map.neighborsOf(flot.c, flot.r)) {
    if (!n.t.land) continue;
    if (n.loc?.beach || n.loc?.island || (n.loc?.port && controllerOf(game, n) === 'red')) out.push(n);
  }
  return out;
}

export function amphibAssault(game, map, flot, hex) {
  const results = [];
  const k = key(hex.c, hex.r);
  // minefields batter the landing force
  const mines = game.mines[k] || 0;
  for (let i = 0; i < mines; i++) {
    if (rnd(game) < 0.55) {
      applyDamage(game, flot, 1);
      log(game, `Landing craft strike mines off ${hex.loc?.name || 'the beach'}! ${flot.name} -1 step`, 'combat', 'blue');
      results.push({ kind: 'mine', hex });
    }
  }
  if (!flot.alive) { captureSweep(game, map); return results; }
  const defenders = unitsAt(game, hex.c, hex.r).filter(u => u.side === 'blue' && u.cls === 'ground');
  const troopsIds = [...flot.cargo];
  for (const tid of troopsIds) {
    const troop = game.units.find(u => u.id === tid);
    if (!troop || !troop.alive) continue;
    const def = defenders.find(dd => dd.alive);
    if (def) {
      // opposed landing: defender gets +60% defense, attacker exposed
      const a = attackStrength(game, troop, def) * 0.85;
      const defEff = typeOf(def).def * terrainDefMod(map, def) * 1.6 * Math.pow(frac(def), 0.3);
      const defLost = applyDamage(game, def, rollSteps(game, a * (0.7 + rnd(game) * 0.6), defEff));
      const counter = attackStrength(game, def, troop) * 0.9;
      const atkEff = typeOf(troop).def * 0.8; // no cover on the beach
      const atkLost = applyDamage(game, troop, rollSteps(game, counter * (0.7 + rnd(game) * 0.6), atkEff));
      log(game, `${troop.name} storms ${hex.loc?.name || 'the beach'}: defender -${defLost}, landing force -${atkLost}`, 'combat', 'red');
      results.push({ kind: 'assault', troop: troop.id, def: def.id, defLost, atkLost });
      if (!troop.alive) { flot.cargo = flot.cargo.filter(x => x !== tid); continue; }
      if (def.alive) {
        // beach held — troops fall back aboard if the wave fails
        continue;
      }
    }
    // ashore
    troop.embarkedIn = null; troop.c = hex.c; troop.r = hex.r; troop.moved = 99; troop.attacked = true;
    flot.cargo = flot.cargo.filter(x => x !== tid);
    if (!game.beachheads.includes(k) && map.isTaiwanMain(hex)) {
      game.beachheads.push(k);
      log(game, `PLA forces establish a beachhead at ${hex.loc?.name || k}!`, 'alert', 'red');
    }
    game.ai.landed = game.ai.landed || map.isTaiwanMain(hex);
    results.push({ kind: 'landed', troop: troop.id, hex });
    if (surfaceUnitsAt(game, hex.c, hex.r).filter(u => u.side === 'red').length >= 2) break;
  }
  flot.attacked = true; flot.moved = 99;
  captureSweep(game, map);
  return results;
}

export function isCutOff(game, u) {
  if (u.side !== 'red' || u.cls !== 'ground') return false;
  const srcs = [...game.beachheads];
  for (const [k, ctrl] of Object.entries(game.control)) {
    if (ctrl === 'red') srcs.push(k);
  }
  return !srcs.some(k => {
    const [c, r] = k.split(',').map(Number);
    return hexDist(u, { c, r }) <= 4;
  });
}

// airborne assault: red only, onto airbase/city/plain hex within 6 of a red airbase
export function airdrop(game, map, u, hex) {
  if (!typeOf(u).airborne || u.attacked) return null;
  const defenders = unitsAt(game, hex.c, hex.r).filter(x => x.side === 'blue' && x.cls !== 'air');
  u.c = hex.c; u.r = hex.r; u.moved = 99; u.attacked = true;
  let lost = 0;
  // dropping into defended airspace is costly; contested LZ worse
  const flakChance = game.airSup >= 2 ? 0.25 : game.airSup >= 0 ? 0.45 : 0.75;
  if (rnd(game) < flakChance) lost += applyDamage(game, u, 1);
  if (defenders.length && u.alive) lost += applyDamage(game, u, 1);
  log(game, `${u.name} conducts airborne assault on ${hex.loc?.name || key(hex.c, hex.r)}${lost ? ` (-${lost} step${lost > 1 ? 's' : ''} on the drop)` : ''}`, 'alert', 'red');
  captureSweep(game, map);
  return { lost, contested: defenders.length > 0 };
}

// ------------------------------------------------------------- fires
// PLARF ballistic/cruise missile volley against a hex target.
export function missileVolley(game, map, n, hex, kind) {
  n = Math.min(n, game.red.srbm + game.red.lacm);
  if (n <= 0) return null;
  const fromSrbm = Math.min(n, game.red.srbm);
  game.red.srbm -= fromSrbm; game.red.lacm -= (n - fromSrbm);
  const onTaiwan = hex.t.region === 'tw';
  let kills = 0, expended = 0;
  if (onTaiwan && game.interceptors > 0) {
    const attempted = Math.min(game.interceptors, Math.round(n * 0.8));
    kills = Math.round(attempted * 0.62);
    expended = attempted;
    game.interceptors = Math.max(0, game.interceptors - expended);
  } else if (hex.t.region === 'jp' && game.jpEntered) {
    kills = Math.round(n * 0.5); // Aegis/PAC-3 at Kadena
  }
  const leakers = Math.max(0, n - kills);
  const k = key(hex.c, hex.r);
  const res = { n, kills, leakers, hex, kind };
  if (kind === 'airbase' || kind === 'port') {
    game.baseDamage[k] = Math.min(4, (game.baseDamage[k] || 0) + leakers / 12);
    for (const w of unitsAt(game, hex.c, hex.r).filter(u => u.cls === 'air' && u.side === 'blue')) {
      const sheltered = hex.loc?.shelters;
      if (rnd(game) < leakers / (sheltered ? 120 : 45)) { applyDamage(game, w, 1); res.wingHit = w.name; }
    }
    if (kind === 'port') { game.supply -= leakers / 10; game.twWill -= leakers / 40; }
  } else if (kind === 'city') {
    game.twWill -= leakers / 11;
    game.intervention += leakers / 22; // strikes on cities harden outside opinion
    game.prcWill -= leakers / 45;
  } else if (kind === 'sam') {
    game.interceptors = Math.max(0, game.interceptors - Math.round(leakers * 1.6));
  } else if (kind === 'ascm') {
    // hunting mobile Hsiung Feng launchers — hard targets, modest returns
    game.pools.ascm = Math.max(0, game.pools.ascm - Math.round(leakers / 10));
  }
  if (hex.t.region === 'jp') {
    triggerJapan(game, map, 'PLA missiles strike Japanese territory');
    triggerUS(game, map, 'US forces on Okinawa attacked');
  }
  log(game, `PLARF volley: ${n} missiles at ${hex.loc?.name || k} — ${kills} intercepted, ${leakers} leakers (${kind})`, 'missile', 'red');
  return res;
}

// Anti-ship ballistic missile shot (DF-21D/DF-26) at a naval unit.
export function asbmStrike(game, target) {
  const shots = Math.min(8, game.red.asbm);
  if (shots <= 0) return null;
  game.red.asbm -= shots;
  const aegis = typeOf(target).def >= 7 ? 0.55 : 1.0;
  const pHit = Math.min(0.85, shots * 0.07 * aegis * (game.airSup > 0 ? 1.2 : 0.9));
  let steps = 0;
  if (rnd(game) < pHit) steps = 1 + (rnd(game) < 0.4 ? 1 : 0);
  const lost = steps ? applyDamage(game, target, steps) : 0;
  if (target.side !== 'red') triggerUS(game, null, `Anti-ship ballistic missiles target ${target.name}`);
  log(game, steps
    ? `DF-26 salvo strikes ${target.name}! ${lost} step${lost > 1 ? 's' : ''} lost${target.alive ? '' : ' — SUNK'}`
    : `DF-26 salvo splashes around ${target.name} — defeated by Aegis and decoys`, 'missile', 'red');
  return { shots, steps, target: target.id };
}

// Blue standoff pools.
export function blueSalvo(game, map, pool, target) {
  if (game.pools[pool] <= 0) return null;
  const power = { ascm: 7, lrasm: 9 }[pool];
  if (!power) return null;
  if (pool === 'ascm' && distToTaiwan(map, target.c, target.r) > 3) return null;
  game.pools[pool] -= 1;
  const penal = game.blueStrikePenalty > 0 ? 0.75 : 1.0;
  const a = power * penal * (0.7 + rnd(game) * 0.6);
  const defEff = typeOf(target).def * Math.pow(frac(target), 0.3);
  const lost = applyDamage(game, target, rollSteps(game, a, defEff));
  log(game, `${pool === 'ascm' ? 'Hsiung Feng coastal missile salvo' : 'LRASM strike from Guam bombers'} hits ${target.name}: ` +
    `${target.alive ? `-${lost} step${lost === 1 ? '' : 's'}` : 'SUNK'}`, 'missile', 'blue');
  return { lost, killed: !target.alive };
}

export function tlamStrike(game, map, hex) {
  if (game.pools.tlam <= 0) return null;
  if (hex.t.region === 'prc' && !game.deepStrike) return null;
  game.pools.tlam -= 1;
  const k = key(hex.c, hex.r);
  game.baseDamage[k] = Math.min(4, (game.baseDamage[k] || 0) + 2);
  let wingHit = null;
  for (const w of unitsAt(game, hex.c, hex.r).filter(u => u.cls === 'air' && u.side === 'red')) {
    if (rnd(game) < 0.6) { applyDamage(game, w, 1); wingHit = w.name; break; }
  }
  if (hex.t.region === 'prc' && !game.homelandStruck) {
    game.homelandStruck = true;
    game.prcWill = Math.min(100, game.prcWill + 5); // rally-round-the-flag
    log(game, 'US cruise missiles strike the Chinese mainland. Beijing rallies public outrage.', 'alert', 'blue');
  }
  log(game, `Tomahawk strike on ${hex.loc?.name || k}${wingHit ? ` — ${wingHit} catches it on the ground` : ''}`, 'missile', 'blue');
  return { hex, wingHit };
}

// Air wing strike mission.
export function airStrikeTargets(game, map, wing) {
  const t = typeOf(wing);
  if (!t.strike || wing.attacked) return [];
  const radius = t.short === 'H-6K' ? 10 : 6;
  const dmgAtBase = baseDamageAt(game, wing.c, wing.r);
  if (dmgAtBase >= 3.5) return []; // runways cratered
  const out = [];
  for (const h of hexesInRange(wing.c, wing.r, radius)) {
    if (!map.inBounds(h.c, h.r)) continue;
    for (const e of unitsAt(game, h.c, h.r)) {
      if ((e.side === 'red') === (wing.side === 'red')) continue;
      if (e.cls === 'air' || !visibleTo(e, wing.side)) continue;
      out.push(e);
    }
  }
  return out;
}

export function airStrike(game, map, wing, target) {
  const t = typeOf(wing);
  const wx = weatherNow(game);
  const naval = target.cls === 'naval' || target.cls === 'amphib' || target.cls === 'sub';
  let a = t.strike * (naval ? 1 : 0.8) * frac(wing) * wx.airMod * supMod(game, wing.side, true);
  a *= (1 - baseDamageAt(game, wing.c, wing.r) / 6);
  const defEff = typeOf(target).def * terrainDefMod(map, target) * Math.pow(frac(target), 0.3);
  const lost = applyDamage(game, target, rollSteps(game, a * (0.7 + rnd(game) * 0.6), defEff));
  wing.attacked = true;
  let attrition = 0;
  const flak = typeOf(target).def >= 6 ? 0.22 : 0.1;
  if (rnd(game) < flak * (wing.side === 'red' ? (game.airSup < 0 ? 1.5 : 1) : (game.airSup > 0 ? 1.5 : 1))) {
    attrition = applyDamage(game, wing, 1);
  }
  log(game, `${wing.name} strikes ${target.name}: ${target.alive ? `-${lost} step${lost === 1 ? '' : 's'}` : (naval ? 'SUNK' : 'DESTROYED')}` +
    (attrition ? ` (${wing.name} loses aircraft to air defenses)` : ''), 'combat', wing.side);
  captureSweep(game, map);
  return { lost, attrition, killed: !target.alive };
}

// --------------------------------------------------------- capture & control
export function captureSweep(game, map) {
  for (const h of map.hexes.values()) {
    if (!h.loc || !h.t.land) continue;
    const k = key(h.c, h.r);
    const here = unitsAt(game, h.c, h.r);
    const redGround = here.filter(u => u.side === 'red' && u.cls === 'ground');
    const blueGround = here.filter(u => u.side === 'blue' && u.cls === 'ground');
    const ctrl = controllerOf(game, h);
    if (redGround.length && !blueGround.length && ctrl === 'blue') {
      game.control[k] = 'red';
      const blueWings = here.filter(u => u.side === 'blue' && u.cls === 'air');
      for (const w of blueWings) evacuateWing(game, map, w);
      if (h.loc.capital) {
        game.twWill -= 25;
        log(game, `TAIPEI HAS FALLEN. The Presidential Office is in PLA hands. Taiwanese resolve reels.`, 'alert', 'red');
      } else {
        game.twWill -= h.loc.city ? 5 : 2;
        log(game, `${h.loc.name} captured by PLA forces`, 'alert', 'red');
      }
      if (h.loc.name === 'Kinmen Defense Cmd' || h.loc.name === 'Kinmen') game.kinmenTaken = true;
    } else if (blueGround.length && !redGround.length && ctrl === 'red' && h.loc.side !== 'red') {
      delete game.control[k];
      game.twWill += 4;
      log(game, `${h.loc.name} liberated by ROC forces!`, 'alert', 'blue');
    }
  }
}

function evacuateWing(game, map, w) {
  const options = friendlyAirbases(game, map, 'blue')
    .filter(h => key(h.c, h.r) !== key(w.c, w.r))
    .filter(h => unitsAt(game, h.c, h.r).filter(x => x.cls === 'air' && x.side === w.side).length < 2);
  if (options.length && w.hp > 1) {
    const dest = options[0];
    applyDamage(game, w, 1);
    w.c = dest.c; w.r = dest.r; w.base = key(dest.c, dest.r);
    log(game, `${w.name} evacuates to ${dest.loc.name} under fire`, 'alert', 'blue');
  } else {
    w.alive = false;
    log(game, `${w.name} destroyed on the ground — base overrun`, 'alert', 'red');
  }
}

// --------------------------------------------------------- CP actions (blue)
export const ACTIONS = {
  lobby: { cp: 2, label: 'Diplomatic Push', desc: 'Lobby Washington and allied capitals (+2‑5 intervention)' },
  mobilize: { cp: 1, label: 'Mobilize Reserves', desc: 'Stand up a reserve brigade in a friendly city' },
  repair: { cp: 1, label: 'Repair Base', desc: 'Repair runway/port damage at one base (‑2 damage)' },
  mines: { cp: 2, label: 'Lay Minefield', desc: 'Mine a landing beach (amphibious assaults suffer)' },
  convoy: { cp: 2, label: 'Run Convoy', desc: 'Resupply the island (+12 supply, risky under blockade)' },
  deepstrike: { cp: 1, label: 'Authorize Deep Strike', desc: 'Permit strikes on mainland bases (escalatory)' },
};

export function doLobby(game) {
  game.cp -= ACTIONS.lobby.cp;
  const gain = 2 + d(game, 4);
  game.intervention += gain;
  log(game, `Taipei's envoys press allied capitals: intervention sentiment +${gain}`, 'political', 'blue');
  return gain;
}

export function doMobilize(game, map, hex) {
  if (game.reservesLeft <= 0) return false;
  if (surfaceUnitsAt(game, hex.c, hex.r).filter(u => u.side === 'blue').length >= 2) return false;
  game.cp -= ACTIONS.mobilize.cp;
  game.reservesLeft -= 1;
  const u = makeUnit(game, 'rocRes', `Reserve Bde (${hex.loc?.name || 'militia'})`, hex.c, hex.r, { side: 'blue' });
  u.moved = 99; u.attacked = true;
  log(game, `Reserve brigade mobilizes at ${hex.loc?.name}`, 'info', 'blue');
  return true;
}

export function doRepair(game, hex) {
  const k = key(hex.c, hex.r);
  if (!(game.baseDamage[k] > 0)) return false;
  game.cp -= ACTIONS.repair.cp;
  game.baseDamage[k] = Math.max(0, game.baseDamage[k] - 2);
  log(game, `Engineers restore operations at ${hex.loc?.name}`, 'info', 'blue');
  return true;
}

export function doMines(game, hex) {
  const k = key(hex.c, hex.r);
  if ((game.mines[k] || 0) >= 2) return false;
  game.cp -= ACTIONS.mines.cp;
  game.mines[k] = (game.mines[k] || 0) + 1;
  log(game, `Naval mines seeded off ${hex.loc?.name}`, 'info', 'blue');
  return true;
}

export function doConvoy(game) {
  game.cp -= ACTIONS.convoy.cp;
  if (game.blockade >= 2 && rnd(game) < 0.35 * game.blockade / 2) {
    game.twWill -= 3;
    log(game, 'Convoy intercepted by PLAN blockade — ships lost, cargo scattered', 'alert', 'red');
    return false;
  }
  game.supply = Math.min(100, game.supply + 12);
  log(game, 'Convoy runs the strait blockade successfully: +12 supply', 'info', 'blue');
  return true;
}

export function doDeepStrike(game) {
  game.cp -= ACTIONS.deepstrike.cp;
  game.deepStrike = true;
  log(game, 'Washington authorizes strikes on mainland military targets.', 'political', 'blue');
}

// --------------------------------------------------------- turn sequence
export function rollWeather(game) {
  if (game.forcedWeather) { game.weather = game.forcedWeather; game.forcedWeather = null; return; }
  let x = rnd(game);
  for (const w of WEATHER) { x -= w.p; if (x <= 0) { game.weather = w.id; return; } }
  game.weather = 'clear';
}

export function drawEvent(game, map) {
  if (rnd(game) > 0.65) return null;
  const pool = EVENTS.filter(e => !game.usedEvents.includes(e.id));
  if (!pool.length) return null;
  const ev = pool[Math.floor(rnd(game) * pool.length)];
  game.usedEvents.push(ev.id);
  ev.apply(game, game);
  log(game, `EVENT — ${ev.name}: ${ev.text}`, 'event');
  return ev;
}

export function triggerUS(game, map, reason) {
  if (game.intervention < 100) {
    game.intervention = 100;
    log(game, `${reason}. American intervention is now certain.`, 'political', 'blue');
  }
}
export function triggerJapan(game, map, reason) {
  game.jpThresholdMod = -100; // guarantees entry at next check
  log(game, `${reason}. Tokyo moves to a war footing.`, 'political', 'blue');
}

function spawnPackage(game, map, oob, side) {
  for (const entry of oob) {
    const [tid, name, c, r, extra = {}] = entry;
    const u = makeUnit(game, tid, name, c, r, { ...extra, side });
    const t = TYPES[tid];
    if (t.cls === 'naval' || t.cls === 'sub' || t.cls === 'amphib') {
      const h = map.get(u.c, u.r);
      if (!h.t.water) {
        for (const n of map.neighborsOf(u.c, u.r)) if (n.t.water) { u.c = n.c; u.r = n.r; break; }
      }
    }
    if (t.cls === 'air') u.base = key(u.c, u.r);
  }
}

export function checkAllianceEntries(game, map) {
  game.intervention = Math.max(0, Math.min(100, game.intervention));
  if (!game.usEntered && game.intervention >= CONST.usEnterAt) {
    game.usEntered = true; game.usEntryTurn = game.turn;
    game.pools.lrasm = 6; game.pools.tlam = 4;
    spawnPackage(game, map, US_PACKAGE, 'blue');
    log(game, 'THE UNITED STATES ENTERS THE WAR. Seventh Fleet surges west; bombers stand up at Guam.', 'alert', 'blue');
  }
  if (game.usEntered && !game.secondCSGIn && game.turn >= game.usEntryTurn + CONST.secondCSGDelay) {
    game.secondCSGIn = true;
    spawnPackage(game, map, [US_SECOND_CSG], 'blue');
    log(game, 'Second US carrier strike group arrives on station.', 'alert', 'blue');
  }
  if (!game.jpEntered && game.usEntered && game.intervention >= CONST.jpEnterAt + game.jpThresholdMod) {
    game.jpEntered = true;
    spawnPackage(game, map, JP_PACKAGE, 'blue');
    spawnPackage(game, map, [US_KADENA_WING], 'blue');
    log(game, 'JAPAN COMMITS. Kadena opens to combat operations; JMSDF escorts sortie.', 'alert', 'blue');
  }
}

export function redReinforcements(game, map) {
  for (const rr of RED_REINFORCEMENTS) {
    const id = 'rr' + rr.turn;
    if (game.reinfSpawned.includes(id)) continue;
    if (game.turn >= rr.turn + game.redReinfDelay) {
      game.reinfSpawned.push(id);
      const [tid, name, c, r, extra] = rr.entry;
      const u = makeUnit(game, tid, name, c, r, { side: 'red' });
      const h = map.get(u.c, u.r);
      if (!h.t.water) for (const n of map.neighborsOf(u.c, u.r)) if (n.t.water) { u.c = n.c; u.r = n.r; break; }
      for (const spec of (extra?.cargo || rr.entry[4]?.cargo || [])) {
        const [ctid, cname] = spec.split(':');
        const cu = makeUnit(game, ctid, cname, u.c, u.r, { side: 'red' });
        cu.embarkedIn = u.id; u.cargo.push(cu.id);
      }
      log(game, `PLA follow-on echelon puts to sea: ${name}`, 'alert', 'red');
    }
  }
}

export function recomputeAirSup(game, map) {
  let red = 2; // mainland SAM umbrella over the strait
  let blue = 0;
  for (const u of game.units) {
    if (!u.alive || u.cls !== 'air') {
      if (u.alive && typeOf(u).carrier && typeOf(u).airPts) {
        const pts = typeOf(u).airPts * frac(u);
        if (u.side === 'red') red += pts; else blue += pts;
      }
      continue;
    }
    const dmg = baseDamageAt(game, u.c, u.r);
    const pts = (typeOf(u).airPts || 0) * frac(u) * Math.max(0.15, 1 - dmg / 4.5);
    if (u.side === 'red') red += pts; else blue += pts;
  }
  if (game.interceptors > 150) blue += 2;
  else if (game.interceptors > 0) blue += 1;
  const wx = weatherNow(game);
  game.airSupDetail = { red: Math.round(red * 10) / 10, blue: Math.round(blue * 10) / 10 };
  game.airSup = Math.max(-3, Math.min(3, Math.round((red - blue) / 3)));
  if (wx.id === 'typhoon') game.airSup = 0; // nobody flies
}

export function recomputeBlockade(game, map) {
  let redShips = 0, blueEscorts = 0;
  for (const u of game.units) {
    if (!u.alive || u.embarkedIn) continue;
    if (!['naval', 'sub', 'amphib'].includes(u.cls)) continue;
    const dist = distToTaiwan(map, u.c, u.r);
    if (dist <= CONST.blockadeRadius) {
      if (u.side === 'red') redShips += 1; else blueEscorts += 1;
    }
  }
  let level = redShips >= 6 ? 3 : redShips >= 4 ? 2 : redShips >= 2 ? 1 : 0;
  if (game.airSup >= 2) level += 1;
  for (const [k, ctrl] of Object.entries(game.control)) {
    if (ctrl !== 'red') continue;
    const [c, r] = k.split(',').map(Number);
    if (map.get(c, r)?.loc?.port) { level += 1; break; }
  }
  level -= Math.floor(blueEscorts / 2);
  game.blockade = Math.max(0, Math.min(3, level));
}

// Runs at the start of the blue phase; returns things the UI should surface.
export function startTurn(game, map) {
  const notices = [];
  rollWeather(game);
  const ev = drawEvent(game, map);
  if (ev) notices.push({ kind: 'event', ev });
  redReinforcements(game, map);
  checkAllianceEntries(game, map);
  // supply & blockade
  recomputeBlockade(game, map);
  game.supply = Math.max(0, game.supply - game.blockade * 2 - 0.5);
  if (game.supply <= 0) game.twWill -= 4;
  else if (game.supply < 40) game.twWill -= 1;
  // occupied cities sap will
  for (const [k, ctrl] of Object.entries(game.control)) {
    if (ctrl !== 'red') continue;
    const [c, r] = k.split(',').map(Number);
    const loc = map.get(c, r)?.loc;
    if (loc?.capital) game.twWill -= 4;
    else if (loc?.city) game.twWill -= 1.5;
  }
  // stalled invasion saps PRC will
  if (game.turn >= 9 && !game.ai.landed) game.prcWill -= 3;
  if (game.turn >= 5 && !game.usEntered) game.intervention += 2; // pressure builds
  // pools regen
  if (game.usEntered && game.turn % 2 === 0) game.pools.lrasm += 1;
  if (game.blueStrikePenalty > 0) game.blueStrikePenalty -= 1;
  // command points
  game.cp = Math.max(2, CONST.blueCPBase - game.cpPenalty - (game.supply < 25 ? 1 : 0));
  game.cpPenalty = 0;
  // reset unit turn flags
  for (const u of game.units) {
    if (!u.alive) continue;
    u.moved = 0; u.attacked = false;
    if (u.cls === 'sub') {
      if (u.revealedTimer > 0) u.revealedTimer -= 1;
      if (u.revealedTimer <= 0) u.hidden = true;
    }
  }
  clampTracks(game);
  return notices;
}

export function clampTracks(game) {
  game.twWill = Math.max(0, Math.min(100, game.twWill));
  game.prcWill = Math.max(0, Math.min(100, game.prcWill));
  game.intervention = Math.max(0, Math.min(100, game.intervention));
  game.supply = Math.max(0, Math.min(100, game.supply));
}

export function endOfRedPhase(game, map) {
  recomputeAirSup(game, map);
  recomputeBlockade(game, map);
  // Taipei occupation clock
  const taipeiKey = '11,5';
  if (game.control[taipeiKey] === 'red') game.taipeiRedTurns += 1;
  else game.taipeiRedTurns = 0;
  clampTracks(game);
  checkVictory(game, map);
  if (!game.result) game.turn += 1;
}

export function checkVictory(game, map) {
  if (game.result) return game.result;
  const redAmphAlive = game.units.some(u => u.alive && u.cls === 'amphib');
  const redOnTaiwan = game.units.some(u => u.alive && u.side === 'red' && u.cls === 'ground' && map.isTaiwanMain(map.get(u.c, u.r)));
  if (game.twWill <= 0) {
    game.result = { winner: 'red', kind: 'capitulation', title: 'Taiwan Capitulates', text: 'Blockade, bombardment and lost ground broke the defenders’ will. Taipei accepts “reunification talks” under PLA guns.' };
  } else if (game.prcWill <= 0) {
    game.result = { winner: 'blue', kind: 'beijing-blinks', title: 'Beijing Seeks an Off-Ramp', text: 'Staggering losses, sanctions and a stalled invasion force the Politburo to declare victory and go home. The strait holds.' };
  } else if (game.taipeiRedTurns >= 2) {
    game.result = { winner: 'red', kind: 'capital-fallen', title: 'The Fall of Taipei', text: 'With the capital firmly in PLA hands, organized resistance collapses. The PRC completes its conquest.' };
  } else if (!redAmphAlive && !redOnTaiwan && game.turn >= 6) {
    game.result = { winner: 'blue', kind: 'strait-holds', title: 'Decisive Victory: The Strait Holds', text: 'The invasion fleet lies on the bottom of the Taiwan Strait and no PLA soldier stands on the island. A historic defensive victory.' };
  } else if (game.turn > CONST.maxTurns) {
    game.result = { winner: 'blue', kind: 'held-the-line', title: 'Taiwan Endures', text: 'Thirty days on, Taiwan still stands. The invasion has culminated; international pressure imposes a ceasefire on Beijing’s worst terms.' };
  }
  return game.result;
}
