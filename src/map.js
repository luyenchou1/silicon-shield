// The theater map: a 20 x 22 hex grid covering the Taiwan Strait region.
// One hex is roughly 40-45 km. Peripheral geography (Okinawa, Luzon) is
// distance-compressed toward the map corners, a standard operational-wargame
// convention; see README for the geographic assumptions.
//
// Legend:
//   ~ deep ocean          , littoral / shallow water
//   M mainland plain      m mainland hills           u mainland city
//   t Taiwan plain        h Taiwan hills             ^ Taiwan high mountains
//   U Taiwan city         i small island (Kinmen/Matsu/Penghu)
//   K Okinawa (Japan)     L Luzon (Philippines)

import { key, neighbors, hexDist } from './hex.js';

const ROWS = [
  'MMMuM,,~~~~~~~~~~K~~', // 0
  'MMMMu,,~~~~~~~~~~,~~', // 1
  'MMMMM,,~~~~~~~~~~~~~', // 2
  'MMMMu,i,~~~~~~~~~~~~', // 3
  'MMMMm,,~,,,,~~~~~~~~', // 4
  'MMMm,,~~~,tUU,~~~~~~', // 5
  'MMum,,~~~,Ut^^,~~~~~', // 6
  'MMum,,~~~,h^^t,~~~~~', // 7
  'MMm,,~~~~,U^^U,~~~~~', // 8
  'Mui,,~~~~,tt^h,~~~~~', // 9
  'MMm,,~,i,,th^h,~~~~~', // 10
  'MM,,~~~,,,th^t,~~~~~', // 11
  'Mm,,~~~~,,Ut^t,~~~~~', // 12
  'Mu,,~~~~~,Uht,~~~~~~', // 13
  'MM,,~~~~~,th,~~~~~~~', // 14
  'M,,~~~~~~~,,,~~~~~~~', // 15
  'M,~~~~~~~~~~~~~~~~~~', // 16
  '~,~~~~~~~~~~~~~,,,~~', // 17
  '~~~~~~~~~~~~~~,LLL,~', // 18
  '~~~~~~~~~~~~~~,LLLL,', // 19
  '~~~~~~~~~~~~~,LLLLLL', // 20
  '~~~~~~~~~~~~~,LLLLLL', // 21
];

export const W = 20, H = 22;

export const TERRAIN = {
  '~': { name: 'Deep ocean', water: true, moveSea: 1, height: 0.02, color: 0x0e2a4a },
  ',': { name: 'Littoral', water: true, moveSea: 1, height: 0.05, color: 0x17466e },
  'M': { name: 'Mainland plain', land: true, region: 'prc', height: 0.16, color: 0x5c5347 },
  'm': { name: 'Mainland hills', land: true, region: 'prc', height: 0.30, color: 0x4e463c },
  'u': { name: 'Mainland city', land: true, region: 'prc', urban: true, height: 0.20, color: 0x6e6152 },
  't': { name: 'Plains', land: true, region: 'tw', height: 0.16, color: 0x4c6b3a },
  'h': { name: 'Hills', land: true, region: 'tw', height: 0.34, color: 0x476033 },
  '^': { name: 'High mountains', land: true, region: 'tw', mountain: true, height: 0.85, color: 0x5d6b60 },
  'U': { name: 'City', land: true, region: 'tw', urban: true, height: 0.22, color: 0x7a8577 },
  'i': { name: 'Island', land: true, region: 'tw', island: true, height: 0.14, color: 0x6b7d4f },
  'K': { name: 'Okinawa', land: true, region: 'jp', height: 0.16, color: 0x4f6b57 },
  'L': { name: 'Luzon', land: true, region: 'ph', height: 0.20, color: 0x4f6b3f },
};

// Named locations and their strategic features.
// kinds: capital, city, port, airbase, beach (amphib-suitable), navalbase, staging
export const LOCS = [
  // --- Mainland (PRC) ---
  { c: 3, r: 0, name: 'Ningbo', side: 'red', port: true, navalbase: true, city: true },
  { c: 4, r: 1, name: 'Wenzhou', side: 'red', airbase: true, port: true, city: true },
  { c: 4, r: 3, name: 'Fuzhou', side: 'red', airbase: true, port: true, staging: true, city: true },
  { c: 2, r: 6, name: 'Longtian AB', side: 'red', airbase: true },
  { c: 2, r: 7, name: 'Quanzhou', side: 'red', port: true, staging: true, city: true },
  { c: 1, r: 9, name: 'Xiamen', side: 'red', airbase: true, port: true, staging: true, city: true },
  { c: 1, r: 13, name: 'Shantou', side: 'red', airbase: true, port: true, city: true },
  // --- ROC offshore islands ---
  { c: 6, r: 3, name: 'Matsu', side: 'blue', fortified: true, island: true },
  { c: 2, r: 9, name: 'Kinmen', side: 'blue', fortified: true, island: true },
  { c: 7, r: 10, name: 'Penghu (Magong)', side: 'blue', airbase: true, port: true, island: true },
  // --- Taiwan ---
  { c: 11, r: 5, name: 'Taipei', side: 'blue', capital: true, city: true },
  { c: 12, r: 5, name: 'Keelung', side: 'blue', port: true, city: true },
  { c: 10, r: 5, name: 'Taoyuan', side: 'blue', city: true, airbase: true, beach: 'Linkou–Taoyuan beaches' },
  { c: 10, r: 6, name: 'Hsinchu', side: 'blue', city: true, airbase: true, fabs: true, beach: 'Hsinchu coast' },
  { c: 13, r: 7, name: 'Yilan', side: 'blue', city: true, beach: 'Lanyang plain' },
  { c: 10, r: 8, name: 'Taichung', side: 'blue', city: true, port: true, airbase: true, beach: 'Taichung port flats' },
  { c: 10, r: 9, name: 'Changhua', side: 'blue', city: true },
  { c: 13, r: 8, name: 'Hualien', side: 'blue', airbase: true, port: true, shelters: true, city: true },
  { c: 10, r: 10, name: 'Yunlin', side: 'blue' },
  { c: 10, r: 11, name: 'Chiayi', side: 'blue', airbase: true, city: true },
  { c: 10, r: 12, name: 'Tainan', side: 'blue', city: true, airbase: true, beach: 'Tainan beaches' },
  { c: 10, r: 13, name: 'Kaohsiung', side: 'blue', city: true, port: true, navalbase: true, beach: 'Linyuan beaches' },
  { c: 12, r: 13, name: 'Taitung', side: 'blue', airbase: true, shelters: true, city: true },
  { c: 11, r: 14, name: 'Hengchun', side: 'blue' },
  // --- Allies ---
  { c: 17, r: 0, name: 'Okinawa (Kadena)', side: 'jp', airbase: true, port: true },
  { c: 16, r: 19, name: 'Luzon EDCA sites', side: 'us', airbase: true, staging: true },
];

export function buildMap() {
  const hexes = new Map();
  for (let r = 0; r < H; r++) {
    const row = ROWS[r];
    if (row.length !== W) throw new Error(`map row ${r} has length ${row.length}, expected ${W}`);
    for (let c = 0; c < W; c++) {
      const ch = row[c];
      const t = TERRAIN[ch];
      if (!t) throw new Error(`unknown terrain '${ch}' at ${c},${r}`);
      hexes.set(key(c, r), { c, r, ch, t, loc: null });
    }
  }
  for (const loc of LOCS) {
    const h = hexes.get(key(loc.c, loc.r));
    if (!h) throw new Error(`location ${loc.name} off map`);
    if (!h.t.land) throw new Error(`location ${loc.name} placed on water at ${loc.c},${loc.r}`);
    h.loc = loc;
  }
  return {
    W, H, hexes,
    get(c, r) { return hexes.get(key(c, r)); },
    inBounds(c, r) { return c >= 0 && c < W && r >= 0 && r < H; },
    neighborsOf(c, r) {
      return neighbors(c, r).filter(n => this.inBounds(n.c, n.r)).map(n => this.get(n.c, n.r));
    },
    isTaiwanMain(h) { return h.t.region === 'tw' && !h.t.island && !h.loc?.island; },
  };
}

// Distance from a hex to the nearest hex of Taiwan proper (used for blockade
// and coastal-defense range checks).
export function distToTaiwan(map, c, r) {
  let best = 99;
  for (const h of map.hexes.values()) {
    if (map.isTaiwanMain(h)) best = Math.min(best, hexDist({ c, r }, h));
  }
  return best;
}
