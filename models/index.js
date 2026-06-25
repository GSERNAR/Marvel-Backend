const { usersModel } = require('./nosql/users')
const { charactersModel } = require('./nosql/characters')
const { formsModel } = require('./nosql/forms')
const { powersModel } = require('./nosql/powers')
const { attributeModel } = require('./nosql/attributes')
const { attributeValuesModel, attributeStacksModel } = require('./nosql/attributeStacks')
const { ModulesModel } = require('./nosql/modules')
const { sheetsModel } = require('./nosql/sheets')
const { tablesModel } = require('./nosql/tables')

module.exports = {
    usersModel,
    charactersModel,
    formsModel,
    powersModel,
    ModulesModel,
    attributeModel,
    attributeValuesModel,
    attributeStacksModel,
    sheetsModel,
    tablesModel
}