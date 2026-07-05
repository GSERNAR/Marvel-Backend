const { tablesModel, sheetsModel, usersModel, formsModel, powersModel, charactersModel } = require('../models')
const { ApiError, ErrorCode } = require('../common/apiError')

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

  // Fetch portrait info for accepted members with sheets
  const sheetIds = table.members.filter(m => m.status === 'accepted' && m.sheetId).map(m => m.sheetId)
  const portraits = await sheetsModel.find(
    { _id: { $in: sheetIds } },
    'displayName characterName level characterId formName'
  )
  const portraitMap = Object.fromEntries(portraits.map(s => [String(s._id), {
    displayName: s.displayName,
    characterName: s.characterName,
    level: s.level,
    characterId: String(s.characterId),
    formName: s.formName || null,
  }]))

  const members = table.members.map(m => ({
    userId: m.userId,
    username: m.username,
    status: m.status,
    sheetId: m.sheetId,
    pendingSheets: m.pendingSheets || [],
    portrait: m.sheetId ? (portraitMap[String(m.sheetId)] ?? null) : null,
  }))

  return {
    _id: table._id,
    name: table.name,
    oaaId: table.oaaId,
    oaaUsername: table.oaaUsername,
    oaaSheetIds: table.oaaSheetIds || [],
    members,
    initiative: table.initiative || null,
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
  await table.save()
  return { sheetId: member.sheetId }
}

const addOaaSheet = async (oaaId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const sheet = await sheetsModel.findOne({ _id: sheetId, userId: oaaId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  if (!table.oaaSheetIds.map(String).includes(String(sheetId))) {
    table.oaaSheetIds.push(String(sheetId))
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

  // All participants can see accepted member sheets and OAA NPC sheets
  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
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
    sheetId: String(sid), memberUsername: table.oaaUsername, memberId: table.oaaId, isNpc: true
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

// ── Initiative ────────────────────────────────────────────────────────────────

const requestInitiative = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  table.initiative = { status: 'requesting', rolls: {}, tiebreakerUserIds: [], tiebreakerRolls: {}, order: null }
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

const advanceInitiativeTurn = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')
  if (!table.initiative?.order?.length) throw new ApiError(ErrorCode.BAD_REQUEST, 'No published order')

  const order = table.initiative.order
  const current = table.initiative.currentTurnIndex ?? -1
  const next = (current + 1) % order.length
  table.initiative.currentTurnIndex = next
  table.markModified('initiative')
  await table.save()

  const turnEntry = order[next]
  if (global.io) global.io.emit('initiative:turn', { tableId: String(tableId), currentTurnIndex: next, turnEntry })

  return { currentTurnIndex: next, turnEntry }
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

const clearInitiative = async (oaaId, tableId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  table.initiative = null
  table.markModified('initiative')
  await table.save()
  return { ok: true }
}

const oaaSheetCombatUpdate = async (oaaId, tableId, sheetId, body) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.oaaSheetIds.map(String),
  ])
  if (!validIds.has(String(sheetId))) throw new ApiError(ErrorCode.FORBIDDEN, 'Sheet not in table')

  const sheet = await sheetsModel.findById(sheetId)
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  if (body.damage != null) {
    sheet.currentHp = Math.max(0, (sheet.currentHp ?? 0) - Number(body.damage))
  }

  if (body.heal != null) {
    sheet.currentHp = (sheet.currentHp ?? 0) + Number(body.heal)
  }

  if (body.statusId != null) {
    if (!sheet.specialResource) sheet.specialResource = {}
    if (!sheet.specialResource.statusEffects) sheet.specialResource.statusEffects = {}
    sheet.specialResource.statusEffects[body.statusId] = { active: !!body.statusActive }
    sheet.markModified('specialResource')
  }

  await sheet.save()
  if (global.io) global.io.emit('sheet:updated', { sheetId: String(sheetId), sheet })
  if (body.damage != null && global.io) global.io.emit('combat:damage', { sheetId: String(sheetId) })
  return { currentHp: sheet.currentHp }
}

module.exports = {
  getTables, getTable, createTable, deleteTable,
  inviteMember, respondToInvitation, selectSheet,
  addOaaSheet, removeOaaSheet,
  requestSheet, approveSheetRequest,
  kickMember, leaveTable,
  getTableSheet, getAbsorbTargets, getAbsorbTargetsForSheet,
  requestInitiative, submitInitiativeRoll, startInitiativeTiebreaker,
  publishInitiativeOrder, advanceInitiativeTurn, setInitiativeRollOaa, clearInitiative,
  oaaSheetCombatUpdate,
}
