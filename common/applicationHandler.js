const { usersModel } = require('../models')
const { UserType } = require('../models/nosql/users')
const { handleError, ErrorCode, ApiError } = require('./apiError')
const { authMiddleware } = require('./authMiddleware')

const handleUserAccess = (targetFunction) =>
    async (req, res) => {
        await authMiddleware(req, res, async () =>
            handleError(async () => {
                const tokenBody = req.tokenBody
                const isSameUser = String(req.params.id) === String(tokenBody.id)
                const isAdmin = tokenBody.roles.includes(UserType.ADMIN.value)
                if (!isSameUser && !isAdmin) {
                    throw new ApiError(ErrorCode.UNAUTHORIZED, 'Insufficient permissions')
                }
                return await targetFunction(req)
            })(req, res)
        )
    }

const handleUser = (targetFunction) =>
    async (req, res) => {
        await authMiddleware(req, res, async () =>
            handleError(async () => {
                const tokenBody = req.tokenBody
                const { id } = tokenBody
                const user = usersModel.findById(id)
                if (!user) {
                    throw new ApiError(ErrorCode.UNAUTHORIZED, 'User token not found')
                }
                req.user = user
                return await targetFunction(req)
            })(req, res)
        )
    }

module.exports = {
    handleUserAccess,
    handleUser
}