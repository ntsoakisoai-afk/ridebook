require("dotenv").config();

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const auth = require("./middleware/auth");

const Ride = require('./models/Ride');
const User = require('./models/User');

const app = express();

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors());
app.use(express.json());

// ==========================================
// DATABASE CONNECTION
// ==========================================

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

// ==========================================
// FILE UPLOAD CONFIGURATION
// ==========================================

// Ensure the upload directory exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp_randomstring.extension
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'vehicle_' + uniqueSuffix + ext);
  }
});

// File filter - only allow images
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, GIF, and WEBP images are allowed'), false);
  }
};

// Create multer upload instance
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// ==========================================
// API ROUTES
// ==========================================

// ---------- DEBUG ROUTES ----------
app.get('/api/debug', (req, res) => {
  res.json({ 
    message: 'Server is running!',
    routes: {
      login: '/api/login',
      register: '/api/register',
      profile: '/api/users/profile',
      rides: '/api/rides',
      upload: '/api/users/upload-vehicle-photo'
    },
    timestamp: new Date().toISOString()
  });
});

// ---------- RIDE ROUTES ----------
function normalizeRideLocation(location) {
  if (!location || !location.address) {
    return null;
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const isValid = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33;

  if (!isValid) {
    return null;
  }

  return {
    address: String(location.address).trim(),
    lat,
    lng
  };
}

app.post('/api/rides', auth, async (req, res) => {
  try {
    const { pickup, dropoff, distanceKm, durationMin, price } = req.body;
    const normalizedPickup = normalizeRideLocation(pickup);
    const normalizedDropoff = normalizeRideLocation(dropoff);

    console.log('Ride creation coordinates', { pickup, dropoff });

    if (!normalizedPickup || !normalizedDropoff) {
      return res.status(400).json({
        message: 'Unable to verify route location. Please select a valid South African address.'
      });
    }

    const ride = new Ride({
      pickup: normalizedPickup,
      dropoff: normalizedDropoff,
      distanceKm,
      durationMin,
      price,
      rider: req.user.id
    });

    const savedRide = await ride.save();
  console.log('Ride created', savedRide);
  console.log('Pickup coordinates', savedRide.pickup);
  console.log('Dropoff coordinates', savedRide.dropoff);
    
    res.status(201).json(savedRide);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/rides', auth, async (req, res) => {
  try {
    let rides;

    if (req.user.role === "driver") {
      rides = await Ride.find({
        $or: [
          { status: "pending" },
          { driver: req.user.id }
        ]
      })
        .populate('rider', 'firstName lastName phone')
        .sort({ createdAt: -1 });
    } else {
      rides = await Ride.find({
        rider: req.user.id
      })
        .populate(
          'driver',
          'firstName lastName phone profileImage rating ' +
          'vehiclePhoto vehicleMake vehicleModel vehicleColor licensePlate'
        )
        .sort({ createdAt: -1 });
    }

    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single ride by ID - FIXED
app.get('/api/rides/:id', auth, async (req, res) => {
  try {
    console.log('🔍 GET /api/rides/:id called:');
    console.log('  - Ride ID:', req.params.id);
    console.log('  - User ID:', req.user.id);
    console.log('  - User Role:', req.user.role);

    const ride = await Ride.findById(req.params.id)
      .populate('driver', 'firstName lastName phone rating vehicleMake vehicleModel vehicleColor licensePlate vehiclePhoto')
      .populate('rider', 'firstName lastName phone');

    if (!ride) {
      console.log('❌ Ride not found');
      return res.status(404).json({ message: 'Ride not found' });
    }

    console.log('  - Ride status:', ride.status);
    console.log('  - Ride driver (raw):', ride.driver);

    // ==========================================================
    // FIX: Check authorization properly
    // ==========================================================
    
    // If user is a driver, check if they are the assigned driver
    if (req.user.role === 'driver') {
      // Handle both populated and unpopulated driver
      let rideDriverId = null;
      if (ride.driver) {
        if (typeof ride.driver === 'object' && ride.driver._id) {
          rideDriverId = ride.driver._id.toString();
        } else if (typeof ride.driver === 'string') {
          rideDriverId = ride.driver;
        } else if (typeof ride.driver === 'object' && ride.driver.toString) {
          rideDriverId = ride.driver.toString();
        }
      }
      
      const userId = req.user.id.toString();
      
      console.log('  - Ride driver ID (string):', rideDriverId);
      console.log('  - User ID (string):', userId);
      
      // If driver is assigned and doesn't match, deny access
      if (rideDriverId && rideDriverId !== userId) {
        console.log('❌ Driver mismatch - access denied');
        return res.status(403).json({ 
          message: 'Not authorized to view this ride',
          rideDriver: rideDriverId,
          userId: userId
        });
      }
      
      // If no driver assigned yet, allow access (for pending rides)
      if (!rideDriverId && ride.status === 'pending') {
        console.log('✅ No driver assigned yet - allowing access for pending ride');
        // Allow driver to view pending rides
      }
    }

    // If user is a rider, check if they are the rider
    if (req.user.role === 'rider') {
      let rideRiderId = null;
      if (ride.rider) {
        if (typeof ride.rider === 'object' && ride.rider._id) {
          rideRiderId = ride.rider._id.toString();
        } else if (typeof ride.rider === 'string') {
          rideRiderId = ride.rider;
        }
      }
      
      const userId = req.user.id.toString();
      
      if (rideRiderId && rideRiderId !== userId) {
        console.log('❌ Rider mismatch - access denied');
        return res.status(403).json({ message: 'Not authorized to view this ride' });
      }
    }

    console.log('✅ Access granted');
    res.json(ride);
  } catch (err) {
    console.error('Error fetching ride:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- HISTORY ROUTES ----------
app.get('/api/driver/history', auth, async (req, res) => {
  try {
    if (req.user.role !== "driver") {
      return res.status(403).json({ message: "Access denied." });
    }

    const rides = await Ride.find({
      driver: req.user.id
    })
      .populate('rider', 'firstName lastName phone rating')
      .sort({ createdAt: -1 });

    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rider/history', auth, async (req, res) => {
  try {
    if (req.user.role !== "rider") {
      return res.status(403).json({ message: "Access denied." });
    }

    const rides = await Ride.find({
      rider: req.user.id
    }).sort({ createdAt: -1 });

    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- AUTH ROUTES ----------
app.post("/api/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, phone } = req.body;

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
      phone
    });

    await user.save();

    res.status(201).json({ message: "Registration successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        vehiclePhoto: user.vehiclePhoto,
        vehicleMake: user.vehicleMake,
        vehicleModel: user.vehicleModel,
        vehicleColor: user.vehicleColor,
        licensePlate: user.licensePlate
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- VEHICLE PHOTO UPLOAD ----------
app.post('/api/users/upload-vehicle-photo', auth, upload.single('vehiclePhoto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Get the URL path to the uploaded file
    const photoUrl = `/uploads/${req.file.filename}`;

    // Update the user's vehiclePhoto field
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { vehiclePhoto: photoUrl } },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Vehicle photo uploaded successfully!',
      vehiclePhoto: photoUrl,
      user: updatedUser
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to serve uploaded images
app.get('/uploads/:filename', (req, res) => {
  const filepath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filepath)) {
    res.sendFile(filepath);
  } else {
    res.status(404).json({ message: 'File not found' });
  }
});

// ---------- PROFILE ROUTES ----------
app.patch('/api/users/profile', auth, async (req, res) => {
  try {
    const { phone, vehicleMake, vehicleModel, vehicleColor, licensePlate, vehiclePhoto } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          phone: phone || '',
          vehicleMake: vehicleMake || '',
          vehicleModel: vehicleModel || '',
          vehicleColor: vehicleColor || '',
          licensePlate: licensePlate ? licensePlate.toUpperCase().trim() : '',
          vehiclePhoto: vehiclePhoto || ''
        }
      },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- RIDE STATUS ROUTES ----------
app.patch('/api/rides/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const rideId = req.params.id;

    if (!['pending', 'accepted', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateFields = { status };

    // ==========================================================
    // FIX: Set driver when status changes to 'accepted'
    // ==========================================================
    if (status === 'accepted') {
      // Only drivers can accept rides
      if (req.user.role !== 'driver') {
        return res.status(403).json({ message: 'Only drivers can accept rides' });
      }
      updateFields.driver = req.user.id;
      updateFields.acceptedAt = new Date();
    }

    // ==========================================================
    // Set inProgressAt when status changes to 'in_progress'
    // ==========================================================
    if (status === 'in_progress') {
      updateFields.inProgressAt = new Date();
    }

    // ==========================================================
    // Clear driver when cancelled or completed
    // ==========================================================
    if (status === 'cancelled' || status === 'completed') {
      // Optionally clear driver or keep for history
    }

    const ride = await Ride.findByIdAndUpdate(rideId, updateFields, { new: true })
      .populate('driver', 'firstName lastName phone rating vehicleMake vehicleModel vehicleColor licensePlate vehiclePhoto')
      .populate('rider', 'firstName lastName phone');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    console.log(`✅ Ride ${rideId} updated: status=${status}, driver=${ride.driver ? ride.driver._id : 'none'}`);

    res.json(ride);
  } catch (err) {
    console.error('Error updating ride:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rides/:id/rate', auth, async (req, res) => {
  try {
    const { rating } = req.body;
    const ride = await Ride.findById(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    if (ride.driver) {
      const driver = await User.findById(ride.driver);
      if (driver) {
        const currentRating = driver.rating || 5.0;
        driver.rating = Number(((currentRating + Number(rating)) / 2).toFixed(1));
        await driver.save();
      }
    }

    res.json({ message: 'Rating submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update driver location - FIXED
app.patch('/api/rides/:id/location', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const rideId = req.params.id;
    
    console.log('📍 LOCATION UPDATE:');
    console.log('  - Ride ID:', rideId);
    console.log('  - User ID:', req.user.id);
    console.log('  - Location:', lat, lng);

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'lat and lng must be numbers' });
    }

    const ride = await Ride.findById(rideId);
    
    if (!ride) {
      console.log('❌ Ride not found');
      return res.status(404).json({ message: 'Ride not found' });
    }

    // ==========================================================
    // FIX: Only allow location updates for active rides
    // ==========================================================
    if (ride.status !== 'accepted' && ride.status !== 'in_progress') {
      console.log('❌ Ride status is', ride.status, '- cannot update location');
      return res.status(403).json({ 
        message: `Cannot update location for ${ride.status} ride`
      });
    }

    // ==========================================================
    // FIX: Check driver authorization properly
    // ==========================================================
    let rideDriverId = null;
    if (ride.driver) {
      if (typeof ride.driver === 'object' && ride.driver._id) {
        rideDriverId = ride.driver._id.toString();
      } else if (typeof ride.driver === 'string') {
        rideDriverId = ride.driver;
      } else if (typeof ride.driver === 'object' && ride.driver.toString) {
        rideDriverId = ride.driver.toString();
      }
    }
    
    const userId = req.user.id.toString();
    
    console.log('  - Ride driver ID:', rideDriverId);
    console.log('  - User ID:', userId);
    
    // If no driver assigned, auto-assign
    if (!rideDriverId) {
      console.log('⚠️ No driver assigned - auto-assigning current user');
      ride.driver = req.user.id;
      rideDriverId = userId;
      await ride.save();
      console.log('✅ Driver auto-assigned');
    }
    
    // Check if current user is the driver
    if (rideDriverId !== userId) {
      console.log('❌ Driver mismatch');
      return res.status(403).json({ 
        message: 'You are not the driver for this ride.',
        rideDriver: rideDriverId,
        userId: userId
      });
    }

    // Update location
    ride.driverLocation = { lat, lng, updatedAt: new Date() };
    await ride.save();

    console.log('✅ Location updated successfully');
    res.json({ 
      message: 'Location updated', 
      driverLocation: ride.driverLocation 
    });

  } catch (err) {
    console.error('Error updating location:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- GEOCODE ROUTE ----------
const geocodeCache = new Map();
const GEOCODE_CACHE_TTL_MS = 1000 * 60 * 60;

function geocodeCacheKey(lat, lng) {
  return `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
}

async function fetchFromNominatim(lat, lng) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`,
    {
      headers: {
        'User-Agent': `RideBook/1.0 (contact: ${process.env.NOMINATIM_CONTACT_EMAIL})`
      }
    }
  );

  return response;
}

app.get('/api/geocode', auth, async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const cacheKey = geocodeCacheKey(lat, lng);
    const cached = geocodeCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < GEOCODE_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    let response = await fetchFromNominatim(lat, lng);

    if (response.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      response = await fetchFromNominatim(lat, lng);
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to fetch address from geocoding service'
      });
    }

    const data = await response.json();

    geocodeCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });

    res.json(data);
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- TEST ROUTE ----------
app.get('/api/test-ridewithgps', async (req, res) => {
  try {
    const response = await fetch(
      'https://ridewithgps.com/api/v1/auth_tokens',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rwgps-api-key': process.env.RIDEWITHGPS_API_KEY
        },
        body: JSON.stringify({
          user: {
            email: process.env.RIDEWITHGPS_EMAIL,
            password: process.env.RIDEWITHGPS_PASSWORD
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data
      });
    }

    res.json({
      success: true,
      message: 'Ride with GPS authentication successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// STATIC FILES & FRONTEND ROUTING
// ==========================================

app.use(express.static('public'));

// Serve login.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Catch-all: any route not matched by API or static files
// serves login.html (for client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ==========================================
// SERVER START
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});