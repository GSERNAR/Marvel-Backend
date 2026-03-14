const express = require('express')
const router = express.Router()
const { handleError } = require('../common/apiError')
const {
    batchUpdate,
    getModules,
    getModule,
    createModule,
    updateModule,
    deleteModule
} = require('../controllers/modules')

router.get('/', handleError(getModules))

router.get('/:id', handleError(req => getModule(req.params.id)))

router.post('/', handleError(req => createModule(req.body)))

router.put('/:id', handleError(req => updateModule(req.params.id, req.body)))

router.delete('/:id', handleError(req => deleteModule(req.params.id)))


module.exports = router