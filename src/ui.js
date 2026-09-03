// DOM HUD: top bar, strategic tracks, unit panel, action bar, event log,
// banners and modals. Pure presentation — main.js wires the callbacks.

import { typeOf } from './state.js';
import { ACTIONS, weatherNow, baseDamageAt } from './rules.js';
import { worldPos } from './hex.js';

const $ = id => document.getElementById(id);

// glance icon for a unit type — echoed in the panel so you can see at once
// what kind of thing you have selected
export function unitIcon(t) {
  if (t.cls === 'air') return '✈️';
  if (t.cls === 'sub') return '⚓';
  if (t.cls === 'amphib') return '🛳️';
  if (t.cls === 'naval') return '🚢';
  if (t.fortress) return '🏰';
  if (t.armor) return '🛡️';
  return '🪖';
}

export class UI {
  constructor(audio = null) {
    this.audio = audio;
    this.onAction = null;   // (actionId) => void
    this.onEndTurn = null;
    this.onMenu = null;
    this.onNextUnit = null; // cycle to the next unit with orders left
    this.onUnitClose = null; // ✕ on the unit panel — owner clears selection
    this._buildTracks();
    this._buildActionBar();
    $('endTurnBtn').addEventListener('click', () => { audio?.sfx('tick'); this.onEndTurn?.(); });
    $('menuBtn').addEventListener('click', () => { audio?.sfx('tick'); this.onMenu?.(); });
    $('logToggle').addEventListener('click', () => $('logPanel').classList.toggle('open'));
    $('unitClose').addEventListener('click', () => {
      if (this.onUnitClose) this.onUnitClose();
      else this.showUnit(null, null);
    });
    const next = document.createElement('button');
    next.id = 'nextBtn';
    next.title = 'Next unit with orders left';
    next.textContent = '⏭ Next';
    next.addEventListener('click', () => { audio?.sfx('tick'); this.onNextUnit?.(); });
    $('topbtns').insertBefore(next, $('endTurnBtn'));
    this.onUndo = null; // take back the last move/rebase (never combat)
    const undo = document.createElement('button');
    undo.id = 'undoBtn';
    undo.title = 'Undo last move';
    undo.textContent = '↩';
    undo.disabled = true;
    undo.addEventListener('click', () => { audio?.sfx('tick'); this.onUndo?.(); });
    $('topbtns').insertBefore(undo, next);
    if (audio) {
      const mute = document.createElement('button');
      mute.id = 'muteBtn';
      mute.title = 'Sound on/off';
      mute.textContent = audio.muted ? '🔇' : '🔊';
      mute.addEventListener('click', () => {
        audio.ensure();
        audio.setMuted(!audio.muted);
        if (audio.muted) audio.stopTheme();
        mute.textContent = audio.muted ? '🔇' : '🔊';
      });
      $('topbtns').insertBefore(mute, $('menuBtn'));
    }
  }

  // ------------------------------------------------------------- tracks
  _buildTracks() {
    const defs = [
      ['trkIntervention', 'US intervention', 'intv'],
      ['trkTwWill', 'Taiwan resolve', 'tw'],
      ['trkPrcWill', 'PRC resolve', 'prc'],
      ['trkSupply', 'Island supply', 'sup'],
    ];
    const box = $('tracks');
    // compact single-row strip shown on narrow screens; tapping it toggles
    // #tracks between the full panel and this strip (see .collapsed in
    // css/style.css). Hidden entirely on desktop.
    const strip = document.createElement('div');
    strip.id = 'tracksStrip';
    strip.innerHTML = `<span id="stripIntv"></span><span id="stripTw"></span>
      <span id="stripPrc"></span><span id="stripSup"></span>
      <span>·</span><span id="stripAir"></span>`;
    strip.addEventListener('click', () => box.classList.toggle('collapsed'));
    box.appendChild(strip);
    if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) {
      box.classList.add('collapsed');
    }
    for (const [id, label, cls] of defs) {
      const el = document.createElement('div');
      el.className = 'track ' + cls;
      el.innerHTML = `<span class="tlabel">${label}</span>
        <div class="bar"><div class="fill" id="${id}"></div></div>
        <span class="tval" id="${id}Val"></span>`;
      box.appendChild(el);
    }
    const air = document.createElement('div');
    air.className = 'track air';
    air.innerHTML = `<span class="tlabel">Air superiority</span>
      <div class="airgauge" id="airGauge">${'<i></i>'.repeat(7)}</div>
      <span class="tval" id="airVal"></span>`;
    box.appendChild(air);
    const inv = document.createElement('div');
    inv.className = 'inventories';
    inv.innerHTML = `
      <span title="PLARF ballistic + cruise missiles remaining">☄ <b id="invMissiles"></b></span>
      <span title="Taiwan/allied interceptors (Patriot, Sky Bow)">🛡 <b id="invInterceptors"></b></span>
      <span title="Turn weather">​<b id="invWeather"></b></span>
      <span title="Blockade level">⚓ <b id="invBlockade"></b></span>`;
    box.appendChild(inv);
  }

  refreshTracks(game) {
    const set = (id, v, max = 100) => {
      $(id).style.width = Math.max(0, Math.min(100, (v / max) * 100)) + '%';
      $(id + 'Val').textContent = Math.round(v);
    };
    set('trkIntervention', game.intervention);
    set('trkTwWill', game.twWill);
    set('trkPrcWill', game.prcWill);
    set('trkSupply', game.supply);
    const gauge = $('airGauge').children;
    for (let i = 0; i < 7; i++) {
      const slot = i - 3; // -3 blue .. +3 red
      gauge[i].className = slot === game.airSup ? (game.airSup > 0 ? 'on red' : game.airSup < 0 ? 'on blue' : 'on mid') : '';
    }
    const airLabel = game.airSup > 0 ? 'PLA' : game.airSup < 0 ? 'Allied' : 'Contested';
    $('airVal').textContent = airLabel;
    $('stripIntv').textContent = `🔵${Math.round(game.intervention)}`;
    $('stripTw').textContent = `🟢${Math.round(game.twWill)}`;
    $('stripPrc').textContent = `🔴${Math.round(game.prcWill)}`;
    $('stripSup').textContent = `🟡${Math.round(game.supply)}`;
    $('stripAir').textContent = airLabel;
    $('invMissiles').textContent = game.red.srbm + game.red.lacm;
    $('invInterceptors').textContent = Math.round(game.interceptors);
    const wx = weatherNow(game);
    $('invWeather').textContent = `${wx.icon} ${wx.name}`;
    $('invBlockade').textContent = ['None', 'Partial', 'Serious', 'Total'][game.blockade];
  }

  refreshTop(game) {
    $('dayLabel').textContent = `D+${game.turn}`;
    $('cpLabel').textContent = `CP ${game.cp}`;
    $('endTurnBtn').disabled = game.phase !== 'blue' || !!game.result;
  }

  setUndoEnabled(on) { $('undoBtn').disabled = !on; }

  // ---------------------------------------------------------- action bar
  _buildActionBar() {
    const bar = $('actionBar');
    const defs = [
      ['lobby', '🤝', 'Diplomacy'],
      ['mobilize', '🪖', 'Reserves'],
      ['mines', '💣', 'Mines'],
      ['repair', '🔧', 'Repair'],
      ['convoy', '🚢', 'Convoy'],
      ['ascm', '🚀', 'ASCM'],
      ['lrasm', '✈️', 'LRASM'],
      ['tlam', '🎯', 'TLAM'],
      ['deepstrike', '⚠️', 'Deep Strike'],
    ];
    for (const [id, icon, label] of defs) {
      const b = document.createElement('button');
      b.id = 'act_' + id;
      b.className = 'actBtn';
      b.innerHTML = `<span class="aicon">${icon}</span><span class="alabel">${label}</span><span class="abadge" id="badge_${id}"></span>`;
      b.addEventListener('click', () => { this.audio?.sfx('tick'); this.onAction?.(id); });
      bar.appendChild(b);
    }
  }

  refreshActions(game) {
    const en = (id, enabled, badge = '') => {
      const b = $('act_' + id);
      b.disabled = !enabled || game.phase !== 'blue' || !!game.result;
      $('badge_' + id).textContent = badge;
    };
    en('lobby', game.cp >= ACTIONS.lobby.cp && !game.usEntered, `${ACTIONS.lobby.cp}CP`);
    en('mobilize', game.cp >= ACTIONS.mobilize.cp && game.reservesLeft > 0, `×${game.reservesLeft}`);
    en('mines', game.cp >= ACTIONS.mines.cp, `${ACTIONS.mines.cp}CP`);
    en('repair', game.cp >= ACTIONS.repair.cp && Object.values(game.baseDamage).some(v => v > 0), `${ACTIONS.repair.cp}CP`);
    en('convoy', game.cp >= ACTIONS.convoy.cp, `${ACTIONS.convoy.cp}CP`);
    en('ascm', game.pools.ascm > 0, `×${game.pools.ascm}`);
    en('lrasm', game.pools.lrasm > 0, `×${game.pools.lrasm}`);
    en('tlam', game.pools.tlam > 0, `×${game.pools.tlam}`);
    en('deepstrike', game.usEntered && !game.deepStrike && game.cp >= ACTIONS.deepstrike.cp, game.deepStrike ? 'ON' : '');
  }

  // ---------------------------------------------------------- unit panel
  showUnit(game, u, extra = '', stack = null) {
    const panel = $('unitPanel');
    if (!u) { panel.classList.add('hidden'); return; }
    const t = typeOf(u);
    const pips = '●'.repeat(u.hp) + '○'.repeat(u.maxHp - u.hp);
    const stats = [];
    if (t.att?.grd) stats.push(`Ground ${t.att.grd}`);
    if (t.att?.sea) stats.push(`Anti-ship ${t.att.sea}`);
    if (t.def) stats.push(`Def ${t.def}`);
    if (t.mov) stats.push(`Move ${t.mov}`);
    if (t.rng) stats.push(`Rng ${t.rng}`);
    if (t.airPts) stats.push(`Air ${t.airPts}`);
    if (t.strike) stats.push(`Strike ${t.strike}`);
    if (t.fortress) stats.push('Fortress');
    const status = [];
    if (u.side === 'blue') {
      if (u.attacked) status.push('has fired');
      else if (!t.mov && t.cls === 'ground') status.push('static garrison — defends in place');
      else if (u.moved >= (t.mov || 0) && t.cls !== 'air') status.push('has moved');
      else status.push('ready');
    }
    if (u.cargo?.length) status.push(`carrying ${u.cargo.length} bde`);
    if (u.cls === 'sub' && u.hidden) status.push('submerged');
    if (stack && stack.n > 1) status.push(`unit ${stack.idx} of ${stack.n} in hex — tap again to cycle`);
    panel.classList.remove('hidden');
    panel.querySelector('#unitName').textContent = `${unitIcon(t)} ${u.name}`;
    panel.querySelector('#unitName').className = u.side === 'red' ? 'red' : 'blue';
    panel.querySelector('#unitType').textContent = t.name;
    panel.querySelector('#unitHp').textContent = pips;
    panel.querySelector('#unitStats').textContent = stats.join(' · ');
    panel.querySelector('#unitStatus').textContent = status.join(' · ');
    panel.querySelector('#unitExtra').innerHTML = extra;
  }

  // location card: tapping an empty named hex shows the place itself
  showLocation(game, map, hex) {
    const panel = $('unitPanel');
    const loc = hex.loc;
    panel.classList.remove('hidden');
    panel.querySelector('#unitName').textContent = `📍 ${loc.name}`;
    panel.querySelector('#unitName').className = loc.side === 'red' ? 'red' : 'blue';
    const feats = [];
    if (loc.capital) feats.push('capital');
    if (loc.airbase) feats.push('airbase');
    if (loc.port) feats.push('port');
    if (loc.navalbase) feats.push('naval base');
    if (loc.staging) feats.push('staging area');
    if (loc.beach) feats.push('landing beach');
    if (loc.fabs) feats.push('semiconductor fabs');
    if (loc.shelters) feats.push('mountain shelters');
    if (loc.island || loc.fortified) feats.push('fortified island');
    panel.querySelector('#unitType').textContent = hex.t.name;
    panel.querySelector('#unitHp').textContent = '';
    panel.querySelector('#unitStats').textContent = feats.join(' · ');
    panel.querySelector('#unitStatus').textContent = '';
    const bits = [];
    const dmg = baseDamageAt(game, hex.c, hex.r);
    if (dmg > 0) bits.push(`infrastructure damage ${'▮'.repeat(Math.round(dmg))}`);
    if (game.mines[`${hex.c},${hex.r}`]) bits.push(`minefield ×${game.mines[`${hex.c},${hex.r}`]}`);
    panel.querySelector('#unitExtra').innerHTML = bits.join('<br>');
  }

  setUnitButtons(buttons) {
    // buttons: [{label, cb, disabled}]
    const box = $('unitButtons');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'ubtn';
      el.textContent = b.label;
      el.disabled = !!b.disabled;
      el.addEventListener('click', b.cb);
      box.appendChild(el);
    }
  }

  hexInfo(game, map, c, r) {
    const hex = map.get(c, r);
    if (!hex) return '';
    const bits = [hex.t.name];
    if (hex.loc) {
      const feats = [];
      if (hex.loc.capital) feats.push('capital');
      if (hex.loc.airbase) feats.push('airbase');
      if (hex.loc.port) feats.push('port');
      if (hex.loc.beach) feats.push('landing beach');
      if (hex.loc.fabs) feats.push('semiconductor fabs');
      bits.push(`<b>${hex.loc.name}</b>${feats.length ? ' — ' + feats.join(', ') : ''}`);
      const dmg = baseDamageAt(game, c, r);
      if (dmg > 0) bits.push(`infrastructure damage ${'▮'.repeat(Math.round(dmg))}`);
      if (game.mines[`${c},${r}`]) bits.push(`minefield ×${game.mines[`${c},${r}`]}`);
    }
    return bits.join('<br>');
  }

  // ------------------------------------------------------------ log
  refreshLog(game) {
    const box = $('logEntries');
    box.innerHTML = '';
    for (const e of game.log.slice(-60)) {
      const div = document.createElement('div');
      div.className = 'logEntry ' + (e.kind || '') + ' ' + (e.side || '');
      div.innerHTML = `<span class="lt">D+${e.turn}</span>${e.text}`;
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
    const latest = game.log[game.log.length - 1];
    $('logLatest').textContent = latest ? latest.text : '';
  }

  banner(text, cls = '') {
    const layer = $('bannerLayer');
    const el = document.createElement('div');
    el.className = 'banner ' + cls;
    el.textContent = text;
    layer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 1700);
  }

  toast(text) {
    const layer = $('bannerLayer');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    layer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2300);
  }

  hint(text) {
    const el = $('hintBar');
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('span').textContent = text;
  }

  // ------------------------------------------------------------ minimap
  // A theater overview in the corner: terrain, unit dots, camera marker.
  // Tap anywhere on it to fly the camera there.
  buildMinimap(map, onJump) {
    const c = document.createElement('canvas');
    c.id = 'minimap';
    c.width = 320; c.height = 300;
    $('app').appendChild(c);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const h of map.hexes.values()) {
      const p = worldPos(h.c, h.r);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this._mm = { c, map, minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ: maxZ + 1 };
    c.addEventListener('click', e => {
      const rect = c.getBoundingClientRect();
      const wx = this._mm.minX + (e.clientX - rect.left) / rect.width * (this._mm.maxX - this._mm.minX);
      const wz = this._mm.minZ + (e.clientY - rect.top) / rect.height * (this._mm.maxZ - this._mm.minZ);
      let best = null, bd = 1e9;
      for (const h of map.hexes.values()) {
        const p = worldPos(h.c, h.r);
        const d = (p.x - wx) ** 2 + (p.z - wz) ** 2;
        if (d < bd) { bd = d; best = h; }
      }
      if (best) { this.audio?.sfx('tick'); onJump(best.c, best.r); }
    });
  }

  drawMinimap(game, camTarget) {
    const mm = this._mm;
    if (!mm) return;
    const ctx = mm.c.getContext('2d');
    const W = mm.c.width, H = mm.c.height;
    const sx = W / (mm.maxX - mm.minX), sz = H / (mm.maxZ - mm.minZ);
    const px = x => (x - mm.minX) * sx, pz = z => (z - mm.minZ) * sz;
    ctx.clearRect(0, 0, W, H);
    const r = Math.min(sx, sz) * 0.95;
    for (const h of mm.map.hexes.values()) {
      const p = worldPos(h.c, h.r);
      ctx.fillStyle = '#' + h.t.color.toString(16).padStart(6, '0');
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = px(p.x) + r * Math.sin(a), y = pz(p.z) + r * Math.cos(a);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    }
    if (game) {
      for (const u of game.units) {
        if (!u.alive || u.embarkedIn || (u.cls === 'sub' && u.hidden && u.side === 'red')) continue;
        const p = worldPos(u.c, u.r);
        ctx.beginPath();
        ctx.arc(px(p.x), pz(p.z), 4, 0, Math.PI * 2);
        ctx.fillStyle = u.side === 'red' ? '#ff5a4c' : '#5aa4ff';
        ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      }
    }
    if (camTarget) {
      ctx.beginPath();
      ctx.arc(px(camTarget.x), pz(camTarget.z), 13, 0, Math.PI * 2);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
    }
  }

  // ---------------------------------------------------------- hover tip
  showHover(html, x, y) {
    let el = $('hoverTip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hoverTip';
      $('app').appendChild(el);
    }
    if (!html) { el.style.display = 'none'; return; }
    el.innerHTML = html;
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.min(window.innerWidth - w - 8, x + 16) + 'px';
    el.style.top = Math.min(window.innerHeight - h - 8, y + 16) + 'px';
  }

  // --------------------------------------------------------- guided tour
  // Coach marks: a spotlight cut-out over a target element with a card of
  // copy. steps: [{target: selector|null, title, text, before: async fn}]
  async tour(steps) {
    const layer = document.createElement('div');
    layer.id = 'tourLayer';
    layer.innerHTML = `<div id="tourHole"></div>
      <div id="tourCard"><div class="tstep"></div><h3></h3><p></p>
      <div class="tbtns"><button id="tourSkip">Skip tour</button><button id="tourNext" class="primary">Next</button></div></div>`;
    $('app').appendChild(layer);
    const hole = layer.querySelector('#tourHole'), card = layer.querySelector('#tourCard');
    const next = layer.querySelector('#tourNext'), skip = layer.querySelector('#tourSkip');
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.before) await s.before();
      const el = s.target ? document.querySelector(s.target) : null;
      if (el && el.getBoundingClientRect().width > 0) {
        const r = el.getBoundingClientRect();
        hole.style.display = 'block';
        hole.style.left = (r.left - 6) + 'px'; hole.style.top = (r.top - 6) + 'px';
        hole.style.width = (r.width + 12) + 'px'; hole.style.height = (r.height + 12) + 'px';
      } else {
        hole.style.display = 'none';
      }
      card.querySelector('.tstep').textContent = `${i + 1} / ${steps.length}`;
      card.querySelector('h3').textContent = s.title;
      card.querySelector('p').innerHTML = s.text;
      next.textContent = i === steps.length - 1 ? 'Start playing' : 'Next';
      const res = await new Promise(resolve => {
        next.onclick = () => { this.audio?.sfx('tick'); resolve('next'); };
        skip.onclick = () => { this.audio?.sfx('tick'); resolve('skip'); };
      });
      if (res === 'skip') break;
    }
    layer.remove();
  }

  // ------------------------------------------------------------ modals
  // onOpen(modalEl) lets callers wire live controls (settings toggles) inside the body
  modal({ title, body, buttons = [{ label: 'Continue', value: true }], wide = false, onOpen = null }) {
    return new Promise(resolve => {
      const layer = $('modalLayer');
      layer.innerHTML = '';
      layer.classList.remove('hidden');
      const m = document.createElement('div');
      m.className = 'modal' + (wide ? ' wide' : '');
      m.innerHTML = `<h2>${title}</h2><div class="mbody">${body}</div><div class="mbtns"></div>`;
      if (onOpen) queueMicrotask(() => onOpen(m));
      const btns = m.querySelector('.mbtns');
      for (const b of buttons) {
        const el = document.createElement('button');
        el.textContent = b.label;
        el.className = b.primary ? 'primary' : '';
        el.addEventListener('click', () => {
          this.audio?.ensure();
          this.audio?.sfx('tick');
          layer.classList.add('hidden');
          layer.innerHTML = '';
          resolve(b.value);
        });
        btns.appendChild(el);
      }
      layer.appendChild(m);
    });
  }
}
