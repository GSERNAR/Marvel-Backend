// Backend mirror of STATUS_EFFECTS_DEF's id -> clearOn mapping in
// Marvel-Frontend/src/pages/my-sheets/CombatTab.jsx — only the clearOn value is needed here (not
// the full descriptive text), to let the table-wide End Fight reset each sheet's status effects
// the same way that sheet's own local End Fight button does. Keep in sync if a status is
// added/removed or its clearOn changes on the frontend.
const STATUS_CLEAR_ON = {
  bleeding: 'longRest',
  burned: 'battle',
  irradiated: 'manual',
  poisoned: 'manual',
  putrid: 'manual',
  blinded: 'turns',
  concussed: 'turns',
  deafened: 'turns',
  frozen: 'manual',
  grappled: 'manual',
  paralyzed: 'turns',
  petrified: 'manual',
  prone: 'manual',
  stunned: 'turns',
  charmed: 'manual',
  confused: 'manual',
  frightened: 'turns',
  possessed: 'manual',
  purpleControl: 'manual',
  telepathicControl: 'manual',
  comatose: 'manual',
  drugged: 'manual',
  invisible: 'manual',
  sleeping: 'manual',
  soaked: 'battle',
  heatStacks: 'manual',
}

function clearStatusForEndFight(statusEffects) {
  const keep = new Set(['shortRest', 'longRest', 'manual'])
  return Object.fromEntries(
    Object.entries(statusEffects ?? {}).filter(([id]) => keep.has(STATUS_CLEAR_ON[id]))
  )
}

function clearStatusForShortRest(statusEffects) {
  const keep = new Set(['longRest', 'manual'])
  return Object.fromEntries(
    Object.entries(statusEffects ?? {}).filter(([id]) => keep.has(STATUS_CLEAR_ON[id]))
  )
}

function clearStatusForLongRest(statusEffects) {
  return Object.fromEntries(
    Object.entries(statusEffects ?? {}).filter(([id]) => STATUS_CLEAR_ON[id] === 'manual')
  )
}

module.exports = { STATUS_CLEAR_ON, clearStatusForEndFight, clearStatusForShortRest, clearStatusForLongRest }
