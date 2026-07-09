const { tablesModel, sheetsModel, usersModel, formsModel, powersModel, charactersModel } = require('../models')
const { ApiError, ErrorCode } = require('../common/apiError')

// Ported from frontend src/pages/my-sheets/sheetMechanics.js computeMaxPP()
const computeMaxPP = (powerStat, level) => {
  const p = Math.min(Math.max(1, powerStat ?? 1), 10)
  return p * 2 + Math.floor((level ?? 1) / 5) * 2
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

  let armorDestroyed = false
  let statusJustApplied = null
  let ironManDebug = null // TEMP diagnostic — remove once the armor-destroy trigger is confirmed working

  if (body.damage != null) {
    const dmg = Number(body.damage)
    const shieldAbsorb = Math.min(sheet.shieldHp ?? 0, dmg)
    const newShieldHp = (sheet.shieldHp ?? 0) - shieldAbsorb
    const hpBefore = sheet.currentHp ?? 0
    const remainingDmg = dmg - shieldAbsorb

    // Iron Man: damage that brings the current armor's HP down to 0 (or below) destroys it
    // instead of applying death-HP rules. Tony ejects into whatever armor is equipped inside
    // it (Hulkbuster's sub-armor), or his base form otherwise. Armor locked until repaired.
    // Mirrors the frontend's ResourcesPanel.jsx handleDealDamage so OAA-dealt damage behaves
    // the same as damage dealt from the sheet's own Combat tab.
    if (sheet.characterName === 'Iron Man' && sheet.formId && remainingDmg > 0 && remainingDmg >= hpBefore) {
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
          newCurrentHp = sheet.tonyCurrentHp ?? 30
          newCurrentPp = sheet.tonyCurrentPp ?? 0
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
    else global.io.emit('combat:damage', { sheetId: String(sheetId) })
  }
  if (statusJustApplied && global.io) global.io.emit('status:applied', { sheetId: String(sheetId), statusId: statusJustApplied })
  return { currentHp: sheet.currentHp, shieldHp: sheet.shieldHp ?? 0, deathHp: sheet.deathHp ?? 0, ironManDebug }
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
  watchAnyInitiativeTurn,
}
