const mongoose = require('mongoose')
const { Schema } = mongoose
const { ObjectId } = mongoose.Types

const CharacterType = {
    HERO: {
        value: 'hero'
    },
    VILLIAN: {
        value: 'villian'
    },
    NPC: {
        value: 'npc'
    }
}

const typeValues = Object.values(CharacterType).map(type => type.value)

const CharacterScheme = new Schema(
    {
        _id: { 
            type: ObjectId,
            auto: true 
        },
        name: {
            type: String
        },
        alterego: {
            type: String
        },
        description: {
            type: String
        },
        logo: {
            type: String
        },
        types: [{
            type: String,
            enum: typeValues,
            default: CharacterType.HERO.value
        }],
        defaultForm: {
            type: String,
        },
        forms: [{
            type: String,
        }],
        // Subset of `forms` that only a sheet currently tagged "Boss" in a table may switch into.
        boss: [{
            type: String,
        }],
        order: {
            type: Number
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
)

const charactersModel = mongoose.model('characters', CharacterScheme)

module.exports = {
    charactersModel,
    CharacterType
}