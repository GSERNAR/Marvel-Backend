const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { ObjectId } = mongoose.Types

// Vehicles are their own collection (not Forms) — e.g. Green Goblin's form references the
// Goblin Glider vehicle via form.vehicle. A character form can pilot/ride a vehicle without the
// vehicle itself needing skills, progression, or an owning Character document.
const VehicleScheme = new Schema(
    {
        _id: {
            type: ObjectId,
            auto: true
        },
        name: {
            type: String
        },
        image: {
            type: String
        },
        stats: {
            type: Map,
            of: Number
        },
        abilities: [{
            type: String
        }],
        weaknesses: [{
            type: String
        }],
        powers: [{
            type: String
        }],
        types: [{
            type: String
        }],
        character: {
            type: String
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
)

const vehiclesModel = mongoose.model('vehicles', VehicleScheme)

module.exports = {
    vehiclesModel
}
