const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { ObjectId } = mongoose.Types
const { AttributesStackScheme } = require('./attributeStacks')

const FormType = {
    NORMAL: {
        value: 'normal'
    },
    ALTERNATE: {
        value: 'alternate'
    },
    ARMOR: {
        value: 'armor'
    }
}

const typeValues = Object.values(FormType).map(type => type.value)

const FormScheme = new Schema(
    {
        _id: { 
            type: ObjectId,
            auto: true 
        },
        name: {
            type: String
        },
        image: {
            type: String
        },
        attributeStack: {
            type: AttributesStackScheme
        },
        stats: {
            type: Map,
            of: Number
          },
        skills: {
            type: Map,
            of: Number
          },
        specialSkills: {
            type: Map,
            of: Number
        },
        abilities: [{
            type: String
        }],
        progression: [{
            type: String
        }],
        weaknesses: [{
            type: String
        }],
        powers: [{
            type: String
        }],
        types: [{
            type: String,
            enum: typeValues,
            default: FormType.NORMAL.value
        }],
        character: {
            type: String
        },
        noSkillUpgrade: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
)

const formsModel = mongoose.model('forms', FormScheme)

module.exports = {
    formsModel,
    FormType
}