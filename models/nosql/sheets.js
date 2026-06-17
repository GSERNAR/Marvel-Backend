const mongoose = require('mongoose')
const { ObjectId } = mongoose.Types

const SheetScheme = new mongoose.Schema(
  {
    _id: { type: ObjectId, auto: true },
    userId: { type: String, required: true },
    characterId: { type: String, required: true },
    formId: { type: String, default: null },
    characterName: { type: String, required: true },
    formName: { type: String, default: '' },
    displayName: { type: String, required: true },

    // Progression
    level: { type: Number, default: 1 },
    unspentSkillPoints: { type: Number, default: 10 },
    reputation: { type: Number, default: 0 },
    popularity: { type: Number, default: 0 },
    heroism: { type: Number, default: 0 },
    shieldCredits: { type: Number, default: 0 },

    // HP / PP
    currentHp: { type: Number, default: null },
    currentPp: { type: Number, default: null },
    progressionHpBonus: { type: Number, default: 0 },

    // Skills (extra ranks bought with SP per skill)
    skillRanks: { type: Object, default: {} },

    // Unlocks
    unlockedPowerIds: { type: Array, default: [] },
    progressionPicks: { type: Object, default: {} },

    // Text fields
    textFields: {
      playerName: { type: String, default: '' },
      origin: { type: String, default: '' },
      identity: { type: String, default: '' },
      publicImage: { type: String, default: '' },
      notes: { type: String, default: '' },
      specialNotes: { type: String, default: '' },
      contactsAndFriendship: { type: String, default: '[]' },
      weaponSlots: { type: String, default: '' },
      consumableSlots: { type: String, default: '[]' },
      customImmunities: { type: String, default: '' }
    },

    // Combat
    combatEffects: { type: Array, default: [] },
    specialResource: { type: Object, default: {} },

    // Inventory
    inventory: { type: Array, default: [] },
    iso8: { type: Array, default: [] }
  },
  { timestamps: true, versionKey: false }
)

module.exports = {
  sheetsModel: mongoose.model('sheets', SheetScheme)
}
