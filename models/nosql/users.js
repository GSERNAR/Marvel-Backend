const mongoose = require('mongoose')
const { ObjectId } = mongoose.Types

const UserType = {
    ADMIN: {
        value: 'admin'
    },
    PLAYER: {
        value: 'player'
    }
}

const typeValues = Object.values(UserType).map(type => type.value)

const UserScheme = new mongoose.Schema(
    {
        _id: { 
            type: ObjectId,
            auto: true 
        },
        name: {
            type: String
        },
        username: {
            type: String
        },
        photo: {
            type: String
        },
        bithdate: {
            type: String
        },
        email: {
            type: String,
            unique: true
        },
        password: {
            type: String
        },
        roles: [{
            type: String,
            enum: typeValues,
            default: UserType.PLAYER.value
        }]
        ,
        favourites: [{
            type: String,
        }]
    },
    {
        timestamps: true,
        versionKey: false
    }
)

module.exports = {
    usersModel: mongoose.model('users', UserScheme),
    UserType
}