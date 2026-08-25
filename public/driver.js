console.log("Driver page loaded");

const driverRides = document.getElementById('driver-rides');
const token = sessionStorage.getItem('token');
const user = JSON.parse(sessionStorage.getItem('user') || 'null');

if (!token || !user) {
  window.location.href = '/login.html';
}

if (user.role !== 'driver') {
  showToast('Access denied. You do not have permission to view this page.', 'error', 3000);
  window.location.href = '/login.html';
}

const currentUserId = user.id ? user.id.toString() : null;

const driverName = document.getElementById('driverName');
if (driverName) {
  driverName.textContent = `${user.firstName} ${user.lastName}`;
}

// ===============================
// MAP SETUP
// ===============================

const map = L.map('driver-map').setView([-33.9608, 25.6022], 13);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let driverLocation = null;
let driverMarker = null;
let stopMarker = null;
let approachLine = null;
let tripOverviewLine = null;
let currentMapRideId = null;
let currentMapStage = null;

// ===============================
// CAR ICON WITH ROTATION
// ===============================

function createCarIcon(rotation = 0) {
  return L.divIcon({
    className: 'driver-car-marker',
    html: `<div style="font-size: 28px; transform: rotate(${rotation}deg); transition: transform 0.3s ease; filter: drop-shadow(0 3px 8px rgba(0,212,170,0.3));">🚖</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

// ===============================
// DISTANCE HELPER
// ===============================

function haversineDistanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

// ===============================
// FETCH ROUTE
// ===============================

async function fetchRouteCoords(pointA, pointB) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pointA.lng},${pointA.lat};${pointB.lng},${pointB.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) return null;
    return {
      coords: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
      distanceKm: data.routes[0].distance / 1000,
      durationSec: data.routes[0].duration
    };
  } catch (err) {
    console.warn('fetchRouteCoords failed:', err);
    return null;
  }
}

// ===============================
// POINT ALONG ROUTE
// ===============================

function getPointAlongRoute(coords, t) {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) {
    return { lat: coords[0][0], lng: coords[0][1], bearingDeg: 0 };
  }

  const segLens = [];
  let totalLen = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = haversineDistanceKm(
      { lat: coords[i][0], lng: coords[i][1] },
      { lat: coords[i + 1][0], lng: coords[i + 1][1] }
    );
    segLens.push(d);
    totalLen += d;
  }

  if (totalLen === 0) {
    return { lat: coords[0][0], lng: coords[0][1], bearingDeg: 0 };
  }

  const targetDist = Math.min(Math.max(t, 0), 1) * totalLen;
  let covered = 0;

  for (let i = 0; i < segLens.length; i++) {
    const segLen = segLens[i];
    if (covered + segLen >= targetDist || i === segLens.length - 1) {
      const segT = segLen === 0 ? 0 : (targetDist - covered) / segLen;
      const a = coords[i];
      const b = coords[i + 1];
      const lat = a[0] + (b[0] - a[0]) * segT;
      const lng = a[1] + (b[1] - a[1]) * segT;
      const bearingDeg = Math.atan2(b[0] - a[0], b[1] - a[1]) * (180 / Math.PI);
      return { lat, lng, bearingDeg };
    }
    covered += segLen;
  }

  const last = coords[coords.length - 1];
  return { lat: last[0], lng: last[1], bearingDeg: 0 };
}

// ===============================
// ANIMATION STATE - REAL TIME + 3X FASTER
// ===============================

let animState = {
  running: false,
  rideId: null,
  phase: null, // 'to_pickup' or 'to_dropoff'
  routeCoords: [],
  startTime: null, // Server timestamp (acceptedAt or inProgressAt)
  realDurationMs: 0, // Real-world duration from OSRM
  animDurationMs: 0, // Duration for animation (realDurationMs / 3)
  progress: 0,
  completed: false,
  animFrameId: null,
  etaIntervalId: null,
  lastPosition: null
};

function resetAnimation() {
  if (animState.animFrameId) {
    cancelAnimationFrame(animState.animFrameId);
    animState.animFrameId = null;
  }
  if (animState.etaIntervalId) {
    clearInterval(animState.etaIntervalId);
    animState.etaIntervalId = null;
  }
  animState.running = false;
  animState.rideId = null;
  animState.phase = null;
  animState.routeCoords = [];
  animState.startTime = null;
  animState.realDurationMs = 0;
  animState.animDurationMs = 0;
  animState.progress = 0;
  animState.completed = false;
  animState.lastPosition = null;
}

function placeMarker(lat, lng, bearingDeg) {
  if (!driverMarker) return;
  driverMarker.setIcon(createCarIcon(bearingDeg));
  driverMarker.setLatLng([lat, lng]);
  animState.lastPosition = { lat, lng };
}

// ===============================
// START ANIMATION - REAL TIME + 3X FASTER
// ===============================

async function startAnimation(ride, phaseKey, targetStop) {
  // If already running for this ride+phase, keep going
  if (animState.running && animState.rideId === ride._id && animState.phase === phaseKey) {
    return;
  }

  // Reset any existing animation
  resetAnimation();

  // Get start position
  let startPoint = animState.lastPosition;
  if (!startPoint) {
    startPoint = phaseKey === 'to_pickup'
      ? { lat: ride.pickup.lat + 0.0025, lng: ride.pickup.lng + 0.0025 }
      : { lat: ride.pickup.lat, lng: ride.pickup.lng };
  }

  // Create marker if needed
  if (!driverMarker) {
    driverMarker = L.marker([startPoint.lat, startPoint.lng], { icon: createCarIcon(0) })
      .addTo(map)
      .bindPopup('Driver');
  }

  // Fetch route
  const route = await fetchRouteCoords(startPoint, targetStop);
  
  const coords = route ? route.coords : [[startPoint.lat, startPoint.lng], [targetStop.lat, targetStop.lng]];
  const distanceKm = route ? route.distanceKm : haversineDistanceKm(startPoint, targetStop);

  // ==========================================================
  // REAL DURATION (from OSRM or estimate)
  // ==========================================================
  let realDurationMs;
  if (phaseKey === 'to_dropoff' && ride.durationMin) {
    realDurationMs = ride.durationMin * 60 * 1000;
  } else if (route && route.durationSec) {
    realDurationMs = route.durationSec * 1000;
  } else {
    realDurationMs = (distanceKm / 30) * 3600 * 1000;
  }
  
  // Minimum real duration: 60 seconds
  realDurationMs = Math.max(realDurationMs, 60000);

  // ==========================================================
  // ANIMATION DURATION = realDuration / 3 (3x faster)
  // ==========================================================
  const SPEED_MULTIPLIER = 3;
  const animDurationMs = realDurationMs / SPEED_MULTIPLIER;

  // ==========================================================
  // GET SERVER TIMESTAMP (for persistence across reloads)
  // ==========================================================
  let serverTimestamp = null;
  if (phaseKey === 'to_pickup') {
    serverTimestamp = ride.acceptedAt ? new Date(ride.acceptedAt) : null;
  } else {
    serverTimestamp = ride.inProgressAt ? new Date(ride.inProgressAt) : null;
  }
  
  if (!serverTimestamp) {
    serverTimestamp = new Date();
  }

  const startTime = serverTimestamp.getTime();

  // ==========================================================
  // CALCULATE CURRENT PROGRESS
  // ==========================================================
  const elapsedRealTime = Date.now() - startTime;
  const progress = Math.min(1, elapsedRealTime / animDurationMs);

  console.log(`🔍 Animation started: realDuration=${realDurationMs/1000}s, animDuration=${animDurationMs/1000}s, progress=${progress.toFixed(2)}`);

  // ==========================================================
  // SETUP ANIMATION STATE
  // ==========================================================
  animState.running = true;
  animState.rideId = ride._id;
  animState.phase = phaseKey;
  animState.routeCoords = coords;
  animState.startTime = startTime;
  animState.realDurationMs = realDurationMs;
  animState.animDurationMs = animDurationMs;
  animState.progress = progress;
  animState.completed = false;

  // If already complete, snap to end
  if (progress >= 1) {
    const last = coords[coords.length - 1];
    placeMarker(last[0], last[1], 0);
    animState.completed = true;
    animState.running = false;
    
    if (phaseKey === 'to_dropoff') {
      const endTripBtn = document.getElementById('end-trip-btn');
      if (endTripBtn) {
        endTripBtn.disabled = false;
        endTripBtn.textContent = '✅ End Trip';
      }
    }
    return;
  }

  // Place marker at current progress
  const pos = getPointAlongRoute(coords, progress);
  if (pos) {
    placeMarker(pos.lat, pos.lng, pos.bearingDeg);
  }

  // ==========================================================
  // START ETA TIMER - SHOWS REAL TIME REMAINING
  // ==========================================================
  animState.etaIntervalId = setInterval(() => {
    if (!animState.running && !animState.completed) return;
    
    // Calculate real time remaining
    const elapsedReal = Date.now() - animState.startTime;
    const realRemainingMs = Math.max(animState.realDurationMs - elapsedReal, 0);
    const minutesRemaining = Math.max(Math.ceil(realRemainingMs / 60000), 0);
    
    // Update ETA display
    const etaEl = document.getElementById('driver-eta-value');
    if (etaEl) {
      etaEl.textContent = minutesRemaining <= 0 ? 'Arriving' : `${minutesRemaining} min`;
    }
    
    // Update distance display
    const distEl = document.getElementById('driver-distance-value');
    if (distEl && animState.routeCoords.length > 0) {
      const totalDist = haversineDistanceKm(
        { lat: animState.routeCoords[0][0], lng: animState.routeCoords[0][1] },
        { lat: animState.routeCoords[animState.routeCoords.length - 1][0], lng: animState.routeCoords[animState.routeCoords.length - 1][1] }
      );
      const progressVal = Math.min(1, elapsedReal / animState.animDurationMs);
      const remainingDist = totalDist * (1 - progressVal);
      distEl.textContent = `${remainingDist.toFixed(1)} km`;
    }
    
    // Enable End Trip when animation complete
    if (animState.completed && animState.phase === 'to_dropoff') {
      const endTripBtn = document.getElementById('end-trip-btn');
      if (endTripBtn && endTripBtn.disabled) {
        endTripBtn.disabled = false;
        endTripBtn.textContent = '✅ End Trip';
      }
    }
  }, 1000);

  // Update ETA immediately
  const initialRealRemaining = Math.max(animState.realDurationMs, 0);
  const initialMinutes = Math.ceil(initialRealRemaining / 60000);
  const etaEl = document.getElementById('driver-eta-value');
  if (etaEl) {
    etaEl.textContent = initialMinutes <= 0 ? 'Arriving' : `${initialMinutes} min`;
  }

  // ==========================================================
  // ANIMATION LOOP - MOVES CAR 3X FASTER
  // ==========================================================
  
  function animateFrame() {
    // Check if animation should continue
    if (!animState.running || animState.rideId !== ride._id || animState.phase !== phaseKey) {
      return;
    }

    // Calculate current progress (3x faster than real time)
    const elapsedReal = Date.now() - animState.startTime;
    const t = Math.min(elapsedReal / animState.animDurationMs, 1);
    animState.progress = t;

    // Get position along route
    const pos = getPointAlongRoute(animState.routeCoords, t);
    
    if (pos) {
      placeMarker(pos.lat, pos.lng, pos.bearingDeg);
    }

    // Check if complete
    if (t >= 1) {
      animState.completed = true;
      animState.running = false;
      
      // Snap to final position
      const last = animState.routeCoords[animState.routeCoords.length - 1];
      placeMarker(last[0], last[1], 0);
      
      // Enable End Trip button if dropoff phase
      if (phaseKey === 'to_dropoff') {
        const endTripBtn = document.getElementById('end-trip-btn');
        if (endTripBtn) {
          endTripBtn.disabled = false;
          endTripBtn.textContent = '✅ End Trip';
        }
        showToast('Arrived at destination! You can end the trip.', 'success', 3000);
      }
      return;
    }

    // Continue animation
    animState.animFrameId = requestAnimationFrame(animateFrame);
  }

  // Start the animation loop
  animState.animFrameId = requestAnimationFrame(animateFrame);
}

// ===============================
// LIVE DRIVER LOCATION + PUSH TO SERVER
// ===============================

let activeTripId = null;
let lastLocationPushAt = 0;
const LOCATION_PUSH_INTERVAL_MS = 5000;

function watchDriverLocation() {
  console.log('🔍 watchDriverLocation started');

  if (!navigator.geolocation) {
    console.warn('⚠️ Geolocation not supported');
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const newLat = position.coords.latitude;
      const newLng = position.coords.longitude;
      
      driverLocation = { lat: newLat, lng: newLng };

      // Only use real GPS if NO animation is running
      if (!animState.running) {
        if (!driverMarker) {
          driverMarker = L.marker([newLat, newLng], { icon: createCarIcon(0) })
            .addTo(map)
            .bindPopup('You are here');
          map.setView([newLat, newLng], 14);
        } else {
          const angle = Math.atan2(
            newLat - (animState.lastPosition?.lat || newLat),
            newLng - (animState.lastPosition?.lng || newLng)
          ) * (180 / Math.PI);
          driverMarker.setIcon(createCarIcon(angle));
          driverMarker.setLatLng([newLat, newLng]);
          animState.lastPosition = { lat: newLat, lng: newLng };
        }
      }

      if (activeTripId) {
        checkAndPushLocation();
      }
    },
    (error) => {
      console.warn('❌ GPS error:', error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000
    }
  );
}

async function checkAndPushLocation() {
  if (!driverLocation || !activeTripId) {
    console.log('⚠️ No driver location or active trip ID');
    return;
  }
  
  try {
    // ==========================================================
    // FIX: Log the ride ID being checked
    // ==========================================================
    console.log('🔍 checkAndPushLocation - Checking ride:', activeTripId);
    
    const response = await fetch(`/api/rides/${activeTripId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.warn('Failed to verify ride status:', response.status);
      return;
    }

    const ride = await response.json();

    console.log('  - Ride status:', ride.status);
    console.log('  - Ride driver:', ride.driver ? 'Set' : 'Not set');

    // ==========================================================
    // FIX: Only push location if ride is active
    // ==========================================================
    if (ride.status !== 'accepted' && ride.status !== 'in_progress') {
      console.log('⚠️ Ride is not active (status:', ride.status, '), skipping location push');
      // If the ride is completed or cancelled, clear activeTripId
      if (ride.status === 'completed' || ride.status === 'cancelled') {
        console.log('  🧹 Clearing activeTripId because ride is', ride.status);
        activeTripId = null;
        loadPendingRides();
      }
      return;
    }

    // ==========================================================
    // FIX: Check if driver is assigned
    // ==========================================================
    if (!ride.driver) {
      console.log('⚠️ No driver assigned to this ride');
      return;
    }

    // Get driver ID
    let driverId = null;
    if (typeof ride.driver === 'object' && ride.driver._id) {
      driverId = ride.driver._id.toString();
    } else if (typeof ride.driver === 'string') {
      driverId = ride.driver;
    }

    console.log('  - Driver ID from ride:', driverId);
    console.log('  - Current user ID:', currentUserId);

    if (!driverId || driverId !== currentUserId) {
      console.log('⚠️ Driver ID mismatch, skipping location push');
      return;
    }

    const now = Date.now();
    if (now - lastLocationPushAt > LOCATION_PUSH_INTERVAL_MS) {
      lastLocationPushAt = now;
      
      console.log('📍 Pushing location for ride:', activeTripId);
      
      const pushResponse = await fetch(`/api/rides/${activeTripId}/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          lat: driverLocation.lat,
          lng: driverLocation.lng
        })
      });

      if (!pushResponse.ok) {
        const errorData = await pushResponse.json().catch(() => ({}));
        console.warn('❌ Location push failed:', errorData.message || 'Unknown error');
        console.warn('❌ Status:', pushResponse.status);
        
        if (pushResponse.status === 403) {
          console.warn('⚠️ Driver not authorized for this ride, clearing activeTripId');
          activeTripId = null;
          loadPendingRides();
        }
      } else {
        console.log('✅ Location pushed successfully for ride:', activeTripId);
      }
    }
  } catch (err) {
    console.warn('❌ Error in checkAndPushLocation:', err);
  }
}

// ===============================
// ROUTE DRAWING - GREEN PATH
// ===============================

async function getRoadRoute(pointA, pointB) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pointA.lng},${pointA.lat};${pointB.lng},${pointB.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.routes || !data.routes.length) return null;
    return {
      coordinates: data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: data.routes[0].distance / 1000,
      durationMin: data.routes[0].duration / 60
    };
  } catch (error) {
    console.error('Routing error:', error);
    return null;
  }
}

function clearTripLayers() {
  if (stopMarker) { map.removeLayer(stopMarker); stopMarker = null; }
  if (approachLine) { map.removeLayer(approachLine); approachLine = null; }
  if (tripOverviewLine) { map.removeLayer(tripOverviewLine); tripOverviewLine = null; }
  currentMapRideId = null;
  currentMapStage = null;
  resetAnimation();
}

async function drawTripOnMap(ride, stage) {
  if (currentMapRideId === ride._id && currentMapStage === stage) return;

  clearTripLayers();
  currentMapRideId = ride._id;
  currentMapStage = stage;

  const nextStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;

  stopMarker = L.marker([nextStop.lat, nextStop.lng])
    .addTo(map)
    .bindPopup(stage === 'to_pickup' ? '📍 Pickup' : '🔴 Dropoff')
    .openPopup();

  if (stage === 'to_dropoff' && ride.pickup) {
    L.marker([ride.pickup.lat, ride.pickup.lng])
      .addTo(map)
      .bindPopup('📍 Pickup');
  }

  // ==========================================================
  // FULL ROUTE - GREEN SOLID LINE
  // ==========================================================
  if (ride.pickup && ride.dropoff) {
    try {
      const fullRouteUrl = `https://router.project-osrm.org/route/v1/driving/${ride.pickup.lng},${ride.pickup.lat};${ride.dropoff.lng},${ride.dropoff.lat}?overview=full&geometries=geojson`;
      const fullRes = await fetch(fullRouteUrl);
      const fullData = await fullRes.json();
      if (fullData.routes && fullData.routes.length > 0) {
        const coords = fullData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        tripOverviewLine = L.polyline(coords, {
          color: '#22c55e', // GREEN
          weight: 4,
          opacity: 0.7
        }).addTo(map);
        console.log('✅ Full route drawn (GREEN solid)');
      } else {
        tripOverviewLine = L.polyline(
          [[ride.pickup.lat, ride.pickup.lng], [ride.dropoff.lat, ride.dropoff.lng]],
          { color: '#22c55e', weight: 4, opacity: 0.6 }
        ).addTo(map);
      }
    } catch (err) {
      console.warn('Error fetching full route:', err);
      tripOverviewLine = L.polyline(
        [[ride.pickup.lat, ride.pickup.lng], [ride.dropoff.lat, ride.dropoff.lng]],
        { color: '#22c55e', weight: 4, opacity: 0.6 }
      ).addTo(map);
    }
  }

  // ==========================================================
  // APPROACH ROUTE - BRIGHT GREEN / TEAL
  // ==========================================================
  if (driverLocation) {
    try {
      const route = await getRoadRoute(driverLocation, nextStop);
      if (route && route.coordinates && route.coordinates.length > 0) {
        approachLine = L.polyline(route.coordinates, {
          color: '#00d4aa', // Teal
          weight: 5,
          opacity: 0.95,
          lineJoin: 'round'
        }).addTo(map);
        
        // Glow effect
        const glowLine = L.polyline(route.coordinates, {
          color: '#00d4aa',
          weight: 12,
          opacity: 0.12,
          lineJoin: 'round'
        }).addTo(map);
        approachLine._glow = glowLine;
        
        map.fitBounds(approachLine.getBounds(), { padding: [50, 50] });
        console.log('✅ Approach route drawn (teal)');
      } else {
        approachLine = L.polyline(
          [[driverLocation.lat, driverLocation.lng], [nextStop.lat, nextStop.lng]],
          { color: '#00d4aa', weight: 4, opacity: 0.8 }
        ).addTo(map);
      }
    } catch (err) {
      console.warn('Error drawing approach route:', err);
    }
  }

  // Start animation
  const phaseKey = stage === 'to_pickup' ? 'to_pickup' : 'to_dropoff';
  const targetStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;
  
  if (targetStop) {
    startAnimation(ride, phaseKey, targetStop);
  }
}

// ===============================
// CLEANUP FUNCTION - Stop all background processes
// ===============================

let locationPushIntervalId = null;

function cleanupDriver() {
  console.log('🧹 Cleaning up driver processes...');
  
  // Clear the main polling interval
  if (locationPushIntervalId) {
    clearInterval(locationPushIntervalId);
    locationPushIntervalId = null;
  }
  
  // Clear animation
  resetAnimation();
  
  // Clear active trip
  activeTripId = null;
  
  // Cancel any pending location pushes
  lastLocationPushAt = 0;
  
  console.log('✅ Cleanup complete');
}

// ===============================
// FIXED: checkAndPushLocation - Add a guard against completed rides
// ===============================

async function checkAndPushLocation() {
  // Guard: Don't push if no location or no active trip
  if (!driverLocation || !activeTripId) {
    return;
  }
  
  // Guard: Don't push if animState is complete (ride is done)
  if (animState.completed && animState.phase === 'to_dropoff') {
    console.log('⚠️ Ride is completed, not pushing location');
    return;
  }
  
  try {
    console.log('🔍 checkAndPushLocation - Checking ride:', activeTripId);
    
    const response = await fetch(`/api/rides/${activeTripId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.warn('Failed to verify ride status:', response.status);
      return;
    }

    const ride = await response.json();

    console.log('  - Ride status:', ride.status);
    console.log('  - Ride driver:', ride.driver ? 'Set' : 'Not set');

    // ==========================================================
    // CRITICAL FIX: If ride is completed or cancelled, stop everything
    // ==========================================================
    if (ride.status === 'completed' || ride.status === 'cancelled') {
      console.log('🧹 Ride is', ride.status, '- cleaning up');
      cleanupDriver();
      loadPendingRides();
      return;
    }

    // Only push if ride is active
    if (ride.status !== 'accepted' && ride.status !== 'in_progress') {
      console.log('⚠️ Ride is not active (status:', ride.status, '), skipping');
      return;
    }

    // Check driver assignment
    if (!ride.driver) {
      console.log('⚠️ No driver assigned to this ride');
      return;
    }

    let driverId = null;
    if (typeof ride.driver === 'object' && ride.driver._id) {
      driverId = ride.driver._id.toString();
    } else if (typeof ride.driver === 'string') {
      driverId = ride.driver;
    }

    console.log('  - Driver ID from ride:', driverId);
    console.log('  - Current user ID:', currentUserId);

    if (!driverId || driverId !== currentUserId) {
      console.log('⚠️ Driver ID mismatch, skipping location push');
      return;
    }

    const now = Date.now();
    if (now - lastLocationPushAt > LOCATION_PUSH_INTERVAL_MS) {
      lastLocationPushAt = now;
      
      console.log('📍 Pushing location for ride:', activeTripId);
      
      const pushResponse = await fetch(`/api/rides/${activeTripId}/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          lat: driverLocation.lat,
          lng: driverLocation.lng
        })
      });

      if (!pushResponse.ok) {
        const errorData = await pushResponse.json().catch(() => ({}));
        console.warn('❌ Location push failed:', errorData.message || 'Unknown error');
        console.warn('❌ Status:', pushResponse.status);
        
        if (pushResponse.status === 403) {
          console.warn('⚠️ Driver not authorized for this ride, cleaning up');
          cleanupDriver();
          loadPendingRides();
        }
      } else {
        console.log('✅ Location pushed successfully for ride:', activeTripId);
      }
    }
  } catch (err) {
    console.warn('❌ Error in checkAndPushLocation:', err);
  }
}

// ===============================
// UPDATE ACTIVE TRIP UI
// ===============================

function updateActiveTripUI(ride, stage) {
  const nextStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;
  
  const distanceEl = document.getElementById('driver-distance-value');
  
  if (distanceEl && nextStop && driverLocation) {
    const distKm = haversineDistanceKm(driverLocation, nextStop);
    distanceEl.textContent = `${distKm.toFixed(1)} km`;
  }
}

// ===============================
// RENDER RIDE REQUEST CARD
// ===============================

function renderRideRequestCard(ride) {
  const pickupAddr = ride.pickup?.address || `${ride.pickup?.lat?.toFixed(4)}, ${ride.pickup?.lng?.toFixed(4)}`;
  const dropoffAddr = ride.dropoff?.address || `${ride.dropoff?.lat?.toFixed(4)}, ${ride.dropoff?.lng?.toFixed(4)}`;
  
  let distanceToPickup = 'Calculating...';
  let etaToPickup = '...';
  if (driverLocation && ride.pickup) {
    const dist = haversineDistanceKm(driverLocation, ride.pickup);
    distanceToPickup = `${dist.toFixed(1)} km`;
    etaToPickup = `${Math.round(dist / 0.5)} min`;
  }

  const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';
  const tripDuration = ride.durationMin ? `${Math.round(ride.durationMin)} min` : '--';
  const price = ride.price ? `R${ride.price.toFixed(2)}` : '--';

  let passengerName = 'Passenger';
  let passengerRating = '4.8';
  if (ride.rider && typeof ride.rider === 'object') {
    passengerName = `${ride.rider.firstName || ''} ${ride.rider.lastName || ''}`.trim() || 'Passenger';
    passengerRating = ride.rider.rating ? Number(ride.rider.rating).toFixed(1) : '4.8';
  }

  const requestTime = ride.createdAt ? new Date(ride.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

  const card = document.createElement('div');
  card.className = 'ride-request-card';

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 0.7rem;">🚗</span>
        <span style="font-weight: 700; color: var(--rb-teal); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em;">New</span>
        <span style="font-size: 0.5rem; background: rgba(0,212,170,0.12); color: var(--rb-teal); padding: 1px 6px; border-radius: 8px; font-weight: 600;">PENDING</span>
      </div>
      <span style="font-size: 0.55rem; color: var(--rb-text-muted);">${requestTime}</span>
    </div>

    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
      <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; border: 1px solid var(--rb-border-teal);">👤</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.75rem; font-weight: 600; color: var(--rb-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${passengerName}</div>
        <div style="font-size: 0.6rem; color: var(--rb-text-secondary);">⭐ ${passengerRating}</div>
      </div>
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--rb-teal);">${price}</div>
    </div>

    <div style="margin-bottom: 6px; padding: 4px 6px; background: var(--rb-surface); border-radius: 6px;">
      <div style="display: flex; align-items: center; gap: 6px; padding: 1px 0;">
        <span style="font-size: 0.6rem;">📍</span>
        <span style="font-size: 0.65rem; color: var(--rb-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pickupAddr}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; padding: 1px 0;">
        <span style="font-size: 0.6rem;">🔴</span>
        <span style="font-size: 0.65rem; color: var(--rb-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dropoffAddr}</span>
      </div>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 0; margin-bottom: 8px; border-top: 1px solid rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.04);">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 0.55rem; color: var(--rb-text-muted);">📏 ${tripDistance}</span>
        <span style="font-size: 0.55rem; color: var(--rb-text-muted);">⏱ ${tripDuration}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 4px;">
        <span style="font-size: 0.55rem; color: var(--rb-text-muted);">🛣</span>
        <span style="font-size: 0.6rem; font-weight: 600; color: var(--rb-teal);">${distanceToPickup}</span>
        <span style="font-size: 0.5rem; color: var(--rb-text-muted);">(${etaToPickup})</span>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1.5fr; gap: 5px;">
      <button class="decline-btn" data-ride-id="${ride._id}">Decline</button>
      <button class="accept-btn" data-ride-id="${ride._id}">Accept</button>
    </div>
  `;

  const acceptBtn = card.querySelector('.accept-btn');
  const declineBtn = card.querySelector('.decline-btn');

  acceptBtn.addEventListener('click', () => {
    updateRide(ride._id, 'accepted');
  });

  acceptBtn.addEventListener('mouseenter', () => {
    acceptBtn.style.background = '#00b894';
    acceptBtn.style.transform = 'scale(1.02)';
  });
  acceptBtn.addEventListener('mouseleave', () => {
    acceptBtn.style.background = 'var(--rb-teal)';
    acceptBtn.style.transform = 'scale(1)';
  });

  declineBtn.addEventListener('click', () => {
    if (confirm('Decline this ride request?')) {
      updateRide(ride._id, 'cancelled');
    }
  });

  declineBtn.addEventListener('mouseenter', () => {
    declineBtn.style.background = 'rgba(220,53,69,0.08)';
    declineBtn.style.borderColor = 'rgba(220,53,69,0.3)';
    declineBtn.style.color = '#ef7777';
  });
  declineBtn.addEventListener('mouseleave', () => {
    declineBtn.style.background = 'transparent';
    declineBtn.style.borderColor = 'rgba(220,53,69,0.15)';
    declineBtn.style.color = '#f2a3ab';
  });

  return card;
}

// ===============================
// RENDER ACTIVE TRIP SCREEN
// ===============================

function renderActiveTripScreen(ride) {
  const stage = ride.status === 'accepted' ? 'to_pickup' : 'to_dropoff';
  
  // Check if we already have this ride rendered
  const existingCard = document.querySelector('.active-trip-screen');
  const existingRideId = existingCard ? existingCard.dataset.rideId : null;
  
  if (existingRideId === ride._id && existingCard) {
    updateActiveTripUI(ride, stage);
    return;
  }

  setTimeout(() => {
    drawTripOnMap(ride, stage);
  }, 100);

  const nextStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;

  const riderName = ride.rider
    ? `${ride.rider.firstName || ''} ${ride.rider.lastName || ''}`.trim()
    : 'Rider';

  const riderPhone = ride.rider?.phone || '';

  let distanceToStop = 'Getting location...';
  if (driverLocation && nextStop) {
    const distKm = haversineDistanceKm(driverLocation, nextStop);
    distanceToStop = `${distKm.toFixed(1)} km`;
  }

  const driver = ride.driver || {};
  const vehicleDesc = [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') || 'Standard Vehicle';
  const plate = driver.licensePlate && driver.licensePlate.trim() !== '' 
    ? driver.licensePlate 
    : 'Not provided';
  const driverNameDisplay = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Your Driver';
  const driverRating = driver.rating ? Number(driver.rating).toFixed(1) : '4.8';

  const isPickupStage = stage === 'to_pickup';
  const stageEmoji = isPickupStage ? '📍' : '🔴';
  const stageLabel = isPickupStage ? 'Pickup' : 'Dropoff';
  const statusText = isPickupStage ? 'Heading to pickup' : 'Trip in progress';
  const statusColor = isPickupStage ? 'var(--rb-teal)' : '#0fbd8c';
  const statusBg = isPickupStage ? 'rgba(0,212,170,0.08)' : 'rgba(15,189,140,0.08)';

  const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';
  const price = ride.price ? `R${ride.price.toFixed(2)}` : '--';

  let actionButtons = '';
  if (isPickupStage) {
    actionButtons = `
      <button id="confirm-pickup-btn" class="confirm-pickup-btn">
        ✅ Confirm Pickup
      </button>
    `;
  } else {
    const arrived = animState.completed && animState.phase === 'to_dropoff' && animState.rideId === ride._id;
    actionButtons = `
      <button
        id="end-trip-btn"
        class="complete-btn"
        onclick="updateRide('${ride._id}', 'completed')"
        ${arrived ? '' : 'disabled'}
      >
        ${arrived ? '✅ End Trip' : '🚕 Driving to dropoff...'}
      </button>
    `;
  }

  const cardHtml = `
    <div class="active-trip-screen" data-ride-id="${ride._id}" data-stage="${stage}">
      <div style="background: ${statusBg}; border-radius: 8px; padding: 8px 14px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 0.8rem; font-weight: 600; color: ${statusColor};">${stageEmoji} ${statusText}</span>
        <span style="font-size: 0.7rem; color: var(--rb-text-muted);">
          <span id="driver-distance-value">${distanceToStop}</span> · ETA <span id="driver-eta-value">--</span>
        </span>
      </div>

      <div style="background: var(--rb-surface); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 0.7rem;">${stageEmoji}</span>
          <span style="font-size: 0.6rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 600; letter-spacing: 0.04em;">${stageLabel}</span>
          <span style="font-size: 0.75rem; color: var(--rb-text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${nextStop.address || 'Location'}</span>
        </div>
        <div style="display: flex; gap: 16px; margin-top: 4px;">
          <span style="font-size: 0.7rem; color: var(--rb-text-muted);">📏 ${tripDistance}</span>
          <span style="font-size: 0.7rem; color: var(--rb-teal); font-weight: 600;">💰 ${price}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; background: var(--rb-surface); border-radius: 8px; margin-bottom: 12px;">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">👤</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--rb-text);">${riderName}</div>
          <div style="font-size: 0.7rem; color: var(--rb-text-secondary);">⭐ ${driverRating} · ${vehicleDesc}</div>
        </div>
        <div style="font-size: 0.7rem; font-weight: 600; color: var(--rb-text-muted); letter-spacing: 0.04em; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px;">${plate}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
        ${riderPhone ? `
          <button onclick="window.location.href='tel:${riderPhone}'" style="padding: 8px; border: 1px solid var(--rb-border); border-radius: 6px; background: transparent; color: var(--rb-text); font-weight: 600; font-size: 0.7rem; cursor: pointer;">📞 Call</button>
          <button onclick="window.location.href='sms:${riderPhone}'" style="padding: 8px; border: 1px solid var(--rb-border); border-radius: 6px; background: transparent; color: var(--rb-text); font-weight: 600; font-size: 0.7rem; cursor: pointer;">💬 Message</button>
        ` : `
          <span style="color: var(--rb-text-muted); font-size: 0.7rem; text-align: center; grid-column: 1 / -1; padding: 4px;">No contact info available</span>
        `}
      </div>

      <button onclick="updateRide('${ride._id}', 'cancelled')" style="width: 100%; padding: 8px; border: 1px solid var(--rb-border-strong); border-radius: 6px; background: transparent; color: var(--rb-text-secondary); font-weight: 500; font-size: 0.7rem; cursor: pointer; margin-bottom: 6px;">
        Cancel Ride
      </button>

      ${actionButtons}
    </div>
  `;

  driverRides.innerHTML = cardHtml;

  // Start the animation
  const phaseKey = stage === 'to_pickup' ? 'to_pickup' : 'to_dropoff';
  const targetStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;
  
  if (targetStop) {
    startAnimation(ride, phaseKey, targetStop);
  }

  setTimeout(() => {
    const pickupBtn = document.getElementById('confirm-pickup-btn');
    if (pickupBtn) {
      pickupBtn.onclick = function() {
        if (currentMapRideId) {
          updateRide(currentMapRideId, 'in_progress');
        }
      };
      pickupBtn.addEventListener('mouseenter', () => {
        pickupBtn.style.background = '#00b894';
        pickupBtn.style.transform = 'scale(1.02)';
      });
      pickupBtn.addEventListener('mouseleave', () => {
        pickupBtn.style.background = 'var(--rb-teal)';
        pickupBtn.style.transform = 'scale(1)';
      });
    }
  }, 100);
}

// ===============================
// RENDER AVAILABLE RIDES LIST
// ===============================

function renderAvailableRidesList(rides) {
  const pendingRides = rides.filter(r => r.status === 'pending');

  if (pendingRides.length === 0) {
    driverRides.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 2.8rem; margin-bottom: 10px;">🚗</div>
        <h3 style="color: var(--rb-text); font-size: 0.95rem; font-weight: 600; margin-bottom: 4px;">No rides available</h3>
        <p style="color: var(--rb-text-muted); font-size: 0.8rem;">Check back later for new ride requests</p>
      </div>
    `;
    return;
  }

  driverRides.innerHTML = '';
  pendingRides.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  pendingRides.forEach(ride => {
    const card = renderRideRequestCard(ride);
    driverRides.appendChild(card);
  });
}

// ===============================
// LOAD RIDES
// ===============================

async function loadPendingRides() {
  try {
    const response = await fetch('/api/rides', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 401) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      localStorage.clear();
      window.location.href = '/login.html';
      return;
    }

    const rides = await response.json();

    // Find the ACTIVE trip (pending, accepted, or in_progress)
    const myActiveTrip = rides.find(
      r => r.status === 'accepted' || r.status === 'in_progress'
    );

    console.log('🔍 loadPendingRides:');
    console.log('  - Active trip found:', myActiveTrip ? myActiveTrip._id : 'None');
    console.log('  - Active trip status:', myActiveTrip ? myActiveTrip.status : 'None');
    console.log('  - Current activeTripId:', activeTripId);

    if (myActiveTrip) {
      // Update activeTripId
      if (activeTripId !== myActiveTrip._id) {
        console.log('  ✅ Updating activeTripId from', activeTripId, 'to', myActiveTrip._id);
        activeTripId = myActiveTrip._id;
      }
      
      const existingCard = document.querySelector('.active-trip-screen');
      const existingRideId = existingCard ? existingCard.dataset.rideId : null;
      
      if (existingRideId !== myActiveTrip._id) {
        renderActiveTripScreen(myActiveTrip);
      } else {
        const stage = myActiveTrip.status === 'accepted' ? 'to_pickup' : 'to_dropoff';
        updateActiveTripUI(myActiveTrip, stage);
        
        if (myActiveTrip.pickup && myActiveTrip.dropoff) {
          const targetStop = stage === 'to_pickup' ? myActiveTrip.pickup : myActiveTrip.dropoff;
          const phaseKey = stage === 'to_pickup' ? 'to_pickup' : 'to_dropoff';
          
          // Only start animation if not already running
          if (!animState.running || animState.rideId !== myActiveTrip._id) {
            // Clear any old animation state first
            resetAnimation();
            startAnimation(myActiveTrip, phaseKey, targetStop);
          }
        }
      }
    } else {
      console.log('  ⚠️ No active trip found - cleaning up');
      // No active trip - clean up everything
      cleanupDriver();
      renderAvailableRidesList(rides);
    }

  } catch (err) {
    console.error('Error loading rides:', err);
  }
}

async function updateRide(id, status) {
  try {
    console.log('🔍 Updating ride:', id, 'to status:', status);

    const response = await fetch(`/api/rides/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status })
    });

    if (response.status === 401) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      localStorage.clear();
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to update ride. Status: ${response.status}`);
    }

    const updatedRide = await response.json();
    console.log('🔍 Ride updated successfully:', updatedRide);

    if (status === 'completed') {
      clearTripLayers();
      activeTripId = null;
      resetAnimation();
      showToast('Trip completed! 🎉', 'success', 3000);
    } else if (status === 'in_progress') {
      showToast('Pickup confirmed! Heading to destination.', 'success', 3000);
    } else if (status === 'accepted') {
      showToast('Ride accepted! Heading to pickup.', 'success', 3000);
    } else if (status === 'cancelled') {
      showToast('Ride cancelled.', 'info', 2000);
    }

    loadPendingRides();

  } catch (err) {
    console.error('Error updating ride:', err);
    if (typeof showToast === 'function') {
      showToast(err.message, 'error', 3000);
    }
  }
}

// ===============================
// INITIALIZATION
// ===============================

watchDriverLocation();
loadPendingRides();
setInterval(loadPendingRides, 5000);