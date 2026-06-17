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
        },
        specialcomp: [{
            type: String
        }],
        hpperlevel: {
            type: Number,
            default: 0
        },
        // summonCost > 0 means this companion must be summoned (not always present)
        summonCost: {
            type: Number,
            default: 0
        },
        // e.g. [{ level: 6, max: 1 }, { level: 10, max: 2 }, { level: 18, max: 3 }]
        maxInstancesByLevel: {
            type: Array,
            default: []
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