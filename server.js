require("dotenv").config();

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const auth = require("./middleware/auth");

const Ride = require('./models/Ride');
const User = require('./models/User');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});


const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

app.post('/api/rides', auth, async (req, res) => {
  try {
    const { pickup, dropoff } = req.body;

    const ride = new Ride({
      pickup,
      dropoff,
      rider: req.user.id
    });

    const savedRide = await ride.save();
    
    res.status(201).json(savedRide);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/rides', auth, async (req, res) => {
  try {

    let rides;

    // DRIVER
    if (req.user.role === "driver") {

      rides = await Ride.find({
        $or: [
          { status: "pending" },
          { driver: req.user.id }
        ]
      }).sort({ createdAt: -1 });

    }

    // RIDER
    else {

      rides = await Ride.find({
        rider: req.user.id
      }).sort({ createdAt: -1 });

    }

    res.json(rides);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }
});

app.get('/api/driver/history', auth, async (req, res) => {

  try {

    if (req.user.role !== "driver") {
      return res.status(403).json({
        message: "Access denied."
      });
    }

    const rides = await Ride.find({
      driver: req.user.id,
      status: "completed"
    }).sort({ createdAt: -1 });

    res.json(rides);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

});

app.patch('/api/rides/:id', auth, async (req, res) => {
  try {

    const { status } = req.body;

    // Find the ride first
    const ride = await Ride.findById(req.params.id);

    if (!ride) {
      return res.status(404).json({
        error: 'Ride not found'
      });
    }

    // If a driver is accepting the ride,
    // save who accepted it
    if (status === 'accepted') {

      // Prevent another driver from taking it
      if (ride.driver && ride.driver.toString() !== req.user.id) {
        return res.status(403).json({
          error: 'Ride has already been accepted by another driver.'
        });
      }

      ride.driver = req.user.id;
    }

    // Update the ride status
    ride.status = status;

    await ride.save();

    res.json(ride);

  } catch (err) {

    res.status(400).json({
      error: err.message
    });

  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "Email already registered"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
      phone
    });

    await user.save();

    res.status(201).json({
      message: "Registration successful"
    });

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    // Create JWT
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d"
      }
    );

    console.log("Logging in:", user.role); // Log the user information
    
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});