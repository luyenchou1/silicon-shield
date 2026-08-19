// Bootstrap and orchestration: input, selection/targeting, the turn loop,
// saving, and campaign flow. This is the only module that touches everything.

import { key, hexDist } from './hex.js';
import { distToTaiwan } from './map.js';
import { newGame, serialize, deserialize, typeOf } from './state.js';
import {
  startTurn, endOfRedPhase, checkVictory, unitsAt, visibleTo, moveTargets,
  attackTargets, resolveCombat, doMove, rebaseTargets, doRebase,
  airStrikeTargets, airStrike, blueSalvo, tlamStrike, controllerOf,
  doLobby, doMobilize, doRepair, doMines, doConvoy, doDeepStrike,
  ACTIONS, baseDamageAt, log,
} from './rules.js';
import { runRedTurn } from './ai.js';
import { Renderer } from './render.js';
import { Fx } from './fx.js';
import { UI, unitIcon } from './ui.js';
import { TYPE_INTEL, LOC_INTEL } from './intel.js';
import { AudioEngine } from './audio.js';
import { DIFFICULTY } from './data.js';

const SAVE_KEY = 'silicon-shield-save-v1';

// localStorage can be unavailable (sandboxed iframes, private browsing);
// the game degrades to session-only play.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* no persistence */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* no persistence */ } },
};

let game = null, map = null, renderer = null, fx = null, ui = null, audio = null;
let selId = null;        // selected unit id
let mode = null;         // targeting mode {hint, valid:(hex)=>bool, handler:(hex)=>Promise}
let busy = false;        // red turn / animation lock

// ------------------------------------------------------------------ helpers
const sel = () => game?.units.find(u => u.id === selId && u.alive && !u.embarkedIn) || null;

function refreshAll() {
  renderer.syncUnits(game);
  ui.refreshTop(game);
  ui.refreshTracks(game);
  ui.refreshActions(game);
  ui.refreshLog(game);
  drawSelection();
}

function save() {
  store.set(SAVE_KEY, serialize(game));
}

// --------------------------------------------------------------- selection
function drawSelection() {
  renderer.clearHighlights();
  if (game.revealRedPlan && game.ai.beach && !game.ai.landed) {
    renderer.addHexHighlight(game.ai.beach.c, game.ai.beach.r, 0xe8b64c, 0.9, true);
  }
  if (mode) return; // targeting highlights drawn by mode setup
  const u = sel();
  if (!u) { ui.showUnit(null, null); return; }
  renderer.selectRing(u.c, u.r);
  const extra = ui.hexInfo(game, map, u.c, u.r);
  // stack awareness: same friendly-first order selectAt cycles through
  const stackAll = unitsAt(game, u.c, u.r).filter(x => visibleTo(x, 'blue'))
    .sort((a, b) => (a.side === 'blue' ? 0 : 1) - (b.side === 'blue' ? 0 : 1));
  const stack = stackAll.length > 1 ? { idx: stackAll.findIndex(x => x.id === u.id) + 1, n: stackAll.length } : null;
  ui.showUnit(game, u, extra, stack);
  const buttons = [];
  if (u.side === 'blue' && !busy && !game.result) {
    if (u.cls === 'air') {
      // strike targets ring in red, same language as ground attacks — tap to strike
      for (const t of airStrikeTargets(game, map, u)) renderer.addHexHighlight(t.c, t.r, 0xff5040, 0.9, true);
      buttons.push({
        label: 'Rebase', disabled: !rebaseTargets(game, map, u).length,
        cb: () => enterRebaseMode(u),
      });
    }
    if (u.cls !== 'air') {
      for (const m of moveTargets(game, map, u)) renderer.addHexHighlight(m.c, m.r, 0xffffff, 0.22);
      for (const t of attackTargets(game, map, u)) renderer.addHexHighlight(t.c, t.r, 0xff5040, 0.9, true);
    }
  }
  const brief = TYPE_INTEL[u.tid];
  if (brief) {
    buttons.push({
      label: 'ℹ️ About',
      cb: () => ui.modal({ title: `${unitIcon(typeOf(u))} ${typeOf(u).name}`, body: brief, wide: true }),
    });
  }
  ui.setUnitButtons(buttons);
}

function selectAt(c, r) {
  const stack = unitsAt(game, c, r).filter(u => visibleTo(u, 'blue'));
  if (!stack.length) {
    selId = null;
    drawSelection();
    const hex = map.get(c, r);
    if (hex?.loc) {
      // no unit here — show the place itself, with its intel brief
      renderer.selectRing(c, r);
      ui.showLocation(game, map, hex);
      const brief = LOC_INTEL[hex.loc.name];
      ui.setUnitButtons(brief ? [{
        label: 'ℹ️ About',
        cb: () => ui.modal({ title: `📍 ${hex.loc.name}`, body: brief, wide: true }),
      }] : []);
    }
    return;
  }
  // cycle through the stack on repeat taps, friendlies first
  stack.sort((a, b) => (a.side === 'blue' ? 0 : 1) - (b.side === 'blue' ? 0 : 1));
  const idx = stack.findIndex(u => u.id === selId);
  selId = stack[(idx + 1) % stack.length].id;
  drawSelection();
}

// ------------------------------------------------------------ target modes
function setMode(m) {
  mode = m;
  renderer.clearHighlights();
  for (const h of map.hexes.values()) {
    if (m.valid(h)) renderer.addHexHighlight(h.c, h.r, m.color ?? 0xffa030, 0.85, true);
  }
  ui.hint(m.hint);
}

function clearMode() {
  mode = null;
  ui.hint(null);
  drawSelection();
}

function enterRebaseMode(wing) {
  const targets = rebaseTargets(game, map, wing);
  const keys = new Set(targets.map(t => key(t.c, t.r)));
  setMode({
    hint: `${wing.name}: choose a new base`,
    color: 0x50c0ff,
    valid: h => keys.has(key(h.c, h.r)),
    handler: async h => { doRebase(game, map, wing, h.c, h.r); },
  });
}

const actionModes = {
  lobby: async () => { doLobby(game); ui.toast('Envoys dispatched to Washington and Tokyo.'); },
  convoy: async () => {
    const ok = doConvoy(game);
    ui.toast(ok ? 'Convoy made it through!' : 'Convoy intercepted — ships lost.');
  },
  deepstrike: async () => {
    const yes = await ui.modal({
      title: 'Authorize Deep Strike?',
      body: `<p>Striking bases on the Chinese mainland will degrade PLA sortie generation — but Beijing will rally domestic support around the escalation.</p>
             <p class="dim">Unlocks Tomahawk strikes against mainland airbases and staging ports.</p>`,
      buttons: [{ label: 'Authorize', value: true, primary: true }, { label: 'Hold', value: false }],
    });
    if (yes) doDeepStrike(game);
  },
  mobilize: () => setMode({
    hint: 'Choose a friendly city to mobilize a reserve brigade',
    color: 0x60d080,
    valid: h => h.t.region === 'tw' && h.loc?.city && controllerOf(game, h) === 'blue' &&
      unitsAt(game, h.c, h.r).filter(u => u.side === 'blue' && u.cls !== 'air').length < 2,
    handler: async h => { doMobilize(game, map, h); },
  }),
  repair: () => setMode({
    hint: 'Choose a damaged base to repair',
    color: 0x60d080,
    valid: h => baseDamageAt(game, h.c, h.r) > 0 && h.loc && controllerOf(game, h) !== 'red' && h.t.region !== 'prc',
    handler: async h => { doRepair(game, h); },
  }),
  mines: () => setMode({
    hint: 'Choose a landing beach to mine',
    color: 0x60d080,
    valid: h => h.loc?.beach && controllerOf(game, h) === 'blue' && (game.mines[key(h.c, h.r)] || 0) < 2,
    handler: async h => { doMines(game, h); },
  }),
  ascm: () => targetUnitMode('Hsiung Feng coastal missiles: choose a PLAN target (within 3 of the coast)',
    u => ['naval', 'amphib', 'sub'].includes(u.cls) && visibleTo(u, 'blue') && distToTaiwan(map, u.c, u.r) <= 3,
    async t => {
      const from = renderer.hexCenter(10, Math.max(5, Math.min(13, t.r)));
      const arc = fx.arc(from, renderer.hexCenter(t.c, t.r), { apex: 2, dur: 0.55 });
      blueSalvo(game, map, 'ascm', t);
      await arc; fx.boom(renderer.hexCenter(t.c, t.r), { size: 0.6 });
    }),
  lrasm: () => targetUnitMode('LRASM strike from Guam: choose any PLAN target',
    u => ['naval', 'amphib', 'sub'].includes(u.cls) && visibleTo(u, 'blue'),
    async t => {
      const from = renderer.hexCenter(19, 14);
      const arc = fx.arc(from, renderer.hexCenter(t.c, t.r), { apex: 5, dur: 0.8 });
      blueSalvo(game, map, 'lrasm', t);
      await arc; fx.boom(renderer.hexCenter(t.c, t.r), { size: 0.7 });
    }),
  tlam: () => setMode({
    hint: 'Tomahawk strike: choose an enemy airbase or staging port' + (game.deepStrike ? '' : ' (mainland requires Deep Strike authorization)'),
    valid: h => h.loc && (h.loc.airbase || h.loc.staging) &&
      ((h.t.region === 'prc' && game.deepStrike) || controllerOf(game, h) === 'red'),
    handler: async h => {
      const from = renderer.hexCenter(16, 12);
      const arc = fx.arc(from, renderer.hexCenter(h.c, h.r), { apex: 3, dur: 0.7 });
      tlamStrike(game, map, h);
      await arc; fx.boom(renderer.hexCenter(h.c, h.r), { size: 0.7 });
    },
  }),
};

function targetUnitMode(hint, unitPred, handler) {
  const targets = game.units.filter(u => u.alive && !u.embarkedIn && u.side === 'red' && unitPred(u));
  if (!targets.length) { ui.toast('No valid targets in range.'); return; }
  const byKey = new Map();
  for (const t of targets) byKey.set(key(t.c, t.r), t);
  setMode({
    hint,
    valid: h => byKey.has(key(h.c, h.r)),
    handler: async h => { await handler(byKey.get(key(h.c, h.r))); },
  });
}

// ----------------------------------------------------------------- input
function bindInput() {
  const el = renderer.renderer.domElement;
  let down = null;
  // unlock audio on any interaction (iOS gesture requirement)
  document.addEventListener('pointerdown', () => audio.ensure(), { capture: true });
  // keep map gestures on the map: stop iOS/host-page scroll and rubber-banding
  document.addEventListener('touchmove', e => {
    if (e.target.closest('#scene')) e.preventDefault();
  }, { passive: false });
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  el.addEventListener('pointerup', async e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const wasTap = Math.hypot(dx, dy) < 8 && Date.now() - down.t < 600;
    down = null;
    if (!wasTap || !game) return;
    const hit = renderer.pick(e.clientX, e.clientY);
    if (!hit) return;
    await handleTap(hit.c, hit.r);
  });
  document.getElementById('hintCancel').addEventListener('click', clearMode);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') clearMode(); });
}

async function handleTap(c, r) {
  if (busy || game.result) return;
  const hex = map.get(c, r);
  if (mode) {
    if (mode.valid(hex)) {
      const handler = mode.handler;
      clearMode();
      busy = true;
      try { await handler(hex); } finally { busy = false; }
      checkMidTurnVictory();
      refreshAll();
    } else {
      ui.toast('Not a valid target.');
    }
    return;
  }
  const u = sel();
  if (u && u.side === 'blue' && u.cls === 'air' && !game.result) {
    // strike? (targets are already ringed in red)
    const tgt = airStrikeTargets(game, map, u).find(t => t.c === c && t.r === r);
    if (tgt) {
      busy = true;
      try {
        const res = airStrike(game, map, u, tgt);
        await fx.strike(u, tgt, res);
      } finally { busy = false; }
      checkMidTurnVictory();
      refreshAll();
      return;
    }
  }
  if (u && u.side === 'blue' && u.cls !== 'air') {
    // move?
    const mv = moveTargets(game, map, u).find(m => m.c === c && m.r === r);
    if (mv) {
      // A friendly unit already there makes the tap ambiguous: stacking move
      // vs. switching selection. Ask, so browsing units never moves by accident.
      const others = unitsAt(game, c, r)
        .filter(x => x.id !== u.id && x.side === 'blue' && x.alive && !x.embarkedIn && visibleTo(x, 'blue'));
      if (others.length) {
        const pick = await ui.modal({
          title: 'Move or select?',
          body: `<p class="dim">${others.map(o => o.name).join(' and ')} ${others.length > 1 ? 'are' : 'is'} in that hex.</p>`,
          buttons: [
            { label: `Move ${u.name} here`, value: 'move', primary: true },
            { label: `Select ${others[0].name}`, value: 'select' },
            { label: 'Cancel', value: null },
          ],
        });
        if (pick === 'move') { doMove(game, map, u, c, r); refreshAll(); }
        else if (pick === 'select') { selId = others[0].id; drawSelection(); }
        return;
      }
      doMove(game, map, u, c, r);
      refreshAll();
      return;
    }
    // attack?
    const tgt = attackTargets(game, map, u).find(t => t.c === c && t.r === r);
    if (tgt) {
      busy = true;
      try {
        const res = resolveCombat(game, map, u, tgt);
        await fx.attack(u, tgt, res);
      } finally { busy = false; }
      checkMidTurnVictory();
      refreshAll();
      return;
    }
  }
  selectAt(c, r);
}

function checkMidTurnVictory() {
  checkVictory(game, map);
  if (game.result) showResult();
}

// -------------------------------------------------------------- turn loop
async function endTurn() {
  if (busy || game.result) return;
  busy = true;
  selId = null; clearMode();
  const btn = document.getElementById('endTurnBtn');
  btn.textContent = 'Skip ⏩';
  btn.disabled = false;
  fx.speed = 1;
  const skipper = () => { fx.speed = 12; };
  btn.addEventListener('click', skipper);
  let notices = [];
  // snapshot the world before the PLA moves, so the situation report can
  // explain exactly what the red phase cost each side
  const reportTurn = game.turn;
  const snap = {
    units: new Map(game.units.map(u => [u.id, { alive: u.alive, hp: u.hp }])),
    tracks: { intv: game.intervention, tw: game.twWill, prc: game.prcWill, sup: game.supply },
    grounded: groundedAirbases(),
  };
  try {
    await runRedTurn(game, map, fx);
    const fires = endOfRedPhase(game, map);
    refreshAll();
    for (const f of fires) await fx.garrisonFire(f);
    if (!game.result) {
      notices = startTurn(game, map);
      checkVictory(game, map);
    }
    save();
  } finally {
    btn.removeEventListener('click', skipper);
    btn.textContent = 'End Turn ⏵';
    fx.speed = 1;
    busy = false;
    refreshAll();
  }
  if (game.result) { showResult(); return; }
  const sitrep = buildSitrep(snap, reportTurn);
  if (sitrep) {
    await ui.modal({ title: `📋 D+${reportTurn} Situation Report`, body: sitrep, wide: true });
  }
  for (const n of notices) {
    if (n.kind === 'event') {
      audio.sfx('chime');
      await ui.modal({ title: `📰 ${n.ev.name}`, body: `<p>${n.ev.text}</p>` });
    }
  }
  if (game.result) { showResult(); return; }
  ui.banner(`D+${game.turn} — YOUR ORDERS, COMMANDER`, 'blue');
}

// -------------------------------------------------- situation report
function groundedAirbases() {
  const out = [];
  for (const h of map.hexes.values()) {
    if (h.loc?.airbase && h.t.region !== 'prc' && baseDamageAt(game, h.c, h.r) >= 3.5) out.push(h.loc.name);
  }
  return out;
}

function buildSitrep(snap, reportTurn) {
  const changed = u => snap.units.get(u.id);
  const lostBy = side => game.units.filter(u => changed(u)?.alive && !u.alive && u.side === side);
  const damagedBy = side => game.units
    .filter(u => changed(u)?.alive && u.alive && u.hp < changed(u).hp && u.side === side)
    .map(u => ({ u, d: changed(u).hp - u.hp }));
  // the log line that mentions a dead unit IS the explanation of what killed it
  const causeOf = u => {
    const e = [...game.log].reverse().find(e => e.turn === reportTurn && e.text.includes(u.name));
    return e ? e.text : 'lost in action';
  };

  const rows = [];
  const section = (title, items) => {
    if (items.length) rows.push(`<h3 class="aar-h">${title}</h3>` + items.join(''));
  };

  section('Your losses', lostBy('blue').map(u =>
    `<div class="aar-t"><span class="aar-day">${unitIcon(typeOf(u))}</span><b>${u.name}</b> — ${causeOf(u)}</div>`));
  section('Your units damaged', damagedBy('blue').map(({ u, d }) =>
    `<div class="aar-t"><span class="aar-day">${unitIcon(typeOf(u))}</span>${u.name} −${d} step${d === 1 ? '' : 's'} (${u.hp} left)</div>`));
  section('Enemy losses', lostBy('red').map(u =>
    `<div class="aar-t"><span class="aar-day">${unitIcon(typeOf(u))}</span><b>${u.name}</b> — ${causeOf(u)}</div>`));

  const nowGrounded = groundedAirbases().filter(n => !snap.grounded.includes(n));
  section('Airbases knocked out', nowGrounded.map(n =>
    `<div class="aar-t"><span class="aar-day">🛬</span><b>${n}</b> — runways cratered; wings there are grounded until repaired</div>`));

  const tr = [];
  const delta = (label, before, after) => {
    const d = Math.round(after) - Math.round(before);
    if (d) tr.push(`<div class="aar-t"><span class="aar-day">${d > 0 ? '▲' : '▼'}</span>${label} ${Math.round(before)} → ${Math.round(after)} (${d > 0 ? '+' : ''}${d})</div>`);
  };
  delta('US intervention', snap.tracks.intv, game.intervention);
  delta('Taiwan resolve', snap.tracks.tw, game.twWill);
  delta('PRC resolve', snap.tracks.prc, game.prcWill);
  delta('Island supply', snap.tracks.sup, game.supply);
  section('Strategic tracks', tr);

  const seen = new Set();
  const keyEvents = game.log
    .filter(e => e.turn === reportTurn && ['alert', 'political'].includes(e.kind))
    .filter(e => { const k = e.text.slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8);
  section('Developments', keyEvents.map(e => `<div class="aar-t"><span class="aar-day">•</span>${e.text}</div>`));

  return rows.length ? rows.join('') : null;
}

// ------------------------------------------------------- after-action report
function afterActionReport() {
  const dead = (side, classes) => game.units.filter(u => !u.alive && u.side === side && classes.includes(u.cls)).length;
  const diff = DIFFICULTY[game.difficulty];
  const missilesFired = diff.srbm + diff.lacm - (game.red.srbm + game.red.lacm);
  const interceptorsUsed = Math.max(0, Math.round(diff.interceptors - game.interceptors));
  const occupied = Object.entries(game.control)
    .filter(([, ctrl]) => ctrl === 'red')
    .map(([k]) => { const [c, r] = k.split(',').map(Number); return map.get(c, r)?.loc?.name; })
    .filter(Boolean);
  const beachheads = game.beachheads
    .map(k => { const [c, r] = k.split(',').map(Number); return map.get(c, r)?.loc?.name; })
    .filter(Boolean);
  const jpEntry = game.log.find(e => e.text.includes('JAPAN COMMITS'))?.turn;

  const facts = [
    ['Days of war', `${Math.min(game.turn, 30)}`],
    ['US entry', game.usEntered ? `D+${game.usEntryTurn}` : 'never committed'],
    ['Japan entry', game.jpEntered ? `D+${jpEntry ?? '?'}` : 'stayed out'],
    ['PLA ships sunk', `${dead('red', ['naval', 'amphib', 'sub'])}`],
    ['Allied ships sunk', `${dead('blue', ['naval', 'sub'])}`],
    ['Brigades destroyed', `PLA ${dead('red', ['ground'])} · Allied ${dead('blue', ['ground'])}`],
    ['Air wings destroyed', `PLA ${dead('red', ['air'])} · Allied ${dead('blue', ['air'])}`],
    ['PLARF missiles fired', `${missilesFired}`],
    ['Interceptors expended', `${interceptorsUsed}`],
    ['Beachheads', beachheads.length ? beachheads.join(', ') : 'none — the fleet never landed'],
    ['Under occupation', occupied.length ? occupied.join(', ') : 'none'],
    ['Final resolve', `Taiwan ${Math.round(game.twWill)} · PRC ${Math.round(game.prcWill)}`],
  ];
  const grid = facts.map(([k, v]) => `<div class="aar-k">${k}</div><div class="aar-v">${v}</div>`).join('');

  // key moments: the alert/event/political log entries tell the story
  let moments = game.log.filter(e => ['alert', 'event', 'political'].includes(e.kind));
  const seen = new Set();
  moments = moments.filter(e => { const key = e.text.slice(0, 60); if (seen.has(key)) return false; seen.add(key); return true; });
  if (moments.length > 18) moments = [...moments.slice(0, 9), ...moments.slice(-9)];
  const timeline = moments.map(e =>
    `<div class="aar-t"><span class="aar-day">D+${e.turn}</span>${e.text}</div>`).join('');

  return `<h3 class="aar-h">By the numbers</h3><div class="aar-grid">${grid}</div>
    <h3 class="aar-h">Key moments</h3><div class="aar-timeline">${timeline}</div>`;
}

async function showResult() {
  const r = game.result;
  refreshAll();
  audio.theme(r.winner === 'blue' ? 'victory' : 'defeat');
  const flag = r.winner === 'blue' ? '🟦 ALLIED VICTORY' : '🟥 PRC VICTORY';
  await ui.modal({
    title: `${flag} — ${r.title}`,
    body: `<p>${r.text}</p>${afterActionReport()}`,
    buttons: [{ label: 'New Campaign', value: true, primary: true }],
    wide: true,
  });
  audio.stopTheme();
  store.del(SAVE_KEY);
  bootMenu();
}

// ------------------------------------------------------------------- menu
const BRIEFING = `
<p><b>April 2027.</b> After months of "quarantine" exercises, the People's Liberation Army has begun
its Joint Island Landing Campaign. Ballistic missiles are falling on Taiwan's airfields.
An invasion fleet is assembling across the strait.</p>
<p>You command the defense: the Republic of China's armed forces — and, if you can bring them in,
the United States and Japan.</p>
<ul>
<li><b>Survive 30 days</b>, keep Taipei, or break Beijing's will to continue (PRC resolve → 0).</li>
<li><b>Sink the amphibious fleet</b> and the invasion dies in the water — a decisive victory.</li>
<li>You lose if <b>Taipei falls</b> or <b>Taiwan's resolve</b> collapses under blockade and bombardment.</li>
</ul>
<p class="dim">Tap a unit to select; tap highlighted hexes to move (white) or attack (red rings).
Use the action bar for missiles, mines, reserves and diplomacy. America enters the war when the
intervention track reaches 50 — diplomacy, time, and PRC atrocities all push it up.</p>`;

const HOW_TO = `
<p><b>Each turn is one day.</b> Move and fight with every unit, spend Command Points (CP) on
strategic actions, then End Turn — the PLA moves, and the next day begins.</p>
<ul>
<li><b>Kill the amphibious fleet.</b> Loaded flotillas (AMPH) carry two brigades each. Every one sunk
is two brigades that never land. Coastal missiles (ASCM), F-16 strikes, your navy, mines and — once
America is in — LRASM are your ship-killers.</li>
<li><b>Preserve your air force.</b> Missile strikes crater runways (repair them) and destroy fighters
on the ground. Hualien and Taitung have mountain shelters. Rebase wings when a base is being pounded.</li>
<li><b>Defend the beaches.</b> Gold rings mark viable landing beaches. Garrison them, mine them, and keep
armor close for the counterattack. Urban and mountain hexes defend far better than plains.</li>
<li><b>Watch the tracks.</b> Supply falls under blockade; at zero, Taiwan's resolve bleeds fast. Convoys
help once the sea lanes are contested. PRC resolve falls with every ship you sink — it is a victory
condition of its own.</li>
<li><b>Bring in the allies.</b> Diplomacy (+CP action) raises US intervention; at 50 the US Navy and
Guam's bombers join; at 70 Japan opens Kadena. If the PLA strikes US or Japanese forces, entry is immediate.</li>
<li><b>Submarines</b> are hidden until they fire. Yours ambush the invasion fleet; theirs hunt your carriers.</li>
<li><b>Air wings fly one mission per day</b> — a strike or a rebase. Select a wing and its eligible
targets ring in red; tap one to strike. The wing's Strike stat is its hitting power. Cratered runways
ground the wing until repaired.</li>
<li><b>Offshore garrisons</b> (Kinmen, Matsu, Penghu Defense Cmds) are immobile fortress commands with
shore batteries. They need no orders: at the end of every PLA turn they automatically shell an enemy ship
or brigade in range — or direct their fire yourself during your turn (red rings). Make Beijing pay for
every island grab. The USMC Littoral Regiment on Luzon works the same way over the Bashi Channel.</li>
<li><b>Situation report.</b> After every PLA turn you get a summary of what it cost: units lost (and
what killed them), damage taken, airbases knocked out, and track movement. The full log is always at
the bottom of the screen.</li>
<li><b>Learn the theater.</b> Every unit and named place has an ℹ️ About brief — the real-world system
or geography behind it and what it does in the game. Tap any unit, or any empty named hex, and hit About.</li>
</ul>
<p class="dim">Camera: drag to pan, two-finger/right-drag to rotate, pinch/wheel to zoom. Esc cancels targeting.</p>`;

async function bootMenu() {
  const hasSave = !!store.get(SAVE_KEY);
  const choice = await ui.modal({
    title: '🛡️ SILICON SHIELD — The Battle for Taiwan',
    body: BRIEFING,
    wide: true,
    buttons: [
      ...(hasSave ? [{ label: '▶ Continue Campaign', value: 'continue', primary: true }] : []),
      { label: 'New: Reporting for Duty (easy)', value: 'easy', primary: !hasSave },
      { label: 'New: Commander (normal)', value: 'normal' },
      { label: 'New: Davidson Window (hard)', value: 'hard' },
    ],
  });
  if (choice === 'continue') {
    try {
      ({ game, map } = deserialize(store.get(SAVE_KEY)));
    } catch {
      ({ game, map } = newGame('normal'));
      startTurn(game, map);
    }
  } else {
    ({ game, map } = newGame(choice));
    startTurn(game, map);
    log(game, 'D+1: PLA joint fire strikes begin. The invasion of Taiwan is underway.', 'alert', 'red');
    audio.ensure();
    audio.theme('main');
  }
  // (re)bind world to renderer
  renderer.map = map;
  selId = null; mode = null; busy = false;
  refreshAll();
  ui.banner(`D+${game.turn} — YOUR ORDERS, COMMANDER`, 'blue');
}

async function menu() {
  const choice = await ui.modal({
    title: 'Menu',
    body: '<p class="dim">Campaign auto-saves at the end of every day.</p>',
    buttons: [
      { label: 'Resume', value: 'resume', primary: true },
      { label: 'How to Play', value: 'how' },
      { label: 'Abandon & New Campaign', value: 'new' },
    ],
  });
  if (choice === 'how') {
    await ui.modal({ title: 'Field Manual', body: HOW_TO, wide: true });
    menu();
  } else if (choice === 'new') {
    store.del(SAVE_KEY);
    bootMenu();
  }
}

// ------------------------------------------------------------------- boot
import { buildMap } from './map.js';

function boot() {
  map = buildMap();
  renderer = new Renderer(document.getElementById('scene'), map);
  audio = new AudioEngine();
  ui = new UI(audio);
  fx = new Fx(renderer, ui, audio);
  fx.onStep = () => { if (game) { renderer.syncUnits(game); ui.refreshTracks(game); ui.refreshLog(game); } };
  ui.onEndTurn = endTurn;
  ui.onMenu = menu;
  ui.onAction = id => {
    if (busy || !game || game.result || game.phase !== 'blue') return;
    clearMode();
    const fn = actionModes[id];
    if (!fn) return;
    Promise.resolve(fn()).then(() => refreshAll());
  };
  bindInput();
  window.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.result) save(); });
  // console/testing hook: window.__ss.screenOf(c, r) -> client coords of a hex
  window.__ss = {
    get game() { return game; },
    get map() { return map; },
    screenOf(c, r) {
      const p = renderer.hexCenter(c, r).project(renderer.camera);
      const rect = renderer.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - (p.y + 1) / 2) * rect.height };
    },
  };
  bootMenu();
}

boot();
