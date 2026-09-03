// Battle effects: missile arcs, explosions, tracers. Implements the async fx
// interface the red AI (and blue actions) await between steps, so the war is
// watchable. `speed` scales all durations; the Skip button cranks it up.

import * as THREE from 'three';
import { makeLabelSprite } from './render.js';

export class Fx {
  constructor(renderer, ui, audio = null) {
    this.r = renderer;
    this.ui = ui;
    this.audio = audio;
    this.baseSpeed = 1;  // player's animation-speed setting
    this.speed = 1;      // live multiplier (Skip cranks it up temporarily)
    this.active = [];
    renderer._tickFx = dt => this.tick(dt);
    this.onStep = null; // callback: HUD refresh between AI steps
  }

  _sfx(name) {
    if (this.audio && this.speed < 8) this.audio.sfx(name);
  }

  tick(dt) {
    dt *= this.speed;
    this.active = this.active.filter(e => e.update(dt));
  }

  wait(ms) {
    if (this.speed >= 8) ms = Math.min(ms, 40);
    return new Promise(res => setTimeout(res, ms / this.speed));
  }

  _step() { this.onStep?.(); }

  // ------------------------------------------------------------ primitives
  boom(pos, { size = 0.5, color = 0xffa03c, dur = 0.5 } = {}) {
    this._sfx(size >= 0.7 ? 'bigboom' : 'boom');
    const geo = new THREE.IcosahedronGeometry(0.2, 1);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    this.r.fxLayer.add(m);
    let t = 0;
    this.active.push({
      update: dt => {
        t += dt / dur;
        m.scale.setScalar(0.3 + t * size * 3);
        mat.opacity = Math.max(0, 0.95 * (1 - t));
        if (t >= 1) { this.r.fxLayer.remove(m); return false; }
        return true;
      },
    });
    const flash = new THREE.PointLight(color, 8, 6);
    flash.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
    this.r.fxLayer.add(flash);
    let ft = 0;
    this.active.push({
      update: dt => {
        ft += dt / (dur * 0.7);
        flash.intensity = Math.max(0, 8 * (1 - ft));
        if (ft >= 1) { this.r.fxLayer.remove(flash); return false; }
        return true;
      },
    });
  }

  arc(from, to, { color = 0xffd27a, dur = 0.7, apex = 3 } = {}) {
    this._sfx('launch');
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y += apex;
    const curve = new THREE.QuadraticBezierCurve3(from.clone().add(new THREE.Vector3(0, 0.2, 0)), mid, to);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff5df })
    );
    const trailGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    const trailMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.geometry.setDrawRange(0, 0);
    this.r.fxLayer.add(head, trail);
    let t = 0;
    return new Promise(resolve => {
      this.active.push({
        update: dt => {
          t += dt / dur;
          const tt = Math.min(1, t);
          head.position.copy(curve.getPoint(tt));
          trail.geometry.setDrawRange(0, Math.floor(tt * 24) + 1);
          trailMat.opacity = 0.8 * (1 - tt * 0.5);
          if (t >= 1.15) {
            this.r.fxLayer.remove(head); this.r.fxLayer.remove(trail);
            resolve();
            return false;
          }
          return true;
        },
      });
    });
  }

  // damage number that rises and fades above the hit — the feedback loop
  // every combat resolution deserves
  floatText(pos, text, color = '#ffd27a', unitId = null) {
    if (unitId) this.r.flashUnit(unitId);
    const s = makeLabelSprite(text, { scale: 0.42, px: 34, bold: true, color });
    s.position.copy(pos).add(new THREE.Vector3(0, 0.75, 0));
    this.r.fxLayer.add(s);
    let t = 0;
    this.active.push({
      update: dt => {
        t += dt / 1.1;
        s.position.y += dt * 0.7;
        s.material.opacity = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
        if (t >= 1) { this.r.fxLayer.remove(s); return false; }
        return true;
      },
    });
  }

  _hitText(lost, killed) { return killed ? 'DESTROYED' : lost ? `−${lost}` : 'miss'; }
  _hitColor(lost, killed) { return killed ? '#ff6a4c' : lost ? '#ffd27a' : '#9fb4cc'; }

  tracer(from, to, color = 0xfff0b0) {
    this._sfx('gun');
    const geo = new THREE.BufferGeometry().setFromPoints([
      from.clone().add(new THREE.Vector3(0, 0.3, 0)),
      to.clone().add(new THREE.Vector3(0, 0.3, 0)),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.r.fxLayer.add(line);
    let t = 0;
    this.active.push({
      update: dt => {
        t += dt / 0.4;
        mat.opacity = Math.max(0, 1 - t);
        if (t >= 1) { this.r.fxLayer.remove(line); return false; }
        return true;
      },
    });
  }

  // -------------------------------------------------- composite (AI-facing)
  async banner(text) {
    if (this.audio) this.audio.sfx('drum');
    this.ui.banner(text);
    await this.wait(900);
  }

  async missiles(hex, res) {
    const to = this.r.hexCenter(hex.c, hex.r);
    const from = this.r.hexCenter(2, Math.max(0, Math.min(21, hex.r - 1)));
    const n = Math.min(5, 1 + Math.floor((res?.n || 10) / 15));
    const arcs = [];
    for (let i = 0; i < n; i++) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
      arcs.push(this.arc(from.clone().add(jitter.clone().multiplyScalar(2)), to.clone().add(jitter), { apex: 4 + i * 0.4 })
        .then(() => this.boom(to.clone().add(jitter), { size: 0.5 })));
      await this.wait(90);
    }
    await Promise.all(arcs);
    this._step();
    await this.wait(150);
  }

  async asbm(target, res) {
    const to = this.r.hexCenter(target.c, target.r);
    const from = this.r.hexCenter(1, 5);
    await this.arc(from, to, { color: 0xff8060, apex: 7, dur: 0.9 });
    this.boom(to, { size: res?.steps ? 0.9 : 0.4, color: res?.steps ? 0xff5030 : 0x88bbee });
    this.floatText(to, res?.steps ? `−${res.steps}` : 'intercepted', res?.steps ? '#ff6a4c' : '#8fd0ff', res?.steps ? target.id : null);
    this._step();
    await this.wait(250);
  }

  // a visible sortie: jets launch, fly to the target, strike, and recover home
  _jetMesh(side) {
    const color = side === 'red' ? 0xe86a5e : 0x7ab4ff;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 4), new THREE.MeshBasicMaterial({ color }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.015, 0.09), new THREE.MeshBasicMaterial({ color }));
    wing.position.z = 0.03;
    g.add(wing);
    return g;
  }

  _fly(obj, from, to, dur, apex = 1.4) {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y = Math.max(from.y, to.y) + apex;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    let t = 0;
    return new Promise(resolve => {
      this.active.push({
        update: dt => {
          t += dt / dur;
          const tt = Math.min(1, t);
          obj.position.copy(curve.getPoint(tt));
          const ahead = curve.getPoint(Math.min(1, tt + 0.02));
          obj.lookAt(ahead);
          if (t >= 1) { resolve(); return false; }
          return true;
        },
      });
    });
  }

  async strike(wing, target, res) {
    const from = this.r.hexCenter(wing.c, wing.r).add(new THREE.Vector3(0, 0.3, 0));
    const to = this.r.hexCenter(target.c, target.r).add(new THREE.Vector3(0, 0.5, 0));
    this._sfx('launch');
    const jets = [this._jetMesh(wing.side), this._jetMesh(wing.side)];
    jets[1].scale.setScalar(0.8);
    for (const j of jets) this.r.fxLayer.add(j);
    const wingman = from.clone().add(new THREE.Vector3(0.35, 0.08, 0.25));
    const outbound = [
      this._fly(jets[0], from.clone(), to.clone(), 0.7),
      this._fly(jets[1], wingman, to.clone().add(new THREE.Vector3(0.3, 0.05, 0.2)), 0.74),
    ];
    await Promise.all(outbound);
    this.boom(this.r.hexCenter(target.c, target.r), { size: 0.45 });
    this.floatText(this.r.hexCenter(target.c, target.r), this._hitText(res?.lost, res?.killed), this._hitColor(res?.lost, res?.killed), target.id);
    if (res?.attrition) { this.boom(to.clone(), { size: 0.3, color: 0xff7043 }); this.floatText(from.clone(), `−${res.attrition}`, '#ff9a7a', wing.id); }
    const inbound = [
      this._fly(jets[0], to.clone(), from.clone(), 0.7),
      this._fly(jets[1], to.clone().add(new THREE.Vector3(0.3, 0.05, 0.2)), wingman.clone(), 0.74),
    ];
    await Promise.all(inbound);
    for (const j of jets) this.r.fxLayer.remove(j);
    this._step();
    await this.wait(150);
  }

  async attack(atk, def, res) {
    const a = this.r.hexCenter(atk.c, atk.r);
    const d = this.r.hexCenter(def.c, def.r);
    this.tracer(a, d);
    await this.wait(160);
    this.boom(d, { size: res?.defKilled ? 0.9 : 0.4 });
    this.floatText(d, this._hitText(res?.defLost, res?.defKilled), this._hitColor(res?.defLost, res?.defKilled), def.id);
    if (res?.atkLost) {
      // defender's return fire, made visible
      await this.wait(120);
      this.tracer(d, a, 0xa8d0ff);
      await this.wait(140);
      this.boom(a, { size: 0.35 });
      this.floatText(a, this._hitText(res.atkLost, res.atkKilled), this._hitColor(res.atkLost, res.atkKilled), atk.id);
    }
    this._step();
    await this.wait(260);
  }

  // garrison shore batteries: a burst of tracers from the island, then impact
  async garrisonFire(f) {
    const pos = u => this.r.unitGroups.get(u.id)?.position.clone() || this.r.hexCenter(u.c, u.r);
    const a = pos(f.gar), d = pos(f.tgt);
    for (let i = 0; i < 3; i++) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
      this.tracer(a, d.clone().add(jitter), 0xffd27a);
      await this.wait(110);
    }
    this.boom(d, { size: f.killed ? 0.8 : 0.4 });
    this.floatText(d, this._hitText(f.lost, f.killed), this._hitColor(f.lost, f.killed), f.tgt.id);
    this._step();
    await this.wait(260);
  }

  async moved(u) {
    this._step();
    await this.wait(230);
  }

  async landing(flot, hex, results) {
    this._sfx('klaxon');
    const from = this.r.hexCenter(flot.c, flot.r);
    const to = this.r.hexCenter(hex.c, hex.r);
    // the moment of the campaign — bring the camera to the beach
    if (this.speed < 8) { this.r.focusOn(hex.c, hex.r, null, { dur: 0.5 }); await this.wait(350); }
    // landing craft waves
    for (let i = 0; i < 3; i++) {
      const craft = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.07, 0.22),
        new THREE.MeshBasicMaterial({ color: 0xc46a5a })
      );
      craft.position.copy(from);
      this.r.fxLayer.add(craft);
      const off = new THREE.Vector3((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
      const dest = to.clone().add(off);
      let t = 0;
      this.active.push({
        update: dt => {
          t += dt / 1.1;
          craft.position.lerpVectors(from, dest, Math.min(1, t));
          if (t >= 1) { this.r.fxLayer.remove(craft); this.boom(dest, { size: 0.35 }); return false; }
          return true;
        },
      });
      await this.wait(160);
    }
    await this.wait(900);
    for (const r of results || []) {
      if (r.kind === 'mine') this.boom(to.clone().add(new THREE.Vector3(0.3, 0, 0.4)), { size: 0.7, color: 0x7fd0ff });
    }
    this._step();
    await this.wait(300);
  }

  async drop(u, hex, res) {
    const to = this.r.hexCenter(hex.c, hex.r);
    if (this.speed < 8) { this.r.focusOn(hex.c, hex.r, null, { dur: 0.5 }); await this.wait(300); }
    const from = to.clone().add(new THREE.Vector3(-6, 5, -2));
    await this.arc(from, to, { color: 0xdddddd, apex: 1, dur: 0.8 });
    this.boom(to, { size: 0.4, color: 0xcccccc });
    this._step();
    await this.wait(250);
  }
}
