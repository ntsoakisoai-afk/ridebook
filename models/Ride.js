const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      trim: true
    },

    lat: {
      type: Number,
      required: true
    },

    lng: {
      type: Number,
      required: true
    }
  },
  { _id: false }
);

const rideSchema = new mongoose.Schema(
  {
    pickup: {
      type: locationSchema,
      required: true
    },

    dropoff: {
      type: locationSchema,
      required: true
    },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'pending'
    },

    createdAt: {
      type: Date,
      default: Date.now
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    distanceKm: {
      type: Number,
      default: null
    },

    durationMin: {
      type: Number,
      default: null
    },

    price: {
      type: Number,
      default: null
    },

    driverLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null }
    },

    // Real wall-clock timestamps for when each phase actually began,
    // used to anchor the rider-side car animation so it reflects true
    // elapsed time and resumes correctly after a page reload/refresh
    // instead of restarting from zero each time.
    acceptedAt: {
      type: Date,
      default: null
    },

    inProgressAt: {
      type: Date,
      default: null
    }
  }
);

module.exports = mongoose.model('Ride', rideSchema);