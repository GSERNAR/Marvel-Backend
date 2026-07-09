const { sheetsModel } = require('../models')
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
  if (maxDeathHp !== null) {
    const nowDead = (sheet.deathHp ?? 0) >= maxDeathHp
    if (nowDead && !wasAlreadyDead && global.io) global.io.emit('combat:kill', { sheetId: String(sheetId) })
  }
  return sheet
}

const deleteSheet = async (userId, sheetId) => {
  const sheet = await sheetsModel.findOneAndDelete({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  return {}
}

module.exports = { getSheets, getSheet, createSheet, updateSheet, deleteSheet }
