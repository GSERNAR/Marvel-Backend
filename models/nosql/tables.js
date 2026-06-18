const mongoose = require('mongoose')
const { ObjectId } = mongoose.Types

const TableSchema = new mongoose.Schema(
  {
    _id: { type: ObjectId, auto: true },
    name: { type: String, required: true },
    oaaId: { type: String, required: true },
    oaaUsername: { type: String, required: true },
    oaaSheetIds: [{ type: String }],
    members: [
      {
        userId: { type: String },
        username: { type: String },
        status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
        sheetId: { type: String, default: null },
        pendingSheets: [{ sheetId: String, sheetName: String }],
      },
    ],
  },
  { timestamps: true, versionKey: false }
)

module.exports = { tablesModel: mongoose.model('tables', TableSchema) }
