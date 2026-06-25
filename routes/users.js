const express = require('express')
const router = express.Router()
const { handleError } = require('../common/apiError')
const { handleUserAccess } = require('../common/applicationHandler')
const { authMiddleware, adminMiddleware } = require('../common/authMiddleware')
const {
    getUser,
    getUsers,
    registerUser,
    generateUserToken,
    updateUser,
    updateFavourites,
    deleteUser,
    verifyEmail,
    forgotPassword,
    resetPassword,
} = require('../controllers/users')

const {
    getSheets,
    getSheet,
    createSheet,
    updateSheet,
    deleteSheet
} = require('../controllers/sheets')

router.get('/', handleError(getUsers))

router.get('/:id', authMiddleware, handleError(req =>
    getUser(req.params.id)
))

router.post('/', handleError(req =>
    registerUser(req.body)
))

router.post('/login', handleError(req =>
    generateUserToken(req.body)
))

router.get('/verify-email/:token', handleError(req =>
    verifyEmail(req.params.token)
))

router.post('/forgot-password', handleError(req =>
    forgotPassword(req.body.email)
))

router.post('/reset-password/:token', handleError(req =>
    resetPassword(req.params.token, req.body.password)
))

router.put('/:id', handleUserAccess(req =>
    updateUser(req.params.id, req.body)
))

// Update favourites (player or admin only)
router.put('/:id/favourites', authMiddleware, handleUserAccess(req =>
  updateFavourites(req.params.id, req.body.favourites)
))


router.delete('/:id', adminMiddleware, handleError(req =>
    deleteUser(req.params.id)
))

// Sheets (scoped to user)
router.get('/:id/sheets', handleUserAccess(req =>
    getSheets(req.params.id)
))

router.post('/:id/sheets', handleUserAccess(req =>
    createSheet(req.params.id, req.body)
))

router.get('/:id/sheets/:sheetId', handleUserAccess(req =>
    getSheet(req.params.id, req.params.sheetId)
))

router.put('/:id/sheets/:sheetId', handleUserAccess(req =>
    updateSheet(req.params.id, req.params.sheetId, req.body)
))

router.delete('/:id/sheets/:sheetId', handleUserAccess(req =>
    deleteSheet(req.params.id, req.params.sheetId)
))

module.exports = router