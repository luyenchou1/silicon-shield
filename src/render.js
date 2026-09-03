// three.js presentation layer: the 3D hex board, terrain decor, animated
// water, unit models, labels, highlights and camera. Effects (missile arcs,
// explosions) live in fx.js. Everything static is merged into a handful of
// vertex-colored meshes so the whole theater is a few draw calls.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { worldPos, worldToHex, key } from './hex.js';
import { typeOf } from './state.js';
import { visibleTo, controllerOf, baseDamageAt } from './rules.js';

const SIDE_COLORS = { red: 0xe0453a, blue: 0x3d8bff };
const SIDE_DARK = { red: 0x8c1f18, blue: 0x1c4f92 };
const STEEL = 0x6d7784;

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
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.028 * w * scale, 0.028 * 52 * scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

// deterministic per-hex jitter so decor never pops between reloads
function hash(c, r, k = 0) {
  let h = (c * 374761393 + r * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Accumulates transformed, vertex-colored geometry into one BufferGeometry.
class MeshBatch {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this._m = new THREE.Matrix4(); this._n = new THREE.Matrix3(); }
  add(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, colorFn = null } = {}) {
    const g = geo.userData.ni || (geo.userData.ni = geo.index ? geo.toNonIndexed() : geo);
    this._m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this._n.getNormalMatrix(this._m);
    const p = g.attributes.position, n = g.attributes.normal;
    const v = new THREE.Vector3(), nv = new THREE.Vector3(), c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const cc = colorFn ? colorFn(v.y, c) : c;
      v.applyMatrix4(this._m);
      nv.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(this._n).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(nv.x, nv.y, nv.z);
      this.col.push(cc.r, cc.g, cc.b);
    }
  }
  build(mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return new THREE.Mesh(geo, mat);
  }
}

const WATER_VERT = `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const WATER_FRAG = `
  uniform float uTime;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    float a = sin(vWorld.x * 2.3 + uTime * 0.8) * sin(vWorld.z * 1.9 - uTime * 0.6);
    float b = sin((vWorld.x * 0.7 + vWorld.z * 1.1) * 3.1 + uTime * 1.1);
    float c = sin((vWorld.x - vWorld.z * 0.6) * 4.7 - uTime * 1.7);
    float crest = smoothstep(0.62, 1.0, a * 0.5 + 0.5) * 0.28
                + smoothstep(0.86, 1.0, b * 0.5 + 0.5) * 0.22
                + smoothstep(0.93, 1.0, c * 0.5 + 0.5) * 0.18;
    vec3 base = vec3(0.04, 0.13, 0.26);
    vec3 col = base + crest * vec3(0.30, 0.42, 0.50);
    gl_FragColor = vec4(col, 0.26 + crest * 0.35);
    #include <fog_fragment>
  }`;

export class Renderer {
  constructor(container, map) {
    this.map = map;
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060d18);
    this.scene.fog = new THREE.Fog(0x060d18, 42, 98);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
    // phones open framed tight on Taiwan itself; wide screens get the full theater
    const narrow = container.clientWidth > 0 && container.clientWidth < 700;
    const center = narrow ? worldPos(11, 9) : worldPos(9, 9);
    this.camera.position.set(center.x, narrow ? 19 : 26, center.z + (narrow ? 12 : 17));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(center.x, 0, center.z);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 5;
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
    // any user camera input cancels an in-flight camera tween
    this.controls.addEventListener('start', () => { this._tween = null; });

    // lighting: warm low sun with soft shadows, cool sky bounce, blue rim
    const hemi = new THREE.HemisphereLight(0x9fbce6, 0x2a2419, 0.42);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    const mid = worldPos(9, 10);
    sun.position.set(mid.x + 14, 28, mid.z + 10);
    sun.target.position.set(mid.x, 0, mid.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(narrow ? 1024 : 2048, narrow ? 1024 : 2048);
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    const rim = new THREE.DirectionalLight(0x4d7dc4, 0.5);
    rim.position.set(-20, 12, -14);
    this.scene.add(hemi, sun, sun.target, rim);
    this.sun = sun;

    this.unitGroups = new Map(); // unit.id -> THREE.Group
    this.highlights = new THREE.Group();
    this.scene.add(this.highlights);
    this.fxLayer = new THREE.Group();
    this.scene.add(this.fxLayer);
    this.markers = new THREE.Group();
    this.scene.add(this.markers);

    this._buildBoard();
    this._buildDecor();
    this._buildEdges();
    this._buildWater();
    this._buildLabels();

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._resize();
    window.addEventListener('resize', () => this._resize());

    this._tween = null;
    this._time = 0;
    this.clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this._time += dt;
      this._tickTween(dt);
      this.controls.update();
      this._tickUnits(dt);
      this._tickHighlights();
      this.water.material.uniforms.uTime.value = this._time;
      this._tickFx?.(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
    // rAF pauses in hidden tabs, which would freeze awaited battle animations
    // mid-turn; keep the fx clock (not rendering) alive so the AI turn finishes
    setInterval(() => {
      if (!document.hidden) return;
      this._tickFx?.(Math.min(this.clock.getDelta(), 0.25));
    }, 120);
  }

  // graphics setting: shadows are the one expensive feature on weak GPUs
  setShadows(on) {
    if (this.renderer.shadowMap.enabled === on) return;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
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

  // ----------------------------------------------------------------- board
  _buildBoard() {
    // one 6-sided prism per hex, merged into a single vertex-colored mesh;
    // land hexes are inset a hair so the tile seams read like a tabletop map
    const batch = new MeshBatch();
    const proto = {};
    const tmp = new THREE.Color();
    for (const hex of this.map.hexes.values()) {
      const hgt = Math.max(0.04, hex.t.height);
      const radius = hex.t.water ? 1.0 : 0.965;
      const kh = hgt.toFixed(3) + radius;
      if (!proto[kh]) proto[kh] = new THREE.CylinderGeometry(radius, radius, hgt, 6).toNonIndexed();
      const { x, z } = worldPos(hex.c, hex.r);
      tmp.setHex(hex.t.color);
      const v = (hash(hex.c, hex.r) - 0.5) * 0.06;
      const col = new THREE.Color(
        Math.min(1, Math.max(0, tmp.r + v)), Math.min(1, Math.max(0, tmp.g + v)), Math.min(1, Math.max(0, tmp.b + v)));
      // land tiles: darker flanks than tops, like cut card
      batch.add(proto[kh], col, {
        x, y: hgt / 2, z,
        colorFn: hex.t.water ? null : (ly, c) => (ly < hgt * 0.45 ? c.clone().multiplyScalar(0.72) : c),
      });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.04 });
    this.boardMesh = batch.build(mat);
    this.boardMesh.receiveShadow = true;
    this.scene.add(this.boardMesh);

    // dark abyss plane under everything
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: 0x040a13 }));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.set(worldPos(9, 9).x, -0.3, worldPos(9, 9).z);
    this.scene.add(abyss);
  }

  // terrain relief + settlements, all merged into one shadow-casting mesh
  _buildDecor() {
    const batch = new MeshBatch();
    const peak = new THREE.ConeGeometry(0.62, 0.95, 8);
    const knoll = new THREE.ConeGeometry(0.34, 0.26, 6);
    const tree = new THREE.ConeGeometry(0.075, 0.2, 5);
    const bldg = new THREE.BoxGeometry(1, 1, 1);
    const rock = 0x7d857c, moss = 0x46583f, snow = 0xc9d2cc, hillTone = 0x4f6a3a, pine = 0x274a2c, mainHill = 0x5a5044;
    const gold = 0xd9b23c;

    for (const hex of this.map.hexes.values()) {
      if (!hex.t.land) continue;
      const { x, z } = worldPos(hex.c, hex.r);
      const top = hex.t.height;
      if (hex.t.mountain) {
        // two offset peaks, snow toward the tips
        // a ridge of four staggered peaks: mossy slopes, rock shoulders, a dab of snow
        for (let i = 0; i < 4; i++) {
          const ox = (hash(hex.c, hex.r, i) - 0.5) * 1.0, oz = (hash(hex.c, hex.r, i + 9) - 0.5) * 0.9;
          const s = 0.34 + hash(hex.c, hex.r, i + 3) * 0.36;
          batch.add(peak, moss, {
            x: x + ox, y: top + 0.95 * s / 2 - 0.03, z: z + oz, sx: s * 1.25, sy: s, sz: s * 1.25,
            ry: hash(hex.c, hex.r, i + 5) * Math.PI,
            colorFn: (ly, c) => (ly > 0.4 ? new THREE.Color(snow) : ly > 0.1 ? new THREE.Color(rock).lerp(c, 1 - (ly - 0.1) / 0.3 * 0.7) : c),
          });
        }
      } else if (hex.ch === 'h' || hex.ch === 'm') {
        // rolling hills: three knolls and (Taiwan side) a stand of trees
        for (let i = 0; i < 3; i++) {
          const ox = (hash(hex.c, hex.r, i) - 0.5) * 1.0, oz = (hash(hex.c, hex.r, i + 7) - 0.5) * 0.9;
          const s = 0.7 + hash(hex.c, hex.r, i + 2) * 0.6;
          batch.add(knoll, hex.ch === 'h' ? hillTone : mainHill, { x: x + ox, y: top + 0.13 * s - 0.01, z: z + oz, sx: s, sy: s, sz: s });
        }
        if (hex.ch === 'h') {
          for (let i = 0; i < 6; i++) {
            const ox = (hash(hex.c, hex.r, 20 + i) - 0.5) * 1.3, oz = (hash(hex.c, hex.r, 30 + i) - 0.5) * 1.1;
            batch.add(tree, pine, { x: x + ox, y: top + 0.1, z: z + oz, sy: 0.8 + hash(hex.c, hex.r, 40 + i) * 0.5 });
          }
        }
      } else if (hex.ch === 't' && !hex.loc) {
        // farmland copses on open Taiwan plain
        for (let i = 0; i < 3; i++) {
          const ox = (hash(hex.c, hex.r, 50 + i) - 0.5) * 1.3, oz = (hash(hex.c, hex.r, 60 + i) - 0.5) * 1.2;
          batch.add(tree, pine, { x: x + ox, y: top + 0.1, z: z + oz, sy: 0.7 + hash(hex.c, hex.r, 70 + i) * 0.4 });
        }
      }

      const loc = hex.loc;
      if (!loc) continue;
      if (loc.city || loc.capital) {
        // a downtown cluster: taller core, lower fringe; capital gets towers
        const n = loc.capital ? 11 : 7;
        const tone = loc.side === 'red' ? 0xb3aa9c : 0xc2ccd6;
        for (let i = 0; i < n; i++) {
          const ang = hash(hex.c, hex.r, 80 + i) * Math.PI * 2;
          const rad = 0.12 + hash(hex.c, hex.r, 90 + i) * 0.42;
          const bx = x + Math.cos(ang) * rad - 0.12, bz = z + Math.sin(ang) * rad - 0.28;
          const core = rad < 0.3;
          const bh = (core ? 0.22 : 0.1) + hash(hex.c, hex.r, 100 + i) * (core ? 0.3 : 0.12) + (loc.capital && core ? 0.18 : 0);
          const bw = 0.09 + hash(hex.c, hex.r, 110 + i) * 0.08;
          batch.add(bldg, tone, {
            x: bx, y: top + bh / 2, z: bz, sx: bw, sy: bh, sz: bw, ry: hash(hex.c, hex.r, 120 + i) * 0.6,
            colorFn: (ly, c) => (ly > 0.45 ? c.clone().multiplyScalar(1.12) : c.clone().multiplyScalar(0.88)),
          });
        }
      }
      if (loc.airbase) {
        // crossed runways + a hangar row
        const strip = new THREE.BoxGeometry(0.9, 0.025, 0.2);
        batch.add(strip, 0x3a4048, { x: x - 0.2, y: top + 0.012, z: z + 0.45, ry: 0.5 });
        batch.add(strip, 0x444a52, { x: x - 0.28, y: top + 0.012, z: z + 0.5, ry: -0.35, sx: 0.7, sz: 0.7 });
        for (let i = 0; i < 3; i++) {
          batch.add(bldg, 0x8a9199, { x: x + 0.28 + i * 0.13, y: top + 0.04, z: z + 0.62, sx: 0.1, sy: 0.08, sz: 0.11 });
        }
      }
      if (loc.port || loc.navalbase) {
        // piers reaching toward the nearest water neighbor, with a crane
        const w = this.map.neighborsOf(hex.c, hex.r).find(nb => nb.t.water);
        if (w) {
          const wp = worldPos(w.c, w.r);
          const dx = wp.x - x, dz = wp.z - z, len = Math.hypot(dx, dz);
          const ux = dx / len, uz = dz / len, ang = Math.atan2(ux, uz);
          for (let i = -1; i <= 1; i += 2) {
            batch.add(bldg, 0x7d7368, {
              x: x + ux * 0.95 + (-uz) * 0.14 * i, y: top - 0.04, z: z + uz * 0.95 + ux * 0.14 * i,
              sx: 0.07, sy: 0.05, sz: 0.55, ry: ang,
            });
          }
          batch.add(bldg, gold, { x: x + ux * 0.75, y: top + 0.14, z: z + uz * 0.75, sx: 0.03, sy: 0.3, sz: 0.03 });
          batch.add(bldg, gold, { x: x + ux * 0.75, y: top + 0.28, z: z + uz * 0.75, sx: 0.03, sy: 0.025, sz: 0.3, ry: ang });
        }
      }
      if (loc.fabs) {
        batch.add(bldg, 0xd8cb6e, { x: x + 0.42, y: top + 0.06, z: z + 0.28, sx: 0.28, sy: 0.12, sz: 0.2 });
        batch.add(bldg, 0xe8dc86, { x: x + 0.6, y: top + 0.05, z: z + 0.1, sx: 0.14, sy: 0.1, sz: 0.14 });
      }
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
    this.decor = batch.build(mat);
    this.decor.castShadow = true;
    this.decor.receiveShadow = true;
    this.scene.add(this.decor);

    // landing beaches: the gold rings the briefing talks about
    for (const hex of this.map.hexes.values()) {
      if (!hex.loc?.beach) continue;
      const p = this.hexCenter(hex.c, hex.r);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.86, 0.025, 6, 6),
        new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.55 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = Math.PI / 6;
      ring.position.set(p.x, p.y + 0.015, p.z);
      this.markers.add(ring);
    }
  }

  // faint hex outlines on every tile top — the cartographic grid
  _buildEdges() {
    // land outlines are crisp; sea-lane outlines stay faint so the ocean reads as water
    const land = [], sea = [];
    for (const hex of this.map.hexes.values()) {
      const { x, z } = worldPos(hex.c, hex.r);
      const y = Math.max(0.04, hex.t.height) + 0.006;
      const rad = hex.t.water ? 1.0 : 0.965;
      const pts = hex.t.water ? sea : land;
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
        pts.push(x + rad * Math.sin(a0), y, z + rad * Math.cos(a0), x + rad * Math.sin(a1), y, z + rad * Math.cos(a1));
      }
    }
    for (const [pts, opacity] of [[land, 0.3], [sea, 0.1]]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x03070d, transparent: true, opacity })));
    }
  }

  // translucent animated sheet just above the water tiles: crests move, the
  // deep/littoral tile colors still show through, ships sit in it at the waterline
  _buildWater() {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const hex of this.map.hexes.values()) {
      const { x, z } = worldPos(hex.c, hex.r);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const geo = new THREE.PlaneGeometry(maxX - minX + 4, maxZ - minZ + 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, depthWrite: false, fog: true,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set((minX + maxX) / 2, 0.075, (minZ + maxZ) / 2);
    this.water.renderOrder = 1;
    this.scene.add(this.water);
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
  // ship deck plan: pointed bow (-Z), straight sides, rounded stern — extruded up
  _hullGeo(len, beam, height) {
    const L = len / 2, B = beam / 2;
    const s = new THREE.Shape();
    s.moveTo(0, L);
    s.quadraticCurveTo(B, L * 0.45, B, -L * 0.7);
    s.quadraticCurveTo(B, -L, 0, -L);
    s.quadraticCurveTo(-B, -L, -B, -L * 0.7);
    s.quadraticCurveTo(-B, L * 0.45, 0, L);
    const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); // shape length axis -> Z (bow at -Z), extrusion -> up
    return g;
  }

  _unitMesh(u) {
    const t = typeOf(u);
    const g = new THREE.Group();
    const body = new THREE.Group(); // idle animation moves this, not the group
    g.add(body);
    const side = SIDE_COLORS[u.side];
    // hulls and armor read as steel with a tint of the side; accents carry the side color
    const steel = new THREE.Color(STEEL).lerp(new THREE.Color(side), 0.22);
    const hullMat = new THREE.MeshStandardMaterial({ color: steel, roughness: 0.5, metalness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.5, metalness: 0.15 });
    const darkMat = new THREE.MeshStandardMaterial({ color: SIDE_DARK[u.side], roughness: 0.6 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3f4a55, roughness: 0.8 });
    const add = (geo, mat, x, y, z, rot) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      m.castShadow = true; m.receiveShadow = true;
      body.add(m);
      return m;
    };

    // side-colored base disc with a soft glow so the token pops on any terrain
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.4, 0.09, 6),
      new THREE.MeshStandardMaterial({ color: side, emissive: side, emissiveIntensity: 0.22, roughness: 0.55 })
    );
    base.position.y = 0.045;
    base.receiveShadow = true;
    g.add(base);

    let bodyH = 0.3;
    if (t.cls === 'ground' && t.fortress) {
      // island garrison: hexagonal bunker + sandbag ring + shore gun
      add(new THREE.TorusGeometry(0.32, 0.035, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.95 }), 0, 0.11, 0, [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.2, 0.24, 0.14, 6), new THREE.MeshStandardMaterial({ color: 0x555b60, roughness: 0.9 }), 0, 0.17, 0);
      add(new THREE.CylinderGeometry(0.23, 0.23, 0.035, 6), accentMat, 0, 0.26, 0);
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.22), darkMat, 0, 0.2, -0.24, [Math.PI / 2 + 0.18, 0, 0]);
      bodyH = 0.4;
    } else if (t.cls === 'ground' && t.armor) {
      // tank: tracks, hull, turret, long gun
      add(new THREE.BoxGeometry(0.11, 0.09, 0.42), darkMat, -0.13, 0.14, 0);
      add(new THREE.BoxGeometry(0.11, 0.09, 0.42), darkMat, 0.13, 0.14, 0);
      add(new THREE.BoxGeometry(0.3, 0.08, 0.4), hullMat, 0, 0.21, 0);
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 8), accentMat, 0, 0.29, 0.02);
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.3), darkMat, 0, 0.3, -0.2, [Math.PI / 2, 0, 0]);
      bodyH = 0.42;
    } else if (t.cls === 'ground') {
      // infantry: a fireteam of little soldiers
      const soldier = (x, z) => {
        add(new THREE.CapsuleGeometry(0.045, 0.1, 3, 8), accentMat, x, 0.2, z);
        add(new THREE.SphereGeometry(0.035, 8, 6), darkMat, x, 0.3, z);
      };
      soldier(-0.12, 0.06); soldier(0.12, 0.06); soldier(0, -0.12);
      bodyH = 0.4;
    } else if (t.cls === 'naval' && t.carrier) {
      // flat-top: hull low, overhanging angled flight deck, island to starboard
      add(this._hullGeo(0.8, 0.2, 0.1), hullMat, 0, 0.09, 0);
      add(new THREE.BoxGeometry(0.3, 0.035, 0.98), deckMat, 0, 0.21, 0);
      add(new THREE.BoxGeometry(0.22, 0.02, 0.5), deckMat, -0.09, 0.24, 0.1, [0, 0.16, 0]);
      add(new THREE.BoxGeometry(0.07, 0.1, 0.16), accentMat, 0.13, 0.28, 0.14);
      add(new THREE.ConeGeometry(0.03, 0.09, 4), accentMat, 0.05, 0.24, -0.28, [Math.PI / 2, 0, 0]);
      add(new THREE.ConeGeometry(0.03, 0.09, 4), accentMat, -0.04, 0.24, 0.32, [Math.PI / 2, 0, 0]);
      body.rotation.y = 0.6;
      bodyH = 0.4;
    } else if (t.cls === 'naval') {
      // surface combatant: shaped hull, deckhouse, bridge, mast, bow gun
      add(this._hullGeo(0.74, 0.17, 0.1), hullMat, 0, 0.09, 0);
      add(new THREE.BoxGeometry(0.12, 0.09, 0.3), hullMat, 0, 0.23, 0.02);
      add(new THREE.BoxGeometry(0.1, 0.07, 0.1), accentMat, 0, 0.31, -0.06);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.16), darkMat, 0, 0.4, -0.02);
      add(new THREE.BoxGeometry(0.06, 0.045, 0.08), accentMat, 0, 0.21, -0.26);
      body.rotation.y = 0.6;
      bodyH = 0.42;
    } else if (t.cls === 'amphib') {
      // landing ship: boxy hull, blunt bow ramp, aft deckhouse, landing craft on deck
      add(new THREE.BoxGeometry(0.26, 0.11, 0.58), hullMat, 0, 0.15, 0.02);
      add(new THREE.BoxGeometry(0.24, 0.03, 0.2), accentMat, 0, 0.24, -0.24, [-0.55, 0, 0]);
      add(new THREE.BoxGeometry(0.18, 0.08, 0.14), accentMat, 0, 0.25, 0.22);
      add(new THREE.BoxGeometry(0.07, 0.035, 0.12), deckMat, -0.06, 0.23, -0.02);
      add(new THREE.BoxGeometry(0.07, 0.035, 0.12), deckMat, 0.07, 0.23, 0.08);
      body.rotation.y = 0.6;
      bodyH = 0.36;
    } else if (t.cls === 'sub') {
      const hull = add(new THREE.CapsuleGeometry(0.09, 0.5, 4, 8), hullMat, 0, 0.14, 0);
      hull.rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.05, 0.1, 0.14), accentMat, 0, 0.23, 0); // sail
      add(new THREE.BoxGeometry(0.16, 0.015, 0.06), accentMat, 0.28, 0.14, 0); // stern planes
      add(new THREE.BoxGeometry(0.015, 0.12, 0.06), accentMat, 0.3, 0.16, 0); // rudder
      body.rotation.y = 0.6 + Math.PI / 2;
      bodyH = 0.3;
    } else if (t.cls === 'air') {
      // fighter: fuselage, swept wings, twin tails; bombers get long straight wings
      const bomber = t.short === 'H-6K';
      const fus = add(new THREE.ConeGeometry(0.1, bomber ? 0.62 : 0.5, 4), hullMat, 0, 0.3, 0, [Math.PI / 2, 0, 0]);
      fus.scale.set(1, 1, 0.75);
      if (bomber) {
        add(new THREE.BoxGeometry(0.72, 0.025, 0.12), accentMat, 0, 0.3, 0.02);
        add(new THREE.BoxGeometry(0.28, 0.02, 0.08), accentMat, 0, 0.32, 0.25);
      } else {
        add(new THREE.BoxGeometry(0.24, 0.025, 0.16), accentMat, -0.15, 0.3, 0.04, [0, 0.45, 0]);
        add(new THREE.BoxGeometry(0.24, 0.025, 0.16), accentMat, 0.15, 0.3, 0.04, [0, -0.45, 0]);
        add(new THREE.BoxGeometry(0.02, 0.09, 0.09), darkMat, -0.05, 0.36, 0.19, [0, 0, 0.35]);
        add(new THREE.BoxGeometry(0.02, 0.09, 0.09), darkMat, 0.05, 0.36, 0.19, [0, 0, -0.35]);
      }
      bodyH = 0.46;
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
    g.userData.body = body;
    g.userData.cls = t.cls;
    g.userData.phase = hash(u.id, 7) * Math.PI * 2;
    return g;
  }

  _updatePips(g, u) {
    const pipGroup = g.getObjectByName('pips');
    while (pipGroup.children.length) pipGroup.remove(pipGroup.children[0]);
    const mat = new THREE.MeshBasicMaterial({ color: u.hp <= 1 ? 0xff7043 : 0xf3f7d9, toneMapped: false });
    for (let i = 0; i < u.hp; i++) {
      const pip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.055), mat);
      pip.position.set(-0.24 + i * 0.16, 0.02, 0.42);
      pipGroup.add(pip);
    }
  }

  // idle life: ships ride a swell, aircraft hover and bank, subs breathe
  _tickUnits(dt) {
    const t = this._time;
    for (const g of this.unitGroups.values()) {
      if (g.userData.target) g.position.lerp(g.userData.target, Math.min(1, dt * 6));
      const b = g.userData.body, ph = g.userData.phase, cls = g.userData.cls;
      if (!b) continue;
      if (cls === 'naval' || cls === 'amphib') {
        b.position.y = Math.sin(t * 1.3 + ph) * 0.012;
        b.rotation.z = Math.sin(t * 1.1 + ph) * 0.03;
        b.rotation.x = Math.sin(t * 0.8 + ph) * 0.02;
      } else if (cls === 'air') {
        b.position.y = 0.06 + Math.sin(t * 2.1 + ph) * 0.03;
        b.rotation.z = Math.sin(t * 1.4 + ph) * 0.08;
      } else if (cls === 'sub') {
        b.position.y = Math.sin(t * 0.9 + ph) * 0.008;
      }
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
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false })
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = Math.PI / 6;
      mesh.userData.pulse = true;
    } else {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 0.92, 0.02, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, toneMapped: false })
      );
    }
    mesh.position.set(p.x, p.y + 0.06, p.z);
    mesh.renderOrder = 10;
    this.highlights.add(mesh);
    return mesh;
  }

  _tickHighlights() {
    const s = 1 + Math.sin(this._time * 4) * 0.05;
    for (const h of this.highlights.children) {
      if (h.userData.pulse) h.scale.set(s, s, 1);
    }
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

  // ---------------------------------------------------------------- camera
  // Glide the view to a hex. distance: optional new camera distance; the
  // viewing angle is preserved so the map never lurches.
  focusOn(c, r, distance = null, { instant = false, dur = 0.65 } = {}) {
    const p = this.hexCenter(c, r);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (distance) offset.setLength(distance);
    const toP = p.clone().add(offset);
    if (instant) {
      this.controls.target.copy(p);
      this.camera.position.copy(toP);
      this._tween = null;
      return;
    }
    this._tween = { t: 0, dur, fromT: this.controls.target.clone(), toT: p, fromP: this.camera.position.clone(), toP };
  }

  _tickTween(dt) {
    const tw = this._tween;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = tw.t * tw.t * (3 - 2 * tw.t); // smoothstep
    this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
    this.camera.position.lerpVectors(tw.fromP, tw.toP, e);
    if (tw.t >= 1) this._tween = null;
  }
}
