const express = require('express')
const router = express.Router()
const { handleError } = require('../common/apiError')
const {
    getVehicles,
    getVehicle,
    createVehicle,
    updateVehicle,
    deleteVehicle
} = require('../controllers/vehicles')

router.get('/', handleError(getVehicles))

router.get('/:id', handleError(req => getVehicle(req.params.id)))

router.post('/', handleError(req => createVehicle(req.body)))

router.put('/:id', handleError(req => updateVehicle(req.params.id, req.body)))

router.delete('/:id', handleError(req => deleteVehicle(req.params.id)))

module.exports = router
