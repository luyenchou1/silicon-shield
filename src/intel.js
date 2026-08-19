// Intel briefs: real-world context for every unit type and named location.
// Shown via the ℹ️ About button. Two audiences at once: the player who wants
// to know why an entity matters in the game, and the reader using the game to
// understand the actual strait. Keep entries honest about what is modeled.

// Keyed by unit template id (u.tid).
export const TYPE_INTEL = {
  // --- PLA ---
  sag: `<p>A PLAN <b>surface action group</b> — Type 055 cruisers and Type 052D destroyers,
the escort backbone of an invasion fleet. China now launches more naval tonnage annually than
any other country; these ships carry deep magazines of YJ-18 anti-ship missiles and modern
air defenses.</p><p><i>In game:</i> the fleet's shield. Kill the amphibs first — but SAGs
will punish your navy and shore targets if left alone.</p>`,
  cv: `<p>A PLAN <b>carrier group</b> — Liaoning/Shandong class, with the catapult-equipped
Fujian working up. PLA carriers are still learning blue-water operations; analysts see them
as most useful east of Taiwan, cutting the island off from US relief.</p><p><i>In game:</i>
adds air points to the superiority contest and escorts the fleet. A prestige target: sinking
it hits Beijing's resolve hard.</p>`,
  amph: `<p>An <b>amphibious flotilla</b> — Type 075/071 assault ships, landing ship tanks,
and requisitioned civilian RO-RO ferries the PLA has exercised with since 2021. Sealift is
the invasion's scarcest resource: CSIS wargames found the amphibious fleet is the center of
gravity of the entire operation.</p><p><i>In game:</i> each flotilla carries two brigades.
Every one sunk is two brigades that never land — this is how you win.</p>`,
  redSSN: `<p>A PLAN <b>nuclear attack submarine</b> (Type 093). Quieter with each block,
tasked with sinking allied carriers and interdicting reinforcement from Guam and Hawaii.</p>
<p><i>In game:</i> hidden until it fires. Screen your carriers and hunt it with your own subs.</p>`,
  redSSK: `<p>A <b>diesel-electric submarine flotilla</b> (Type 039). Slow but nearly silent
on batteries, ideal for ambush positions in the strait's shallow approaches.</p>
<p><i>In game:</i> hidden until it fires; a threat to convoys and your surface fleet.</p>`,
  redInf: `<p>A PLA <b>amphibious combined-arms brigade</b> — the specialized first-wave
formations of the Eastern and Southern Theater Commands, equipped with amphibious IFVs.
There are only about a dozen of these in the whole PLA; they are hard to replace.</p>
<p><i>In game:</i> the landing force. Destroy them on the water or at the beach.</p>`,
  redArm: `<p>A PLA <b>heavy combined-arms brigade</b> — main battle tanks and tracked
artillery, the exploitation force for after a port or beachhead is secured. Getting armor
ashore requires a working port or captured RO-RO ramp — a key invasion bottleneck.</p>
<p><i>In game:</i> arrives in follow-on echelons; dangerous once ashore, brittle at sea.</p>`,
  redMar: `<p>A <b>PLAN Marine Corps brigade</b> — expanded from two to eight brigades since
2017, trained for island seizure and port capture.</p><p><i>In game:</i> first-wave assault
troops, lighter than army heavy brigades.</p>`,
  redAB: `<p>A <b>PLA Airborne Corps brigade</b>. Chinese doctrine calls for vertical
envelopment — seizing airfields behind the beaches so follow-on forces can air-land. CSIS
wargames rate this among the operation's riskiest moves.</p><p><i>In game:</i> can drop on
airbases, cities and plains near red airbases. Kill the drop zones' garrisons or retake them
fast — a lodged airhead splits your defense.</p>`,
  redWingA: `<p><b>J-20 stealth fighter wing</b> — China's fifth-generation air-superiority
fighter, fielded in growing numbers. Its job is sweeping the strait's air space, not ground
attack.</p><p><i>In game:</i> big air-superiority contribution, modest strike power.</p>`,
  redWingB: `<p><b>J-16 strike wing</b> — a heavily-armed Flanker derivative, the PLAAF's
workhorse for maritime and ground strike under fighter escort.</p><p><i>In game:</i> the
PLA's best strike aircraft; a threat to your navy and bases.</p>`,
  redWingC: `<p><b>J-10 fighter wing</b> — single-engine multirole fighters in large numbers;
the mass behind the PLAAF's sortie generation.</p><p><i>In game:</i> a solid all-rounder that
pads red air superiority.</p>`,
  redBmb: `<p><b>H-6K bomber wing</b> — China's long-serving strategic bomber, modernized to
carry six long-range cruise missiles. H-6s ring Taiwan in nearly every large PLA exercise;
their standoff range means they rarely need to enter defended airspace.</p><p><i>In game:</i>
10-hex strike radius and the heaviest punch in the red air order of battle. Killing its base
is easier than killing the bomber.</p>`,

  // --- ROC / Taiwan ---
  rocArm: `<p>A <b>ROC Army armor brigade</b> — M60A3s and CM-11s, now being joined by M1A2T
Abrams. Taiwan's counterattack doctrine holds armor inland to smash a beachhead before it
consolidates: the "decisive battle at the water's edge."</p><p><i>In game:</i> your hammer.
Keep it out of missile range, then counterattack landings hard. Cannot enter high mountains.</p>`,
  rocInf: `<p>A <b>ROC Army mechanized infantry brigade</b> — CM-32 Clouded Leopard vehicles;
the garrison backbone of the western plain. Urban terrain multiplies its defense — a lesson
reinforced by Ukraine's cities.</p><p><i>In game:</i> holds cities and beaches; strongest on
the defense in urban hexes.</p>`,
  rocRes: `<p>A <b>reserve brigade</b>. Taiwan claims over 2 million reservists but the
system's training days and equipment have lagged; reforms since 2022 aim to fix it. Their
wartime value is one of the great unknowns of the scenario.</p><p><i>In game:</i> cheap
infantry mobilized via the Reserves action — thin alone, useful as urban filler.</p>`,
  rocMar: `<p>A <b>ROC Marine brigade</b> — the 66th and 99th are among Taiwan's readiest
formations, often tasked with the capital's defense and rapid counter-landing reaction.</p>
<p><i>In game:</i> mobile, reliable infantry.</p>`,
  rocGar: `<p>An <b>offshore island defense command</b>. Kinmen sits 10 km off Xiamen; it
weathered massive PRC artillery bombardment in 1958 and remains honeycombed with tunnels,
bunkers and coastal guns. Matsu and Penghu are similarly fortified. Politically, the islands
are a dilemma: Beijing could seize them as a fait accompli — but that might harden, not
break, Taiwan's resolve.</p><p><i>In game:</i> immobile fortress with shore batteries — it
fires automatically at ships and troops in range at the end of each PLA turn. It cannot be
reinforced or evacuated; its job is to make every island grab cost time, ships and resolve.</p>`,
  rocNav: `<p>A <b>ROCN surface flotilla</b> — Kidd-class destroyers, Perry- and
Lafayette-class frigates, and Tuo Chiang stealth missile corvettes. Against PLAN numbers,
Taiwan's navy survives by dispersing and striking from cover, not by fleet battle.</p>
<p><i>In game:</i> a ship-killer that dies fast in the open. Use it from coastal hexes,
alongside ASCM salvos.</p>`,
  rocSub: `<p>A <b>ROCN submarine</b> — for decades just two elderly Dutch-built boats; the
indigenous Hai Kun class began sea trials in 2024. Even a few boats in the strait's shallow
approaches threaten the landing fleet's tight formations.</p><p><i>In game:</i> hidden until
it fires; best used against amphibious flotillas.</p>`,
  rocW16: `<p>An <b>F-16V wing</b> — Taiwan's most capable fighters, upgraded with AESA
radar and Harpoon anti-ship missiles. Their survival depends on hardened shelters and rapid
runway repair; the PLA plans to destroy them on the ground in the first hours.</p>
<p><i>In game:</i> your best strike aircraft. Rebase it before its runway is cratered.</p>`,
  rocWIDF: `<p>An <b>Indigenous Defense Fighter (IDF) wing</b> — Taiwan-built light fighters
carrying the domestic Wan Chien standoff weapon.</p><p><i>In game:</i> a workmanlike
strike/air asset; expendable is a strong word, but protect the F-16s first.</p>`,
  rocWMir: `<p>A <b>Mirage 2000 wing</b> — bought from France in the 1990s as high-altitude
interceptors; expensive to maintain and slated for retirement.</p><p><i>In game:</i> air
defense with marginal strike power.</p>`,

  // --- USA / Japan ---
  usCSG: `<p>A <b>US carrier strike group</b> — a Nimitz/Ford-class carrier, its air wing,
and Aegis escorts. The central US dilemma the game models: carriers must close the fight to
strike, but Chinese ASBMs (DF-21D/DF-26) hold them at risk far out to sea. CSIS wargames
routinely see two US carriers damaged or sunk.</p><p><i>In game:</i> huge striking power and
air points — and the PLA rocket force's priority target. Keep it moving.</p>`,
  usSSN: `<p>A <b>US Navy attack submarine</b> — the platform every wargame of this fight
rates as the decisive killer of the invasion fleet. Undersea superiority is the US military's
clearest remaining edge over the PLA.</p><p><i>In game:</i> hidden, fast, lethal against
shipping. Park it on the amphib routes.</p>`,
  usWing: `<p><b>USAF fifth-generation fighters</b> flying from Kadena, Okinawa — the
closest US air base to the strait. Their weakness is the base itself: hundreds of PLA
missiles can reach it, which is why the US now rotates rather than permanently bases
fighters there.</p><p><i>In game:</i> unlocked when Japan commits; powerful, but its base
can be struck.</p>`,
  usMLR: `<p>The <b>3rd Marine Littoral Regiment</b> — the Corps' Force Design experiment:
small, mobile teams with NMESIS anti-ship missiles meant to turn straits and islands into
kill zones. Based in Hawaii, it exercises regularly in the Philippines.</p><p><i>In game:</i>
posted at the Luzon EDCA sites overlooking the Bashi Channel — the strait between Taiwan and
the Philippines that PLAN ships must transit to break out south or east. It fires on any red
ship in reach, and its reach grows if Manila grants full EDCA access (event). It cannot
move: positional deterrence, exactly as designed.</p>`,
  jpDDG: `<p>A <b>JMSDF escort flotilla</b> — Maya-class Aegis destroyers among the world's
best air-defense ships. Japan's 2022 security documents call a Taiwan contingency an
existential concern, but committing forces remains a hard political decision.</p>
<p><i>In game:</i> arrives only if Japan enters; excellent defense, strong anti-ship punch,
and ballistic-missile defense for the fleet.</p>`,
  jpWing: `<p>A <b>JASDF F-35 wing</b>. Japan is buying 147 F-35s — the largest fleet outside
the US — and its southwestern islands sit astride every PLA route into the Pacific.</p>
<p><i>In game:</i> joins when Japan commits, adding air points and strike from Kadena.</p>`,
};

// Keyed by location name (hex.loc.name).
export const LOC_INTEL = {
  // --- PRC coast ---
  'Ningbo': `<p>Headquarters of the PLAN <b>Eastern Theater fleet</b>; its Zhoushan anchorages
host the destroyers and frigates that would escort an invasion. </p><p><i>In game:</i> a red
naval base and staging area on the fleet's northern flank.</p>`,
  'Wenzhou': `<p>A coastal city and airbase midway between Shanghai and the strait; PLA
amphibious exercises are staged from beaches near here.</p><p><i>In game:</i> red airbase
and port supporting the northern axis.</p>`,
  'Fuzhou': `<p>Capital of Fujian province, 250 km from Taipei, and the historic heart of
PLA planning against Taiwan — the old "Fuzhou Military Region." Its port and airfields would
marshal the northern landing echelons.</p><p><i>In game:</i> a major staging port: amphibious
flotillas load and reload brigades here. Tomahawks can hit it once Deep Strike is authorized.</p>`,
  'Longtian AB': `<p>One of the <b>Fujian frontline airbases</b> (Longtian/Huian/Zhangzhou)
hardened and expanded since 2020 — satellite imagery shows new shelters, fuel farms and
missile garrisons across the strait's near shore.</p><p><i>In game:</i> a red fighter base
20 minutes' flight from Taiwan; strikeable with Tomahawks under Deep Strike.</p>`,
  'Quanzhou': `<p>A Fujian port city facing the strait's midpoint, flagged in open-source
analyses as a likely loading point for the invasion's civilian RO-RO ferries.</p>
<p><i>In game:</i> red staging port for the central axis.</p>`,
  'Xiamen': `<p>A metropolis of 5 million directly opposite Kinmen — the two have traded
artillery fire (1958) and tourists (2008) across 10 km of water. Amphibious brigades
garrison the surrounding coast.</p><p><i>In game:</i> the southern staging port; the Kinmen
garrison's shore batteries can reach shipping at its anchorage.</p>`,
  'Shantou': `<p>A Guangdong port on the invasion's far southern flank, home to Southern
Theater amphibious lift.</p><p><i>In game:</i> a red port and airbase anchoring the southern
approach.</p>`,

  // --- Offshore islands ---
  'Matsu': `<p>A ROC-held island group 20 km off Fuzhou — closer to the mainland than to
Taiwan by a factor of ten. Its garrison shrank from 50,000 troops to a few thousand, but its
tunnels and coastal guns remain. PRC "gray zone" pressure (cable cuttings, drone overflights)
tests it constantly.</p><p><i>In game:</i> a fortress hex whose batteries harass the Fuzhou
staging anchorage. Losing it dents Taiwan's resolve — but costs the PLA time and ships.</p>`,
  'Kinmen': `<p>The most famous of Taiwan's offshore islands: 10 km from Xiamen, defended
through the 1949 landing battle and the 1958 artillery crisis. Analysts debate whether
Beijing would seize it early as a cheap fait accompli — or skip it, since taking it might
rally rather than break Taiwanese will.</p><p><i>In game:</i> the AI sometimes opens with a
Kinmen grab. Its garrison cannot be saved — its job is to make the grab expensive.</p>`,
  'Penghu (Magong)': `<p>The strait's mid-channel archipelago and Taiwan's forward naval/air
outpost. Every serious invasion study treats Penghu as a stepping stone: taking it first
gives the PLA a protected anchorage, but telegraphs the main landing weeks early.</p>
<p><i>In game:</i> an island airbase and port astride the invasion routes — its batteries
fire on flotillas that pass within reach.</p>`,

  // --- Taiwan ---
  'Taipei': `<p>Taiwan's capital: the political center whose fall the PLA's "decapitation"
concepts target, ringed by mountains and reachable from the sea only through the Tamsui
river corridor and the port of Keelung. Holding it is holding the war.</p><p><i>In game:</i>
the capital. If PLA troops hold it for two days, organized resistance collapses — the
principal red victory condition.</p>`,
  'Keelung': `<p>Taiwan's northern deep-water port, the capital's maritime lifeline. In most
invasion scenarios it is blockaded or bombarded early; whoever controls it controls Taipei's
resupply.</p><p><i>In game:</i> a port city guarding Taipei's seaward flank.</p>`,
  'Taoyuan': `<p>Home to Taiwan's main international airport and the beaches flagged in PLA
doctrine as the closest viable landing zones to the capital. The 1949-era defense plans and
today's both mass forces here. An airborne seizure of the airport is a standard scenario
opening.</p><p><i>In game:</i> airbase, city, and a gold-ringed landing beach on the
capital's doorstep — defend it accordingly.</p>`,
  'Hsinchu': `<p>The heart of the "silicon shield" this game is named for: TSMC's fabs here
make ~90% of the world's leading-edge chips. The theory — debated by economists and
strategists — is that this concentration deters war because everyone, China included, needs
the fabs intact. It is also a landing-beach city and fighter base.</p><p><i>In game:</i>
airbase, fabs and beach. Its capture or destruction is a strategic and economic
catastrophe.</p>`,
  'Yilan': `<p>The Lanyang plain on Taiwan's northeast coast — one of the few flat landing
areas on the mountainous east side, giving access toward Taipei from behind.</p>
<p><i>In game:</i> a landing beach; watch it when the fleet swings east.</p>`,
  'Taichung': `<p>Taiwan's second city, its central port, and Ching Chuan Kang airbase —
the island's largest. The port flats north of the city are a classic landing zone in PLA
planning studies.</p><p><i>In game:</i> city, port, airbase, beach — a do-everything hex the
PLA would love to own.</p>`,
  'Changhua': `<p>A dense agricultural county behind the Taichung coast; its section of the
western plain funnels any landing force moving south or inland.</p><p><i>In game:</i> plains
city — urban defense bonus, no special facilities.</p>`,
  'Hualien': `<p>East-coast city beneath the Central Range, famous for Chiashan air base —
fighter hangars bored into the mountain itself, built to survive the first-day missile
barrage that would crater every western runway.</p><p><i>In game:</i> mountain shelters
protect wings based here from missile-strike ground kills. The natural rebase refuge.</p>`,
  'Yunlin': `<p>Flat farmland on the western plain between Changhua and Chiayi — tank
country, and a corridor for exploiting any central beachhead.</p><p><i>In game:</i> open
plains; defenders get no urban bonus here.</p>`,
  'Chiayi': `<p>Western plain city and F-16 base — the alert squadrons that intercept PLA
aircraft probing the median line fly from here.</p><p><i>In game:</i> airbase city on the
central plain.</p>`,
  'Tainan': `<p>Taiwan's ancient capital and a modern F-16 and fab city; its flat coast is
the classic southern landing zone.</p><p><i>In game:</i> city, airbase and beach on the
southern axis.</p>`,
  'Kaohsiung': `<p>Taiwan's great southern port — container harbor, naval headquarters at
Zuoying, and the industrial base of the island's south. A blockade that closes Kaohsiung
closes most of Taiwan's trade.</p><p><i>In game:</i> naval base, port, city and beach; the
anchor of the southern defense.</p>`,
  'Taitung': `<p>Southeastern city with Chihhang air base and its own mountain shelters —
the southern counterpart to Hualien's hardened hangars.</p><p><i>In game:</i> sheltered
airbase; wings here survive missile barrages.</p>`,
  'Hengchun': `<p>The peninsula at Taiwan's southern tip, flanking the Bashi Channel through
which PLAN forces break out into the Pacific.</p><p><i>In game:</i> the southern flank;
little infrastructure, but ground worth holding.</p>`,

  // --- Allies ---
  'Okinawa (Kadena)': `<p><b>Kadena Air Base</b> — the largest US air base in the Pacific,
650 km from Taiwan. Every serious study of this war begins with the same question: does the
PLA strike Kadena on day one (bringing Japan in) or leave it alone (and cede US airpower)?
The game makes the PLA AI face exactly that choice.</p><p><i>In game:</i> unlocks as a blue
airbase when Japan commits. If the PLA strikes it first, Japan enters immediately.</p>`,
  'Luzon EDCA sites': `<p>Bases in the northern Philippines the US can use under the
<b>Enhanced Defense Cooperation Agreement</b> — expanded in 2023 to nine sites, several
facing Taiwan across the Bashi Channel. They are the southern jaw of the "first island
chain": US missiles here can close the channel to PLAN ships without a single carrier.
Manila's willingness to allow combat use in a Taiwan war remains deliberately ambiguous —
which is why the game treats access as an event, not a given.</p><p><i>In game:</i> home of
the 3rd Marine Littoral Regiment, which automatically engages red ships entering the Bashi
Channel corner of the map. The "Manila Opens the Gates" event extends its missile reach.
After US entry it also works as a blue rebase airfield.</p>`,
};
