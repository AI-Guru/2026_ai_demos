/** Campaign: 4 missions over Germany + loadouts. Entity positions come from
 *  terrain meta (single source of truth shared with the Python generator). */

export const LOADOUTS = [
  {
    name: 'STANDARD',
    desc: 'Balanced fit. Gun pod, rocket pods and a full PARS 3 rack.',
    gun: 300, rockets: 38, pars: 8, flares: 24, weight: 1.0,
    stats: ['30 mm cannon · 300 rds', '70 mm rockets · 38', 'PARS 3 LR · 8', 'Flares · 24'],
  },
  {
    name: 'TIEFANGRIFF',
    desc: 'Deep strike. No gun pod — heavy rocket load, extra flares. Lighter and more agile.',
    gun: 0, rockets: 44, pars: 6, flares: 32, weight: 0.88,
    stats: ['No gun pod', '70 mm rockets · 44', 'PARS 3 LR · 6', 'Flares · 32'],
  },
  {
    name: 'NAHUNTERSTÜTZUNG',
    desc: 'Close air support. Heavy cannon load for sustained strafing. Heavier airframe.',
    gun: 450, rockets: 22, pars: 4, flares: 24, weight: 1.12,
    stats: ['30 mm cannon · 450 rds', '70 mm rockets · 22', 'PARS 3 LR · 4', 'Flares · 24'],
  },
];

export const MISSIONS = [
  {
    id: 1, mapId: 1,
    title: 'FEUERTAUFTE',
    subtitle: 'First Contact · Lüneburger Heide',
    intel: [
      'FALKE 1-1, this is ADLER. At 04:12 a rogue armored brigade crossed the Elbe and seized the Bergen-Hohne training area. Regular army units are still mobilizing — you are the first asset on station.',
      'A recon element of two BMP-2s is probing our perimeter near Wietzendorf. Behind it, a six-truck supply convoy is moving east on the heath road. Find them, fix them, destroy them before they reach the tree line.',
      'The village of Wietzendorf is still inhabited. Watch your aim — collateral damage will be on your head. Your FARP is established 200 m south of your start position: land there to refuel, rearm and repair.',
    ],
    threats: ['BMP-2 recon (30 mm cannon)', 'Gepard self-propelled AA (radar-guided, deadly below 300 m)', 'Convoy escort BMPs'],
    objectives: [
      { id: 'recon', text: 'Destroy both recon BMPs', primary: true, group: 'recon', required: 2 },
      { id: 'convoy', text: 'Destroy the supply convoy (6 trucks)', primary: true, group: 'convoy', required: 6 },
      { id: 'escort', text: 'Neutralize the convoy escorts', primary: false, group: 'escort', required: 2 },
      { id: 'aa', text: 'Destroy the Gepard AA position', primary: false, group: 'aa', required: 1 },
      { id: 'camp', text: 'Burn out the field camp', primary: false, group: 'camp', required: 3 },
    ],
    escapeFail: { group: 'convoy', count: 3, message: 'The convoy escaped the engagement zone. ADLER is furious.' },
    par: 330,
    radio: {
      start: [
        ['ADLER', 'FALKE 1-1, ADLER. Weapons free. Recon BMPs are north of Wietzendorf, convoy is on the east-west road. Good hunting.'],
        ['FALKE 1-1', 'ADLER, FALKE 1-1. Copy — weapons free. Lifting off now.'],
      ],
      reconComplete: [['ADLER', 'Good effect on the recon element. Now find that convoy before it slips away.']],
      convoyComplete: [['ADLER', 'Convoy is burning. Excellent work, FALKE. Mop up the escorts and the AA position if you can.']],
      firstKill: [['FALKE 1-1', 'ADLER, FALKE — first kill confirmed. The Tiger handles beautifully.']],
      playerHit: [['FALKE 1-1', 'Taking hits! Breaking off…']],
      samLaunch: [],
      lowFuel: [['ADLER', 'FALKE, your fuel state is low. The FARP is south of your start — land on the pad to refuel.']],
      collateral: [['ADLER', 'FALKE! That was a civilian structure. Check your aim — we are not here to level villages.']],
      win: [['ADLER', 'All primary objectives destroyed. The brigade is blind and starving. Return to base — drinks are on me.']],
      fail: [['ADLER', 'FALKE 1-1, respond… FALKE! We lost the airframe. Mission failed.']],
    },
  },
  {
    id: 2, mapId: 2,
    title: 'EISERNER VORHANG',
    subtitle: 'Iron Curtain · Bayerischer Wald',
    intel: [
      'The brigade has pulled back into the Bayerischer Wald and ringed its supply routes with SA-8 Osa batteries. Three launchers and a early-warning radar station form an integrated air-defence net over the forest.',
      'Your task: SEAD. Destroy all three Osa launchers and the radar station near the eastern ridge. The forest gives you cover — use the valleys, pop up, shoot, drop back down. The Osa needs 2.8 seconds of radar lock before it can launch; break the lock with terrain or flares.',
      'Zwiesel is full of civilians. Gepard guns guard the launcher sites — expect heavy tracer fire when you pop up. A supply truck park and a tank platoon are secondary targets of opportunity.',
    ],
    threats: ['SA-8 Osa SAM (2.8 s lock, 2.4 km envelope — use flares!)', 'Gepard radar AA ×2', 'T-80 tank platoon', 'BMP-2'],
    objectives: [
      { id: 'sam', text: 'Destroy all three SA-8 launchers', primary: true, group: 'sam', required: 3 },
      { id: 'radar', text: 'Destroy the early-warning radar station', primary: true, group: 'radar', required: 1 },
      { id: 'aa', text: 'Silence both Gepard guns', primary: false, group: 'aa', required: 2 },
      { id: 'supply', text: 'Destroy the supply truck park', primary: false, group: 'supply', required: 3 },
      { id: 'armor', text: 'Knock out the tank platoon', primary: false, group: 'armor', required: 3 },
    ],
    escapeFail: null,
    par: 420,
    radio: {
      start: [
        ['ADLER', 'FALKE 1-1, the forest is crawling with SAMs. Stay low, use the ridges. When you hear the radar warning, you have under three seconds.'],
        ['FALKE 1-1', 'Copy ADLER. Going in low. Flares are armed.'],
      ],
      samComplete: [['ADLER', 'All launchers down! The sky belongs to us again. Finish that radar station.']],
      radarComplete: [['ADLER', 'Radar station is scrap. The air-defence net is blind — outstanding flying, FALKE.']],
      firstKill: [['FALKE 1-1', 'Splash one. The PARS 3 hits like a hammer.']],
      playerHit: [['FALKE 1-1', 'I am hit! Systems holding… for now.']],
      samLaunch: [['FALKE 1-1', 'Missile launch! Breaking — flares, flares!']],
      lowFuel: [['ADLER', 'Fuel state critical. FARP is at your start point, south-west.']],
      collateral: [['ADLER', 'Civilian damage reported, FALKE. Zwiesel is off limits — precision only.']],
      win: [['ADLER', 'SEAD complete. The corridor is open for the relief force. You just saved a battalion, FALKE.']],
      fail: [['ADLER', 'FALKE is down… the SAM net got him. Mission failed.']],
    },
  },
  {
    id: 3, mapId: 3,
    title: 'BRÜCKENSCHLAG',
    subtitle: 'Bridgehead · Schwäbische Alb',
    intel: [
      'An enemy armor column of eight T-80s is pushing north through Bad Urach toward the gorge bridge. If they cross, they roll up our entire rear area. The bridge is their only crossing for 20 km.',
      'Drop the bridge into the gorge, then hunt the column. If the bridge falls first, the tanks will halt at the water — kill them at your leisure. If four or more tanks cross before you stop them, the mission is lost.',
      'The depot south of the gorge fuels the column — burn it. Bad Urach sits right next to the approach: the church and the houses are full of people. The Gepards south of the bridge will try to spoil your attack.',
    ],
    threats: ['T-80 column ×8 (125 mm fire)', 'Gepard AA ×2', 'Fuel depot (secondary explosion hazard)', 'Civilian town — strict no-strike'],
    objectives: [
      { id: 'bridge', text: 'Destroy the gorge bridge', primary: true, group: 'bridge', required: 1 },
      { id: 'column', text: 'Stop the armor column (8 tanks)', primary: true, group: 'column', required: 8 },
      { id: 'depot', text: 'Burn the fuel depot', primary: false, group: 'depot', required: 1 },
      { id: 'aa', text: 'Destroy both Gepard positions', primary: false, group: 'aa', required: 2 },
      { id: 'supply', text: 'Destroy the supply trucks', primary: false, group: 'supply', required: 2 },
    ],
    escapeFail: { group: 'column', count: 4, message: 'Four tanks crossed the gorge. The rear area is overrun.' },
    par: 450,
    radio: {
      start: [
        ['ADLER', 'FALKE, the column is moving. Bridge first if you can reach it — then tank by tank. Do not let four cross.'],
        ['FALKE 1-1', 'Understood. Bridge first. PARS 3 is ready for the heavy armor.'],
      ],
      bridgeComplete: [['ADLER', 'Bridge is down! The column is trapped on the north bank. Finish them, FALKE.']],
      columnComplete: [['ADLER', 'Eight tanks, eight kills. The column is no more. Superb gunnery.']],
      firstKill: [['FALKE 1-1', 'First tank brewing up. The column is halting… no, still moving.']],
      playerHit: [['FALKE 1-1', 'Hit! Canopy is cracked but holding.']],
      samLaunch: [],
      lowFuel: [['ADLER', 'You are running on fumes, FALKE. FARP is west of the town.']],
      collateral: [['ADLER', 'That was Bad Urach, FALKE! People live there. Weapons tight on the town!']],
      win: [['ADLER', 'Bridge down, column destroyed. The Alb is secure. The Bundeswehr owes you one.']],
      fail: [['ADLER', 'The column broke through… FALKE is down. Mission failed.']],
    },
  },
  {
    id: 4, mapId: 4,
    title: 'WEISSER BLITZ',
    subtitle: 'White Lightning · Allgäu, dusk',
    intel: [
      'Final operation. The brigade command has holed up in a bunker complex above Füssen, guarded by a fuel farm, two Osa batteries and a Mi-28 gunship that has been hunting our scouts all week.',
      'Destroy the command bunker, the fuel depot, and down that gunship. The Mi-28 is fast and it jinks when you lock it — lead your PARS shots, use rockets in the merge, and keep your flares for its escorts. The mountains will hide you, but they will also hide the SAMs.',
      'Sunset in 40 minutes. The light is going, the peaks are icing up, and every shadow in this valley has a radar in it. Bring it home, FALKE. Operation WEISSER BLITZ ends tonight.',
    ],
    threats: ['Mi-28 HAVOC gunship (rockets + 30 mm, evades missile locks)', 'SA-8 Osa ×2', 'T-80 armor ×4', 'Gepard ×2', 'Alpine terrain — watch your altitude'],
    objectives: [
      { id: 'command', text: 'Destroy the command bunker', primary: true, group: 'command', required: 1 },
      { id: 'fuel', text: 'Destroy the fuel depot', primary: true, group: 'fuel', required: 1 },
      { id: 'gunship', text: 'Down the Mi-28 gunship', primary: true, group: 'gunship', required: 1 },
      { id: 'sam', text: 'Destroy both Osa batteries', primary: false, group: 'sam', required: 2 },
      { id: 'radar', text: 'Destroy the ridge radar', primary: false, group: 'radar', required: 1 },
      { id: 'armor', text: 'Destroy the armor guard (4 tanks)', primary: false, group: 'armor', required: 4 },
    ],
    escapeFail: null,
    par: 540,
    radio: {
      start: [
        ['ADLER', 'FALKE 1-1, this is the big one. Bunker, fuel, gunship. The Mi-28 is airborne north of the lake — it knows you are coming.'],
        ['FALKE 1-1', 'ADLER, FALKE. Copy everything. Let us finish this. Weissser Blitz begins now.'],
      ],
      gunshipComplete: [['ADLER', 'The Havoc is down! I saw it go in from here. The sky is yours, FALKE.']],
      commandComplete: [['ADLER', 'Bunker is collapsed. Command structure is decapitated — finish the fuel and get out.']],
      fuelComplete: [['ADLER', 'Fuel farm is a lake of fire. Beautiful.']],
      firstKill: [['FALKE 1-1', 'First kill of the night. The dusk suits us.']],
      playerHit: [['FALKE 1-1', 'Taking fire from the valley! I can barely see the tracers in this light!']],
      samLaunch: [['FALKE 1-1', 'SAM launch from the ridge! Flares out, diving for the deck!']],
      lowFuel: [['ADLER', 'Fuel is critical. FARP is south, near your start. Do not flame out over the peaks.']],
      collateral: [['ADLER', 'Füssen is civilian, FALKE. Precision only — we are liberators, not conquerors.']],
      win: [['ADLER', 'All objectives destroyed. The brigade is surrendering on every frequency. Operation WEISSER BLITZ is complete. Come home, FALKE — the beer is cold.']],
      fail: [['ADLER', 'FALKE 1-1 is down in the Allgäu… God help us. Mission failed.']],
    },
  },
];

export function rating(stats, mission) {
  if (!stats.success) return { label: 'GESCHEITERT', en: 'FAILED', cls: 'fail' };
  let score = 100;
  score -= stats.collateral * 25;
  score -= Math.max(0, stats.time - mission.par) / 6;
  score -= stats.damageTaken * 0.4;
  const secDone = stats.secondaryDone / Math.max(1, stats.secondaryTotal);
  score += secDone * 20;
  if (score >= 110) return { label: 'AUSGEZEICHNET', en: 'EXCELLENT', cls: 'gold' };
  if (score >= 85) return { label: 'SEHR GUT', en: 'VERY GOOD', cls: 'good' };
  return { label: 'BESTANDEN', en: 'PASSED', cls: 'pass' };
}