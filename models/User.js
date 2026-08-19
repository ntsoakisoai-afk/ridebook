const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true
    },

    lastName: {
        type: String,
        required: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    password: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ["rider", "driver", "admin"],
        default: "rider"
    },

    profileImage: {
        type: String,
        default: ""
    },

    phone: {
        type: String,
        default: ""
    },

    // Driver-specific fields (used to populate the rider's
    // "driver accepted" ride status card)
    rating: {
        type: Number,
        default: 4.8
    },

    vehiclePhoto: {
        type: String,
        default: ""
    },

    vehicleMake: {
        type: String,
        default: ""
    },

    vehicleModel: {
        type: String,
        default: ""
    },

    vehicleColor: {
        type: String,
        default: ""
    },

    licensePlate: {
        type: String,
        default: ""
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("User", userSchema);