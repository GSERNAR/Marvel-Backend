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
    'displayName characterName level characterId'
  )
  const portraitMap = Object.fromEntries(portraits.map(s => [String(s._id), {
    displayName: s.displayName,
    characterName: s.characterName,
    level: s.level,
    characterId: String(s.characterId),
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

const getTableSheet = async (oaaId, tableId, sheetId) => {
  const table = await tablesModel.findById(tableId)
  if (!table) throw new ApiError(ErrorCode.NOT_FOUND, 'Table not found')
  if (String(table.oaaId) !== String(oaaId)) throw new ApiError(ErrorCode.FORBIDDEN, 'OAA only')

  const validIds = new Set([
    ...table.members.filter(m => m.sheetId).map(m => String(m.sheetId)),
    ...table.members.flatMap(m => (m.pendingSheets || []).map(ps => String(ps.sheetId))),
    ...table.oaaSheetIds.map(String),
  ])
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

  const formIds = [...new Set(sheets.map(s => s.formId).filter(Boolean))]
  // Fetch as full Mongoose docs (not lean) so toJSON() correctly serializes Map fields (stats, skills)
  const formDocs = await formsModel.find({ _id: { $in: formIds } })
  const formMap = Object.fromEntries(formDocs.map(f => [String(f._id), JSON.parse(JSON.stringify(f))]))

  // Fall back to character's defaultForm (or first form) for sheets without formId
  const noFormSheets = sheets.filter(s => !s.formId)
  const defaultFormMap = {}
  if (noFormSheets.length > 0) {
    const charIds = [...new Set(noFormSheets.map(s => s.characterId).filter(Boolean))]
    const chars = await charactersModel.find({ _id: { $in: charIds } }, 'defaultForm forms').lean()
    chars.forEach(c => {
      // Use defaultForm first, then fall back to first entry in forms array
      const fallbackId = c.defaultForm || (c.forms && c.forms[0]) || null
      if (fallbackId) defaultFormMap[String(c._id)] = String(fallbackId)
    })
    const fallbackFormIds = Object.values(defaultFormMap)
    if (fallbackFormIds.length > 0) {
      const fallbackFormDocs = await formsModel.find({ _id: { $in: fallbackFormIds } })
      fallbackFormDocs.forEach(f => { formMap[String(f._id)] = JSON.parse(JSON.stringify(f)) })
    }
  }

  const allPowerIds = new Set()
  Object.values(formMap).forEach(f => (f.powers ?? []).forEach(id => allPowerIds.add(String(id))))
  const powerObjs = allPowerIds.size > 0
    ? await powersModel.find({ _id: { $in: [...allPowerIds] } }).lean()
    : []
  const powerMap = Object.fromEntries(powerObjs.map(p => [String(p._id), p]))

  const results = []
  for (const target of targets) {
    const sheet = sheetMap[target.sheetId]
    if (!sheet) continue

    const formId = sheet.formId || defaultFormMap[String(sheet.characterId)]
    const form = formId ? formMap[String(formId)] : null
    const hpBonus = sheet.progressionHpBonus ?? 0
    const stats = form
      ? Object.entries(form.stats || {})
          .filter(([key]) => key !== 'combo')
          .map(([key, val]) => ({ uniqueName: key, name: key, value: key === 'hp' ? (val ?? 0) + hpBonus : (val ?? 0) }))
          .filter(s => s.value > 0)
      : []

    const skillRanks = sheet.skillRanks || {}
    const rawSkills = form ? { ...(form.skills || {}), ...(form.specialSkills || {}) } : {}
    const skills = Object.entries(rawSkills)
      .map(([name, val]) => ({ name, value: (val ?? 0) + (skillRanks[name] ?? 0) }))
      .filter(s => s.value > 0)

    const unlockedSet = new Set((sheet.unlockedPowerIds ?? []).map(String))
    const powers = form
      ? (form.powers ?? [])
          // NPC sheets skip the unlock flow — show all form powers; players only see unlocked ones
          .filter(id => target.isNpc || unlockedSet.has(String(id)))
          .map(id => powerMap[String(id)])
          .filter(Boolean)
          .map(p => ({ _id: String(p._id), name: p.name, level: p.level ?? 0, description: p.description, type: p.type, skillCheck: p.skillCheck, chance: p.chance }))
      : []

    results.push({
      memberId: target.memberId,
      memberUsername: target.memberUsername,
      isNpc: target.isNpc,
      sheetId: target.sheetId,
      displayName: sheet.displayName,
      characterName: sheet.characterName,
      characterId: String(sheet.characterId),
      level: sheet.level ?? 1,
      image: form?.image ?? null,
      stats, skills,
      abilities: form?.abilities ?? [],
      powers,
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

module.exports = {
  getTables, getTable, createTable, deleteTable,
  inviteMember, respondToInvitation, selectSheet,
  addOaaSheet, removeOaaSheet,
  requestSheet, approveSheetRequest,
  getTableSheet, getAbsorbTargets, getAbsorbTargetsForSheet,
}
