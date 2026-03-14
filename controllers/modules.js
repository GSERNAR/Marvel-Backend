const { ModulesModel } = require('../models')
const { ApiError, ErrorCode } = require('../common/apiError')

const getModules = async () =>
  await ModulesModel.find({})

const getModule = async (id) => 
  await ModulesModel.findById(id)

const createModule = async (Module) =>
  await ModulesModel.create(Module)

const updateModule = async (id, changes) => {
  const result = await ModulesModel.findByIdAndUpdate(id, changes, { new: true })
  if (!result) {
    throw ApiError(ErrorCode.NOT_FOUND)
  }
  return result
}

const deleteModule = async (id) => {
  const result = await ModulesModel.findByIdAndDelete(id)
  if (!result) {
    throw ApiError(ErrorCode.NOT_FOUND)
  }
  return result
}

module.exports = {
  getModules,
  getModule,
  createModule,
  updateModule,
  deleteModule
}