const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { ObjectId } = mongoose.Types

const ModuleScheme = new Schema(
    {
        _id: { 
            type: ObjectId,
            auto: true 
        },
        name: {
            type: String,
        },
        level: {
            type: Number
        },
        RelatedPower: {
            type: String,
        },
        type: {
            type: String
        },
        skillCheck: {
            type: String
        },
        description: {
            type: String
        },
        amountDice: {
            type: Number
        },
        diceNumber: {
            type: Number
        },
        healing: {
            type: Boolean
        },
        statusEffect: [{
            type: String
        }],
        chance: [{
            type: String
        }],
        moduleType: {
            type: String
        },
        character: {
            type: String
        },
        form: {
            type: String
        }
    }
)

const ModulesModel = mongoose.model('Modules', ModuleScheme)

module.exports = {
    ModulesModel
}