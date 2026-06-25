const webpush = require('web-push')
const { pushSubscriptionsModel } = require('../models/nosql/pushSubscriptions')

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:santisernaramirez@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

const getVapidPublicKey = async () => {
  return { publicKey: process.env.VAPID_PUBLIC_KEY }
}

const savePushSubscription = async (userId, subscription) => {
  await pushSubscriptionsModel.findOneAndUpdate(
    { userId: String(userId) },
    { userId: String(userId), subscription },
    { upsert: true, new: true }
  )
  return { ok: true }
}

const sendPushToUser = async (userId, payload) => {
  if (!userId || !process.env.VAPID_PUBLIC_KEY) return
  const record = await pushSubscriptionsModel.findOne({ userId: String(userId) })
  if (!record) return
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload))
  } catch (err) {
    if (err.statusCode === 410) {
      await pushSubscriptionsModel.deleteOne({ userId: String(userId) })
    }
  }
}

module.exports = { getVapidPublicKey, savePushSubscription, sendPushToUser }
