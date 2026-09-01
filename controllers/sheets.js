const { sheetsModel, tablesModel, formsModel } = require('../models')
const { ApiError, ErrorCode } = require('../common/apiError')

const getSheets = async (userId) => {
  return sheetsModel.find({ userId })
}

const getSheet = async (userId, sheetId) => {
  const sheet = await sheetsModel.findOne({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  return sheet
}

const createSheet = async (userId, body) => {
  return sheetsModel.create({ ...body, userId })
}

// Removes every reference to a sheet from every table it could be attached to — used whenever a
// sheet stops existing on a table (deleted outright, or a summoned companion auto-dismissed on
// death). Covers every place a sheetId can live on a Table document: a member's own primary
// sheet, a member's pending sheet request, a member's companion sheets, the OAA's NPC list, a
// per-sheet combat role, an OAA-tagged-Player's own initiative roll, and a published initiative
// order entry. Without this, a deleted/auto-dismissed sheet leaves dangling ids around that show
// up as broken cards or silently-stuck state elsewhere.
const detachSheetFromTables = async (sheetId) => {
  const sid = String(sheetId)

  await tablesModel.updateMany(
    { 'members.sheetId': sid },
    { $set: { 'members.$[m].sheetId': null } },
    { arrayFilters: [{ 'm.sheetId': sid }] }
  )
  await tablesModel.updateMany(
    { 'members.pendingSheets.sheetId': sid },
    { $pull: { 'members.$[].pendingSheets': { sheetId: sid } } }
  )
  await tablesModel.updateMany(
    { 'members.companionSheetIds': sid },
    { $pull: { 'members.$[].companionSheetIds': sid } }
  )
  await tablesModel.updateMany(
    { oaaSheetIds: sid },
    { $pull: { oaaSheetIds: sid } }
  )

  // combatRoles / initiative.sheetRolls / initiative.order live on Mixed-type fields, so a plain
  // $unset-by-dynamic-key update + explicit markModified is the safe way to touch them.
  const tablesToClean = await tablesModel.find({
    $or: [
      { [`combatRoles.${sid}`]: { $exists: true } },
      { [`initiative.sheetRolls.${sid}`]: { $exists: true } },
      { 'initiative.order': { $elemMatch: { sheetId: sid } } },
    ],
  })
  for (const table of tablesToClean) {
    let changed = false
    if (table.combatRoles && table.combatRoles[sid] !== undefined) {
      delete table.combatRoles[sid]
      table.markModified('combatRoles')
      changed = true
    }
    if (table.initiative?.sheetRolls?.[sid] !== undefined) {
      delete table.initiative.sheetRolls[sid]
      table.markModified('initiative')
      changed = true
    }
    if (Array.isArray(table.initiative?.order) && table.initiative.order.some(e => String(e.sheetId) === sid)) {
      table.initiative.order = table.initiative.order.filter(e => String(e.sheetId) !== sid)
      table.markModified('initiative')
      changed = true
    }
    if (changed) await table.save()
  }
}

// Deletes a summoned companion (isSummoned = its own form defines maxInstancesByLevel — the same
// rule CompanionsTab.jsx uses to decide whether a companion needs an explicit Summon button) and
// fully detaches it from every table. "Always present" companions (no maxInstancesByLevel, e.g.
// Lockheed) are left alone by this — false is returned and the sheet is untouched, so it behaves
// like any normal character sheet. Shared by both death-detection points below.
const dismissSummonedCompanionIfDead = async (sheet) => {
  if (!sheet.parentSheetId) return false
  // forms can have non-ObjectId legacy _ids that break findById's auto-cast — fetch-all + string
  // compare instead, matching findFormById in controllers/tables.js.
  const forms = await formsModel.find({})
  const form = forms.find(f => String(f._id) === String(sheet.formId))
  if ((form?.maxInstancesByLevel ?? []).length === 0) return false
  await sheetsModel.deleteOne({ _id: sheet._id })
  await detachSheetFromTables(sheet._id)
  await sheetsModel.updateOne({ _id: sheet.parentSheetId }, { $pull: { chosenCompIds: String(sheet.characterId) } })
  if (global.io) global.io.emit('combat:kill', { sheetId: String(sheet._id) })
  return true
}

const updateSheet = async (userId, sheetId, body) => {
  delete body._id
  delete body.userId

  // Edge-detect the moment deathHp crosses the level cap so the sheet's own Deal Damage
  // button (which never hits the OAA combat endpoint) still fires a global 'combat:kill' —
  // mirrors oaaSheetCombatUpdate in controllers/tables.js. Only bothers with the extra
  // lookup when this update actually touches deathHp.
  let wasAlreadyDead = false
  let maxDeathHp = null
  if (body.deathHp !== undefined) {
    const before = await sheetsModel.findOne({ _id: sheetId, userId }, 'deathHp level').lean()
    if (before) {
      maxDeathHp = 30 + (before.level ?? 1) * 5
      wasAlreadyDead = (before.deathHp ?? 0) >= maxDeathHp
    }
  }

  const sheet = await sheetsModel.findOneAndUpdate(
    { _id: sheetId, userId },
    { $set: body },
    { new: true, strict: false }
  )
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  if (global.io) global.io.emit('sheet:updated', { sheetId: String(sheetId), sheet })

  // Summoned companions ignore the normal deathHp/overkill system entirely — "no death rules",
  // they die and delete the instant their HP hits 0. Only checked when this update actually
  // touched currentHp: sheet.currentHp can otherwise still be its schema-default null, which
  // means "full HP" by convention elsewhere in this app, NOT 0 — gating on body.currentHp having
  // been provided avoids false-triggering on unrelated updates. The response below still returns
  // the (now-deleted) sheet object as normal, so the caller sees the fatal update that triggered
  // this; the deletion is a pure side effect.
  if (body.currentHp !== undefined && sheet.currentHp <= 0) {
    const dismissed = await dismissSummonedCompanionIfDead(sheet)
    if (dismissed) return sheet
  }

  if (maxDeathHp !== null) {
    const nowDead = (sheet.deathHp ?? 0) >= maxDeathHp
    if (nowDead && !wasAlreadyDead && global.io) global.io.emit('combat:kill', { sheetId: String(sheetId) })
  }
  return sheet
}

const deleteSheet = async (userId, sheetId) => {
  const sheet = await sheetsModel.findOneAndDelete({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')

  await detachSheetFromTables(sheetId)

  // If this was a companion sheet, un-mark it as chosen on the parent — otherwise a deleted
  // pickable companion (chosenCompIds still holding its id) gets silently auto-recreated the
  // next time the parent's Companions tab renders (CompanionsTab.jsx auto-creates a sheet for
  // any already-chosen pickable companion that doesn't have one). This makes delete = a real
  // dismiss for every entry point (the tab's own Dismiss button, or the generic My Sheets delete).
  if (sheet.parentSheetId) {
    const parent = await sheetsModel.findOneAndUpdate(
      { _id: sheet.parentSheetId },
      { $pull: { chosenCompIds: String(sheet.characterId) } },
      { new: true }
    )
    if (parent && global.io) global.io.emit('sheet:updated', { sheetId: String(parent._id), sheet: parent })
  }

  return {}
}

module.exports = { getSheets, getSheet, createSheet, updateSheet, deleteSheet, detachSheetFromTables, dismissSummonedCompanionIfDead }
