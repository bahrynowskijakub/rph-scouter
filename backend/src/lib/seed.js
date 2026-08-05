/**
 * Archetype presets for Core Constructed, transcribed from the metagame table at
 * https://inkdecks.com/lorcana-metagame/core with "Group decks by: Archetypes" — all 44 rows
 * the page reported for Attack of The Vine! (Set 13), as of 5 August 2026.
 *
 * Names are the bare label the site puts in its Archetype column ("Elinor", "Midrange"), with
 * no ink pair spelled into them, because the pair is already sitting next to them as two ink
 * plates. That is also why `archetypes` is keyed on **(name, inks)** rather than on the name:
 * eleven of these labels are shared between pairs — "Midrange" belongs to four of them,
 * "Evasive" to another four — so a name on its own does not identify an archetype.
 *
 * Row order is the page's own: metashare descending, then deck count. It becomes `sort_order`,
 * which is what makes the sheet preselect the likeliest archetype for whichever pair a scout
 * has just tapped in.
 *
 * Ruby/Sapphire is absent on purpose — the page lists no archetype for it. That pair's picker
 * offers only "+ Dodaj archetyp…", which is the honest answer.
 *
 * NOT gospel. The sheet always offers to add one, and what gets added is a row in this same
 * table. `scripts/migrate.js` treats this list as authoritative over `source='seed'` rows only:
 * it overwrites and retires those, and never touches the ones scouts added. Refreshing the meta
 * is: edit this file, `yarn db:migrate`, redeploy.
 */
const SEED_ARCHETYPES = [
  { name: 'Elinor', inks: ['amber', 'emerald'], note: 'Tier 1 · 16% mety' },
  { name: 'Midrange', inks: ['amber', 'amethyst'], note: 'Tier 1 · 11% mety' },
  { name: 'Boost', inks: ['amber', 'ruby'], note: 'Tier 1 · 11% mety' },
  { name: 'Steelsong', inks: ['amber', 'steel'], note: 'Tier 1 · 10% mety' },
  { name: 'Songs', inks: ['amber', 'emerald'], note: 'Tier 2 · 9% mety' },
  { name: 'Evasive', inks: ['amethyst', 'ruby'], note: 'Tier 2 · 7% mety' },
  { name: 'Bots', inks: ['amethyst', 'steel'], note: 'Tier 2 · 7% mety' },
  { name: 'Toys', inks: ['amber', 'emerald'], note: 'Tier 2 · 5% mety' },
  { name: 'Toys', inks: ['amber', 'ruby'], note: 'Tier 2 · 5% mety' },
  { name: 'Detectives', inks: ['sapphire', 'steel'], note: 'Tier 3 · 4% mety' },
  { name: 'Mickey & Minnie', inks: ['emerald', 'sapphire'], note: 'Tier 3 · 4% mety' },
  { name: 'Midrange', inks: ['amethyst', 'steel'], note: 'Tier 3 · 4% mety' },
  { name: 'Touch Paradise', inks: ['emerald', 'steel'], note: 'Tier 3 · 3% mety' },
  { name: 'Actions', inks: ['amber', 'emerald'], note: 'Tier 4 · 2% mety' },
  { name: 'Ramp', inks: ['amber', 'sapphire'], note: 'Tier 4 · 2% mety' },
  { name: 'Supers', inks: ['amethyst', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Songs', inks: ['amber', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Aggro', inks: ['amber', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Self-discard', inks: ['emerald', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Merida', inks: ['emerald', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Supers', inks: ['ruby', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Dwarfs', inks: ['amethyst', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Parr', inks: ['ruby', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Pocahontas', inks: ['amber', 'amethyst'], note: 'Tier 4 · 1% mety' },
  { name: 'Evasive', inks: ['amethyst', 'sapphire'], note: 'Tier 4 · 1% mety' },
  { name: 'Locations', inks: ['ruby', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Midrange', inks: ['amethyst', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Evasive', inks: ['amethyst', 'emerald'], note: 'Tier 4 · 1% mety' },
  { name: 'Damaged', inks: ['amethyst', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Burn', inks: ['amethyst', 'emerald'], note: 'Tier 4 · 1% mety' },
  { name: 'Vineling', inks: ['amethyst', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Madrigal', inks: ['amber', 'amethyst'], note: 'Tier 4 · 1% mety' },
  { name: 'Merida', inks: ['amethyst', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Detectives', inks: ['emerald', 'sapphire'], note: 'Tier 4 · 1% mety' },
  { name: 'Aggro', inks: ['amber', 'amethyst'], note: 'Tier 4 · 1% mety' },
  { name: 'Midrange', inks: ['amethyst', 'emerald'], note: 'Tier 4 · 1% mety' },
  { name: 'Songs', inks: ['emerald', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Bots', inks: ['amber', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Circle', inks: ['amber', 'steel'], note: 'Tier 4 · 1% mety' },
  { name: 'Evasive', inks: ['emerald', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Sulley & Boo', inks: ['amber', 'ruby'], note: 'Tier 4 · 1% mety' },
  { name: 'Midrange Tempo', inks: ['amber', 'sapphire'], note: 'Tier 4 · 1% mety' },
  { name: 'Elinor', inks: ['amethyst', 'emerald'], note: 'Tier 4 · 1% mety' },
  { name: 'Ramp', inks: ['sapphire', 'steel'], note: 'Tier 4 · 1% mety' },
];

module.exports = { SEED_ARCHETYPES };
