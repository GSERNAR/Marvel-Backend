
const { usersModel } = require('../models')
const { ErrorCode, ApiError } = require('../common/apiError')
const { hashPassword, validatePassword } = require('../common/bcryptUtil')
const { generateToken } = require('../common/jwtUtil')

const getUsers = async () => {
  const users =  await usersModel.find({})
  return users.map(userView)
}

const getUser = async (id) =>
  userView(await usersModel.findById(id))

const registerUser = async (user) => {
  const hashedPassword = await hashPassword(user.password)
  user = {
    ...user,
    password: hashedPassword
  }
  return userView(await usersModel.create(user))
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

module.exports = {
  getUsers,
  getUser,
  registerUser,
  generateUserToken,
  updateUser,
  updateFavourites,     
  deleteUser
}