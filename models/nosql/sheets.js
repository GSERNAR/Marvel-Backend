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
    currentHp:      { type: Number, default: null },
    shieldHp:       { type: Number, default: 0 },
    currentPp:      { type: Number, default: null },
    webCharges:     { type: Number, default: 20 },
    webCartridges:  { type: Number, default: 10 },
    progressionHpBonus: { type: Number, default: 0 },

    // Per-form SP (multi-form characters like Moon Knight / Agent Venom)
    formSkillPoints: { type: Object, default: {} },

    // Cable: Techno-Organic Virus accumulation (0–20, death at 20)
    toVirus: { type: Number, default: 0 },

    // Black Panther: Kinetic Points (0–10)
    kineticPoints: { type: Number, default: 0 },

    // Hulk: Rage state and Rampage wisdom check difficulty
    isInRage:               { type: Boolean, default: false },
    rampageCheckDifficulty: { type: Number,  default: 3 },

    // Wolverine: Fury system
    furyPoints:         { type: Number,  default: 0 },
    isInFury:           { type: Boolean, default: false },
    furyTurnsRemaining: { type: Number,  default: 0 },

    // Thor: Asgardian Energy + Warrior's Madness
    asgardianEnergy:  { type: Number,  default: 2 },
    isWarriorsMadness:{ type: Boolean, default: false },
    isBerserkersRage: { type: Boolean, default: false },
    wisdomFailCount:  { type: Number,  default: 0 },

    // Companion mini-sheets: { [compCharId]: [{ hp, pp }, ...] }
    // Always-present companions have 1 element; summoned companions grow 0→N
    companionInstances: { type: Object, default: {} },

    // Pickable companions chosen via progression (e.g. Ant-Man's giant ants)
    chosenCompIds: { type: Array, default: [] },

    // Rogue: Absorption system
    rogueStatSlots:    { type: Number, default: 0 },
    rogueSkillSlots:   { type: Number, default: 0 },
    rogueAbilitySlots: { type: Number, default: 0 },
    roguePowerSlots:   { type: Array,  default: [0, 1] }, // each entry is max tier for that slot
    rogueCurrentAbsorbed: { type: Array,  default: [] },
    rogueAbsorbedHistory: { type: Array,  default: [] },

    // Sentry: Void Points (0 → voidThreshold triggers Void transformation)
    voidPoints: { type: Number, default: 0 },

    // Captain Marvel: Binary system (charges to 20 → Binary form, drains to 0 → reverts)
    binaryPoints: { type: Number, default: 0 },
    isBinary:     { type: Boolean, default: false },

    // Bishop: Energy Points (absorbed energy stored for later discharge, 0–10)
    energyPoints: { type: Number, default: 0 },

    // Angel / Archangel: Holy Points and transformation
    holyPoints:              { type: Number,  default: 0 },
    isArchangel:             { type: Boolean, default: false },
    archangelTurnsRemaining: { type: Number,  default: 0 },

    // Skills (extra ranks bought with SP per skill)
    skillRanks: { type: Object, default: {} },

    // Unlocks
    unlockedPowerIds: { type: Array, default: [] },
    unlockedFormIds: { type: Array, default: [] },
    equippedModuleIds: { type: Array, default: [] },
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
      equipmentSlots:  { type: String, default: '[]' },
      explosiveSlots:  { type: String, default: '[]' },
      knifeHarness:    { type: String, default: '0' },
      customImmunities: { type: String, default: '' },
      spellScrolls:    { type: String, default: '[]' },
      scrollAbilityUsed: { type: String, default: 'false' },
      // Nico Minoru / Sister Grimm — Spell tracking
      nicoSpellList:       { type: String, default: '[]' },
      nicoFavoriteSpells:  { type: String, default: '[]' },
      nicoCastCounts:      { type: String, default: '{}' },
      nicoStudyReductions: { type: String, default: '{}' },
      nicoFreePicksUsed:   { type: String, default: '0' },
      nicoLanguages:       { type: String, default: '["Japanese", "English"]' },
      nicoShortRestUsed:   { type: String, default: 'false' },
      nicoCastingWords:    { type: String, default: '{}' },
    },

    // Stat/skill buff overlays (applied by player, visible to OAA in read-only view)
    statBuffs:  { type: Object, default: {} },
    skillBuffs: { type: Object, default: {} },

    // Skills unlocked via SP outside of the character's base form skills (5 SP each)
    unlockedSkills: { type: Array, default: [] },

    // Per-form unlocked power IDs for multi-form characters (Moon Knight, etc.)
    // Structure: { [formId]: [powerId, ...] }
    // Single-form characters continue to use unlockedPowerIds
    formUnlockedPowerIds: { type: Object, default: {} },

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
