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
// DRIVER PROFILE VALIDATION
// ===============================

/**
 * Checks whether the driver has completed the required profile fields
 * (phone, vehicle make, vehicle model, vehicle color, license plate)
 * before being allowed to accept rides.
 */
function isDriverProfileComplete() {
  if (!user) return false;

  const required = [
    { key: 'phone',         label: 'Phone number' },
    { key: 'vehicleMake',   label: 'Vehicle make' },
    { key: 'vehicleModel',  label: 'Vehicle model' },
    { key: 'vehicleColor',  label: 'Vehicle color' },
    { key: 'licensePlate',  label: 'License plate' }
  ];

  const missing = required.filter(field => {
    const value = user[field.key];
    return !value || (typeof value === 'string' && value.trim() === '');
  });

  if (missing.length > 0) {
    console.warn('⚠️ Driver profile incomplete. Missing:', missing.map(f => f.label).join(', '));
    return false;
  }

  return true;
}

// Redirect driver to profile page if incomplete on page load
if (!isDriverProfileComplete()) {
  console.warn('⚠️ Driver profile incomplete — redirecting to profile page');
  showToast('Please complete your profile before accepting rides.', 'warning', 4000);
  setTimeout(() => {
    window.location.href = 'profile.html';
  }, 1200);
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
  startTime: null,
  realDurationMs: 0,
  animDurationMs: 0,
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
  if (animState.running && animState.rideId === ride._id && animState.phase === phaseKey) {
    return;
  }

  resetAnimation();

  let startPoint = animState.lastPosition;
  if (!startPoint) {
    startPoint = phaseKey === 'to_pickup'
      ? { lat: ride.pickup.lat + 0.0025, lng: ride.pickup.lng + 0.0025 }
      : { lat: ride.pickup.lat, lng: ride.pickup.lng };
  }

  if (!driverMarker) {
    driverMarker = L.marker([startPoint.lat, startPoint.lng], { icon: createCarIcon(0) })
      .addTo(map)
      .bindPopup('Driver');
  }

  const route = await fetchRouteCoords(startPoint, targetStop);
  
  const coords = route ? route.coords : [[startPoint.lat, startPoint.lng], [targetStop.lat, targetStop.lng]];
  const distanceKm = route ? route.distanceKm : haversineDistanceKm(startPoint, targetStop);

  let realDurationMs;
  if (phaseKey === 'to_dropoff' && ride.durationMin) {
    realDurationMs = ride.durationMin * 60 * 1000;
  } else if (route && route.durationSec) {
    realDurationMs = route.durationSec * 1000;
  } else {
    realDurationMs = (distanceKm / 30) * 3600 * 1000;
  }
  
  realDurationMs = Math.max(realDurationMs, 60000);

  const SPEED_MULTIPLIER = 3;
  const animDurationMs = realDurationMs / SPEED_MULTIPLIER;

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

  const elapsedRealTime = Date.now() - startTime;
  const progress = Math.min(1, elapsedRealTime / animDurationMs);

  animState.running = true;
  animState.rideId = ride._id;
  animState.phase = phaseKey;
  animState.routeCoords = coords;
  animState.startTime = startTime;
  animState.realDurationMs = realDurationMs;
  animState.animDurationMs = animDurationMs;
  animState.progress = progress;
  animState.completed = false;

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

  const pos = getPointAlongRoute(coords, progress);
  if (pos) {
    placeMarker(pos.lat, pos.lng, pos.bearingDeg);
  }

  animState.etaIntervalId = setInterval(() => {
    if (!animState.running && !animState.completed) return;
    
    const elapsedReal = Date.now() - animState.startTime;
    const realRemainingMs = Math.max(animState.realDurationMs - elapsedReal, 0);
    const minutesRemaining = Math.max(Math.ceil(realRemainingMs / 60000), 0);
    
    const etaEl = document.getElementById('driver-eta-value');
    if (etaEl) {
      etaEl.textContent = minutesRemaining <= 0 ? 'Arriving' : `${minutesRemaining} min`;
    }
    
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
    
    if (animState.completed && animState.phase === 'to_dropoff') {
      const endTripBtn = document.getElementById('end-trip-btn');
      if (endTripBtn && endTripBtn.disabled) {
        endTripBtn.disabled = false;
        endTripBtn.textContent = '✅ End Trip';
      }
    }
  }, 1000);

  const initialRealRemaining = Math.max(animState.realDurationMs, 0);
  const initialMinutes = Math.ceil(initialRealRemaining / 60000);
  const etaEl = document.getElementById('driver-eta-value');
  if (etaEl) {
    etaEl.textContent = initialMinutes <= 0 ? 'Arriving' : `${initialMinutes} min`;
  }

  function animateFrame() {
    if (!animState.running || animState.rideId !== ride._id || animState.phase !== phaseKey) {
      return;
    }

    const elapsedReal = Date.now() - animState.startTime;
    const t = Math.min(elapsedReal / animState.animDurationMs, 1);
    animState.progress = t;

    const pos = getPointAlongRoute(animState.routeCoords, t);
    
    if (pos) {
      placeMarker(pos.lat, pos.lng, pos.bearingDeg);
    }

    if (t >= 1) {
      animState.completed = true;
      animState.running = false;
      
      const last = animState.routeCoords[animState.routeCoords.length - 1];
      placeMarker(last[0], last[1], 0);
      
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

    animState.animFrameId = requestAnimationFrame(animateFrame);
  }

  animState.animFrameId = requestAnimationFrame(animateFrame);
}

// ===============================
// LIVE DRIVER LOCATION + PUSH TO SERVER
// ===============================

let activeTripId = null;
let lastLocationPushAt = 0;
const LOCATION_PUSH_INTERVAL_MS = 5000;

function watchDriverLocation() {
  if (!navigator.geolocation) {
    console.warn('⚠️ Geolocation not supported');
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const newLat = position.coords.latitude;
      const newLng = position.coords.longitude;
      
      driverLocation = { lat: newLat, lng: newLng };

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

  if (ride.pickup && ride.dropoff) {
    try {
      const fullRouteUrl = `https://router.project-osrm.org/route/v1/driving/${ride.pickup.lng},${ride.pickup.lat};${ride.dropoff.lng},${ride.dropoff.lat}?overview=full&geometries=geojson`;
      const fullRes = await fetch(fullRouteUrl);
      const fullData = await fullRes.json();
      if (fullData.routes && fullData.routes.length > 0) {
        const coords = fullData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        tripOverviewLine = L.polyline(coords, {
          color: '#22c55e',
          weight: 4,
          opacity: 0.7
        }).addTo(map);
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

  if (driverLocation) {
    try {
      const route = await getRoadRoute(driverLocation, nextStop);
      if (route && route.coordinates && route.coordinates.length > 0) {
        approachLine = L.polyline(route.coordinates, {
          color: '#00d4aa',
          weight: 5,
          opacity: 0.95,
          lineJoin: 'round'
        }).addTo(map);
        
        const glowLine = L.polyline(route.coordinates, {
          color: '#00d4aa',
          weight: 12,
          opacity: 0.12,
          lineJoin: 'round'
        }).addTo(map);
        approachLine._glow = glowLine;
        
        map.fitBounds(approachLine.getBounds(), { padding: [50, 50] });
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

  const phaseKey = stage === 'to_pickup' ? 'to_pickup' : 'to_dropoff';
  const targetStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;
  
  if (targetStop) {
    startAnimation(ride, phaseKey, targetStop);
  }
}

// ===============================
// CLEANUP FUNCTION
// ===============================

let locationPushIntervalId = null;

function cleanupDriver() {
  console.log('🧹 Cleaning up driver processes...');
  
  if (locationPushIntervalId) {
    clearInterval(locationPushIntervalId);
    locationPushIntervalId = null;
  }
  
  resetAnimation();
  activeTripId = null;
  lastLocationPushAt = 0;
}

// ===============================
// checkAndPushLocation
// ===============================

async function checkAndPushLocation() {
  if (!driverLocation || !activeTripId) {
    return;
  }
  
  try {
    const response = await fetch(`/api/rides/${activeTripId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.warn('Failed to verify ride status:', response.status);
      return;
    }

    const ride = await response.json();

    if (ride.status === 'completed' || ride.status === 'cancelled') {
      console.log('🧹 Ride is', ride.status, '- cleaning up');
      cleanupDriver();
      loadPendingRides();
      return;
    }

    if (ride.status !== 'accepted' && ride.status !== 'in_progress') {
      console.log('⚠️ Ride is not active (status:', ride.status, '), skipping');
      return;
    }

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

    if (!driverId || driverId !== currentUserId) {
      console.log('⚠️ Driver ID mismatch, skipping location push');
      return;
    }

    const now = Date.now();
    if (now - lastLocationPushAt > LOCATION_PUSH_INTERVAL_MS) {
      lastLocationPushAt = now;
      
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
        
        if (pushResponse.status === 403) {
          console.warn('⚠️ Driver not authorized for this ride, cleaning up');
          cleanupDriver();
          loadPendingRides();
        }
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
// COMPACT RIDE REQUEST CARD
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
    <div class="ride-card-header">
      <div class="ride-card-badge">
        <span class="badge-new">NEW</span>
        <span class="badge-price">${price}</span>
      </div>
      <span class="ride-card-time">${requestTime}</span>
    </div>

    <div class="ride-card-rider">
      <div class="rider-avatar-small">👤</div>
      <div class="rider-info">
        <span class="rider-name">${passengerName}</span>
        <span class="rider-rating">⭐ ${passengerRating}</span>
      </div>
      <div class="rider-distance">
        <span class="distance-value">${distanceToPickup}</span>
        <span class="eta-value">${etaToPickup}</span>
      </div>
    </div>

    <div class="ride-card-route">
      <div class="route-item pickup">
        <span class="route-icon pickup-icon">📍</span>
        <span class="route-address">${pickupAddr}</span>
      </div>
      <div class="route-connector"></div>
      <div class="route-item dropoff">
        <span class="route-icon dropoff-icon">🔴</span>
        <span class="route-address">${dropoffAddr}</span>
      </div>
    </div>

    <div class="ride-card-stats">
      <span class="stat-item">📏 ${tripDistance}</span>
      <span class="stat-item">⏱ ${tripDuration}</span>
    </div>

    <div class="ride-card-actions">
      <button class="decline-btn" data-ride-id="${ride._id}">Decline</button>
      <button class="accept-btn" data-ride-id="${ride._id}">Accept Ride</button>
    </div>
  `;

  const acceptBtn = card.querySelector('.accept-btn');
  const declineBtn = card.querySelector('.decline-btn');

  acceptBtn.addEventListener('click', () => {
    if (typeof isDriverProfileComplete === 'function' && !isDriverProfileComplete()) {
      showToast('Please complete your profile before accepting rides.', 'warning', 4000);
      setTimeout(() => window.location.href = 'profile.html', 800);
      return;
    }
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Accepting...';
    updateRide(ride._id, 'accepted');
  });

  declineBtn.addEventListener('click', () => {
    if (confirm('Decline this ride request?')) {
      updateRide(ride._id, 'cancelled');
    }
  });

  return card;
}

// ===============================
// COMPACT ACTIVE TRIP SCREEN
// ===============================

function renderActiveTripScreen(ride) {
  const stage = ride.status === 'accepted' ? 'to_pickup' : 'to_dropoff';
  
  const existingCard = document.querySelector('.active-trip-screen');
  const existingRideId = existingCard ? existingCard.dataset.rideId : null;
  const existingStage = existingCard ? existingCard.dataset.stage : null;
  
  // If same ride AND same stage, just update the UI values
  if (existingRideId === ride._id && existingStage === stage && existingCard) {
    updateActiveTripUI(ride, stage);
    return;
  }

  // If same ride but different stage (e.g. accepted → in_progress),
  // remove the old card so it gets fully re-rendered
  if (existingRideId === ride._id && existingStage !== stage && existingCard) {
    console.log('🔄 Stage changed:', existingStage, '→', stage, '— re-rendering');
    existingCard.remove();
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
      <div class="active-trip-status" style="background: ${statusBg};">
        <span style="color: ${statusColor};">${stageEmoji} ${statusText}</span>
        <span>
          <span id="driver-distance-value">${distanceToStop}</span> · ETA <span id="driver-eta-value">--</span>
        </span>
      </div>

      <div class="active-trip-route">
        <div class="route-item">
          <span class="route-icon pickup-icon">📍</span>
          <span class="route-label">${stageLabel}</span>
          <span class="route-address">${nextStop.address || 'Location'}</span>
        </div>
        <div class="active-trip-stats">
          <span>📏 ${tripDistance}</span>
          <span>💰 ${price}</span>
        </div>
      </div>

      <div class="active-trip-driver">
        <div class="driver-avatar-small">👤</div>
        <div class="driver-info">
          <span class="driver-name">${riderName}</span>
          <span class="driver-vehicle">⭐ ${driverRating} · ${vehicleDesc}</span>
        </div>
        <div class="driver-plate">${plate}</div>
      </div>

      <div class="active-trip-actions">
        ${riderPhone ? `
          <button onclick="window.location.href='tel:${riderPhone}'">📞 Call</button>
          <button onclick="window.location.href='sms:${riderPhone}'">💬 Message</button>
        ` : `
          <span class="no-contact">No contact info</span>
        `}
      </div>

      <button onclick="updateRide('${ride._id}', 'cancelled')" class="btn-cancel-ride">
        Cancel Ride
      </button>

      ${actionButtons}
    </div>
  `;

  driverRides.innerHTML = cardHtml;

  const phaseKey = stage === 'to_pickup' ? 'to_pickup' : 'to_dropoff';
  const targetStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;
  
  if (targetStop) {
    startAnimation(ride, phaseKey, targetStop);
  }

  setTimeout(() => {
    const pickupBtn = document.getElementById('confirm-pickup-btn');
    if (pickupBtn) {
      pickupBtn.onclick = function() {
        if (!currentMapRideId) {
          console.warn('⚠️ No current ride ID — cannot confirm pickup');
          showToast('Ride information missing. Please refresh.', 'error', 3000);
          return;
        }

        // Immediate visual feedback
        pickupBtn.disabled = true;
        pickupBtn.textContent = '⏳ Confirming...';

        // Clear the active trip card immediately so it re-renders on next poll
        const activeCard = document.querySelector('.active-trip-screen');
        if (activeCard) activeCard.remove();

        updateRide(currentMapRideId, 'in_progress');
      };
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
        <div class="empty-icon">🚗</div>
        <h3>No rides available</h3>
        <p>Check back later for new ride requests</p>
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
// PROFILE INCOMPLETE BANNER
// ===============================

function renderProfileIncompleteBanner() {
  const existingBanner = document.getElementById('profile-incomplete-banner');
  const profileComplete = isDriverProfileComplete();

  if (profileComplete) {
    // Remove banner if profile is now complete
    if (existingBanner) existingBanner.remove();
    return;
  }

  if (existingBanner) return; // Already showing

  const banner = document.createElement('div');
  banner.id = 'profile-incomplete-banner';
  banner.style.cssText = `
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: 480px;
    flex-wrap: wrap;
  `;

  banner.innerHTML = `
    <div style="flex: 1; min-width: 200px;">
      <div style="font-size: 0.85rem; font-weight: 700; color: #f59e0b; margin-bottom: 2px;">
        ⚠️ Profile Incomplete
      </div>
      <div style="font-size: 0.78rem; color: var(--rb-text-secondary); line-height: 1.4;">
        You must complete your phone, vehicle, and license plate details before you can accept rides.
      </div>
    </div>
    <button
      onclick="window.location.href='profile.html'"
      style="
        padding: 8px 14px;
        background: #f59e0b;
        color: #1a1a1a;
        border: none;
        border-radius: 6px;
        font-weight: 700;
        font-size: 0.75rem;
        cursor: pointer;
        white-space: nowrap;
      "
    >
      Complete Profile
    </button>
  `;

  // Insert at top of driver-content, before the map
  const driverContent = document.querySelector('.driver-content');
  const mapEl = document.getElementById('driver-map');
  if (driverContent && mapEl) {
    driverContent.insertBefore(banner, mapEl);
  } else if (driverContent) {
    driverContent.insertBefore(banner, driverContent.firstChild);
  }
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

    // Show a persistent banner if profile is incomplete
    renderProfileIncompleteBanner();

    const myActiveTrip = rides.find(
      r => r.status === 'accepted' || r.status === 'in_progress'
    );

    if (myActiveTrip) {
      if (activeTripId !== myActiveTrip._id) {
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
          
          if (!animState.running || animState.rideId !== myActiveTrip._id) {
            resetAnimation();
            startAnimation(myActiveTrip, phaseKey, targetStop);
          }
        }
      }
    } else {
      cleanupDriver();
      renderAvailableRidesList(rides);
    }

  } catch (err) {
    console.error('Error loading rides:', err);
  }
}

async function updateRide(id, status) {
  // Guard: Block 'accepted' status if profile is incomplete
  if (status === 'accepted' && typeof isDriverProfileComplete === 'function' && !isDriverProfileComplete()) {
    showToast('Please complete your profile (phone, vehicle details, number plate) before accepting rides.', 'warning', 4000);
    window.location.href = 'profile.html';
    return;
  }

  try {
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
    console.log('✅ Ride updated:', { id, status, ride: updatedRide });

    // Handle each status transition
    if (status === 'completed') {
      clearTripLayers();
      activeTripId = null;
      resetAnimation();
      showToast('Trip completed! 🎉', 'success', 3000);
      // Force immediate refresh
      await loadPendingRides();
    } else if (status === 'in_progress') {
      showToast('Pickup confirmed! Heading to destination.', 'success', 3000);

      // Force immediate refresh so UI moves from "to_pickup" → "to_dropoff"
      await loadPendingRides();

      // Extra safety: if for some reason the ride card still shows the old state,
      // force a full re-render of the active trip screen
      setTimeout(async () => {
        const existingCard = document.querySelector('.active-trip-screen');
        const currentStage = existingCard?.dataset?.stage;
        if (currentStage === 'to_pickup') {
          console.log('🔄 Force re-rendering active trip screen after in_progress transition');
          // Fetch fresh ride data and re-render
          try {
            const freshRes = await fetch(`/api/rides/${id}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (freshRes.ok) {
              const freshRide = await freshRes.json();
              if (freshRide.status === 'in_progress') {
                renderActiveTripScreen(freshRide);
              }
            }
          } catch (e) {
            console.warn('Failed to force re-render:', e);
          }
        }
      }, 500);

    } else if (status === 'accepted') {
      showToast('Ride accepted! Heading to pickup.', 'success', 3000);
      await loadPendingRides();
    } else if (status === 'cancelled') {
      showToast('Ride cancelled.', 'info', 2000);
      await loadPendingRides();
    } else {
      loadPendingRides();
    }

  } catch (err) {
    console.error('Error updating ride:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Failed to update ride. Please try again.', 'error', 3000);
    }

    // On error, force a refresh to restore the correct UI state
    setTimeout(() => loadPendingRides(), 500);
  }
}

// ===============================
// INITIALIZATION
// ===============================

watchDriverLocation();
loadPendingRides();
setInterval(loadPendingRides, 5000);