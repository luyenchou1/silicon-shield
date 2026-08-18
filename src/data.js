// Scenario data: unit templates, orders of battle, strategic resource pools,
// weather model and the event deck. Force structure and inventories are
// derived from open sources (DoD China Military Power Report, IISS Military
// Balance, CSIS "First Battle of the Next War" wargame); see README.

// ---------------------------------------------------------------- templates
// cls: ground | naval | sub | amphib | air
// att: attack strength vs {sea, grd}; airPts: contribution to air superiority
// strike: standoff strike power (air wings / bombers); rng: attack range
export const TYPES = {
  // --- PLA (red) ---
  sag:     { cls: 'naval', name: 'PLAN Surface Action Group', short: 'SAG', mov: 3, rng: 2, hp: 4, att: { sea: 7, grd: 3 }, def: 6 },
  cv:      { cls: 'naval', name: 'PLAN Carrier Group', short: 'CV', mov: 3, rng: 2, hp: 4, att: { sea: 5, grd: 2 }, def: 6, airPts: 3, carrier: true },
  amph:    { cls: 'amphib', name: 'Amphibious Flotilla', short: 'AMPH', mov: 2, rng: 1, hp: 4, att: { sea: 1, grd: 2 }, def: 3, cargoCap: 2 },
  redSSN:  { cls: 'sub', name: 'PLAN Nuclear Attack Sub', short: 'SSN', mov: 3, rng: 1, hp: 2, att: { sea: 7 }, def: 5 },
  redSSK:  { cls: 'sub', name: 'PLAN Diesel Sub Flotilla', short: 'SSK', mov: 2, rng: 1, hp: 2, att: { sea: 6 }, def: 4 },
  redInf:  { cls: 'ground', name: 'PLA Amphib Combined-Arms Bde', short: 'CAB', mov: 2, rng: 1, hp: 4, att: { grd: 5 }, def: 4 },
  redArm:  { cls: 'ground', name: 'PLA Heavy Combined-Arms Bde', short: 'HVY', mov: 2, rng: 1, hp: 4, att: { grd: 7 }, def: 5, armor: true },
  redMar:  { cls: 'ground', name: 'PLAN Marine Bde', short: 'MAR', mov: 2, rng: 1, hp: 3, att: { grd: 4 }, def: 4 },
  redAB:   { cls: 'ground', name: 'PLA Airborne Bde', short: 'ABN', mov: 2, rng: 1, hp: 3, att: { grd: 3 }, def: 3, airborne: true },
  redWingA:{ cls: 'air', name: 'PLAAF J-20 Wing', short: 'J-20', hp: 3, airPts: 4, strike: 2, def: 4 },
  redWingB:{ cls: 'air', name: 'PLAAF J-16 Strike Wing', short: 'J-16', hp: 3, airPts: 3, strike: 4, def: 4 },
  redWingC:{ cls: 'air', name: 'PLAAF J-10 Wing', short: 'J-10', hp: 3, airPts: 3, strike: 2, def: 3 },
  redBmb:  { cls: 'air', name: 'PLAAF H-6K Bomber Wing', short: 'H-6K', hp: 3, airPts: 1, strike: 6, def: 2 },

  // --- ROC / Taiwan (blue) ---
  rocArm:  { cls: 'ground', name: 'ROC Army Armor Bde', short: 'ARM', mov: 2, rng: 1, hp: 4, att: { grd: 6 }, def: 5, armor: true },
  rocInf:  { cls: 'ground', name: 'ROC Army Mech-Inf Bde', short: 'INF', mov: 2, rng: 1, hp: 4, att: { grd: 4 }, def: 5 },
  rocRes:  { cls: 'ground', name: 'ROC Reserve Bde', short: 'RES', mov: 1, rng: 1, hp: 3, att: { grd: 2 }, def: 3 },
  rocMar:  { cls: 'ground', name: 'ROC Marine Bde', short: 'MAR', mov: 2, rng: 1, hp: 3, att: { grd: 4 }, def: 4 },
  rocGar:  { cls: 'ground', name: 'ROC Island Garrison', short: 'GAR', mov: 0, rng: 1, hp: 3, att: { grd: 3, sea: 3 }, def: 6, fortress: true, coastal: true },
  rocNav:  { cls: 'naval', name: 'ROCN Flotilla', short: 'FLT', mov: 3, rng: 2, hp: 3, att: { sea: 5 }, def: 4 },
  rocSub:  { cls: 'sub', name: 'ROCN Submarine', short: 'SS', mov: 2, rng: 1, hp: 2, att: { sea: 5 }, def: 4 },
  rocW16:  { cls: 'air', name: 'ROCAF F-16V Wing', short: 'F-16V', hp: 3, airPts: 3, strike: 2, def: 3 },
  rocWIDF: { cls: 'air', name: 'ROCAF IDF Wing', short: 'IDF', hp: 3, airPts: 2, strike: 2, def: 3 },
  rocWMir: { cls: 'air', name: 'ROCAF Mirage 2000 Wing', short: 'M2K', hp: 3, airPts: 2, strike: 1, def: 3 },

  // --- USA ---
  usCSG:   { cls: 'naval', name: 'US Carrier Strike Group', short: 'CSG', mov: 3, rng: 3, hp: 4, att: { sea: 9, grd: 4 }, def: 8, airPts: 4, strike: 5, carrier: true },
  usSSN:   { cls: 'sub', name: 'US Navy SSN', short: 'SSN', mov: 4, rng: 1, hp: 3, att: { sea: 9 }, def: 6 },
  usWing:  { cls: 'air', name: 'USAF F-22/F-35 Wings (Kadena)', short: 'USAF', hp: 3, airPts: 5, strike: 4, def: 4 },
  usMLR:   { cls: 'ground', name: 'USMC Littoral Regiment', short: 'MLR', mov: 0, rng: 3, hp: 2, att: { sea: 6, grd: 2 }, def: 4, coastal: true },

  // --- Japan ---
  jpDDG:   { cls: 'naval', name: 'JMSDF Escort Flotilla', short: 'DDG', mov: 3, rng: 2, hp: 3, att: { sea: 6 }, def: 7, bmd: true },
  jpWing:  { cls: 'air', name: 'JASDF F-35 Wing', short: 'F-35', hp: 3, airPts: 3, strike: 2, def: 4 },
};

// ------------------------------------------------------------------- OOB
// Each entry: [typeId, displayName, c, r, extra]
export const BLUE_OOB = [
  ['rocArm', '6th Corps Armor Gp', 11, 5],
  ['rocArm', '10th Corps Armor Gp', 10, 8],
  ['rocArm', '8th Corps Armor Gp', 10, 13],
  ['rocInf', '269th Mech Bde', 10, 5],
  ['rocInf', '542nd Bde (Hsinchu)', 10, 6],
  ['rocInf', '234th Bde (Changhua)', 10, 9],
  ['rocInf', '117th Bde (Chiayi)', 10, 11],
  ['rocInf', '203rd Bde (Tainan)', 10, 12],
  ['rocInf', '333rd Bde (Pingtung)', 10, 14],
  ['rocMar', '66th Marine Bde', 10, 13],
  ['rocGar', 'Kinmen Defense Cmd', 2, 9, { hp: 4 }],
  ['rocGar', 'Matsu Defense Cmd', 6, 3],
  ['rocGar', 'Penghu Defense Cmd', 7, 10],
  ['rocNav', '131st Flotilla (Keelung)', 12, 5],
  ['rocNav', '124th Flotilla (Zuoying)', 10, 13],
  ['rocSub', 'Hai Kun (SS-711)', 14, 9, { hidden: true }],
  ['rocW16', '4th TFW F-16V (Chiayi)', 10, 11],
  ['rocW16', '5th TFW F-16V (Hualien)', 13, 8],
  ['rocWIDF', '3rd TFW IDF (Taichung)', 10, 8],
  ['rocWMir', '2nd TFW Mirage (Hsinchu)', 10, 6],
];

export const RED_OOB = [
  ['sag', 'SAG North (Type 055)', 5, 0],
  ['sag', 'SAG Center (Type 052D)', 5, 3],
  ['sag', 'SAG South (Type 052D)', 3, 9],
  ['cv', 'CV-17 Shandong Group', 8, 2],
  ['cv', 'CV-18 Fujian Group', 7, 16],
  ['redSSN', '093B Boat', 8, 5, { hidden: true }],
  ['redSSN', '093B Boat', 8, 12, { hidden: true }],
  ['redSSK', '039C Flotilla', 6, 7, { hidden: true }],
  ['redSSK', '039C Flotilla', 9, 14, { hidden: true }],
  ['amph', '1st Landing Gp (Fuzhou)', 5, 4, { cargo: ['redInf:1st Amphib CAB', 'redArm:Hvy CAB "Nanjing"'] }],
  ['amph', '2nd Landing Gp (Fuzhou)', 6, 4, { cargo: ['redInf:2nd Amphib CAB', 'redMar:1st Marine Bde'] }],
  ['amph', '3rd Landing Gp (Xiamen)', 3, 10, { cargo: ['redInf:3rd Amphib CAB', 'redMar:2nd Marine Bde'] }],
  ['amph', '4th Landing Gp (Xiamen)', 4, 10, { cargo: ['redInf:4th Amphib CAB', 'redArm:Hvy CAB "Fujian"'] }],
  ['redAB', '127th Air Assault Bde', 4, 3],
  ['redAB', '43rd Airborne Bde', 1, 9],
  ['redWingA', 'J-20 Wing (Fuzhou)', 4, 3],
  ['redWingB', 'J-16 Wing (Longtian)', 2, 6],
  ['redWingB', 'J-16 Wing (Wenzhou)', 4, 1],
  ['redWingC', 'J-10 Wing (Xiamen)', 1, 9],
  ['redBmb', 'H-6K Regt (Ningbo)', 3, 0],
];

// Follow-on echelons (turn: units appear at given hex if it is red-controlled
// water/port and blue hasn't destroyed the RO-RO pool narrative-wise).
export const RED_REINFORCEMENTS = [
  { turn: 4, entry: ['amph', 'RO-RO Echelon A', 5, 4, { cargo: ['redArm:Hvy CAB "Xiamen"', 'redInf:5th Amphib CAB'] }] },
  { turn: 6, entry: ['amph', 'RO-RO Echelon B', 3, 10, { cargo: ['redArm:Hvy CAB "Ningbo"', 'redInf:6th Amphib CAB'] }] },
];

// US/Japan force packages, spawned when the intervention track unlocks them.
export const US_PACKAGE = [
  ['usCSG', 'CSG-5 (7th Fleet)', 18, 6],
  ['usSSN', 'SSN "Key West"', 15, 10, { hidden: true }],
  ['usSSN', 'SSN "Jefferson City"', 12, 17, { hidden: true }],
  ['usMLR', '3rd Marine Littoral Regt', 16, 19],
];
export const US_SECOND_CSG = ['usCSG', 'CSG-1 (surge)', 18, 12];
export const JP_PACKAGE = [
  ['jpDDG', 'Escort Flotilla 1', 17, 1],
  ['jpWing', '3rd Air Wing F-35A', 17, 0],
];
export const US_KADENA_WING = ['usWing', '18th Wing + F-22 (Kadena)', 17, 0];

// ------------------------------------------------------------- constants
export const CONST = {
  maxTurns: 30,
  blueCPBase: 6,
  usEnterAt: 50,     // intervention track threshold: US forces commit
  jpEnterAt: 70,     // Japan grants basing + JSDF commits
  secondCSGDelay: 8, // turns after US entry
  reserveMobilizations: 6,
  blockadeRadius: 2, // red naval presence within N hexes of Taiwan drives blockade
};

export const DIFFICULTY = {
  easy:   { label: 'Reporting for Duty', srbm: 900,  lacm: 400, asbm: 40, interceptors: 650, intervention: 40, redAggro: 0.85 },
  normal: { label: 'Commander',          srbm: 1100, lacm: 500, asbm: 60, interceptors: 500, intervention: 30, redAggro: 1.0 },
  hard:   { label: 'Davidson Window',    srbm: 1300, lacm: 650, asbm: 80, interceptors: 400, intervention: 22, redAggro: 1.15 },
};

// Blue strike pools (salvos). Magazine depth is the point: they do not last.
export const BLUE_POOLS = {
  ascm: 10,   // ROC land-based HF-2/HF-3 coastal missile salvos (range 3 from Taiwan proper)
  lrasm: 0,   // USAF bomber LRASM salvos from Guam (unlocks with US entry, 6 + slow regen)
  tlam: 0,    // SSN Tomahawk land-attack salvos (unlocks with US entry)
};

export const WEATHER = [
  { id: 'clear', name: 'Clear', p: 0.42, icon: '☀', amphib: true, airMod: 1.0, seaMod: 1.0 },
  { id: 'overcast', name: 'Overcast / haze', p: 0.30, icon: '⛅', amphib: true, airMod: 0.8, seaMod: 1.0 },
  { id: 'rough', name: 'Strait sea state 5+', p: 0.20, icon: '🌊', amphib: false, airMod: 0.9, seaMod: 0.8 },
  { id: 'typhoon', name: 'Typhoon', p: 0.08, icon: '🌀', amphib: false, airMod: 0.4, seaMod: 0.6 },
];

// ------------------------------------------------------------------ events
// Drawn at most one per turn (65%). `when` gates conditional events.
export const EVENTS = [
  { id: 'tsmc', name: 'Silicon Shield Shock', text: 'TSMC announces fab shutdown and engineer evacuation. Global chip markets crater — pressure mounts on Beijing and Washington alike.', apply: s => { s.prcWill -= 5; s.intervention += 6; } },
  { id: 'logistics', name: 'PLA Logistics Snarl', text: 'Satellite imagery shows chaos at Fujian ports: RO-RO ferries queued, fuel shortages. The next PLA echelon is delayed.', apply: s => { s.redReinfDelay += 1; } },
  { id: 'cyber', name: 'Grid Cyberattack', text: 'A cyberattack blacks out northern Taiwan. Rolling outages sap civilian morale and command coordination.', apply: s => { s.twWill -= 5; s.cpPenalty += 1; } },
  { id: 'congress', name: 'Emergency Joint Session', text: 'The US Congress convenes in emergency session; support for intervention surges.', apply: s => { s.intervention += 8; } },
  { id: 'diet', name: 'Japan Diet Acts', text: 'Tokyo declares a "survival-threatening situation" under the 2015 security laws. Japanese participation nears.', apply: s => { s.jpThresholdMod -= 12; } },
  { id: 'un', name: 'UN General Assembly Vote', text: '141 nations condemn the invasion. Beijing is isolated diplomatically.', apply: s => { s.prcWill -= 4; } },
  { id: 'depot', name: 'Missile Depot Sabotage', text: 'An explosion rocks a PLARF depot in Jiangxi. Rocket Force expenditure must slow.', apply: s => { s.red.srbm = Math.max(0, s.red.srbm - 90); } },
  { id: 'shipping', name: 'Insurance Markets Panic', text: "Lloyd's suspends war-risk coverage in the strait. Taiwan's stockpile drawdown accelerates.", apply: s => { s.supply -= 8; } },
  { id: 'typhoonInc', name: 'Typhoon Forming', text: 'A late-season typhoon spins up east of Luzon. Next turn: typhoon conditions.', apply: s => { s.forcedWeather = 'typhoon'; } },
  { id: 'nukes', name: 'Nuclear Signaling', text: 'Beijing raises rocket-force readiness and hints at "unbearable costs". Washington wavers.', apply: s => { s.intervention -= 8; s.prcWill -= 2; } },
  { id: 'rally', name: 'Island Stands Firm', text: 'Millions join civil-defense mobilization; conscripts report at 96%. Taiwanese resolve hardens.', apply: s => { s.twWill += 6; } },
  { id: 'counterspace', name: 'Counterspace Attack', text: 'PLA ASAT and dazzling operations degrade allied ISR constellations for a time.', apply: s => { s.blueStrikePenalty = 2; } },
  { id: 'edca', name: 'Manila Opens the Gates', text: 'The Philippines grants unrestricted EDCA access. US posture in Luzon strengthens.', apply: s => { s.mlrBonus = true; s.intervention += 4; } },
  { id: 'defector', name: 'PLA Staff Defector', text: 'A defecting staff officer reveals the landing plan. Taiwan repositions with foreknowledge.', apply: s => { s.revealRedPlan = true; s.twWill += 3; } },
  { id: 'sanctions', name: 'Sanctions Bite', text: 'SWIFT cutoff and energy embargo begin to strangle the Chinese economy. Domestic pressure builds.', apply: s => { s.prcWill -= 6; } },
  { id: 'subAground', name: 'Submarine Mishap', text: 'A PLAN diesel boat surfaces with casualties after grounding near Penghu — located and prosecuted.', apply: (s, g) => { const u = g?.units.find(u => u.side === 'red' && u.cls === 'sub' && u.alive); if (u) { u.hidden = false; u.hp -= 1; if (u.hp <= 0) u.alive = false; } } },
];
