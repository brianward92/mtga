/** Short reminders based on Wizards’ Common Keywords glossary.
 * https://magic.wizards.com/en/keyword-glossary
 * These explain keywords mentioned in the rules, including granted abilities.
 */
const HELP: Record<string, string> = {
  'Double strike': 'Deals combat damage in both the first-strike and regular damage steps.',
  'First strike': 'Deals combat damage before creatures without first strike or double strike.',
  'Flying': 'Only creatures with flying or reach can block it.',
  'Reach': 'Can block creatures with flying.',
  'Vigilance': 'Attacking does not tap this creature.',
  'Haste': 'Can attack and use tap abilities without waiting a turn.',
  'Lifelink': 'Its controller gains life equal to the damage it deals.',
  'Deathtouch': 'Any positive damage it deals to a creature is lethal damage.',
  'Menace': 'Must be blocked by at least two creatures.',
  'Trample': 'Can assign excess combat damage beyond its blockers to the defending player or permanent.',
  'Defender': 'Cannot attack.',
  'Flash': 'Can be cast whenever you could cast an instant.',
  'Hexproof': 'Opponents cannot target it with spells or abilities.',
  'Indestructible': 'Cannot be destroyed by damage or effects that say destroy.'
}

export function keywordHelp(text: string): Array<[string, string]> {
  return Object.entries(HELP).filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(text))
}
