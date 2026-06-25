const express = require('express')
const router = express.Router()
const { handleError } = require('../common/apiError')
const { authMiddleware } = require('../common/authMiddleware')
const { getVapidPublicKey, savePushSubscription } = require('../controllers/push')

router.get('/vapid-public-key', handleError(() => getVapidPublicKey()))

router.post('/subscription', authMiddleware, handleError(req =>
  savePushSubscription(req.tokenBody.id, req.body.subscription)
))

module.exports = router
