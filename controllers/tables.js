const { tablesModel, sheetsModel, usersModel, formsModel, powersModel, charactersModel, ModulesModel } = require('../models')
const { ApiError, ErrorCode } = require('../common/apiError')
const {
  processEffectsForNextTurn, filterEffectsForNextTurn, restoreEffectsForPreviousTurn,
  filterEffectsForEndFight, processEffectsForRest,
} = require('../common/combatEffects')
const { clearStatusForEndFight } = require('../common/statusEffects')
const { applyShortRestToSheet, applyLongRestToSheet } = require('../common/rest')
const { detachSheetFromTables } = require('./sheets')

// Ported from frontend src/pages/my-sheets/sheetMechanics.js computeMaxPP()
const computeMaxPP = (powerStat, level) => {
  const p = Math.min(Math.max(1, powerStat ?? 1), 10)
  return p * 2 + Math.floor((level ?? 1) / 5) * 2
}

// Ported from frontend src/pages/my-sheets/sheetMechanics.js ARMORED_HERO_BASE_FIELDS —
// keep both copies in sync when adding a new armored hero.
const ARMORED_HERO_BASE_FIELDS = {
  'Iron Man':    { hpField: 'tonyCurrentHp',   ppField: 'tonyCurrentPp' },
  'War Machine': { hpField: 'rhodesCurrentHp', ppField: 'rhodesCurrentPp' },
}

// forms/characters can have _id stored as plain strings (not real ObjectIds) from older
// bulk imports, which breaks Mongoose's auto-casting findById(). Fetch-all + string compare
// instead, matching how the working GET /forms and GET /characters list routes already do it.
const findFormById = async (id) => {
  if (!id) return null
  const forms = await formsModel.find({})
  return forms.find(f => String(f._id) === String(id)) ?? null
}
const findCharacterById = async (id) => {
  if (!id) return null
  const characters = await charactersModel.find({})
  return characters.find(c => String(c._id) === String(id)) ?? null
}

// Ported from frontend src/pages/my-sheets/sheetMechanics.js computeIso8StatBonuses()
const computeIso8StatBonuses = (iso8Array) => {
  const bonuses = {}
  for (const iso of (iso8Array ?? [])) {
    if (!iso || !iso.statBonuses) continue
    if (iso.combatsRemaining !== undefined && iso.combatsRemaining <= 0) continue
    for (const { stat, amount } of iso.statBonuses) bonuses[stat] = (bonuses[stat] ?? 0) + amount
  }
  return bonuses
}

// Approximate max HP for clamping a heal so it can't overheal past the target's max — covers the
// common case (base form HP + level progression + ISO-8) but doesn't replicate every
// character-specific override the frontend's useSheetStats.js pipeline has (Warstar's split HP
// table, Sandman's temporary boost, Extremis, Rogue absorption, etc.). Returns null (meaning
// "don't clamp") rather than guess when the form can't be resolved.
// Most sheets don't store their own formId — they implicitly use the character's default form
// (see frontend useSheetStats.js: `sheet.formId ?? character?.defaultForm`). Resolving only
// sheet.formId meant this returned null (i.e. "don't clamp"/"don't touch") for the common
// single-form case, silently skipping the heal clamp and PP/ammo calculations below.
const resolveSheetForm = async (sheet) => {
  if (sheet?.formId) return findFormById(sheet.formId)
  if (!sheet?.characterId) return null
  const character = await findCharacterById(sheet.characterId)
  return character?.defaultForm ? findFormById(character.defaultForm) : null
}

const computeApproxMaxHp = async (sheet) => {
  const form = await resolveSheetForm(sheet)
  if (!form) return null
  const baseHp = form.stats?.get?.('hp') ?? 0
  const iso8HpBonus = computeIso8StatBonuses(sheet.iso8 ?? []).hp ?? 0
  return baseHp + (sheet.progressionHpBonus ?? 0) + iso8HpBonus
}

// Same approximation approach as computeApproxMaxHp, for max PP — used to clamp/target the
// table-wide Short Rest/Long Rest heals (half/full PP).
const computeApproxMaxPP = async (sheet) => {
  const form = await resolveSheetForm(sheet)
  if (!form) return null
  const basePower = form.stats?.get?.('power') ?? 1
  const iso8PowerBonus = computeIso8StatBonuses(sheet.iso8 ?? []).power ?? 0
  const statBuffPower = sheet.statBuffs?.power ?? 0
  return computeMaxPP(basePower + iso8PowerBonus + statBuffPower, sheet.level ?? 1)
}

// Ported from frontend src/pages/my-sheets/CombatTab.jsx's handleEndFight — mutates `sheet` (not
// saved here) with the exact same reset. Every value it touches lives on the sheet's own document
// already, so this is fully generic: no character/form lookups needed, and the handful of
// character-gated fields in the frontend version (magnetoBarriers, docOckRising) are just
// harmlessly included for every sheet since they sit unused on characters who don't have them.
function applyEndFightToSheet(sheet) {
  const { effects: keptEffects, statBuffs, skillBuffs } =
    processEffectsForRest(sheet.combatEffects ?? [], sheet.statBuffs ?? {}, sheet.skillBuffs ?? {}, filterEffectsForEndFight)

  const updatedIso8 = (sheet.iso8 ?? []).map((iso) => {
    if (!iso || iso.combatsRemaining === undefined) return iso
    return { ...iso, combatsRemaining: Math.max(0, iso.combatsRemaining - 1) }
  })

  const level = sheet.level ?? 1
  const angelEndHoly = sheet.isArchangel ? (level >= 20 ? 2 : 0) : (sheet.holyPoints ?? 0)

  sheet.combatTurnCount = 1
  sheet.combatEffects = keptEffects
  sheet.statBuffs = statBuffs
  sheet.skillBuffs = skillBuffs
  sheet.specialResource = {
    ...(sheet.specialResource ?? {}),
    statusEffects: clearStatusForEndFight(sheet.specialResource?.statusEffects),
    magnetoBarriers: [],
  }
  sheet.iso8 = updatedIso8
  sheet.isInRage = false
  sheet.rampageCheckDifficulty = 3
  sheet.isInFury = false
  sheet.furyTurnsRemaining = 0
  sheet.asgardianEnergy = level >= 20 ? 4 : level >= 10 ? 3 : 2
  sheet.isWarriorsMadness = false
  sheet.isBerserkersRage = false
  sheet.wisdomFailCount = 0
  sheet.holyPoints = angelEndHoly
  sheet.isArchangel = false
  sheet.archangelTurnsRemaining = 0
  sheet.bladeSerumUsesThisCombat = 0
  sheet.bishopBoosterTurnsRemaining = 0
  sheet.bishopBoosterBonuses = {}
  sheet.shawKineticCapReduction = 0
  sheet.docOckRising = false
}

// Long-poll watchers: userId (string) → [{ finish, timer, done }, ...]
// Array so multiple open tabs/windows for the same user all get notified.
const pendingWatchers = new Map()

// Last turn-advance event seen per user, keyed by monotonic seq. Lets a /watch request
// that connects *after* a notify already fired (e.g. GM rapid-firing Next Turn through several
// NPCs faster than a tab can reconnect its long-poll) catch up immediately instead of waiting
// for the 28s timeout — closing the race that made OAA/NPC turn notifications feel inconsistent.
const lastEventForUser = new Map()
let turnEventSeq = 0

const watchAnyInitiativeTurn = (userId, res, sinceSeq) => {
  const key = String(userId)

  const last = lastEventForUser.get(key)
  if (last && Number(sinceSeq || 0) < last.seq) {
    return res.json(last.payload)
  }

  if (!pendingWatchers.has(key)) pendingWatchers.set(key, [])
  const list = pendingWatchers.get(key)

  const entry = { done: false }

  const finish = (data) => {
    if (entry.done) return
    entry.done = true
    clearTimeout(entry.timer)
    const idx = list.indexOf(entry)
    if (idx >= 0) list.splice(idx, 1)
    try { if (!res.headersSent) res.json(data) } catch {}
  }

  entry.finish = finish
  entry.timer = setTimeout(() => finish({ timeout: true }), 28000)
  list.push(entry)

  res.on('close', () => {
    if (entry.done) return
    entry.done = true
    clearTimeout(entry.timer)
    const idx = list.indexOf(entry)
    if (idx >= 0) list.splice(idx, 1)
  })
}

const getTables = async (userId) => {
  return tablesModel.find({
    $or: [{ oaaId: userId }, { 'members.userId': userId }]
  }).sort({ updatedAt: -1 })
}

const getTable = async (userId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa = String(table.oaaId) === String(userId)
  const memberEntry = table.members.find(m => String(m.userId) === String(userId))
  if (!isOaa && !memberEntry) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')

  // Fetch portrait info for accepted members with sheets (primary sheet + any companion sheets)
  const primarySheetIds = table.members.filter(m => m.status === 'accepted' && m.sheetId).map(m => m.sheetId)
  const companionSheetIds = table.members.flatMap(m => m.status === 'accepted' ? (m.companionSheetIds || []) : [])
  const sheetIds = [...primarySheetIds, ...companionSheetIds]
  const portraits = await sheetsModel.find(
    { _id: { $in: sheetIds } },
    'displayName characterName level characterId formId formName'
  )
  const portraitMap = Object.fromEntries(portraits.map(s => [String(s._id), {
    sheetId: String(s._id),
    displayName: s.displayName,
    characterName: s.characterName,
    level: s.level,
    characterId: String(s.characterId),
    formId: s.formId || null,
    formName: s.formName || null,
  }]))

  const members = table.members.map(m => ({
    userId: m.userId,
    username: m.username,
    status: m.status,
    sheetId: m.sheetId,
    pendingSheets: m.pendingSheets || [],
    companionSheetIds: m.companionSheetIds || [],
    portrait: m.sheetId ? (portraitMap[String(m.sheetId)] ?? null) : null,
    companionPortraits: (m.companionSheetIds || []).map(sid => portraitMap[String(sid)]).filter(Boolean),
  }))

  return {
    _id: table._id,
    name: table.name,
    oaaId: table.oaaId,
    oaaUsername: table.oaaUsername,
    oaaSheetIds: table.oaaSheetIds || [],
    members,
    initiative: table.initiative || null,
    combatRoles: table.combatRoles || {},
    activeMarkets: table.activeMarkets || {},
    isOaa,
    isMember: !!memberEntry && memberEntry.status === 'accepted',
    isPending: !!memberEntry && memberEntry.status === 'pending',
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  }
}

const createTable = async (userId, body) => {
  const user = await usersModel.findById(userId)
  if (!user) throw new ApiError(ErrorCode.NOT_FOUND, 'User not found')
  return tablesModel.create({ name: body.name, oaaId: userId, oaaUsername: user.username, oaaSheetIds: [], members: [] })
}

const deleteTable = async (oaaId, tableId) => {
  const table = await tablesModel.findOneAndDelete({ _id: tableId, oaaId })
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found or not authorized')
  return {}
}

const inviteMember = async (oaaId, tableId, targetUsername) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const target = await usersModel.findOne({ username: targetUsername })
  if (!target) throw new ApiError(ErrorCode.NOT_FOUND, `User "${targetUsername}" not found`)
  if (String(target._id) === String(oaaId)) throw new ApiError(ErrorCode.BAD_REQUEST, 'Cannot invite yourself')

  const alreadyIn = table.members.some(m => String(m.userId) === String(target._id))
  if (alreadyIn) throw new ApiError(ErrorCode.CONFLICT, 'User already invited or a member')

  table.members.push({ userId: String(target._id), username: target.username, status: 'pending', sheetId: null, pendingSheets: [] })
  await table.save()
  if (global.io) global.io.emit('table:invitation', { userId: String(target._id), tableId: String(tableId) })
  return { ok: true }
}

const respondToInvitation = async (userId, tableId, accept) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const member = table.members.find(m => String(m.userId) === String(userId))
  if (!member) throw new ApiError(ErrorCode.NOT_FOUND, 'Invitation not found')
  if (member.status !== 'pending') throw new ApiError(ErrorCode.BAD_REQUEST, 'Already responded')

  member.status = accept ? 'accepted' : 'declined'
  await table.save()
  return { status: member.status }
}

const selectSheet = async (userId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const member = table.members.find(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!member) throw new ApiError(ErrorCode.FORBIDDEN, 'Not an accepted member')

  const sheet = await sheetsModel.findOne({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  member.sheetId = String(sheetId)
  // Companions always mirror whichever sheet is currently selected as primary — recomputed fresh
  // (not merged) on every select, so switching away from a sheet drops its companions from the
  // table in the same atomic step that picks up the new sheet's, rather than only ever adding.
  const companionSheets = await sheetsModel.find({ parentSheetId: String(sheetId), userId }, '_id')
  member.companionSheetIds = companionSheets.map(s => String(s._id))
  await table.save()
  return { sheetId: member.sheetId, companionSheetIds: member.companionSheetIds }
}

const addOaaSheet = async (oaaId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const sheet = await sheetsModel.findOne({ _id: sheetId, userId: oaaId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  // Any companion sheets this NPC already has (created before it was added here — e.g. via its
  // own Companions tab auto-create) attach too, same as the sheet itself. Mirrors selectSheet's
  // companion recompute for player-selected sheets; addOaaSheet only ever added the one sheetId
  // requested, silently leaving pre-existing companions stranded off the table.
  const companionSheets = await sheetsModel.find({ parentSheetId: String(sheetId), userId: oaaId }, '_id')
  const idsToAdd = [String(sheetId), ...companionSheets.map(s => String(s._id))]
  const existing = new Set(table.oaaSheetIds.map(String))
  const newIds = idsToAdd.filter(id => !existing.has(id))
  if (newIds.length > 0) {
    table.oaaSheetIds.push(...newIds)
    await table.save()
  }
  return { oaaSheetIds: table.oaaSheetIds }
}

const removeOaaSheet = async (oaaId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  table.oaaSheetIds = table.oaaSheetIds.filter(id => String(id) !== String(sheetId))
  await table.save()
  return { oaaSheetIds: table.oaaSheetIds }
}

// Auto-attach for a player's own summoned companion sheet — unlike requestSheet/approveSheetRequest
// (a manual, OAA-approved swap of the member's primary sheet), this needs no approval since the
// player already paid the summon cost on their own sheet; it just makes the companion visible at
// the table alongside them.
const addCompanionSheet = async (userId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const member = table.members.find(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!member) throw new ApiError(ErrorCode.FORBIDDEN, 'Not an accepted member')

  const sheet = await sheetsModel.findOne({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  if (!member.companionSheetIds) member.companionSheetIds = []
  if (!member.companionSheetIds.map(String).includes(String(sheetId))) {
    member.companionSheetIds.push(String(sheetId))
    await table.save()
  }
  return { companionSheetIds: member.companionSheetIds }
}

const requestSheet = async (userId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const member = table.members.find(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!member) throw new ApiError(ErrorCode.FORBIDDEN, 'Not an accepted member')

  const sheet = await sheetsModel.findOne({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  if (!member.pendingSheets) member.pendingSheets = []
  const alreadyPending = member.pendingSheets.some(ps => String(ps.sheetId) === String(sheetId))
  if (!alreadyPending) {
    member.pendingSheets.push({ sheetId: String(sheetId), sheetName: sheet.displayName })
    await table.save()
  }
  return { pendingSheets: member.pendingSheets }
}

const approveSheetRequest = async (oaaId, tableId, memberId, sheetId, approve) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const member = table.members.find(m => String(m.userId) === String(memberId))
  if (!member) throw new ApiError(ErrorCode.NOT_FOUND, 'Member not found')

  member.pendingSheets = (member.pendingSheets || []).filter(ps => String(ps.sheetId) !== String(sheetId))
  if (approve) member.sheetId = String(sheetId)

  await table.save()
  return { ok: true }
}

const leaveTable = async (userId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) === String(userId)) throw new ApiError(ErrorCode.BAD_REQUEST, 'OAA cannot leave — delete the table instead')

  const before = table.members.length
  table.members = table.members.filter(m => String(m.userId) !== String(userId))
  if (table.members.length === before) throw new ApiError(ErrorCode.NOT_FOUND, 'Not a table member')

  await table.save()
  return { ok: true }
}

const kickMember = async (oaaId, tableId, userId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const before = table.members.length
  table.members = table.members.filter(m => String(m.userId) !== String(userId))
  if (table.members.length === before) throw new ApiError(ErrorCode.NOT_FOUND, 'Member not found')

  await table.save()
  if (global.io) global.io.emit('table:member-kicked', { tableId: String(tableId), userId: String(userId) })
  return { ok: true }
}

const getTableSheet = async (userId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa = String(table.oaaId) === String(userId)
  const isMember = table.members.some(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!isOaa && !isMember) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')

  // All participants can see accepted member sheets, their companion sheets, and OAA NPC sheets
  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.members.flatMap(m => (m.companionSheetIds || []).map(String)),
    ...table.oaaSheetIds.map(String),
  ])
  // OAA can also access pending sheets under review
  if (isOaa) {
    table.members.flatMap(m => (m.pendingSheets || []).map(ps => String(ps.sheetId))).forEach(id => validIds.add(id))
  }
  if (!validIds.has(String(sheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Sheet not in table')

  const sheet = await sheetsModel.findById(sheetId)
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  return sheet
}

const getAbsorbTargets = async (userId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa    = String(table.oaaId) === String(userId)
  const isMember = table.members.some(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!isOaa && !isMember) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')

  // Other accepted members' sheets
  const memberEntries = table.members
    .filter(m => m.status === 'accepted' && m.sheetId && String(m.userId) !== String(userId))
    .map(m => ({ sheetId: String(m.sheetId), memberUsername: m.username, memberId: m.userId, isNpc: false }))

  // OAA NPC sheets — visible to every table participant
  const oaaEntries = (table.oaaSheetIds || []).map(sid => ({
    sheetId: String(sid), memberUsername: table.oaaUsername, memberId: table.oaaId, isNpc: true,
    combatRole: table.combatRoles?.[String(sid)] ?? null,
  }))

  const targets = [...memberEntries, ...oaaEntries]
  if (targets.length === 0) return []

  const sheets = await sheetsModel.find({ _id: { $in: targets.map(t => t.sheetId) } }).lean()
  const sheetMap = Object.fromEntries(sheets.map(s => [String(s._id), s]))

  const results = []
  for (const target of targets) {
    const sheet = sheetMap[target.sheetId]
    if (!sheet) continue
    results.push({
      memberId: target.memberId,
      memberUsername: target.memberUsername,
      isNpc: target.isNpc,
      sheetId: target.sheetId,
      displayName: sheet.displayName,
      characterName: sheet.characterName,
      characterId: String(sheet.characterId),
      formId: sheet.formId || null,
      level: sheet.level ?? 1,
      progressionHpBonus: sheet.progressionHpBonus ?? 0,
      skillRanks: sheet.skillRanks || {},
      unlockedPowerIds: (sheet.unlockedPowerIds ?? []).map(String),
      combatRole: target.combatRole ?? null,
    })
  }
  return results
}

// Find the right table for a given sheet and return absorb targets — no frontend guessing needed
const getAbsorbTargetsForSheet = async (userId, sheetId) => {
  // Priority 1: table where this specific sheet is the active member sheet or an OAA NPC
  let table = await tablesModel.findOne({
    $or: [
      { 'members': { $elemMatch: { sheetId: String(sheetId), status: 'accepted' } } },
      { oaaSheetIds: String(sheetId) },
    ]
  })

  // Priority 2: any table where this user is an accepted member (sheet not explicitly selected)
  if (!table) {
    table = await tablesModel.findOne({
      'members': { $elemMatch: { userId: String(userId), status: 'accepted' } }
    }).sort({ updatedAt: -1 })
  }

  if (!table) return []
  return getAbsorbTargets(userId, String(table._id))
}

// A regular table member (not just the OAA) may HEAL another sheet in the same table — an ally's
// own sheet, or an OAA NPC that isn't tagged Boss/Minion (per the item catalog's "heal an ally or
// eligible NPC" items). This is the only cross-sheet WRITE a non-OAA player has; scoped strictly
// to healing (mirrors oaaSheetCombatUpdate's heal branch) — no damage/status/other fields.
const assistSheetForSheet = async (userId, callerSheetId, targetSheetId, body) => {
  // Same table-resolution convenience as getAbsorbTargetsForSheet — no frontend tableId needed.
  let table = await tablesModel.findOne({
    $or: [
      { 'members': { $elemMatch: { sheetId: String(callerSheetId), status: 'accepted' } } },
      { oaaSheetIds: String(callerSheetId) },
    ]
  })
  if (!table) {
    table = await tablesModel.findOne({
      'members': { $elemMatch: { userId: String(userId), status: 'accepted' } }
    }).sort({ updatedAt: -1 })
  }
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa = String(table.oaaId) === String(userId)
  const isMember = table.members.some(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!isOaa && !isMember) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')

  const isMemberSheet = table.members.some(m => m.status === 'accepted' && String(m.sheetId) === String(targetSheetId))
  const isOaaSheet = (table.oaaSheetIds || []).map(String).includes(String(targetSheetId))
  if (!isMemberSheet && !isOaaSheet) throw new ApiError(ErrorCode.FORBIDDEN, 'Target not in this table')

  if (isOaaSheet) {
    const role = table.combatRoles?.[String(targetSheetId)]
    if (role === 'Boss' || role === 'Minion') throw new ApiError(ErrorCode.FORBIDDEN, 'Cannot assist a Boss or Minion')
  }

  const sheet = await sheetsModel.findById(targetSheetId)
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  let wasDamage = false
  if (body.heal != null) {
    // Sane upper bound in case of a broken client — the biggest catalog heal (Asgardian Mead) is 50.
    const amt = Math.max(0, Math.min(200, Number(body.heal) || 0))
    // Putrid ("any healing ability deals damage equal to the healing amount instead of restoring
    // HP" — STATUS_EFFECTS_DEF in Marvel-Frontend's CombatTab.jsx): checked against the TARGET's
    // own status, since this heal is being cast ON them.
    const isPutrid = !!sheet.specialResource?.statusEffects?.putrid?.active
    wasDamage = isPutrid
    if (isPutrid) {
      const hpBefore = sheet.currentHp ?? 0
      const newHp = Math.max(0, hpBefore - amt)
      const maxDeathHp = 30 + (sheet.level ?? 1) * 5
      const rawDeathHp = newHp === 0 && amt > hpBefore ? (sheet.deathHp ?? 0) + (amt - hpBefore) : newHp > 0 ? 0 : (sheet.deathHp ?? 0)
      sheet.currentHp = newHp
      sheet.deathHp = Math.min(maxDeathHp, rawDeathHp)
    } else {
      // Never heal past the target's own max HP.
      const approxMaxHp = await computeApproxMaxHp(sheet)
      const clamp = (hp) => approxMaxHp != null ? Math.min(approxMaxHp, hp) : hp
      const currentDeathHp = sheet.deathHp ?? 0
      if (currentDeathHp > 0) {
        const deathReduction = Math.min(currentDeathHp, amt)
        sheet.deathHp = currentDeathHp - deathReduction
        const remaining = amt - deathReduction
        if (remaining > 0) sheet.currentHp = clamp((sheet.currentHp ?? 0) + remaining)
      } else {
        sheet.currentHp = clamp((sheet.currentHp ?? 0) + amt)
      }
    }
  }

  await sheet.save()
  if (global.io) {
    global.io.emit('sheet:updated', { sheetId: String(targetSheetId), sheet })
    if (body.heal != null) {
      if (wasDamage) global.io.emit('combat:damage', { sheetId: String(targetSheetId), defeated: sheet.currentHp === 0 })
      else global.io.emit('combat:heal', { sheetId: String(targetSheetId) })
    }
  }
  return { currentHp: sheet.currentHp, deathHp: sheet.deathHp ?? 0 }
}

// ── Initiative ────────────────────────────────────────────────────────────────

const requestInitiative = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  table.initiative = { status: 'requesting', rolls: {}, sheetRolls: {}, tiebreakerUserIds: [], tiebreakerRolls: {}, order: null }
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

const submitInitiativeRoll = async (userId, tableId, total, isSpeedster, isTiebreaker) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa = String(table.oaaId) === String(userId)
  const member = table.members.find(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!isOaa && !member) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')
  if (!table.initiative) throw new ApiError(ErrorCode.BAD_REQUEST, 'No initiative in progress')

  const username = member?.username ?? table.oaaUsername
  let characterName = null
  if (member?.sheetId) {
    const sheet = await sheetsModel.findById(member.sheetId, 'characterName').lean()
    characterName = sheet?.characterName ?? null
  }

  if (!table.initiative.rolls) table.initiative.rolls = {}
  if (!table.initiative.tiebreakerRolls) table.initiative.tiebreakerRolls = {}

  if (isTiebreaker) {
    table.initiative.tiebreakerRolls[String(userId)] = Number(total)
  } else {
    table.initiative.rolls[String(userId)] = {
      username,
      characterName,
      total: Number(total),
      isSpeedster: !!isSpeedster,
    }
  }

  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

const startInitiativeTiebreaker = async (oaaId, tableId, userIds) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')
  if (!table.initiative) throw new ApiError(ErrorCode.BAD_REQUEST, 'No initiative in progress')

  table.initiative.status = 'tiebreaking'
  table.initiative.tiebreakerUserIds = (userIds || []).map(String)
  table.initiative.tiebreakerRolls = {}
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

const publishInitiativeOrder = async (oaaId, tableId, order) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')
  if (!table.initiative) throw new ApiError(ErrorCode.BAD_REQUEST, 'No initiative in progress')

  table.initiative.order = order
  table.initiative.currentTurnIndex = -1
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

const advanceInitiativeTurn = async (callerId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (!table.initiative?.order?.length) throw new ApiError(ErrorCode.BAD_REQUEST, 'No published order')

  // The OAA can always advance. A regular member may ALSO advance, but only when it's currently
  // their own selected sheet's turn — lets a player's own sheet "Next Turn" button drive the
  // shared table order forward on their own turn, without needing the OAA to click Advance too.
  const isOaa = String(table.oaaId) === String(callerId)
  if (!isOaa) {
    const currentIdx = table.initiative.currentTurnIndex ?? -1
    const currentSheetId = currentIdx >= 0 ? table.initiative.order[currentIdx]?.sheetId : null
    const member = table.members.find(m => m.status === 'accepted' && String(m.userId) === String(callerId))
    if (!member || !currentSheetId || String(member.sheetId) !== String(currentSheetId)) {
      throw new ApiError(ErrorCode.FORBIDDEN, 'Not your turn')
    }
  }

  const order = table.initiative.order
  const current = table.initiative.currentTurnIndex ?? -1
  const next = (current + 1) % order.length
  table.initiative.currentTurnIndex = next
  table.markModified('initiative')
  await table.save()

  // The combatant whose turn just ENDED (order[current], before this advance) gets their Active
  // Effects ticked down exactly like clicking "Next Turn" on their own sheet's Combat tab would —
  // see common/combatEffects.js (ported from the frontend's sheetMechanics.js) — and their own
  // turn counter (sheet.combatTurnCount) advances too, even if they have no active effects.
  const endingSheetId = current >= 0 ? order[current]?.sheetId : null
  if (endingSheetId) {
    const endingSheet = await sheetsModel.findById(endingSheetId)
    if (endingSheet) {
      endingSheet.combatTurnCount = (endingSheet.combatTurnCount ?? 1) + 1
      if ((endingSheet.combatEffects ?? []).length) {
        const { effects: ticked, statBuffs, skillBuffs, healDelta } =
          processEffectsForNextTurn(endingSheet.combatEffects ?? [], endingSheet.statBuffs ?? {}, endingSheet.skillBuffs ?? {})
        endingSheet.combatEffects = filterEffectsForNextTurn(ticked)
        endingSheet.statBuffs = statBuffs
        endingSheet.skillBuffs = skillBuffs
        if (healDelta) {
          const newHp = Math.max(0, (endingSheet.currentHp ?? 0) + healDelta)
          const approxMaxHp = healDelta > 0 ? await computeApproxMaxHp(endingSheet) : null
          endingSheet.currentHp = approxMaxHp != null ? Math.min(approxMaxHp, newHp) : newHp
        }
      }
      await endingSheet.save()
      if (global.io) global.io.emit('sheet:updated', { sheetId: String(endingSheetId), sheet: endingSheet })
    }
  }

  const turnEntry = order[next]
  if (global.io) global.io.emit('initiative:turn', { tableId: String(tableId), currentTurnIndex: next, turnEntry })

  // Notify long-poll watchers for OAA + all accepted members (all open tabs per user)
  turnEventSeq += 1
  const notifyPayload = { tableId: String(tableId), currentTurnIndex: next, turnEntry, seq: turnEventSeq }
  const notifyIds = new Set([String(table.oaaId)])
  for (const m of (table.members ?? [])) {
    if (m.status === 'accepted' && m.userId) notifyIds.add(String(m.userId))
  }
  for (const uid of notifyIds) {
    lastEventForUser.set(uid, { seq: turnEventSeq, payload: notifyPayload })
    const list = pendingWatchers.get(uid) ?? []
    pendingWatchers.set(uid, [])
    list.forEach(w => w.finish(notifyPayload))
  }

  return { currentTurnIndex: next, turnEntry, seq: turnEventSeq }
}

const reverseInitiativeTurn = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')
  if (!table.initiative?.order?.length) throw new ApiError(ErrorCode.BAD_REQUEST, 'No published order')

  const order = table.initiative.order
  const current = table.initiative.currentTurnIndex ?? -1
  const prev = current <= 0 ? order.length - 1 : current - 1
  table.initiative.currentTurnIndex = prev
  table.markModified('initiative')
  await table.save()

  // Undo the tick that the advance we're reversing applied to order[prev] (the combatant whose
  // turn we're un-ending) — restores remaining-turns counts (partial undo only, see
  // common/combatEffects.js's restoreEffectsForPreviousTurn doc comment) and their own turn
  // counter, even if they have no active effects.
  const returningSheetId = prev >= 0 ? order[prev]?.sheetId : null
  if (returningSheetId) {
    const returningSheet = await sheetsModel.findById(returningSheetId)
    if (returningSheet) {
      returningSheet.combatTurnCount = Math.max(1, (returningSheet.combatTurnCount ?? 1) - 1)
      if ((returningSheet.combatEffects ?? []).length) {
        returningSheet.combatEffects = restoreEffectsForPreviousTurn(returningSheet.combatEffects ?? [])
      }
      await returningSheet.save()
      if (global.io) global.io.emit('sheet:updated', { sheetId: String(returningSheetId), sheet: returningSheet })
    }
  }

  const turnEntry = order[prev]
  if (global.io) global.io.emit('initiative:turn', { tableId: String(tableId), currentTurnIndex: prev, turnEntry })

  // Notify long-poll watchers for OAA + all accepted members (all open tabs per user)
  turnEventSeq += 1
  const notifyPayload = { tableId: String(tableId), currentTurnIndex: prev, turnEntry, seq: turnEventSeq }
  const notifyIds = new Set([String(table.oaaId)])
  for (const m of (table.members ?? [])) {
    if (m.status === 'accepted' && m.userId) notifyIds.add(String(m.userId))
  }
  for (const uid of notifyIds) {
    lastEventForUser.set(uid, { seq: turnEventSeq, payload: notifyPayload })
    const list = pendingWatchers.get(uid) ?? []
    pendingWatchers.set(uid, [])
    list.forEach(w => w.finish(notifyPayload))
  }

  return { currentTurnIndex: prev, turnEntry, seq: turnEventSeq }
}

const setInitiativeRollOaa = async (oaaId, tableId, userId, total) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')
  if (!table.initiative) throw new ApiError(ErrorCode.BAD_REQUEST, 'No initiative in progress')

  const member = table.members.find(m => String(m.userId) === String(userId))
  if (!member) throw new ApiError(ErrorCode.NOT_FOUND, 'Member not found')

  if (!table.initiative.rolls) table.initiative.rolls = {}

  const existing = table.initiative.rolls[String(userId)] ?? {}
  let characterName = existing.characterName ?? null
  if (!characterName && member.sheetId) {
    const sheet = await sheetsModel.findById(member.sheetId, 'characterName').lean()
    characterName = sheet?.characterName ?? null
  }

  table.initiative.rolls[String(userId)] = {
    username: member.username,
    characterName,
    total: Number(total),
    isSpeedster: existing.isSpeedster ?? false,
  }
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

// OAA sheets tagged 'Player' have no user account to roll for themselves — the OAA rolls on
// their behalf here, storing the result separately from userId-keyed `rolls` so tie-detection
// and the self-roll/tiebreaker flow (both keyed by the authenticated caller's userId) stay untouched.
const setSheetInitiativeRoll = async (oaaId, tableId, sheetId, total, isSpeedster) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')
  if (!table.initiative) throw new ApiError(ErrorCode.BAD_REQUEST, 'No initiative in progress')
  if (!table.oaaSheetIds.map(String).includes(String(sheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Sheet not in table')

  const sheet = await sheetsModel.findById(sheetId, 'displayName characterName').lean()
  if (!table.initiative.sheetRolls) table.initiative.sheetRolls = {}

  table.initiative.sheetRolls[String(sheetId)] = {
    displayName: sheet?.displayName ?? null,
    characterName: sheet?.characterName ?? null,
    total: Number(total),
    isSpeedster: !!isSpeedster,
  }
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

const clearInitiative = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  table.initiative = null
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

// Every accepted member's own sheet plus every OAA-controlled NPC sheet (Bosses, Minions,
// Players, everything) — the full set a table-wide combat action applies to.
function getAllTableSheetIds(table) {
  return new Set([
    ...table.members.filter(m => m.status === 'accepted' && m.sheetId).map(m => String(m.sheetId)),
    ...table.members.filter(m => m.status === 'accepted').flatMap(m => (m.companionSheetIds ?? []).map(String)),
    ...(table.oaaSheetIds ?? []).map(String),
  ])
}

// Runs `applySheetFn(sheet)` (sync or async) over every sheet in the table, saving and
// broadcasting each one — the shared shape behind End Fight/Short Rest/Long Rest/Reset Turns.
async function applyToAllTableSheets(table, applySheetFn) {
  const sheetIds = getAllTableSheetIds(table)
  for (const sheetId of sheetIds) {
    const sheet = await sheetsModel.findById(sheetId)
    if (!sheet) continue
    await applySheetFn(sheet)
    await sheet.save()
    if (global.io) global.io.emit('sheet:updated', { sheetId: String(sheetId), sheet })
  }
  return sheetIds.size
}

// OAA-only: ends combat for EVERY sheet in the table — every accepted member's own sheet plus
// every OAA-controlled NPC sheet (Bosses, Minions, everything) — applying the exact same reset
// each sheet's own local End Fight button would (see applyEndFightToSheet). Also clears the
// table's initiative order, since an active initiative is what gates each sheet's own local End
// Fight button in the first place — this is what un-gates it again.
const endFightForTable = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const sheetsReset = await applyToAllTableSheets(table, (sheet) => applyEndFightToSheet(sheet))

  table.initiative = null
  table.markModified('initiative')
  await table.save()

  // Reuses the initiative:turn channel purely to trigger every connected client's existing
  // load()-on-turn-event fallback, which re-fetches /tables and picks up initiative: null —
  // no separate "table cleared" event type needed.
  if (global.io) global.io.emit('initiative:turn', { tableId: String(tableId), currentTurnIndex: null, turnEntry: null })
  turnEventSeq += 1
  const notifyPayload = { tableId: String(tableId), currentTurnIndex: null, turnEntry: null, seq: turnEventSeq }
  const notifyIds = new Set([String(table.oaaId)])
  for (const m of (table.members ?? [])) {
    if (m.status === 'accepted' && m.userId) notifyIds.add(String(m.userId))
  }
  for (const uid of notifyIds) {
    lastEventForUser.set(uid, { seq: turnEventSeq, payload: notifyPayload })
    const list = pendingWatchers.get(uid) ?? []
    pendingWatchers.set(uid, [])
    list.forEach(w => w.finish(notifyPayload))
  }

  return { ok: true, sheetsReset }
}

// OAA-only: applies a Short Rest to every sheet in the table (see applyShortRestToSheet) — same
// heal-target approximation caveats as computeApproxMaxHp/computeApproxMaxPP, and Nico/Hawkeye's
// interactive rest choices are skipped (same as their own "Skip" flow).
const shortRestForTable = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const sheetsReset = await applyToAllTableSheets(table, async (sheet) => {
    const character = sheet.characterId ? await findCharacterById(sheet.characterId) : null
    const [approxMaxHp, approxMaxPp] = await Promise.all([computeApproxMaxHp(sheet), computeApproxMaxPP(sheet)])
    applyShortRestToSheet(sheet, { approxMaxHp, approxMaxPp, characterName: character?.name })
  })

  return { ok: true, sheetsReset }
}

// OAA-only: applies a Long Rest to every sheet in the table (see applyLongRestToSheet) — same caveats.
const longRestForTable = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const sheetsReset = await applyToAllTableSheets(table, async (sheet) => {
    const [character, form] = await Promise.all([
      sheet.characterId ? findCharacterById(sheet.characterId) : null,
      resolveSheetForm(sheet),
    ])
    const [approxMaxHp, approxMaxPp] = await Promise.all([computeApproxMaxHp(sheet), computeApproxMaxPP(sheet)])
    // `weapons` isn't declared in FormScheme (models/nosql/forms.js), so Mongoose never installs
    // a path getter for it — plain `form.weapons` is always undefined on a hydrated document even
    // though the data survives reads. Reach into the raw hydrated doc instead, same as how
    // controllers/forms.js's formView() surfaces it via toObject() for the GET /forms route.
    const formWeapons = form?._doc?.weapons ?? form?.toObject?.()?.weapons
    applyLongRestToSheet(sheet, { approxMaxHp, approxMaxPp, characterName: character?.name, formWeapons })
  })

  return { ok: true, sheetsReset }
}

// OAA-only: sets every sheet in the table back to turn 1 — just the turn counter, nothing else
// (no effects/status/HP/PP touched), unlike End Fight/rests.
const resetTurnsForTable = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const sheetsReset = await applyToAllTableSheets(table, (sheet) => { sheet.combatTurnCount = 1 })

  return { ok: true, sheetsReset }
}

// Persists a combat role ('Boss' | 'NPC' | 'Minion' | falsy-to-clear) for a sheet within this
// table, so any viewer (not just the OAA's own browser) can tell a sheet's current role — used
// e.g. to gate a character's boss-only forms to sheets currently tagged Boss.
const setCombatRole = async (oaaId, tableId, sheetId, role) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.members.flatMap(m => (m.companionSheetIds || []).map(String)),
    ...table.oaaSheetIds.map(String),
  ])
  if (!validIds.has(String(sheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Sheet not in table')

  const combatRoles = { ...(table.combatRoles ?? {}) }
  if (role) combatRoles[String(sheetId)] = role
  else delete combatRoles[String(sheetId)]

  table.combatRoles = combatRoles
  table.markModified('combatRoles')
  await table.save()

  return { combatRoles }
}

const oaaSheetCombatUpdate = async (oaaId, tableId, sheetId, body) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.members.flatMap(m => (m.companionSheetIds || []).map(String)),
    ...table.oaaSheetIds.map(String),
  ])
  if (!validIds.has(String(sheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Sheet not in table')

  const sheet = await sheetsModel.findById(sheetId)
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  // Edge-detect the moment deathHp crosses the level cap, mirroring the frontend's own
  // prevDeathHpRef check in SheetPage.jsx, so a global 'combat:kill' only fires once.
  const maxDeathHp = 30 + (sheet.level ?? 1) * 5
  const wasAlreadyDead = (sheet.deathHp ?? 0) >= maxDeathHp

  let armorDestroyed = false
  let statusJustApplied = null
  let ironManDebug = null // TEMP diagnostic — remove once the armor-destroy trigger is confirmed working

  if (body.damage != null) {
    const dmg = Number(body.damage)
    const shieldAbsorb = Math.min(sheet.shieldHp ?? 0, dmg)
    const newShieldHp = (sheet.shieldHp ?? 0) - shieldAbsorb
    const hpBefore = sheet.currentHp ?? 0
    const remainingDmg = dmg - shieldAbsorb

    // Armored heroes (Iron Man, War Machine): damage that brings the current armor's HP down
    // to 0 (or below) destroys it instead of applying death-HP rules. The pilot ejects into
    // whatever armor is equipped inside it (Hulkbuster's sub-armor), or their base form otherwise.
    // Armor locked until repaired. Mirrors the frontend's ResourcesPanel.jsx handleDealDamage so
    // OAA-dealt damage behaves the same as damage dealt from the sheet's own Combat tab.
    const pilotFields = ARMORED_HERO_BASE_FIELDS[sheet.characterName]
    if (pilotFields && sheet.formId && remainingDmg > 0 && remainingDmg >= hpBefore) {
      const currentForm = await findFormById(sheet.formId)
      ironManDebug = {
        formId: sheet.formId ?? null,
        formFound: !!currentForm,
        formTypes: currentForm?.types ?? null,
        hpBefore,
        remainingDmg,
        wouldTriggerDestroy: !!currentForm?.types?.includes('armor'),
      }
      if (currentForm?.types?.includes('armor')) {
        armorDestroyed = true
        const destroyedFormId = sheet.formId
        const isHulkbuster = /hulkbuster/i.test(currentForm.name ?? '')

        let equipmentSlots = []
        try { equipmentSlots = JSON.parse(sheet.textFields?.equipmentSlots || '[]') } catch { equipmentSlots = [] }
        const equippedArmorSlot = isHulkbuster ? equipmentSlots.find(s => s?.formId && s?.isActive) : null
        const subArmorFormId = equippedArmorSlot?.formId ?? null

        const character = await findCharacterById(sheet.characterId)
        const targetFormId = subArmorFormId ?? character?.defaultForm ?? null
        const targetForm = targetFormId ? await findFormById(targetFormId) : null

        const armorCurrentHp = { ...(sheet.armorCurrentHp ?? {}) }
        const armorCurrentPp = sheet.armorCurrentPp ?? {}
        armorCurrentHp[destroyedFormId] = 0

        let newCurrentHp, newCurrentPp
        if (subArmorFormId && targetForm) {
          const targetMaxHp = (targetForm.stats?.get('hp') ?? 0) + (sheet.progressionHpBonus ?? 0)
          const targetPower = targetForm.stats?.get('power') ?? 1
          const targetMaxPp = computeMaxPP(targetPower, sheet.level ?? 1)
          newCurrentHp = armorCurrentHp[subArmorFormId] ?? targetMaxHp
          newCurrentPp = armorCurrentPp[subArmorFormId] ?? targetMaxPp
        } else {
          newCurrentHp = sheet[pilotFields.hpField] ?? 30
          newCurrentPp = sheet[pilotFields.ppField] ?? 0
        }

        const newEquipmentSlots = equipmentSlots.map(s => s?.formId === destroyedFormId ? { ...s, isActive: false } : s)
        if (!sheet.textFields) sheet.textFields = {}
        sheet.textFields.equipmentSlots = JSON.stringify(newEquipmentSlots)

        sheet.shieldHp = newShieldHp
        sheet.armorCurrentHp = armorCurrentHp
        sheet.destroyedArmorFormIds = [...new Set([...(sheet.destroyedArmorFormIds ?? []), destroyedFormId])]
        sheet.currentHp = newCurrentHp
        sheet.currentPp = newCurrentPp
        if (targetFormId) {
          sheet.formId = targetFormId
          sheet.formName = targetForm?.name ?? sheet.formName
        }
      }
    }

    if (!armorDestroyed) {
      sheet.shieldHp = newShieldHp
      sheet.currentHp = Math.max(0, hpBefore - remainingDmg)
      if (sheet.currentHp === 0 && remainingDmg > hpBefore) {
        const maxDeathHp = 30 + (sheet.level ?? 1) * 5
        sheet.deathHp = Math.min(maxDeathHp, (sheet.deathHp ?? 0) + (remainingDmg - hpBefore))
      } else if (sheet.currentHp > 0) {
        sheet.deathHp = 0
      }
    }
  }

  if (body.heal != null) {
    const healAmt = Number(body.heal)
    const currentDeathHp = sheet.deathHp ?? 0
    if (currentDeathHp > 0) {
      const deathReduction = Math.min(currentDeathHp, healAmt)
      sheet.deathHp = currentDeathHp - deathReduction
      const remaining = healAmt - deathReduction
      if (remaining > 0) sheet.currentHp = (sheet.currentHp ?? 0) + remaining
    } else {
      sheet.currentHp = (sheet.currentHp ?? 0) + healAmt
    }
  }

  if (body.statusId != null) {
    if (!sheet.specialResource) sheet.specialResource = {}
    if (!sheet.specialResource.statusEffects) sheet.specialResource.statusEffects = {}
    const wasActive = !!sheet.specialResource.statusEffects[body.statusId]?.active
    const nowActive = !!body.statusActive
    if (nowActive && !wasActive) statusJustApplied = body.statusId
    sheet.specialResource.statusEffects[body.statusId] = { active: nowActive }
    sheet.markModified('specialResource')
  }

  await sheet.save()
  if (global.io) global.io.emit('sheet:updated', { sheetId: String(sheetId), sheet })
  if (body.damage != null && global.io) {
    if (armorDestroyed) global.io.emit('armor:destroyed', { sheetId: String(sheetId) })
    // The armorDestroyed branch never sets currentHp to 0 here — it swaps into the
    // sub-armor/base form's HP instead — so this naturally never fires at 0 HP for armored heroes.
    else global.io.emit('combat:damage', { sheetId: String(sheetId), defeated: sheet.currentHp === 0 })
  }
  if (body.heal != null && global.io) global.io.emit('combat:heal', { sheetId: String(sheetId) })
  const nowDead = (sheet.deathHp ?? 0) >= maxDeathHp
  if (nowDead && !wasAlreadyDead) {
    if (global.io) global.io.emit('combat:kill', { sheetId: String(sheetId) })
    // Summoned companions auto-dismiss on death here too — the OAA's Combat Controls Damage
    // button hits this endpoint, not updateSheet in controllers/sheets.js, so both death-detection
    // points need the same rule (isSummoned = the companion's own form defines
    // maxInstancesByLevel; "always present" companions like Lockheed are left alone).
    if (sheet.parentSheetId) {
      const compForm = await findFormById(sheet.formId)
      if ((compForm?.maxInstancesByLevel ?? []).length > 0) {
        await sheetsModel.deleteOne({ _id: sheetId })
        await detachSheetFromTables(sheetId)
        await sheetsModel.updateOne({ _id: sheet.parentSheetId }, { $pull: { chosenCompIds: String(sheet.characterId) } })
      }
    }
  }
  if (statusJustApplied && global.io) global.io.emit('status:applied', { sheetId: String(sheetId), statusId: statusJustApplied })
  return { currentHp: sheet.currentHp, shieldHp: sheet.shieldHp ?? 0, deathHp: sheet.deathHp ?? 0, ironManDebug }
}

// ── Markets & S.H.I.E.L.D. Credits ──────────────────────────────────────────────

const MARKET_KEYS = new Set(['shield', 'tinkerer', 'emporium', 'masque'])

// Max spare ammo a sheet can hold per weapon type — keep in sync with frontend
// InventoryTab.jsx's AMMO_INVENTORY_CAP and my-tables/TableMarkets.jsx's copy.
const AMMO_INVENTORY_CAP = { magazine: 5, pellet: 10 }

const findModulesByIds = async (ids) => {
  if (!ids || ids.length === 0) return []
  const idSet = new Set(ids.map(String))
  const modules = await ModulesModel.find({})
  return modules.filter(m => idSet.has(String(m._id)))
}

// Mirrors totalConsumableSlots in frontend InventoryTab.jsx: base 2 slots, +2 per equipped
// "Micro Compartments" module belonging to the sheet's current form (616 Armor mechanic).
const getTotalConsumableSlots = async (sheet) => {
  if (!sheet.formId) return 2
  const form = await findFormById(sheet.formId)
  const formModules = await findModulesByIds(form?.modules ?? [])
  const equippedModuleIds = (sheet.equippedModuleIds ?? []).map(String)

  let microCompartmentCount = 0
  for (const m of formModules) {
    if (!(m.name ?? '').toLowerCase().includes('micro compartments')) continue
    microCompartmentCount += equippedModuleIds.filter(id => id === String(m._id)).length
  }
  return 2 + microCompartmentCount * 2
}

const genSlotId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function normalizeMaterialName(name = '') {
  return String(name).trim().replace(/\s*\(common\)\s*$/i, '').replace(/\s+/g, ' ').toLowerCase()
}

// OAA generates the 12-slot market client-side (src/pages/my-tables/marketGenerator.js) and
// posts the result here — the backend just stores it as the shared, authoritative stock state
// every table participant's Buy action reads from and mutates.
const setMarket = async (oaaId, tableId, marketKey, slots) => {
  if (!MARKET_KEYS.has(marketKey)) throw new ApiError(ErrorCode.BAD_REQUEST, 'Unknown market')
  if (!Array.isArray(slots)) throw new ApiError(ErrorCode.BAD_REQUEST, 'slots must be an array')

  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const activeMarkets = { ...(table.activeMarkets ?? {}) }
  activeMarkets[marketKey] = { slots, activatedAt: new Date().toISOString() }
  table.activeMarkets = activeMarkets
  table.markModified('activeMarkets')
  await table.save()

  if (global.io) global.io.emit('table:market-updated', { tableId: String(tableId), marketKey, market: activeMarkets[marketKey] })
  return { activeMarkets: table.activeMarkets }
}

const closeMarket = async (oaaId, tableId, marketKey) => {
  if (!MARKET_KEYS.has(marketKey)) throw new ApiError(ErrorCode.BAD_REQUEST, 'Unknown market')

  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const activeMarkets = { ...(table.activeMarkets ?? {}) }
  activeMarkets[marketKey] = null
  table.activeMarkets = activeMarkets
  table.markModified('activeMarkets')
  await table.save()

  if (global.io) global.io.emit('table:market-updated', { tableId: String(tableId), marketKey, market: null })
  return { activeMarkets: table.activeMarkets }
}

// Players buy only for their own active sheet; the OAA buys only for their own NPC sheets.
// Stock, credits, and slot-availability are all re-checked here (not trusted from the client)
// since this is the one action multiple table participants can race against each other on.
const buyFromMarket = async (userId, tableId, marketKey, slotId, buyerSheetId) => {
  if (!MARKET_KEYS.has(marketKey)) throw new ApiError(ErrorCode.BAD_REQUEST, 'Unknown market')

  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa = String(table.oaaId) === String(userId)
  const member = table.members.find(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!isOaa && !member) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')

  const isOwnNpc = isOaa && table.oaaSheetIds.map(String).includes(String(buyerSheetId))
  const isOwnMemberSheet = !!member && String(member.sheetId) === String(buyerSheetId)
  if (!isOwnNpc && !isOwnMemberSheet) throw new ApiError(ErrorCode.FORBIDDEN, 'You can only buy for your own sheet')

  const market = table.activeMarkets?.[marketKey]
  if (!market?.slots) throw new ApiError(ErrorCode.BAD_REQUEST, 'Market is not active')
  const slot = market.slots.find(s => String(s.id) === String(slotId))
  if (!slot) throw new ApiError(ErrorCode.NOT_FOUND, 'Item not found')
  if ((slot.stock ?? 0) <= 0) throw new ApiError(ErrorCode.BAD_REQUEST, 'Item is out of stock')

  const sheet = await sheetsModel.findById(buyerSheetId)
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  const price = Number(slot.price) || 0
  if ((sheet.shieldCredits ?? 0) < price) throw new ApiError(ErrorCode.BAD_REQUEST, 'Not enough S.H.I.E.L.D. Credits')

  if (slot.entryType === 'item') {
    const isEquipment = slot.type === 'Equipment'
    if (!sheet.textFields) sheet.textFields = {}

    if (isEquipment) {
      let equipmentSlots = []
      try { equipmentSlots = JSON.parse(sheet.textFields.equipmentSlots || '[]') } catch { equipmentSlots = [] }
      if (equipmentSlots.length >= 2) throw new ApiError(ErrorCode.BAD_REQUEST, 'No free equipment slot')
      equipmentSlots.push({ id: genSlotId(), name: slot.name, effect: slot.effect ?? '', category: slot.category })
      sheet.textFields.equipmentSlots = JSON.stringify(equipmentSlots)
    } else {
      let consumableSlots = []
      try { consumableSlots = JSON.parse(sheet.textFields.consumableSlots || '[]') } catch { consumableSlots = [] }
      const totalConsumableSlots = await getTotalConsumableSlots(sheet)
      if (consumableSlots.length >= totalConsumableSlots) throw new ApiError(ErrorCode.BAD_REQUEST, 'No free consumable slot')
      consumableSlots.push({ id: genSlotId(), name: slot.name, effect: slot.effect ?? '', category: slot.category, uses: 1 })
      sheet.textFields.consumableSlots = JSON.stringify(consumableSlots)
    }
    sheet.markModified('textFields')
  } else if (slot.entryType === 'ammo') {
    // Ported from Marvel-Frontend/src/pages/my-tables/marketGenerator.js's buildAmmoSlot — grants
    // the rolled quantity of spare magazines/pellets straight into the shared ammoInventory,
    // same field the sheet's own Ammo Inventory panel (InventoryTab.jsx) and Long Rest top-up
    // read/write. Capped the same as manual +1 in that panel (5 magazines / 10 pellets per
    // weapon) — reject rather than silently clamp, so credits aren't spent for nothing.
    const key = slot.weaponKey
    const cap = AMMO_INVENTORY_CAP[slot.ammoKind]
    const current = sheet.ammoInventory?.[key] ?? 0
    if (cap != null && current + (Number(slot.quantity) || 0) > cap) {
      throw new ApiError(ErrorCode.BAD_REQUEST, 'Would exceed max ammo capacity for that weapon')
    }
    sheet.ammoInventory = { ...(sheet.ammoInventory ?? {}), [key]: current + (Number(slot.quantity) || 0) }
  } else {
    const materials = [...(sheet.materials ?? [])]
    const existing = materials.find(m => normalizeMaterialName(m.name) === normalizeMaterialName(slot.name) && m.category === slot.category)
    if (existing) existing.quantity = (existing.quantity ?? 0) + 1
    else materials.push({ id: genSlotId(), name: slot.name, category: slot.category, rarity: slot.rarity, quantity: 1 })
    sheet.materials = materials
  }

  sheet.shieldCredits = (sheet.shieldCredits ?? 0) - price
  slot.stock = (slot.stock ?? 0) - 1

  table.markModified('activeMarkets')
  await table.save()
  await sheet.save()

  if (global.io) {
    global.io.emit('table:market-updated', { tableId: String(tableId), marketKey, market: table.activeMarkets[marketKey] })
    global.io.emit('sheet:updated', { sheetId: String(buyerSheetId), sheet })
  }

  return { sheet, market: table.activeMarkets[marketKey] }
}

// OAA-only: grants (or removes, via a negative amount) S.H.I.E.L.D. Credits on any table sheet.
// This is the only way credits are added — players can no longer edit shieldCredits directly
// on their own sheet (see SheetPage.jsx), only spend it (buyFromMarket) or send it (transferCredits).
const grantCredits = async (oaaId, tableId, sheetId, amount) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  // Companions never get their own S.H.I.E.L.D. Credits pool — grants only ever target a
  // primary/NPC sheet, same as before companions could be table combatants at all.
  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.oaaSheetIds.map(String),
  ])
  if (!validIds.has(String(sheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Sheet not in table')

  const amt = Number(amount)
  if (!Number.isFinite(amt)) throw new ApiError(ErrorCode.BAD_REQUEST, 'Invalid amount')

  const sheet = await sheetsModel.findById(sheetId)
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  sheet.shieldCredits = Math.max(0, (sheet.shieldCredits ?? 0) + amt)
  await sheet.save()

  if (global.io) global.io.emit('sheet:updated', { sheetId: String(sheetId), sheet })
  return { shieldCredits: sheet.shieldCredits }
}

// Any participant can send credits from their own sheet (a player's active sheet, or one of the
// OAA's NPCs) to any other sheet visible at the table — the recipient doesn't need to be present.
const transferCredits = async (userId, tableId, fromSheetId, toSheetId, amount) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')

  const isOaa = String(table.oaaId) === String(userId)
  const member = table.members.find(m => String(m.userId) === String(userId) && m.status === 'accepted')
  if (!isOaa && !member) throw new ApiError(ErrorCode.FORBIDDEN, 'Not a table participant')

  const isOwnNpc = isOaa && table.oaaSheetIds.map(String).includes(String(fromSheetId))
  const isOwnMemberSheet = !!member && String(member.sheetId) === String(fromSheetId)
  if (!isOwnNpc && !isOwnMemberSheet) throw new ApiError(ErrorCode.FORBIDDEN, 'You can only send credits from your own sheet')

  // Same as grantCredits — companions aren't a valid credits recipient either, only
  // primary/NPC sheets.
  const validTargets = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.oaaSheetIds.map(String),
  ])
  if (!validTargets.has(String(toSheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Recipient sheet not in table')
  if (String(fromSheetId) === String(toSheetId)) throw new ApiError(ErrorCode.BAD_REQUEST, 'Cannot send credits to yourself')

  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new ApiError(ErrorCode.BAD_REQUEST, 'Invalid amount')

  const fromSheet = await sheetsModel.findById(fromSheetId)
  const toSheet = await sheetsModel.findById(toSheetId)
  if (!fromSheet || !toSheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  if ((fromSheet.shieldCredits ?? 0) < amt) throw new ApiError(ErrorCode.BAD_REQUEST, 'Not enough S.H.I.E.L.D. Credits')

  fromSheet.shieldCredits = (fromSheet.shieldCredits ?? 0) - amt
  toSheet.shieldCredits = (toSheet.shieldCredits ?? 0) + amt
  await fromSheet.save()
  await toSheet.save()

  if (global.io) {
    global.io.emit('sheet:updated', { sheetId: String(fromSheetId), sheet: fromSheet })
    global.io.emit('sheet:updated', { sheetId: String(toSheetId), sheet: toSheet })
  }

  return { fromShieldCredits: fromSheet.shieldCredits, toShieldCredits: toSheet.shieldCredits }
}

module.exports = {
  getTables, getTable, createTable, deleteTable,
  inviteMember, respondToInvitation, selectSheet,
  addOaaSheet, removeOaaSheet, addCompanionSheet,
  requestSheet, approveSheetRequest,
  kickMember, leaveTable,
  getTableSheet, getAbsorbTargets, getAbsorbTargetsForSheet, assistSheetForSheet,
  requestInitiative, submitInitiativeRoll, startInitiativeTiebreaker,
  publishInitiativeOrder, advanceInitiativeTurn, reverseInitiativeTurn, setInitiativeRollOaa, setSheetInitiativeRoll, clearInitiative,
  endFightForTable, shortRestForTable, longRestForTable, resetTurnsForTable,
  setCombatRole,
  oaaSheetCombatUpdate,
  watchAnyInitiativeTurn,
  setMarket, closeMarket, buyFromMarket,
  grantCredits, transferCredits,
}
