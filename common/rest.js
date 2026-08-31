// Backend mirror of Marvel-Frontend/src/pages/my-sheets/CombatTab.jsx's doShortRest/doLongRest —
// lets the OAA's table-wide Short Rest/Long Rest buttons apply the exact same reset each sheet's
// own local button would, to every sheet in the table at once.
//
// Pure functions: the caller (controllers/tables.js) resolves `ctx` (approxMaxHp/approxMaxPp —
// see computeApproxMaxHp/computeApproxMaxPP there — and the character's name) and mutates the
// Mongoose `sheet` document in place; the caller saves it.
//
// KNOWN GAPS vs. the frontend button, both accepted for the same reason computeApproxMaxHp's own
// doc comment gives (a bulk table-wide action, not a substitute for the exact per-character UI):
//   - Heal targets use approxMaxHp/approxMaxPp, which don't replicate every character-specific
//     max-stat override (Warstar's split HP table, Sandman's temporary boost, Extremis, Rogue
//     absorption).
//   - Nico Minoru's short-rest study choice and Hawkeye/Trickshot's bow-modification choice are
//     interactive UI flows this bulk action can't ask for — they're just skipped, identical to
//     the frontend's own "Skip" button (`doShortRest(null)` with no chosen option).
const { processEffectsForRest, filterEffectsForShortRest, filterEffectsForLongRest } = require('./combatEffects')
const { clearStatusForShortRest, clearStatusForLongRest } = require('./statusEffects')

// Ported from frontend sheetMechanics.js LONG_REST_AMMO_DEFAULTS/topUpAmmoOnLongRest — a weapon
// catalog key found among the character's equipped weapons (sheet.textFields.weaponSlots) gets
// its shared ammoInventory count topped up to at least this value (never reduced). Keep in sync
// with the frontend if these numbers change.
const LONG_REST_AMMO_DEFAULTS = {
  PISTOL: 3,
  SUBMACHINE: 3,
  MACHINE: 1,
  ASSAULTRIFLE: 2,
  SHOTGUN: 10,
  SNIPER: 8,
  SAWEDSHOTGUN: 6,
  HUNTINGRIFLE: 10,
}

function topUpAmmoOnLongRest(ammoInventory, weaponKeys) {
  const next = { ...(ammoInventory ?? {}) }
  for (const rawKey of (weaponKeys ?? [])) {
    const key = String(rawKey ?? '').toUpperCase()
    const defaultAmt = LONG_REST_AMMO_DEFAULTS[key]
    if (defaultAmt == null) continue
    next[key] = Math.max(next[key] ?? 0, defaultAmt)
  }
  return next
}

// Ported from frontend sheetMechanics.js RELOAD_CAPACITY/reloadWeaponsOnLongRest — only these 4
// magazine-fed weapons have per-gun loaded ammo to reload; pellet weapons draw straight from
// ammoInventory with no separate loaded state.
const RELOAD_CAPACITY = {
  PISTOL: 10,
  SUBMACHINE: 20,
  ASSAULTRIFLE: 30,
  MACHINE: 100,
}

function reloadWeaponsOnLongRest(equippedWeapons) {
  return (equippedWeapons ?? []).map((w) => {
    const capacity = RELOAD_CAPACITY[w?.key]
    return capacity != null ? { ...w, ammo: capacity } : w
  })
}

// Ported from frontend sheetMechanics.js getDocOckTentacleMaxHp()
function getDocOckTentacleMaxHp(level) {
  const l = level ?? 1
  if (l >= 20) return 70
  if (l >= 14) return 50
  if (l >= 8) return 40
  return 30
}

function characterFlags(characterName) {
  const n = (characterName ?? '').toLowerCase()
  return {
    isGladiator: n.includes('gladiator'),
    isBowArcher: n.includes('hawkeye') || n.includes('trickshot'),
    isDocOck: n.includes('octopus'),
    isBishop: n === 'bishop',
    isSandman: n === 'sandman',
  }
}

function applyShortRestToSheet(sheet, ctx) {
  const { approxMaxHp, approxMaxPp, characterName } = ctx
  const flags = characterFlags(characterName)
  const lvl = sheet.level ?? 1

  // Note: approxMaxHp doesn't distinguish Sandman's boosted max from his normal max (see this
  // file's doc comment) — accepted gap, same as computeApproxMaxHp's own.
  const restMaxHp = approxMaxHp ?? sheet.currentHp ?? 0
  const nextHp = Math.min(restMaxHp, (sheet.currentHp ?? restMaxHp) + Math.ceil(restMaxHp / 2))
  const nextPp = approxMaxPp != null
    ? Math.min(approxMaxPp, (sheet.currentPp ?? approxMaxPp) + Math.floor(approxMaxPp / 2))
    : sheet.currentPp

  const { effects: keptEffects, statBuffs, skillBuffs } =
    processEffectsForRest(sheet.combatEffects ?? [], sheet.statBuffs ?? {}, sheet.skillBuffs ?? {}, filterEffectsForShortRest)

  const thorStartAEP = lvl >= 20 ? 4 : lvl >= 10 ? 3 : 2
  const angelRestHoly = sheet.isArchangel ? (lvl >= 20 ? 2 : 0) : (sheet.holyPoints ?? 0)

  sheet.combatTurnCount = 1
  sheet.currentHp = nextHp
  sheet.currentPp = nextPp
  sheet.deathHp = 0
  sheet.webCharges = 20
  sheet.webCartridges = Math.min(10, (sheet.webCartridges ?? 10) + 5)
  sheet.isInRage = false
  sheet.rampageCheckDifficulty = 3
  sheet.isInFury = false
  sheet.furyTurnsRemaining = 0
  sheet.asgardianEnergy = thorStartAEP
  sheet.isWarriorsMadness = false
  sheet.isBerserkersRage = false
  sheet.wisdomFailCount = 0
  sheet.holyPoints = angelRestHoly
  sheet.isArchangel = false
  sheet.archangelTurnsRemaining = 0
  sheet.bishopBoosterTurnsRemaining = 0
  sheet.bishopBoosterBonuses = {}
  sheet.shawKineticCapReduction = 0
  sheet.combatEffects = keptEffects
  sheet.statBuffs = statBuffs
  sheet.skillBuffs = skillBuffs

  let specialResource = { ...(sheet.specialResource ?? {}), statusEffects: clearStatusForShortRest(sheet.specialResource?.statusEffects) }

  if (flags.isGladiator) {
    const gladiatorMaxCp = lvl >= 16 ? 8 : lvl >= 6 ? 7 : 6
    const gain = lvl >= 2 ? 2 : 1
    sheet.gladiatorCp = Math.min(gladiatorMaxCp, (sheet.gladiatorCp ?? gladiatorMaxCp) + gain)
  }
  if (flags.isBowArcher) {
    sheet.hawkeyeArrows = lvl + 5 + (sheet.hawkeyeBowMod === 'sockets' ? 4 : 0)
  }
  if (flags.isDocOck) {
    const maxTentacleHp = getDocOckTentacleMaxHp(lvl)
    const tentacles = sheet.specialResource?.docOckTentacles ?? Array.from({ length: 4 }, () => ({ hp: maxTentacleHp, outOfCombat: false }))
    specialResource = {
      ...specialResource,
      docOckTentacles: tentacles.map((t) => {
        const hp = Math.min(maxTentacleHp, (t?.hp ?? maxTentacleHp) + Math.ceil(maxTentacleHp / 2))
        return { hp, outOfCombat: hp >= maxTentacleHp ? false : t?.outOfCombat }
      }),
    }
  }
  sheet.specialResource = specialResource
  if (flags.isSandman) {
    sheet.sandmanBoostHp = 0
    sheet.sandmanAbsorptionUses = 0
  }
}

function applyLongRestToSheet(sheet, ctx) {
  const { approxMaxHp, approxMaxPp, characterName, formWeapons } = ctx
  const flags = characterFlags(characterName)
  const lvl = sheet.level ?? 1

  const { effects: keptEffects, statBuffs, skillBuffs } =
    processEffectsForRest(sheet.combatEffects ?? [], sheet.statBuffs ?? {}, sheet.skillBuffs ?? {}, filterEffectsForLongRest)

  let equippedWeapons = []
  try { equippedWeapons = JSON.parse(sheet.textFields?.weaponSlots || '[]') } catch { equippedWeapons = [] }

  // Every ammo-tracked weapon the character has access to at all — their full Basic Equipment
  // loadout (formWeapons) unioned with whatever's currently in their weapon slots — gets topped
  // up, not just what's equipped right now.
  const ammoRelevantWeaponKeys = [
    ...(formWeapons ?? []),
    ...equippedWeapons.map((w) => w?.key),
  ]

  sheet.combatTurnCount = 1
  sheet.currentHp = approxMaxHp ?? sheet.currentHp
  sheet.currentPp = approxMaxPp ?? sheet.currentPp
  sheet.deathHp = 0
  sheet.ammoInventory = topUpAmmoOnLongRest(sheet.ammoInventory, ammoRelevantWeaponKeys)
  if (sheet.textFields) {
    sheet.textFields.weaponSlots = JSON.stringify(reloadWeaponsOnLongRest(equippedWeapons))
  }
  sheet.webCharges = 20
  sheet.webCartridges = 10
  sheet.toVirus = 0
  sheet.kineticPoints = 0
  sheet.isInRage = false
  sheet.rampageCheckDifficulty = 3
  sheet.isInFury = false
  sheet.furyTurnsRemaining = 0
  sheet.furyPoints = 0
  sheet.asgardianEnergy = lvl >= 20 ? 4 : lvl >= 10 ? 3 : 2
  sheet.isWarriorsMadness = false
  sheet.isBerserkersRage = false
  sheet.wisdomFailCount = 0
  sheet.holyPoints = 0
  sheet.isArchangel = false
  sheet.archangelTurnsRemaining = 0
  sheet.bishopBoosterTurnsRemaining = 0
  sheet.bishopBoosterBonuses = {}
  sheet.shawKineticCapReduction = 0
  sheet.combatEffects = keptEffects
  sheet.statBuffs = statBuffs
  sheet.skillBuffs = skillBuffs

  let specialResource = { ...(sheet.specialResource ?? {}), statusEffects: clearStatusForLongRest(sheet.specialResource?.statusEffects) }

  if (flags.isGladiator) sheet.gladiatorCp = 6
  if (flags.isBowArcher) sheet.hawkeyeArrows = lvl + 5 + (sheet.hawkeyeBowMod === 'sockets' ? 4 : 0)
  if (flags.isBishop) sheet.bishopLongRestsSinceTimeTravel = (sheet.bishopLongRestsSinceTimeTravel ?? 0) + 1
  if (flags.isDocOck) {
    const maxTentacleHp = getDocOckTentacleMaxHp(lvl)
    const tentacleCount = (sheet.specialResource?.docOckTentacles ?? []).length || 4
    specialResource = {
      ...specialResource,
      docOckTentacles: Array.from({ length: tentacleCount }, () => ({ hp: maxTentacleHp, outOfCombat: false })),
    }
  }
  sheet.specialResource = specialResource
  if (flags.isSandman) {
    sheet.sandmanBoostHp = 0
    sheet.sandmanAbsorptionUses = 0
  }
}

module.exports = { applyShortRestToSheet, applyLongRestToSheet, getDocOckTentacleMaxHp }
