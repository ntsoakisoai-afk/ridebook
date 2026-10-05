const mongoose = require('mongoose');

const redemptionSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending'
    },
    method: {
      type: String,
      enum: ['bank_transfer', 'cash', 'eft'],
      default: 'bank_transfer'
    },
    note: {
      type: String,
      default: ''
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    processedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Redemption', redemptionSchema);