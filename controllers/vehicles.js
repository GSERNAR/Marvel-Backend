const { vehiclesModel } = require('../models')
const { ApiError, ErrorCode } = require('../common/apiError')

const getVehicles = async () =>
  (await vehiclesModel.find({})).map(vehicleView)

const getVehicle = async (id) => {
  const vehicle = await vehiclesModel.findById(id)
  if (!vehicle) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'Vehicle not found')
  }
  return vehicleView(vehicle)
}

const createVehicle = async (vehicle) =>
  vehicleView(await vehiclesModel.create(vehicle))

const updateVehicle = async (id, changes) => {
  const result = await vehiclesModel.findByIdAndUpdate(id, changes, { new: true })
  if (!result) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'Vehicle not found')
  }
  return vehicleView(result)
}

const deleteVehicle = async (id) => {
  const result = await vehiclesModel.findByIdAndDelete(id)
  if (!result) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'Vehicle not found')
  }
  return vehicleView(result)
}

const vehicleView = (vehicle) => {
  const { stats } = vehicle

  return {
    ...vehicle.toObject(),
    stats
  }
}

module.exports = {
  getVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle
}
