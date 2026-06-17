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
  const sheet = await sheetsModel.findOneAndUpdate(
    { _id: sheetId, userId },
    { $set: body },
    { new: true, strict: false }
  )
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  return sheet
}

const deleteSheet = async (userId, sheetId) => {
  const sheet = await sheetsModel.findOneAndDelete({ _id: sheetId, userId })
  if (!sheet) throw new ApiError(ErrorCode.NOT_FOUND, 'Sheet not found')
  return {}
}

module.exports = { getSheets, getSheet, createSheet, updateSheet, deleteSheet }
