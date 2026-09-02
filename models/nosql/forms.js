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
        // References one or more documents in the separate `vehicles` collection this form can
        // ride/pilot, e.g. Green Goblin's form -> Goblin Glider vehicle. A single legacy string
        // id is auto-cast to a one-element array by Mongoose. Optional, most forms have none.
        vehicle: [{
            type: String
        }],
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
        },
        // A single Summon click creates this many instances at once, still for just one
        // summonCost total (e.g. Squirrel Girl's squirrels: 1 PP summons 2 at a time).
        instancesPerSummon: {
            type: Number,
            default: 1
        },
        // Companions that must be chosen via progression picks before they can be summoned
        pickablecomp: [{
            type: String
        }],
        // When and how many pickable companions can be chosen; e.g. [{level:6,count:2},{level:12,count:2},{level:18,count:2}]
        compPickGroups: {
            type: Array,
            default: []
        },
        // Set on companion forms to share a simultaneous-limit pool across multiple companion types
        companionGroupId: {
            type: String,
            default: ''
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