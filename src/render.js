// three.js presentation layer: the 3D hex board, unit tokens, labels,
// highlights and camera. Effects (missile arcs, explosions) live in fx.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { worldPos, worldToHex, key } from './hex.js';
import { typeOf } from './state.js';
import { visibleTo, controllerOf, baseDamageAt } from './rules.js';

const SIDE_COLORS = { red: 0xd8382e, blue: 0x2f7fe0 };
const SIDE_DARK = { red: 0x8c1f18, blue: 0x1c4f92 };

function makeLabelSprite(text, opts = {}) {
  const scale = opts.scale || 1;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${opts.bold ? '700' : '600'} ${opts.px || 34}px "Segoe UI", system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  canvas.width = w; canvas.height = 52;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(6,12,22,0.95)';
  ctx.strokeText(text, 10, 27);
  ctx.fillStyle = opts.color || '#e8eef7';
  ctx.fillText(text, 10, 27);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = w / 52;
  sprite.scale.set(0.028 * w * scale / aspect * aspect, 0.028 * 52 * scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export class Renderer {
  constructor(container, map) {
    this.map = map;
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060d18);
    this.scene.fog = new THREE.Fog(0x060d18, 40, 95);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
    const center = worldPos(9, 9);
    this.camera.position.set(center.x, 26, center.z + 17);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(center.x, 0, center.z);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 55;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minPolarAngle = Math.PI * 0.06;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // map-style panning: slide along the ground plane, never lift off it
    this.controls.screenSpacePanning = false;
    this.controls.panSpeed = 1.15;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.85;

    const amb = new THREE.AmbientLight(0x8fa3bd, 0.75);
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
    sun.position.set(18, 30, 8);
    const rim = new THREE.DirectionalLight(0x4d7dc4, 0.6);
    rim.position.set(-20, 12, -14);
    this.scene.add(amb, sun, rim);

    this.unitGroups = new Map(); // unit.id -> THREE.Group
    this.highlights = new THREE.Group();
    this.scene.add(this.highlights);
    this.fxLayer = new THREE.Group();
    this.scene.add(this.fxLayer);
    this.markers = new THREE.Group();
    this.scene.add(this.markers);

    this._buildBoard();
    this._buildLabels();

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.controls.update();
      // smooth unit motion
      for (const g of this.unitGroups.values()) {
        if (g.userData.target) {
          g.position.lerp(g.userData.target, Math.min(1, dt * 6));
        }
      }
      this._tickFx?.(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  hexTop(c, r) {
    const h = this.map.get(c, r);
    return h ? h.t.height : 0;
  }

  hexCenter(c, r, lift = 0) {
    const p = worldPos(c, r);
    return new THREE.Vector3(p.x, this.hexTop(c, r) + lift, p.z);
  }

  _buildBoard() {
    // merge one 6-sided prism per hex into a single vertex-colored mesh
    const positions = [], normals = [], colors = [];
    const tmpColor = new THREE.Color();
    const proto = {};
    for (const hex of this.map.hexes.values()) {
      const hgt = Math.max(0.04, hex.t.height);
      const kh = hgt.toFixed(3);
      if (!proto[kh]) {
        const g = new THREE.CylinderGeometry(0.985, 0.985, hgt, 6);
        proto[kh] = g.toNonIndexed();
      }
      const geo = proto[kh];
      const pos = geo.attributes.position, norm = geo.attributes.normal;
      const { x, z } = worldPos(hex.c, hex.r);
      const y = hgt / 2;
      tmpColor.setHex(hex.t.color);
      // slight per-hex variation so terrain doesn't look flat
      const v = ((hex.c * 7 + hex.r * 13) % 5) * 0.016 - 0.032;
      const cr = Math.min(1, Math.max(0, tmpColor.r + v));
      const cg = Math.min(1, Math.max(0, tmpColor.g + v));
      const cb = Math.min(1, Math.max(0, tmpColor.b + v));
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i) + x, pos.getY(i) + y, pos.getZ(i) + z);
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
        colors.push(cr, cg, cb);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.05 });
    this.boardMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.boardMesh);

    // dark abyss plane under everything
    const abyss = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshBasicMaterial({ color: 0x040a13 })
    );
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.set(worldPos(9, 9).x, -0.3, worldPos(9, 9).z);
    this.scene.add(abyss);

    // location markers
    for (const hex of this.map.hexes.values()) {
      if (!hex.loc) continue;
      const p = this.hexCenter(hex.c, hex.r);
      if (hex.loc.airbase) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.85, 0.03, 0.24),
          new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7 })
        );
        strip.position.set(p.x - 0.25, p.y + 0.02, p.z + 0.45);
        strip.rotation.y = 0.5;
        this.markers.add(strip);
      }
      if (hex.loc.city || hex.loc.capital) {
        const n = hex.loc.capital ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const bh = 0.12 + ((i * 37 + hex.c) % 4) * 0.08 + (hex.loc.capital ? 0.1 : 0);
          const b = new THREE.Mesh(
            new THREE.BoxGeometry(0.13, bh, 0.13),
            new THREE.MeshStandardMaterial({ color: 0xb9c4cf, roughness: 0.6 })
          );
          const ang = (i / n) * Math.PI * 2 + hex.r;
          b.position.set(p.x + Math.cos(ang) * 0.34 - 0.15, p.y + bh / 2, p.z + Math.sin(ang) * 0.3 - 0.35);
          this.markers.add(b);
        }
      }
      if (hex.loc.beach) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.88, 0.025, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xd9b23c, transparent: true, opacity: 0.5 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.rotation.z = Math.PI / 6;
        ring.position.set(p.x, p.y + 0.015, p.z);
        this.markers.add(ring);
      }
      if (hex.loc.fabs) {
        const fab = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.1, 0.3),
          new THREE.MeshStandardMaterial({ color: 0xd4c76a, emissive: 0x554d10, roughness: 0.4 })
        );
        fab.position.set(p.x + 0.4, p.y + 0.05, p.z + 0.3);
        this.markers.add(fab);
      }
    }
  }

  _buildLabels() {
    for (const hex of this.map.hexes.values()) {
      if (!hex.loc) continue;
      const big = hex.loc.capital || hex.loc.name.includes('Kadena');
      const sprite = makeLabelSprite(hex.loc.name, {
        scale: big ? 0.62 : 0.5,
        px: 34, bold: big,
        color: hex.loc.capital ? '#ffd76a' : hex.loc.side === 'red' ? '#f2a9a2' : '#dbe7f5',
      });
      const p = this.hexCenter(hex.c, hex.r);
      sprite.position.set(p.x, p.y + 1.05, p.z);
      this.scene.add(sprite);
    }
  }

  // ---------------------------------------------------------------- units
  _unitMesh(u) {
    const t = typeOf(u);
    const g = new THREE.Group();
    const color = SIDE_COLORS[u.side], dark = SIDE_DARK[u.side];
    const baseMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
    const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.09, 6), baseMat);
    base.position.y = 0.045;
    g.add(base);

    let bodyH = 0.3;
    if (t.cls === 'ground') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.3), darkMat);
      body.position.y = 0.19;
      g.add(body);
      if (t.armor) {
        const turret = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.16), baseMat);
        turret.position.y = 0.34;
        g.add(turret);
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3), baseMat);
        gun.rotation.x = Math.PI / 2; gun.position.set(0, 0.34, 0.22);
        g.add(gun);
      }
      bodyH = 0.4;
    } else if (t.cls === 'naval' || t.cls === 'amphib') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, t.carrier ? 0.85 : 0.68), darkMat);
      hull.position.y = 0.16;
      g.add(hull);
      if (t.carrier) {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.85), baseMat);
        deck.position.y = 0.26;
        g.add(deck);
      } else {
        const sup = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), baseMat);
        sup.position.y = 0.29;
        g.add(sup);
      }
      if (t.cls === 'amphib') {
        const bow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), baseMat);
        bow.position.set(0, 0.24, -0.2);
        g.add(bow);
      }
      g.rotation.y = 0.6;
      bodyH = 0.36;
    } else if (t.cls === 'sub') {
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 8), darkMat);
      hull.rotation.z = Math.PI / 2;
      hull.position.y = 0.14;
      g.add(hull);
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), baseMat);
      sail.position.y = 0.24;
      g.add(sail);
      bodyH = 0.3;
    } else if (t.cls === 'air') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 4), baseMat);
      body.rotation.x = Math.PI / 2;
      body.position.y = 0.3;
      g.add(body);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.14), darkMat);
      wing.position.y = 0.3;
      g.add(wing);
      bodyH = 0.44;
    }

    // step pips
    const pipGroup = new THREE.Group();
    pipGroup.name = 'pips';
    g.add(pipGroup);

    const label = makeLabelSprite(t.short, { scale: 0.34, px: 30, bold: true, color: '#ffffff' });
    label.position.y = bodyH + 0.34;
    label.name = 'unitlabel';
    g.add(label);

    g.userData.unitId = u.id;
    return g;
  }

  _updatePips(g, u) {
    const pipGroup = g.getObjectByName('pips');
    while (pipGroup.children.length) pipGroup.remove(pipGroup.children[0]);
    const mat = new THREE.MeshBasicMaterial({ color: u.hp <= 1 ? 0xff7043 : 0xf3f7d9 });
    for (let i = 0; i < u.hp; i++) {
      const pip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.055), mat);
      pip.position.set(-0.24 + i * 0.16, 0.02, 0.42);
      pipGroup.add(pip);
    }
  }

  syncUnits(game, playerSide = 'blue') {
    const seen = new Set();
    for (const u of game.units) {
      const show = u.alive && !u.embarkedIn && visibleTo(u, playerSide);
      let g = this.unitGroups.get(u.id);
      if (show) {
        if (!g) {
          g = this._unitMesh(u);
          this.unitGroups.set(u.id, g);
          this.scene.add(g);
          g.position.copy(this._stackPos(game, u));
        }
        seen.add(u.id);
        g.userData.target = this._stackPos(game, u);
        this._updatePips(g, u);
        // dim spent friendly units
        const spent = u.side === 'blue' && (u.attacked || u.moved >= (typeOf(u).mov || 0)) && typeOf(u).cls !== 'air';
        g.traverse(o => {
          if (o.material && o.material.opacity !== undefined && o.name !== 'unitlabel') {
            o.material.transparent = spent;
            o.material.opacity = spent ? 0.55 : 1;
          }
        });
        // hidden-but-friendly subs shimmer
        if (u.cls === 'sub' && u.hidden) {
          g.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.55; } });
        }
      } else if (g) {
        this.scene.remove(g);
        this.unitGroups.delete(u.id);
      }
    }
    for (const [id, g] of this.unitGroups) {
      if (!seen.has(id)) { this.scene.remove(g); this.unitGroups.delete(id); }
    }
  }

  _stackPos(game, u) {
    const mates = game.units.filter(x => x.alive && !x.embarkedIn && x.c === u.c && x.r === u.r);
    const idx = mates.indexOf(mates.find(x => x.id === u.id));
    const n = mates.length;
    const p = this.hexCenter(u.c, u.r);
    if (n > 1) {
      const ang = (idx / n) * Math.PI * 2 + 0.7;
      p.x += Math.cos(ang) * 0.34;
      p.z += Math.sin(ang) * 0.3;
    }
    return p;
  }

  // ------------------------------------------------------------ highlights
  clearHighlights() {
    while (this.highlights.children.length) this.highlights.remove(this.highlights.children[0]);
  }

  addHexHighlight(c, r, color, opacity = 0.35, ring = false) {
    const p = this.hexCenter(c, r);
    let mesh;
    if (ring) {
      mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.07, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = Math.PI / 6;
    } else {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 0.92, 0.02, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false })
      );
    }
    mesh.position.set(p.x, p.y + 0.06, p.z);
    mesh.renderOrder = 10;
    this.highlights.add(mesh);
    return mesh;
  }

  selectRing(c, r) {
    return this.addHexHighlight(c, r, 0xffffff, 0.9, true);
  }

  // --------------------------------------------------------------- picking
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const { c, r } = worldToHex(hit.x, hit.z);
    if (!this.map.inBounds(c, r)) return null;
    return { c, r };
  }

  focusOn(c, r, distance = null) {
    const p = this.hexCenter(c, r);
    const cur = this.controls.target.clone();
    const delta = p.clone().sub(cur);
    this.controls.target.copy(p);
    this.camera.position.add(delta);
    if (distance) {
      const dir = this.camera.position.clone().sub(p).normalize();
      this.camera.position.copy(p.clone().add(dir.multiplyScalar(distance)));
    }
  }
}
