// Backend mirror of the "Active Effects" turn-processing logic in
// Marvel-Frontend/src/pages/my-sheets/sheetMechanics.js — duplicated here (not shared, separate
// repos) so the OAA's Initiative Tracker "Advance Turn" can tick a sheet's combatEffects down the
// same way that sheet's own "Next Turn" button does, for the combatant whose turn just ended.
// Keep in sync with the frontend's applyBuffDelta/processEffectsForNextTurn/filterEffectsForNextTurn
// if that logic ever changes shape.

function applyBuffDelta(statBuffs, skillBuffs, delta, sign = 1) {
  const newStatBuffs = { ...(statBuffs ?? {}) }
  for (const [k, v] of Object.entries(delta?.stat ?? {})) newStatBuffs[k] = (newStatBuffs[k] ?? 0) + sign * v
  const newSkillBuffs = { ...(skillBuffs ?? {}) }
  for (const [k, v] of Object.entries(delta?.skill ?? {})) newSkillBuffs[k] = (newSkillBuffs[k] ?? 0) + sign * v
  return { statBuffs: newStatBuffs, skillBuffs: newSkillBuffs }
}

const genEffectId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function processEffectsForNextTurn(effects, statBuffs, skillBuffs) {
  let sb = statBuffs, kb = skillBuffs
  let healDelta = 0
  const additions = []
  for (const e of effects) {
    if (e.healPerTurn) healDelta += e.healPerTurn
    if (e.kind === 'turns' && e.count <= 1) {
      const reversed = applyBuffDelta(sb, kb, e.delta, -1)
      sb = reversed.statBuffs
      kb = reversed.skillBuffs
      if (e.onExpire?.heal) healDelta += e.onExpire.heal
      if (e.onExpire?.addEffect) {
        const added = { ...e.onExpire.addEffect, id: genEffectId(), count: (e.onExpire.addEffect.count ?? 1) + 1 }
        const applied = applyBuffDelta(sb, kb, added.delta, 1)
        sb = applied.statBuffs
        kb = applied.skillBuffs
        additions.push(added)
      }
    }
  }
  return { effects: [...effects, ...additions], statBuffs: sb, skillBuffs: kb, healDelta }
}

function filterEffectsForNextTurn(effects) {
  return effects.map((e) => e.kind === 'turns' ? { ...e, count: e.count - 1 } : e).filter((e) => e.kind !== 'turns' || e.count > 0)
}

// Reverse Turn's undo of the tick applied by the Advance Turn it's reversing — restores the
// remaining-turns count for every still-active 'turns'-kind effect. NOTE: this is a partial undo,
// not a full history replay — an effect that fully EXPIRED during that tick (and any onExpire
// heal/HP or chained follow-up effect it triggered) can't be resurrected without snapshotting
// state on every tick, which doesn't exist. That's an acceptable gap for the rare "OAA skipped a
// turn by mistake" correction case this exists for.
function restoreEffectsForPreviousTurn(effects) {
  return effects.map((e) => e.kind === 'turns' ? { ...e, count: e.count + 1 } : e)
}

module.exports = { applyBuffDelta, processEffectsForNextTurn, filterEffectsForNextTurn, restoreEffectsForPreviousTurn }
