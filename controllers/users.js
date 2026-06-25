const crypto = require('crypto')
const { usersModel } = require('../models')
const { ErrorCode, ApiError } = require('../common/apiError')
const { hashPassword, validatePassword } = require('../common/bcryptUtil')
const { generateToken } = require('../common/jwtUtil')
const { sendPasswordResetEmail, sendVerificationEmail } = require('../common/mailer')

const getUsers = async () => {
  const users =  await usersModel.find({})
  return users.map(userView)
}

const getUser = async (id) =>
  userView(await usersModel.findById(id))

const registerUser = async (user) => {
  const hashedPassword = await hashPassword(user.password)

  const rawToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')

  const created = await usersModel.create({
    ...user,
    password: hashedPassword,
    emailVerified: false,
    emailVerificationToken: hashedToken,
  })

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
  await sendVerificationEmail(created.email, created.name || created.username, `${frontendUrl}/verify-email/${rawToken}`)

  return userView(created)
}

const generateUserToken = async (userDetails) => {
  const { email, password } = userDetails
  if (!email || !password) {
    throw new ApiError(ErrorCode.BAD_REQUEST, 'email and password are required')
  }

  // Get user by email
  const user = await usersModel.findOne({ email })
  if (!user) {
    throw new ApiError(ErrorCode.NOT_FOUND, `The user with the email ${email} was not found`)
  }

  // Validate password
  const validPassword = await validatePassword(password, user.password)
  if (!validPassword) {
    throw new ApiError(ErrorCode.FORBIDDEN, 'Invalid username or password')
  }

  // Block unverified accounts (existing accounts without a token are grandfathered in)
  if (!user.emailVerified && user.emailVerificationToken) {
    throw new ApiError(ErrorCode.FORBIDDEN, 'Please verify your email address before logging in. Check your inbox.')
  }
  
  // Generate JWT
  const tokenBody = {
    id: user._id,
    roles: user.roles
  }

  return {
    token: generateToken(tokenBody),
    userId: user._id
  }
}

const updateUser = async (id, changes) => {
  if (changes.password) {
    changes.password = await hashPassword(changes.password)
  }
  delete changes._id
  delete changes.roles
  delete changes.username
  delete changes.email
  delete changes.createdAt
  delete changes.updatedAt
  delete changes.favourites
  const result = await usersModel.findByIdAndUpdate(id, changes, { new: true })
  if (!result) {
    throw new ApiError(ErrorCode.NOT_FOUND)
  }
  return userView(result)
}

// Add at the top with the others
const updateFavourites = async (id, favourites) => {
  if (!Array.isArray(favourites)) {
    throw new ApiError(ErrorCode.BAD_REQUEST, 'favourites must be an array')
  }

  // Only update favourites
  const result = await usersModel.findByIdAndUpdate(
    id,
    { favourites },
    { new: true }
  )

  if (!result) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'User not found')
  }

  return userView(result)
}


const deleteUser = async (id) => {
  const result = await usersModel.findByIdAndDelete(id)
  if (!result) {
    throw new ApiError(ErrorCode.NOT_FOUND)
  }
  return userView(result)
}

const userView = (user) => {
  return user
}

const verifyEmail = async (rawToken) => {
  if (!rawToken) throw new ApiError(ErrorCode.BAD_REQUEST, 'Token is required')

  const hashed = crypto.createHash('sha256').update(rawToken).digest('hex')
  const user = await usersModel.findOne({ emailVerificationToken: hashed })

  if (!user) throw new ApiError(ErrorCode.BAD_REQUEST, 'Verification link is invalid or has already been used')

  user.emailVerified = true
  user.emailVerificationToken = undefined
  await user.save()

  return { ok: true }
}

const forgotPassword = async (email) => {
  if (!email) throw new ApiError(ErrorCode.BAD_REQUEST, 'Email is required')
  const user = await usersModel.findOne({ email: email.toLowerCase().trim() })
  if (!user) throw new ApiError(ErrorCode.NOT_FOUND, 'No account with that email address')

  const rawToken = crypto.randomBytes(32).toString('hex')
  user.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex')
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000)
  await user.save()

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
  await sendPasswordResetEmail(user.email, user.name || user.username, `${frontendUrl}/reset-password/${rawToken}`)

  return { ok: true }
}

const resetPassword = async (rawToken, newPassword) => {
  if (!rawToken || !newPassword) throw new ApiError(ErrorCode.BAD_REQUEST, 'Token and new password are required')

  const hashed = crypto.createHash('sha256').update(rawToken).digest('hex')
  const user = await usersModel.findOne({
    passwordResetToken: hashed,
    passwordResetExpires: { $gt: new Date() },
  })

  if (!user) throw new ApiError(ErrorCode.BAD_REQUEST, 'Reset link is invalid or has expired')

  user.password = await hashPassword(newPassword)
  user.passwordResetToken = undefined
  user.passwordResetExpires = undefined
  await user.save()

  return { ok: true }
}

module.exports = {
  getUsers,
  getUser,
  registerUser,
  generateUserToken,
  updateUser,
  updateFavourites,
  deleteUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
}