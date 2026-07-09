const express = require('express')
const router = express.Router()
const { handleError } = require('../common/apiError')
const { authMiddleware } = require('../common/authMiddleware')
const {
  getTables, getTable, createTable, deleteTable,
  inviteMember, respondToInvitation, selectSheet,
  addOaaSheet, removeOaaSheet,
  requestSheet, approveSheetRequest,
  kickMember, leaveTable,
  getTableSheet, getAbsorbTargets, getAbsorbTargetsForSheet,
  requestInitiative, submitInitiativeRoll, startInitiativeTiebreaker,
  publishInitiativeOrder, advanceInitiativeTurn, setInitiativeRollOaa, clearInitiative,
  oaaSheetCombatUpdate,
  watchAnyInitiativeTurn,
} = require('../controllers/tables')

router.get('/', authMiddleware, handleError(req => getTables(req.tokenBody.id)))

router.post('/', authMiddleware, handleError(req => createTable(req.tokenBody.id, req.body)))

// Must be before /:id to avoid Express matching literal paths as table IDs
router.get('/for-sheet/:sheetId/absorb-targets', authMiddleware, handleError(req =>
  getAbsorbTargetsForSheet(req.tokenBody.id, req.params.sheetId)
))

// Long-poll: holds the response open until a turn advances or 28 s timeout
router.get('/initiative/watch', authMiddleware, (req, res) => {
  try { watchAnyInitiativeTurn(req.tokenBody.id, res, req.query.since) }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: 'Watch failed' }) }
})

router.get('/:id', authMiddleware, handleError(req => getTable(req.tokenBody.id, req.params.id)))

router.delete('/:id', authMiddleware, handleError(req => deleteTable(req.tokenBody.id, req.params.id)))

router.post('/:id/invite', authMiddleware, handleError(req =>
  inviteMember(req.tokenBody.id, req.params.id, req.body.username)
))

router.post('/:id/respond', authMiddleware, handleError(req =>
  respondToInvitation(req.tokenBody.id, req.params.id, req.body.accept)
))

router.post('/:id/select-sheet', authMiddleware, handleError(req =>
  selectSheet(req.tokenBody.id, req.params.id, req.body.sheetId)
))

router.post('/:id/oaa-sheets', authMiddleware, handleError(req =>
  addOaaSheet(req.tokenBody.id, req.params.id, req.body.sheetId)
))

router.delete('/:id/oaa-sheets/:sheetId', authMiddleware, handleError(req =>
  removeOaaSheet(req.tokenBody.id, req.params.id, req.params.sheetId)
))

router.post('/:id/request-sheet', authMiddleware, handleError(req =>
  requestSheet(req.tokenBody.id, req.params.id, req.body.sheetId)
))

router.post('/:id/approve-sheet', authMiddleware, handleError(req =>
  approveSheetRequest(req.tokenBody.id, req.params.id, req.body.memberId, req.body.sheetId, req.body.approve)
))

router.post('/:id/leave', authMiddleware, handleError(req =>
  leaveTable(req.tokenBody.id, req.params.id)
))

router.delete('/:id/members/:userId', authMiddleware, handleError(req =>
  kickMember(req.tokenBody.id, req.params.id, req.params.userId)
))

router.get('/:id/sheets/:sheetId', authMiddleware, handleError(req =>
  getTableSheet(req.tokenBody.id, req.params.id, req.params.sheetId)
))

router.get('/:id/absorb-targets', authMiddleware, handleError(req =>
  getAbsorbTargets(req.tokenBody.id, req.params.id)
))

// ── Initiative ────────────────────────────────────────────────────────────────

router.post('/:id/initiative/request', authMiddleware, handleError(req =>
  requestInitiative(req.tokenBody.id, req.params.id)
))

router.post('/:id/initiative/roll', authMiddleware, handleError(req =>
  submitInitiativeRoll(req.tokenBody.id, req.params.id, req.body.total, req.body.isSpeedster, req.body.isTiebreaker)
))

router.post('/:id/initiative/tiebreaker', authMiddleware, handleError(req =>
  startInitiativeTiebreaker(req.tokenBody.id, req.params.id, req.body.userIds)
))

router.post('/:id/initiative/order', authMiddleware, handleError(req =>
  publishInitiativeOrder(req.tokenBody.id, req.params.id, req.body.order)
))

router.post('/:id/initiative/next-turn', authMiddleware, handleError(req =>
  advanceInitiativeTurn(req.tokenBody.id, req.params.id)
))

router.post('/:id/initiative/set-roll', authMiddleware, handleError(req =>
  setInitiativeRollOaa(req.tokenBody.id, req.params.id, req.body.userId, req.body.total)
))

router.post('/:id/initiative/clear', authMiddleware, handleError(req =>
  clearInitiative(req.tokenBody.id, req.params.id)
))

router.patch('/:id/sheets/:sheetId/combat', authMiddleware, handleError(req =>
  oaaSheetCombatUpdate(req.tokenBody.id, req.params.id, req.params.sheetId, req.body)
))

module.exports = router
