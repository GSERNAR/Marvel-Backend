const mongoose = require('mongoose')
const { ObjectId } = mongoose.Types

const SheetScheme = new mongoose.Schema(
  {
    _id: {
      type: ObjectId,
      auto: true
    },
    userId: {
      type: String,
      required: true
    },
    characterId: {
      type: String,
      required: true
    },
    formId: {
      type: String,
      default: null
    },
    characterName: {
      type: String,
      required: true
    },
    formName: {
      type: String,
      default: ''
    },
    displayName: {
      type: String,
      required: true
    },
    level: {
      type: Number,
      default: 1
    },
    unspentSkillPoints: {
      type: Number,
      default: 0
    },
    reputation: {
      type: Number,
      default: 0
    },
    textFields: {
      playerName: { type: String, default: '' },
      origin: { type: String, default: '' },
      identity: { type: String, default: '' },
      publicImage: { type: String, default: '' },
      notes: { type: String, default: '' }
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
)

module.exports = {
  sheetsModel: mongoose.model('sheets', SheetScheme)
}
