// Game state: creation, seeded RNG, save/load. The map itself is static and
// rebuilt on load; everything else lives in the serializable `game` object.

import { buildMap } from './map.js';
import { TYPES, BLUE_OOB, RED_OOB, DIFFICULTY, BLUE_POOLS } from './data.js';
import { key } from './hex.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;
export function makeUnit(game, tid, name, c, r, extra = {}) {
  const t = TYPES[tid];
  const u = {
    id: nextId++, tid, cls: t.cls, side: extra.side, name: name || t.name,
    c, r, hp: extra.hp ?? t.hp, maxHp: extra.hp ?? t.hp,
    moved: 0, attacked: false, alive: true,
    hidden: !!extra.hidden, cargo: [], embarkedIn: null,
    revealedTimer: 0,
  };
  game.units.push(u);
  return u;
}

export function typeOf(u) { return TYPES[u.tid]; }

// Naval units listed at a port are pushed onto the nearest water hex.
function placeNaval(map, u) {
  const h = map.get(u.c, u.r);
  if (h.t.water) return;
  for (const n of map.neighborsOf(u.c, u.r)) {
    if (n.t.water) { u.c = n.c; u.r = n.r; return; }
  }
}

function spawnOOB(game, map, oob, side) {
  for (const [tid, name, c, r, extra = {}] of oob) {
    const u = makeUnit(game, tid, name, c, r, { ...extra, side });
    const t = TYPES[tid];
    if (t.cls === 'naval' || t.cls === 'sub' || t.cls === 'amphib') placeNaval(map, u);
    if (extra.cargo) {
      for (const spec of extra.cargo) {
        const [ctid, cname] = spec.split(':');
        const cu = makeUnit(game, ctid, cname, u.c, u.r, { side });
        cu.embarkedIn = u.id;
        u.cargo.push(cu.id);
      }
    }
    if (t.cls === 'air') u.base = key(c, r);
  }
}

export function newGame(difficulty = 'normal', seed = (Math.random() * 2 ** 31) | 0) {
  nextId = 1;
  const diff = DIFFICULTY[difficulty];
  const map = buildMap();
  const game = {
    seed, rngCalls: 0, difficulty,
    turn: 1, phase: 'blue', weather: 'clear', forcedWeather: null,
    units: [],
    red: { srbm: diff.srbm, lacm: diff.lacm, asbm: diff.asbm },
    pools: { ...BLUE_POOLS },
    interceptors: diff.interceptors,
    intervention: diff.intervention, prcWill: 100, twWill: 100, supply: 100,
    usEntered: false, jpEntered: false, usEntryTurn: null, secondCSGIn: false,
    cp: 0, cpPenalty: 0,
    airSup: 1, // red starts with local advantage: surprise + mainland SAM umbrella
    blockade: 0,
    baseDamage: {},        // hexKey -> 0..4 runway/port damage
    mines: {},             // hexKey -> level
    control: {},           // hexKey -> 'red' for captured blue locations
    beachheads: [],
    reservesLeft: 6, redReinfDelay: 0, reinfSpawned: [],
    jpThresholdMod: 0, blueStrikePenalty: 0, mlrBonus: false,
    revealRedPlan: false, deepStrike: false, homelandStruck: false,
    usedEvents: [], minedBeaches: [],
    taipeiRedTurns: 0, kinmenTaken: false,
    result: null,
    ai: { stance: 'fires', beach: null, landed: false },
    log: [],
  };
  game.rng = mulberry32(seed);
  spawnOOB(game, map, BLUE_OOB, 'blue');
  spawnOOB(game, map, RED_OOB, 'red');
  return { game, map };
}

export function rnd(game) { game.rngCalls++; return game.rng(); }
export function d(game, n) { return 1 + Math.floor(rnd(game) * n); }

export function serialize(game) {
  const { rng, ...rest } = game;
  return JSON.stringify(rest);
}

export function deserialize(json) {
  const game = JSON.parse(json);
  const map = buildMap();
  game.rng = mulberry32(game.seed);
  for (let i = 0; i < game.rngCalls; i++) game.rng(); // replay RNG position
  const maxId = Math.max(0, ...game.units.map(u => u.id));
  nextId = maxId + 1;
  return { game, map };
}
