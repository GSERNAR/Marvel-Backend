const mongoose = require('mongoose')

const PushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    subscription: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false }
)

module.exports = { pushSubscriptionsModel: mongoose.model('pushSubscriptions', PushSubscriptionSchema) }
