# 🛡️ Silicon Shield — The Battle for Taiwan

A turn-based operational wargame of a PRC invasion of Taiwan, playable in any modern
desktop or mobile browser. You command the defense — the Republic of China armed forces
and, if you can bring them into the war, the United States and Japan. The computer plays
the People's Liberation Army through a doctrinally-grounded AI.


## Quick start

No build step. Serve the directory over HTTP (ES modules require it) and open it:

```bash
cd silicon-shield
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

Works on desktop (mouse) and phone/tablet (touch). Rendering is three.js, loaded from
jsDelivr pinned to 0.185.1. **Play online: https://luyenchou1.github.io/silicon-shield/**

To play fully offline, use `silicon-shield.html` — a standalone single-file build with
three.js inlined that runs straight from `file://`. Regenerate it after source changes
with `node build-standalone.mjs` (needs `npm i -D esbuild`; the pinned three files are
vendored in `lib/`).

- **Camera** — drag to pan, right-drag / two-finger drag to rotate, wheel / pinch to zoom
- **Orders** — tap a unit to select it; tap a white hex to move, a red ring to attack
- **Action bar** — strategic actions (diplomacy, reserves, mines, convoys) and deep fires
  (coastal missiles, LRASM, Tomahawks)
- **End Turn** — the PLA takes its turn (tap again to fast-forward), then a new day begins
- One campaign day per turn, 30 days to survive; auto-saves every day
- **Sound** — procedural WebAudio score and battle SFX (briefing theme, separate victory and
  defeat anthems); toggle with the 🔊 button
- Every campaign ends with an **after-action report**: the war by the numbers plus a
  day-by-day timeline of its key moments

## How the game is won and lost

| Outcome | Condition |
| --- | --- |
| 🟦 **The Strait Holds** (decisive) | Amphibious fleet destroyed with no PLA ground force left on Taiwan |
| 🟦 **Beijing Blinks** | PRC resolve reduced to zero (losses, sanctions, a stalled invasion) |
| 🟦 **Taiwan Endures** | Hold Taipei through D+30 |
| 🟥 **The Fall of Taipei** | PLA holds the capital for two consecutive days |
| 🟥 **Capitulation** | Taiwan's resolve reduced to zero (blockade, bombardment, lost cities) |

The strategic tracks drive everything: **US intervention** (at 50 the US enters; at 70
Japan opens Kadena — PLA strikes on US or Japanese forces trigger entry immediately),
**Taiwan resolve**, **PRC resolve**, and **island supply** under blockade.

## Research basis

The scenario is a 2027 "Davidson window" joint island landing campaign. Force structure,
inventories, geography and the AI's campaign phasing are drawn from open sources:

- **CSIS, *The First Battle of the Next War* (2023)** — the wargame's core dynamics follow
  its findings: the amphibious fleet is the invasion's center of gravity; standoff
  anti-ship missiles (and their shallow magazines) decide the campaign; US bomber-launched
  LRASM regenerates slowly; ground-based air defense empties in days; striking Japan
  guarantees Japanese entry.
- **DoD China Military Power Report (2023–24)** — PLARF inventories (~1,000+ SRBMs, DF-17,
  CJ-10 LACMs, DF-21D/DF-26 ASBMs), PLAN order of battle (Type 055/052D SAGs, Shandong and
  Fujian carrier groups, Type 075/071 amphibs, civilian RO-RO augmentation), Eastern
  Theater Command airbases (Longtian, Huian, Zhangzhou compressed to map locations).
- **IISS Military Balance / public ROC MND data** — ROC force structure: F-16V wings at
  Chiayi and Hualien, IDF at Taichung, Mirage 2000 at Hsinchu, mountain-shelter bases at
  Hualien (Chiashan) and Taitung (Chihhang), Kidd/PFG flotillas at Keelung and Zuoying,
  Hai Kun-class submarine, Kinmen/Matsu/Penghu defense commands, Patriot PAC-3 + Sky Bow
  III inventories, land-based Hsiung Feng II/III coastal missile batteries.
- **Amphibious geography** — Taiwan presents only a handful of brigade-capable landing
  beach groups (the classic count is ~14 beaches in a few clusters); the game models the
  Linkou–Taoyuan group (the direct route to Taipei), Hsinchu, the Taichung port flats,
  Tainan, Linyuan/Kaohsiung, and the Yilan (Lanyang plain) back door. Central-west mudflats
  are treated as non-landable. The Central Mountain Range channels all ground maneuver to
  the western corridor.
- **Meteorology** — the strait permits large-scale amphibious operations in roughly two
  seasonal windows (late March–April, October); the campaign is set in April. Sea state
  halts landings ~20–30% of days and typhoons are possible; weather rolls reflect this.
- **Politics** — intervention dynamics follow the standard scenario literature: US entry
  is uncertain and shapeable by both sides (Taiwanese diplomacy, PRC strikes on civilians,
  nuclear signaling, the TSMC "silicon shield" shock), Japanese entry lags US entry unless
  Japan is struck first, and PRC strikes on the mainland's attackers rally domestic
  support ("deep strike" is deliberately a double-edged player choice).

Distances are compressed at the map edges (Okinawa, Luzon) as in most operational
wargames; one hex ≈ 40–45 km, one turn = one day, ground units are brigade groups.

## The PLA opponent

The AI follows the doctrinal Joint Island Landing Campaign in phases:

1. **Joint fire strike** (D+1–2) — SRBM/LACM volleys against airbases, IADS and ports,
   with interceptor attrition modeled per volley
2. **Sea and air control** — air wings strike the ROCN, submarines ambush, surface action
   groups screen the assembly areas; DF-26 shots at any carrier that closes
3. **Amphibious assault** — a landing beach chosen by weighted threat assessment (and
   re-chosen if you visibly fortify it), flotillas staging outside coastal-missile range
   until weather, escort and air-superiority conditions are met; airborne brigades drop on
   objectives behind the beachhead; Kinmen taken by coup de main
4. **Exploitation** — beachhead buildup, follow-on RO-RO echelons, drive on Taipei
5. **Adaptation** — if the landing force dies, the AI shifts to a blockade-and-bombardment
   strangulation strategy aimed at Taiwan's resolve rather than its territory

On *Davidson Window* difficulty the AI will also weigh the Kadena dilemma: striking US
airpower on Okinawa at the price of certain Japanese entry.

## Architecture

```
index.html          entry point (importmap → three.js, pinned CDN)
css/style.css       HUD, responsive layout
src/
  hex.js            pointy-top odd-r hex math
  map.js            20×22 theater map, terrain, named locations
  data.js           unit templates, orders of battle, pools, weather, events
  state.js          game state, seeded RNG, save/load
  rules.js          movement, combat, fires, amphib ops, politics, victory
  ai.js             the PLA campaign AI (async, animates through an fx interface)
  render.js         three.js board/units/labels/picking
  fx.js             missile arcs, explosions, landings
  ui.js             HUD panels, tracks, modals, log
  main.js           input, targeting modes, turn loop, saves
test/sim.test.js    headless engine + balance test (node, no browser)
```

The engine (`hex/map/data/state/rules/ai`) has no DOM or three.js dependency and runs
headless — `npm test` plays 72 full AI-vs-scripted-defender campaigns and checks
invariants plus win-rate spread across difficulties and defender skill levels.

## Balance and tuning

The headless harness pits the AI against two scripted defenders: a passive one (loses
~95% — the historical base case for an unprepared defense) and a competent one that
masses fires on the amphibious fleet (wins ~85% — the porcupine thesis). A human player
lands between them; difficulty levels shift PLARF stocks, interceptor depth, starting
intervention and AI aggression. Main tuning knobs live in `data.js` (`DIFFICULTY`,
`CONST`, unit stats) and the will/attrition weights in `rules.js` (`applyDamage`,
`startTurn`).

## Known simplifications (v1)

- Air power is base-tied wings + a single global air-superiority meter, not sortie-level
- Cyber/space appear as events, not player systems; no dedicated ISR/targeting layer
- PLA ground forces on Taiwan use a simple cut-off rule rather than full supply lines
- Matsu can be bypassed; no PRC nuclear-use modeling beyond the signaling event
- Single scenario (April 2027 full invasion); blockade-only and Kinmen-grab-only
  scenarios would reuse the same engine

This is a game informed by open research, not a predictive model — inventories and
effectiveness numbers are abstractions tuned for playability.
