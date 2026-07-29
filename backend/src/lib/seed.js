/**
 * Starting archetype presets for Core Constructed after the Set 13 rotation
 * (legal sets 009-013). These are a scout's shortcuts, not gospel — the admin can add
 * to the list mid-event, and the modal always accepts a free-text archetype.
 *
 * The insert lives in backend/scripts/migrate.js and only fires into an empty table, so
 * admin edits are never overwritten. This file is just the data.
 */
const SEED_ARCHETYPES = [
  { name: 'Amber/Emerald Elinor', inks: ['amber', 'emerald'], style: 'midrange', note: 'Elinor value engine behind cheap wide bodies' },
  { name: 'Amber/Ruby Boost', inks: ['amber', 'ruby'], style: 'tempo', note: 'Boost curve-out into Simba / Lady Tremaine' },
  { name: 'Amber/Amethyst Midrange', inks: ['amber', 'amethyst'], style: 'midrange', note: 'Dale pumping recurring questers' },
  { name: 'Amber/Steel Steelsong', inks: ['amber', 'steel'], style: 'control', note: 'Amber singers cheating out Steel removal songs' },
  { name: 'Amethyst/Ruby Evasive', inks: ['amethyst', 'ruby'], style: 'tempo', note: 'Cheap unblockable lore, races removal-light decks' },
  { name: 'Amber/Emerald Aggro', inks: ['amber', 'emerald'], style: 'aggro', note: 'Go-wide flood build, Under the Sea as reset' },
  { name: 'Sapphire/Steel Detectives', inks: ['sapphire', 'steel'], style: 'midrange', note: 'Darkwing / Judy Hopps grindy card advantage' },
  { name: 'Amethyst/Steel Dwarfs', inks: ['amethyst', 'steel'], style: 'midrange', note: 'Right Behind You dumping the Seven Dwarfs' },
  { name: 'Amethyst/Sapphire Blurple', inks: ['amethyst', 'sapphire'], style: 'ramp', note: 'Hunny ramp-control into Hades / Demona' },
  { name: 'Emerald/Ruby Sid', inks: ['emerald', 'ruby'], style: 'combo', note: 'Sid banishing his own toys for lore' },
  { name: 'Ruby/Steel Supers', inks: ['ruby', 'steel'], style: 'midrange', note: 'Incredibles tribal' },
  { name: 'Emerald/Steel Merida', inks: ['emerald', 'steel'], style: 'control', note: 'Three Arrows rebought by Merida' },
  { name: 'Emerald/Sapphire Support', inks: ['emerald', 'sapphire'], style: 'combo', note: 'Stack Support, then one huge lore turn' },
  { name: 'Ruby/Sapphire Items', inks: ['ruby', 'sapphire'], style: 'midrange', note: 'Item-density value out of the Wilds Unknown shell' },
  { name: 'Amber/Sapphire Madrigals', inks: ['amber', 'sapphire'], style: 'midrange', note: 'Encanto tribal, emerging brew' },
  { name: 'Amethyst/Emerald Burn', inks: ['amethyst', 'emerald'], style: 'aggro', note: 'Direct damage plus evasive pressure' },
  { name: 'Amber/Ruby Monsters', inks: ['amber', 'ruby'], style: 'midrange', note: 'Monsters, Inc. shell around Sulley & Boo' },
];

module.exports = { SEED_ARCHETYPES };
