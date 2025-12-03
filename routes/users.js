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
    deleteUser
} = require('../controllers/users')

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

module.exports = router