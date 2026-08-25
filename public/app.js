// ===============================
// MAP INITIALIZATION
// ===============================

const map = L.map('map').setView([-33.9608, 25.6022], 13);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);


// ===============================
// STATE & MARKERS (Declared ONCE)
// ===============================

let pickupMarker = null;
let dropoffMarker = null;

let pickupLocation = null;
let dropoffLocation = null;

let routeLine = null;
let passengerRides = [];

let activeRideId = null;
let currentDriverPhone = null;
let driverMarker = null;
let completedRideToRate = null;
let selectedRating = 5;

let currentRideEstimate = null;

// ===============================
// CAR ICON WITH ROTATION SUPPORT (RIDER VIEW)
// ===============================

function createRiderCarIcon(rotation = 0, isStale = false) {
  const opacity = isStale ? '0.45' : '1';
  const grayscale = isStale ? 'grayscale(60%)' : 'none';
  return L.divIcon({
    className: 'custom-car-icon',
    html: `<div style="
      font-size: 26px;
      transform: rotate(${rotation}deg);
      transition: transform 0.3s ease;
      filter: drop-shadow(0 2px 5px rgba(0,0,0,0.35)) ${grayscale};
      opacity: ${opacity};
    ">🚖</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

// Fallback static car icon (no rotation)
const carIcon = L.divIcon({
  className: 'custom-car-icon',
  html: '<div style="font-size: 26px; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.35));">🚖</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

// Stale car icon
const carIconStale = L.divIcon({
  className: 'custom-car-icon',
  html: '<div style="font-size: 26px; opacity: 0.45; filter: grayscale(60%);">🚖</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const DRIVER_LOCATION_STALE_MS = 20000; // 20s with no update = show as stale

// ===============================
// CAR ANIMATION STATE (RIDER VIEW)
// ===============================

let lastDriverPositionRider = null;
let animFrameIdRider = null;

// ===============================
// DOM ELEMENTS
// ===============================

const instruction = document.getElementById('instruction');

const pickupSearch = document.getElementById('pickup-search');
const dropoffSearch = document.getElementById('dropoff-search');

const pickupResults = document.getElementById('pickup-results');
const dropoffResults = document.getElementById('dropoff-results');

const useLocationBtn = document.getElementById('use-location-btn');

const fareInfo = document.getElementById('fare-info');
const fareDistance = document.getElementById('fare-distance');
const farePrice = document.getElementById('fare-price');

const rideControls = document.getElementById('ride-controls');
const requestBtn = document.getElementById('request-btn');
const resetBtn = document.getElementById('reset-btn');

const ridesList = document.getElementById('rides-list');
const rideCount = document.getElementById('ride-count');
const rideSort = document.getElementById('ride-sort');

const welcomeUser = document.getElementById('welcome-user');
const profileBtn = document.getElementById('profile-btn');
const logoutBtn = document.getElementById('logout-btn');

// Bottom Sheet / Status Card Elements
const rideStatusBackdrop = document.getElementById('ride-status-backdrop');
const rideStatusSheet = document.getElementById('ride-status-sheet');
const sheetSearching = document.getElementById('sheet-searching');
const sheetDriver = document.getElementById('sheet-driver');

const searchingEtaValue = document.getElementById('searching-eta-value');
const driverEtaValue = document.getElementById('driver-eta-value');

const driverNameEl = document.getElementById('driver-name');
const driverRatingValue = document.getElementById('driver-rating-value');
const vehicleModelEl = document.getElementById('vehicle-model');
const vehiclePlateValue = document.getElementById('vehicle-plate-value');

const cancelSearchBtn = document.getElementById('cancel-search-btn');
const cancelDriverBtn = document.getElementById('cancel-driver-btn');
const callDriverBtn = document.getElementById('call-driver-btn');
const messageDriverBtn = document.getElementById('message-driver-btn');

// Rating Modal Elements
const ratingModal = document.getElementById('rating-modal');
const ratingDriverName = document.getElementById('rating-driver-name');
const submitRatingBtn = document.getElementById('submit-rating-btn');


// ===============================
// AUTH SESSION
// ===============================

const token = sessionStorage.getItem('token');
const user = JSON.parse(sessionStorage.getItem('user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
} else if (welcomeUser) {
  welcomeUser.textContent = `Welcome, ${user.firstName}!`;
}


// ===============================
// BOOKING FORM LOCK
// ===============================

function hasActiveRide() {
  return !!activeRideId;
}

function setBookingFormEnabled(enabled) {

  if (pickupSearch) pickupSearch.disabled = !enabled;
  if (dropoffSearch) dropoffSearch.disabled = !enabled;
  if (useLocationBtn) useLocationBtn.disabled = !enabled;

  if (!enabled) {
    if (pickupResults) {
      pickupResults.innerHTML = '';
      pickupResults.style.display = 'none';
    }
    if (dropoffResults) {
      dropoffResults.innerHTML = '';
      dropoffResults.style.display = 'none';
    }
    if (rideControls) rideControls.classList.add('hidden');
    if (fareInfo) fareInfo.classList.add('hidden');
  }

}


// ===============================
// ROUTE DRAWING & PREVIEW
// ===============================

async function drawRoutePreview() {
  if (!pickupLocation || !dropoffLocation) return;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pickupLocation.lng},${pickupLocation.lat};${dropoffLocation.lng},${dropoffLocation.lat}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || data.routes.length === 0) return;

    const route = data.routes[0];
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

    if (routeLine) map.removeLayer(routeLine);

    routeLine = L.polyline(coords, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.85
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

    const distKm = route.distance / 1000;
    const durationMin = route.duration / 60;
    const estPrice = Math.max(25, Math.round(15 + (distKm * 7) + (durationMin * 1.5)));

    currentRideEstimate = {
      distanceKm: distKm,
      durationMin: durationMin,
      price: estPrice
    };

    if (fareInfo) fareInfo.classList.remove('hidden');
    if (fareDistance) fareDistance.textContent = `${distKm.toFixed(1)} km`;
    if (farePrice) farePrice.textContent = `R ${estPrice}`;
  } catch (err) {
    console.error('Error drawing preview route:', err);
  }
}


// ===============================
// LOCATION & GEOCODING
// ===============================

function getCurrentLocation() {
  if (!navigator.geolocation) {
    if (instruction) instruction.textContent = 'Geolocation is not supported by your browser.';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      pickupLocation = { lat, lng, address: 'Current Location' };

      if (pickupMarker) map.removeLayer(pickupMarker);
      pickupMarker = L.marker([lat, lng]).addTo(map).bindPopup('📍 Pickup Location').openPopup();

      map.setView([lat, lng], 14);

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        if (data && data.display_name) {
          pickupLocation.address = data.display_name;
          if (pickupSearch) pickupSearch.value = data.display_name;
        }
      } catch (e) {
        if (pickupSearch) pickupSearch.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }

      if (instruction) instruction.textContent = 'Select dropoff destination.';
      checkReadyToRequest();
    },
    (err) => {
      console.warn(err);
      if (instruction) instruction.textContent = 'Search or click on the map to set pickup.';
    }
  );
}

// Search Geocoding Autocomplete
function setupSearchInput(inputEl, resultsEl, isPickup) {
  if (!inputEl || !resultsEl) return;

  let debounceTimer;

  inputEl.addEventListener('input', () => {

    if (hasActiveRide()) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
      return;
    }

    clearTimeout(debounceTimer);
    const query = inputEl.value.trim();

    if (query.length < 3) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
        const results = await res.json();

        resultsEl.innerHTML = '';
        resultsEl.style.display = 'block';

        if (results.length === 0) {
          resultsEl.innerHTML = '<div class="result-item no-result">No locations found</div>';
          return;
        }

        results.forEach(item => {
          const div = document.createElement('div');
          div.className = 'result-item';
          div.textContent = item.display_name;
          div.addEventListener('click', () => {

            if (hasActiveRide()) return;

            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);

            inputEl.value = item.display_name;
            resultsEl.innerHTML = '';
            resultsEl.style.display = 'none';

            if (isPickup) {
              pickupLocation = { lat, lng, address: item.display_name };
              if (pickupMarker) map.removeLayer(pickupMarker);
              pickupMarker = L.marker([lat, lng]).addTo(map).bindPopup('📍 Pickup').openPopup();
            } else {
              dropoffLocation = { lat, lng, address: item.display_name };
              if (dropoffMarker) map.removeLayer(dropoffMarker);
              dropoffMarker = L.marker([lat, lng]).addTo(map).bindPopup('🔴 Dropoff').openPopup();
            }

            if (pickupLocation && dropoffLocation) {
              drawRoutePreview();
            } else {
              map.setView([lat, lng], 14);
            }

            checkReadyToRequest();
          });
          resultsEl.appendChild(div);
        });
      } catch (err) {
        console.error('Geocoding error:', err);
      }
    }, 350);
  });

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.style.display = 'none';
    }
  });
}

setupSearchInput(pickupSearch, pickupResults, true);
setupSearchInput(dropoffSearch, dropoffResults, false);


// Map Click Handler for Direct Selection
map.on('click', async (e) => {

  if (hasActiveRide()) return;

  const { lat, lng } = e.latlng;

  if (!pickupLocation) {
    pickupLocation = { lat, lng, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([lat, lng]).addTo(map).bindPopup('📍 Pickup').openPopup();
    if (pickupSearch) pickupSearch.value = pickupLocation.address;
    if (instruction) instruction.textContent = 'Now click to set dropoff destination.';
  } else if (!dropoffLocation) {
    dropoffLocation = { lat, lng, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    if (dropoffMarker) map.removeLayer(dropoffMarker);
    dropoffMarker = L.marker([lat, lng]).addTo(map).bindPopup('🔴 Dropoff').openPopup();
    if (dropoffSearch) dropoffSearch.value = dropoffLocation.address;
    drawRoutePreview();
  }

  checkReadyToRequest();
});

function checkReadyToRequest() {

  if (hasActiveRide()) {
    if (rideControls) rideControls.classList.add('hidden');
    return;
  }

  if (pickupLocation && dropoffLocation) {
    if (rideControls) rideControls.classList.remove('hidden');
    if (instruction) instruction.textContent = 'Ready to request! Click Request Ride below.';
  } else {
    if (rideControls) rideControls.classList.add('hidden');
  }
}


// ===============================
// REQUEST & RESET ACTIONS
// ===============================

if (useLocationBtn) {
  useLocationBtn.addEventListener('click', () => {
    if (hasActiveRide()) return;
    getCurrentLocation();
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {

    if (hasActiveRide()) return;

    pickupLocation = null;
    dropoffLocation = null;

    if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
    if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

    if (pickupSearch) pickupSearch.value = '';
    if (dropoffSearch) dropoffSearch.value = '';
    if (fareInfo) fareInfo.classList.add('hidden');
    if (rideControls) rideControls.classList.add('hidden');
    if (instruction) instruction.textContent = 'Search or click on the map to set pickup.';
  });
}


// ===============================
// HELPER: DRAW REAL ROAD ROUTE VIA OSRM
// ===============================

async function drawRoadRoute(pickup, dropoff) {
  if (!pickup || !dropoff) return;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) throw new Error("No route found");

    const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

    if (routeLine) map.removeLayer(routeLine);

    routeLine = L.polyline(coords, {
      color: '#00d4aa',
      weight: 5,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });
  } catch (err) {
    console.warn('OSRM routing failed, drawing fallback line:', err);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline([
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng]
    ], { color: '#00d4aa', weight: 4, dashArray: '6, 8' }).addTo(map);
  }
}

let mapInitializedForRideId = null;

function showRideStatusBackdrop() {
  if (!rideStatusBackdrop) return;
  rideStatusBackdrop.classList.remove('hidden');
  void rideStatusBackdrop.offsetWidth;
  rideStatusBackdrop.classList.add('visible');
}

function hideRideStatusBackdrop() {
  if (!rideStatusBackdrop) return;
  rideStatusBackdrop.classList.remove('visible');
  setTimeout(() => {
    rideStatusBackdrop.classList.add('hidden');
  }, 360);
}

// ===============================
// DISTANCE HELPER
// ===============================

function haversineDistanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * c;
}

// ===============================
// ROUTE FETCH HELPER (no drawing — used by both the trip-route
// line and the simulated-motion fallback below)
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
// SIMULATED MOTION FALLBACK (RIDER VIEW)
//
// Real driver GPS (ride.driverLocation) is always used when it's
// present and fresh. This only kicks in when the real feed goes
// stale/missing, so the car keeps moving smoothly toward the next
// stop instead of freezing — then hands back to real GPS the moment
// it updates again.
// ===============================

let simRideId = null;
let simPhase = null; // 'to_pickup' | 'to_dropoff'
let simRouteCoords = null;
let simStartTime = null;
let simDurationMs = null;
let simRafId = null;
let simCompletedForPhase = false;
let simClaimed = false; // true the instant a phase is claimed, even before its route fetch resolves — prevents a slow fetch from being cancelled/restarted by the next 5s poll
let simEtaIntervalId = null;

function cancelSimulatedMotion() {
  if (simRafId) {
    cancelAnimationFrame(simRafId);
    simRafId = null;
  }
  if (simEtaIntervalId) {
    clearInterval(simEtaIntervalId);
    simEtaIntervalId = null;
  }
  simRideId = null;
  simPhase = null;
  simRouteCoords = null;
  simStartTime = null;
  simDurationMs = null;
  simCompletedForPhase = false;
  simClaimed = false;
}

// Writes the current simulated (or real) minutes-remaining into
// whichever ETA element is currently in the DOM. Runs on its own
// timer so the countdown keeps ticking between the 5s polls, and
// survives the sheet's innerHTML being rebuilt each poll since it
// looks the element up fresh every tick rather than holding a
// stale reference.
function tickSimulatedEta() {
  if (!simStartTime || !simDurationMs) return;

  const elapsed = performance.now() - simStartTime;
  const remainingMs = Math.max(simDurationMs - elapsed, 0);
  const minutesRemaining = Math.max(Math.ceil(remainingMs / 60000), 0);

  const target = document.getElementById('driver-eta-value')
    || document.getElementById('searching-eta-value');

  if (target) {
    target.textContent = minutesRemaining <= 0 ? 'Arriving' : `${minutesRemaining} min`;
  }
}

// Returns { lat, lng, bearingDeg } at fraction t (0..1) along a
// multi-point route, walking real segment distances rather than
// just picking the nearest coordinate index — keeps speed constant
// even where OSRM points are unevenly spaced.
function pointAlongRoute(coords, t) {
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

// Directly places the marker (no tween of its own — used by the
// simulation's per-frame loop, which already computes the
// interpolated point itself).
function placeDriverMarkerAt(lat, lng, bearingDeg, isStale) {
  if (!driverMarker) return;
  driverMarker.setIcon(createRiderCarIcon(bearingDeg, isStale));
  driverMarker.setLatLng([lat, lng]);
  lastDriverPositionRider = { lat, lng };
}

async function startSimulatedApproach(ride, phaseKey, targetStop) {

  // Already claimed for this exact ride+phase
  if (simRideId === ride._id && simPhase === phaseKey && simClaimed) {
    return;
  }

  cancelSimulatedMotion();
  simRideId = ride._id;
  simPhase = phaseKey;
  simClaimed = true;

  // Start from wherever the car is currently displayed
  let startPoint = lastDriverPositionRider;

  if (!startPoint) {
    startPoint = phaseKey === 'to_pickup'
      ? { lat: ride.pickup.lat + 0.0025, lng: ride.pickup.lng + 0.0025 }
      : { lat: ride.pickup.lat, lng: ride.pickup.lng };
  }

  const route = await fetchRouteCoords(startPoint, targetStop);

  if (simRideId !== ride._id || simPhase !== phaseKey) return;

  const coords = route
    ? route.coords
    : [[startPoint.lat, startPoint.lng], [targetStop.lat, targetStop.lng]];

  const distanceKm = route ? route.distanceKm : haversineDistanceKm(startPoint, targetStop);

  // Determine duration
  let estimatedMs;
  if (phaseKey === 'to_dropoff' && ride.durationMin) {
    estimatedMs = ride.durationMin * 60 * 1000;
  } else if (route && route.durationSec) {
    estimatedMs = route.durationSec * 1000;
  } else {
    estimatedMs = (distanceKm / 30) * 3600 * 1000;
  }

  const SIM_SPEED_MULTIPLIER = 3; // 3x faster than real-world timing
  estimatedMs = estimatedMs / SIM_SPEED_MULTIPLIER;

  simRouteCoords = coords;
  simDurationMs = Math.max(estimatedMs, 12000); // floor lowered to match the faster pace

  // ===== USE SERVER TIMESTAMP FOR PERSISTENCE =====
  // This is the key fix: use the database timestamp so the
  // animation picks up where it left off on page reload.
  let serverTimestamp = null;
  if (phaseKey === 'to_pickup') {
    serverTimestamp = ride.acceptedAt ? new Date(ride.acceptedAt) : null;
  } else {
    serverTimestamp = ride.inProgressAt ? new Date(ride.inProgressAt) : null;
  }

  // If no server timestamp exists yet, use current time
  // (this handles the first time the phase starts)
  if (!serverTimestamp) {
    serverTimestamp = new Date();
  }

  // Use the server timestamp as the start time
  simStartTime = serverTimestamp.getTime();

  // Calculate elapsed time so far (for page reloads)
  const elapsedMs = Date.now() - simStartTime;
  const progressSoFar = Math.min(1, elapsedMs / simDurationMs);

  // If already completed, snap to end
  if (progressSoFar >= 1) {
    const last = coords[coords.length - 1];
    placeDriverMarkerAt(last[0], last[1], 0, false);
    simCompletedForPhase = true;
    simClaimed = false;
    return;
  }

  if (simEtaIntervalId) clearInterval(simEtaIntervalId);
  simEtaIntervalId = setInterval(tickSimulatedEta, 1000);
  tickSimulatedEta();

  // Apply the progress so far immediately (no jump, just resume)
  const pos = pointAlongRoute(simRouteCoords, progressSoFar);
  if (pos) {
    placeDriverMarkerAt(pos.lat, pos.lng, pos.bearingDeg, false);
  }

  function step(now) {
    if (simRideId !== ride._id || simPhase !== phaseKey) return;

    // Use the server timestamp for elapsed time
    const elapsed = now - simStartTime;
    const t = Math.min(elapsed / simDurationMs, 1);
    const pos = pointAlongRoute(simRouteCoords, t);

    if (pos) {
      placeDriverMarkerAt(pos.lat, pos.lng, pos.bearingDeg, false);
    }

    if (t < 1) {
      simRafId = requestAnimationFrame(step);
    } else {
      simRafId = null;
      simCompletedForPhase = true;
    }
  }

  simRafId = requestAnimationFrame(step);
}

// ===============================
// CAR ANIMATION FOR RIDER VIEW
// ===============================

function animateRiderCar(newLat, newLng, isStale = false) {
  if (!driverMarker) return;

  const newPos = { lat: newLat, lng: newLng };

  // If no previous position, just set it
  if (!lastDriverPositionRider) {
    const icon = createRiderCarIcon(0, isStale);
    driverMarker.setIcon(icon);
    driverMarker.setLatLng([newLat, newLng]);
    lastDriverPositionRider = newPos;
    return;
  }

  // Calculate angle for rotation
  const angle = Math.atan2(
    newLat - lastDriverPositionRider.lat,
    newLng - lastDriverPositionRider.lng
  ) * (180 / Math.PI);

  // Update icon with rotation
  const newIcon = createRiderCarIcon(angle, isStale);
  driverMarker.setIcon(newIcon);

  // Animate position
  const startLat = lastDriverPositionRider.lat;
  const startLng = lastDriverPositionRider.lng;
  const endLat = newLat;
  const endLng = newLng;
  const duration = 2000;
  const startTime = Date.now();

  if (animFrameIdRider) {
    cancelAnimationFrame(animFrameIdRider);
    animFrameIdRider = null;
  }

  function animateStep() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const eased = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const currentLat = startLat + (endLat - startLat) * eased;
    const currentLng = startLng + (endLng - startLng) * eased;

    driverMarker.setLatLng([currentLat, currentLng]);

    if (progress < 1) {
      animFrameIdRider = requestAnimationFrame(animateStep);
    } else {
      driverMarker.setLatLng([endLat, endLng]);
      lastDriverPositionRider = newPos;
      animFrameIdRider = null;
    }
  }

  animateStep();
}

// ===============================
// UPDATE DRIVER STATE DISPLAY
// ===============================

function updateDriverStateDisplay(ride, state) {
  const statusText = document.getElementById('driver-status-text');
  if (!statusText) return;

  if (state === 'accepted') {
    statusText.textContent = '🚗 Driver is on the way to your pickup location';
    statusText.style.color = 'var(--rb-teal)';
    statusText.style.background = 'rgba(0, 212, 170, 0.06)';
    statusText.style.borderRadius = '8px';
    statusText.style.padding = '8px 12px';
    statusText.style.textAlign = 'center';
  } else if (state === 'in_progress') {
    statusText.textContent = '🚕 Trip in progress - heading to destination';
    statusText.style.color = '#0fbd8c';
    statusText.style.background = 'rgba(15, 189, 140, 0.06)';
    statusText.style.borderRadius = '8px';
    statusText.style.padding = '8px 12px';
    statusText.style.textAlign = 'center';
  }
}

// ===============================
// UPDATE DRIVER MARKER WITH ANIMATION
// ===============================

function updateDriverMarker(ride, driver, isDriverPopulated) {
  if (!ride.pickup) return;

  const phaseKey = ride.status === 'in_progress' ? 'to_dropoff' : 'to_pickup';
  const targetStop = phaseKey === 'to_dropoff' ? ride.dropoff : ride.pickup;

  // A phase change (accepted -> in_progress) or a different ride
  // means any in-flight simulation for the old phase no longer
  // applies — real GPS or a fresh simulation will take over below.
  if (simRideId && (simRideId !== ride._id || simPhase !== phaseKey)) {
    cancelSimulatedMotion();
  }

  const hasLiveLoc = !!(ride.driverLocation && ride.driverLocation.lat != null);

  let isStale = false;
  if (hasLiveLoc && ride.driverLocation.updatedAt) {
    const ageMs = Date.now() - new Date(ride.driverLocation.updatedAt).getTime();
    isStale = ageMs > DRIVER_LOCATION_STALE_MS;
  }

  const driverNameForPopup = isDriverPopulated ? (driver.firstName || 'Driver') : 'Driver';

  // ---- Fresh real GPS available: use it, and stop any simulation ----
  if (hasLiveLoc && !isStale) {

    cancelSimulatedMotion();

    const newLat = ride.driverLocation.lat;
    const newLng = ride.driverLocation.lng;

    if (!driverMarker) {
      driverMarker = L.marker([newLat, newLng], {
        icon: createRiderCarIcon(0, false)
      }).addTo(map);
      driverMarker.bindPopup(`<b>${driverNameForPopup}</b> is on the way!`);
      lastDriverPositionRider = { lat: newLat, lng: newLng };
    } else {
      animateRiderCar(newLat, newLng, false);
    }

    return;
  }

  // ---- No fresh real GPS: fall back to simulated motion along the
  // road route toward the current phase's target stop ----

  if (!driverMarker) {
    const startLoc = { lat: ride.pickup.lat + 0.0025, lng: ride.pickup.lng + 0.0025 };
    driverMarker = L.marker([startLoc.lat, startLoc.lng], {
      icon: createRiderCarIcon(0, false)
    }).addTo(map);
    driverMarker.bindPopup(`<b>${driverNameForPopup}</b> is on the way!`);
    lastDriverPositionRider = { lat: startLoc.lat, lng: startLoc.lng };
  }

  if (targetStop) {
    startSimulatedApproach(ride, phaseKey, targetStop);
  }

  // If we DO have a real location but it's just stale (not fully
  // absent), let the rider know without freezing the marker — the
  // simulation above keeps it moving in the meantime.
  if (hasLiveLoc && isStale) {
    driverMarker.bindPopup(
      `<b>${driverNameForPopup}</b><br><small>Live location hasn't updated recently — showing estimated position.</small>`
    );
  }
}

// ===============================
// ACTIVE STATUS FLOW
// ===============================

function startRideStatusFlow(ride) {
  if (!ride) return;
  activeRideId = ride._id;

  setBookingFormEnabled(false);

  const sheet = document.getElementById('ride-status-sheet');
  const searchingState = document.getElementById('sheet-searching');
  const driverState = document.getElementById('sheet-driver');

  if (sheet) {
    sheet.classList.remove('hidden');
    sheet.style.display = 'block';
    void sheet.offsetWidth;
    sheet.classList.add('visible');
  }

  if (ride.pickup && ride.dropoff && mapInitializedForRideId !== ride._id) {
    mapInitializedForRideId = ride._id;

    if (typeof drawRoadRoute === 'function') {
      drawRoadRoute(ride.pickup, ride.dropoff);
    }

    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([ride.pickup.lat, ride.pickup.lng]).addTo(map).bindPopup('📍 Pickup');

    if (dropoffMarker) map.removeLayer(dropoffMarker);
    dropoffMarker = L.marker([ride.dropoff.lat, ride.dropoff.lng]).addTo(map).bindPopup('🔴 Dropoff');
  }

  // ==========================================================
  // STATE 1: PENDING - Searching for driver
  // ==========================================================
  if (ride.status === 'pending') {
    showRideStatusBackdrop();

    if (searchingState) {
      searchingState.classList.remove('hidden');
      searchingState.style.display = 'flex';
    }
    if (driverState) {
      driverState.classList.add('hidden');
      driverState.style.display = 'none';
    }

    const pickupAddr = ride.pickup?.address || 'Pickup location';
    const dropoffAddr = ride.dropoff?.address || 'Dropoff location';
    const fareDisplay = ride.price ? `R${ride.price}` : '--';
    const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';

    const searchingContent = document.querySelector('#sheet-searching .sheet-content') || document.querySelector('#sheet-searching');
    if (searchingContent) {
      searchingContent.innerHTML = `
        <div style="text-align: center; padding: 8px 0 4px;">
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 16px;">
            <div style="position: absolute; inset: 0; border: 3px solid rgba(0,212,170,0.12); border-top-color: var(--rb-teal); border-radius: 50%; animation: spinnerSpin 0.9s linear infinite;"></div>
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 28px;">🚗</div>
          </div>
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--rb-text); margin-bottom: 4px;">Finding your ride</h3>
          <p style="font-size: 0.85rem; color: var(--rb-text-muted); margin-bottom: 12px;">Connecting you with a nearby driver</p>
        </div>

        <div style="background: var(--rb-surface); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 10px; padding: 4px 0;">
            <span style="font-size: 1rem;">📍</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 700; letter-spacing: 0.04em;">Pickup</div>
              <div style="font-size: 0.85rem; font-weight: 500; color: var(--rb-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pickupAddr}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; padding: 4px 0;">
            <span style="font-size: 1rem;">🔴</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 700; letter-spacing: 0.04em;">Dropoff</div>
              <div style="font-size: 0.85rem; font-weight: 500; color: var(--rb-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dropoffAddr}</div>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;">
          <div style="background: var(--rb-surface); border-radius: 8px; padding: 8px 12px; text-align: center;">
            <div style="font-size: 0.55rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 600; letter-spacing: 0.04em;">Distance</div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--rb-text);">${tripDistance}</div>
          </div>
          <div style="background: var(--rb-surface); border-radius: 8px; padding: 8px 12px; text-align: center;">
            <div style="font-size: 0.55rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 600; letter-spacing: 0.04em;">Fare</div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--rb-teal);">${fareDisplay}</div>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 12px;">
          <span style="font-size: 0.75rem; color: var(--rb-text-muted);">⏱ Estimated wait:</span>
          <span style="font-size: 0.85rem; font-weight: 600; color: var(--rb-teal);" id="searching-eta-value">2-4 min</span>
        </div>

        <button id="cancel-search-btn" class="btn-cancel-ride" style="width: 100%; padding: 12px; border: 1px solid rgba(220,53,69,0.25); border-radius: 8px; background: transparent; color: var(--rb-danger); font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;">
          Cancel Ride
        </button>
      `;
    }

    const newCancelBtn = document.getElementById('cancel-search-btn');
    if (newCancelBtn) {
      newCancelBtn.addEventListener('click', handleCancelRide);
    }

    if (driverMarker) {
      map.removeLayer(driverMarker);
      driverMarker = null;
      lastDriverPositionRider = null;
    }
    cancelSimulatedMotion();
  }

  // ==========================================================
  // STATE 2: ACCEPTED - Driver assigned, en route to pickup
  // ==========================================================
  else if (ride.status === 'accepted') {
    hideRideStatusBackdrop();

    if (searchingState) {
      searchingState.classList.add('hidden');
      searchingState.style.display = 'none';
    }
    if (driverState) {
      driverState.classList.remove('hidden');
      driverState.style.display = 'flex';
    }

    const driver = ride.driver || {};
    const isDriverPopulated = driver && typeof driver === 'object' && 'firstName' in driver;
    currentDriverPhone = (isDriverPopulated && driver.phone) ? driver.phone : null;

    let distanceToPickup = 'Calculating...';
    let etaMinutes = '...';
    // Prefer real GPS; fall back to the simulated marker's current
    // position so the numbers shown here stay consistent with
    // whatever the car is actually doing on the map.
    const posForEta = (ride.driverLocation && ride.driverLocation.lat != null)
      ? { lat: ride.driverLocation.lat, lng: ride.driverLocation.lng }
      : lastDriverPositionRider;

    if (posForEta && ride.pickup) {
      const distKm = haversineDistanceKm(posForEta, ride.pickup);
      distanceToPickup = `${distKm.toFixed(1)} km`;
      etaMinutes = `${Math.round(distKm / 0.5)} min`;
    }

    const pickupAddr = ride.pickup?.address || 'Pickup location';
    const dropoffAddr = ride.dropoff?.address || 'Dropoff location';
    const fareDisplay = ride.price ? `R${ride.price}` : '--';
    const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';

    const driverName = isDriverPopulated ? `${driver.firstName || ''} ${driver.lastName || ''}`.trim() : 'Loading driver...';
    const driverRating = isDriverPopulated ? (driver.rating ? Number(driver.rating).toFixed(1) : '4.8') : '--';
    const vehicleDesc = isDriverPopulated ? [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') : 'Loading vehicle...';
    const plate = isDriverPopulated ? (driver.licensePlate || 'NO PLATE') : '--';

    const driverContent = document.querySelector('#sheet-driver .sheet-content') || document.querySelector('#sheet-driver');
    if (driverContent) {
      driverContent.innerHTML = `
        <!-- ETA Banner -->
        <div style="background: rgba(0,212,170,0.08); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; text-align: center;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <span style="font-size: 0.85rem; font-weight: 600; color: var(--rb-teal);">🚗 ${distanceToPickup}</span>
            <span style="width: 4px; height: 4px; background: var(--rb-text-muted); border-radius: 50%;"></span>
            <span style="font-size: 0.85rem; color: var(--rb-text-secondary);">ETA <strong style="color: var(--rb-teal);">${etaMinutes}</strong></span>
            <span style="width: 4px; height: 4px; background: var(--rb-text-muted); border-radius: 50%;"></span>
            <span style="font-size: 0.8rem; color: var(--rb-text-muted);">💰 ${fareDisplay}</span>
          </div>
          <div style="font-size: 0.7rem; color: var(--rb-text-muted); margin-top: 4px;">
            📍 ${pickupAddr} → 🔴 ${dropoffAddr} · 📏 ${tripDistance}
          </div>
        </div>

        <!-- Status Text -->
        <div id="driver-status-text" style="text-align: center; font-size: 0.85rem; font-weight: 500; color: var(--rb-teal); padding: 6px 0 10px; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 12px;">
          🚗 Driver is on the way to your pickup
        </div>

        <!-- Driver Profile -->
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 12px;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; border: 2px solid var(--rb-border-teal);">👤</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 1rem; font-weight: 700; color: var(--rb-text);">${driverName}</div>
            <div style="font-size: 0.8rem; color: var(--rb-text-secondary);">⭐ ${driverRating} · ${vehicleDesc}</div>
          </div>
        </div>

        <!-- Vehicle Plate -->
        <div style="background: var(--rb-surface); border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.75rem; color: var(--rb-text-muted);">🚘 Number Plate</span>
          <span style="font-size: 0.85rem; font-weight: 700; color: var(--rb-text); letter-spacing: 0.06em; background: rgba(255,255,255,0.05); padding: 2px 12px; border-radius: 4px;">${plate}</span>
        </div>

        <!-- Actions -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
          <button id="call-driver-btn" class="btn-driver-action" style="padding: 10px; border: 1px solid var(--rb-border); border-radius: 8px; background: transparent; color: var(--rb-text); font-weight: 600; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">📞 Call</button>
          <button id="message-driver-btn" class="btn-driver-action" style="padding: 10px; border: 1px solid var(--rb-border); border-radius: 8px; background: transparent; color: var(--rb-text); font-weight: 600; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">💬 Message</button>
        </div>

        <!-- Cancel Button -->
        <button id="cancel-driver-btn" class="btn-cancel-ride-secondary" style="width: 100%; padding: 10px; border: 1px solid var(--rb-border-strong); border-radius: 8px; background: transparent; color: var(--rb-text-secondary); font-weight: 500; font-size: 0.82rem; cursor: pointer; transition: all 0.2s; margin-bottom: 8px;">
          Cancel Ride
        </button>

        <!-- Action Container (hidden for accepted) -->
        <div class="action-container" style="display: none;"></div>
      `;
    }

    const newCallBtn = document.getElementById('call-driver-btn');
    if (newCallBtn) {
      newCallBtn.addEventListener('click', () => {
        if (currentDriverPhone) {
          window.location.href = `tel:${currentDriverPhone}`;
        } else {
          showToast('Driver phone number not provided.', 'info', 3000);
        }
      });
    }

    const newMessageBtn = document.getElementById('message-driver-btn');
    if (newMessageBtn) {
      newMessageBtn.addEventListener('click', () => {
        if (currentDriverPhone) {
          window.location.href = `sms:${currentDriverPhone}`;
        } else {
          showToast('Driver contact not available for messaging.', 'info', 3000);
        }
      });
    }

    const newCancelBtn = document.getElementById('cancel-driver-btn');
    if (newCancelBtn) {
      newCancelBtn.addEventListener('click', handleCancelRide);
    }

    // Show driver marker with animation
    updateDriverMarker(ride, driver, isDriverPopulated);
  }

  // ==========================================================
  // STATE 3: IN_PROGRESS - Trip started, heading to destination
  // ==========================================================
  else if (ride.status === 'in_progress') {
    hideRideStatusBackdrop();

    if (searchingState) {
      searchingState.classList.add('hidden');
      searchingState.style.display = 'none';
    }
    if (driverState) {
      driverState.classList.remove('hidden');
      driverState.style.display = 'flex';
    }

    const driver = ride.driver || {};
    const isDriverPopulated = driver && typeof driver === 'object' && 'firstName' in driver;
    currentDriverPhone = (isDriverPopulated && driver.phone) ? driver.phone : null;

    let distanceToDest = 'Calculating...';
    let progressPercent = 0;
    // Prefer real GPS; fall back to the simulated marker's current
    // position, same reasoning as the pickup-stage ETA above.
    const posForProgress = (ride.driverLocation && ride.driverLocation.lat != null)
      ? { lat: ride.driverLocation.lat, lng: ride.driverLocation.lng }
      : lastDriverPositionRider;

    if (posForProgress && ride.pickup && ride.dropoff) {
      const totalDist = ride.distanceKm || 1;
      const remainingDist = haversineDistanceKm(posForProgress, ride.dropoff);
      distanceToDest = `${remainingDist.toFixed(1)} km`;
      progressPercent = Math.min(100, Math.max(0, ((totalDist - remainingDist) / totalDist) * 100));
    } else if (ride.dropoff) {
      if (ride.distanceKm) {
        distanceToDest = `${ride.distanceKm.toFixed(1)} km`;
      } else {
        distanceToDest = 'Calculating...';
      }
    }

    const pickupAddr = ride.pickup?.address || 'Pickup location';
    const dropoffAddr = ride.dropoff?.address || 'Dropoff location';
    const fareDisplay = ride.price ? `R${ride.price}` : '--';
    const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';

    const driverName = isDriverPopulated ? `${driver.firstName || ''} ${driver.lastName || ''}`.trim() : 'Your Driver';
    const driverRating = isDriverPopulated ? (driver.rating ? Number(driver.rating).toFixed(1) : '4.8') : '4.8';
    const vehicleDesc = isDriverPopulated ? [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') : 'Standard Vehicle';
    const plate = isDriverPopulated ? (driver.licensePlate || 'NO PLATE') : 'NO PLATE';

    const driverContent = document.querySelector('#sheet-driver .sheet-content') || document.querySelector('#sheet-driver');
    if (driverContent) {
      driverContent.innerHTML = `
        <!-- Trip Progress Banner -->
        <div style="background: rgba(15,189,140,0.08); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-size: 0.85rem; font-weight: 600; color: #0fbd8c;">🚕 Trip in Progress</span>
            <span style="font-size: 0.85rem; font-weight: 600; color: var(--rb-text);">${distanceToDest} to destination</span>
          </div>
          <!-- Progress Bar -->
          <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden;">
            <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #0fbd8c, var(--rb-teal)); border-radius: 2px; transition: width 1s ease;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 4px;">
            <span style="font-size: 0.6rem; color: var(--rb-text-muted);">📍 ${pickupAddr}</span>
            <span style="font-size: 0.6rem; color: var(--rb-text-muted);">🔴 ${dropoffAddr}</span>
          </div>
        </div>

        <!-- Trip Stats -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 12px;">
          <div style="background: var(--rb-surface); border-radius: 8px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 0.5rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 600; letter-spacing: 0.04em;">Distance</div>
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--rb-text);">${tripDistance}</div>
          </div>
          <div style="background: var(--rb-surface); border-radius: 8px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 0.5rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 600; letter-spacing: 0.04em;">Fare</div>
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--rb-teal);">${fareDisplay}</div>
          </div>
          <div style="background: var(--rb-surface); border-radius: 8px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 0.5rem; text-transform: uppercase; color: var(--rb-text-muted); font-weight: 600; letter-spacing: 0.04em;">Status</div>
            <div style="font-size: 0.75rem; font-weight: 600; color: #0fbd8c;">En Route</div>
          </div>
        </div>

        <!-- Status Text -->
        <div id="driver-status-text" style="text-align: center; font-size: 0.85rem; font-weight: 500; color: #0fbd8c; padding: 6px 0 10px; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 12px;">
          🚕 Heading to your destination
        </div>

        <!-- Driver Profile -->
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 12px;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; border: 2px solid var(--rb-border-teal);">👤</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 1rem; font-weight: 700; color: var(--rb-text);">${driverName}</div>
            <div style="font-size: 0.8rem; color: var(--rb-text-secondary);">⭐ ${driverRating} · ${vehicleDesc}</div>
          </div>
        </div>

        <!-- Vehicle Plate -->
        <div style="background: var(--rb-surface); border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.75rem; color: var(--rb-text-muted);">🚘 Number Plate</span>
          <span style="font-size: 0.85rem; font-weight: 700; color: var(--rb-text); letter-spacing: 0.06em; background: rgba(255,255,255,0.05); padding: 2px 12px; border-radius: 4px;">${plate}</span>
        </div>

        <!-- Actions -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
          <button id="call-driver-btn" class="btn-driver-action" style="padding: 10px; border: 1px solid var(--rb-border); border-radius: 8px; background: transparent; color: var(--rb-text); font-weight: 600; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">📞 Call</button>
          <button id="message-driver-btn" class="btn-driver-action" style="padding: 10px; border: 1px solid var(--rb-border); border-radius: 8px; background: transparent; color: var(--rb-text); font-weight: 600; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">💬 Message</button>
        </div>

        <!-- Cancel Button -->
        <button id="cancel-driver-btn" class="btn-cancel-ride-secondary" style="width: 100%; padding: 10px; border: 1px solid var(--rb-border-strong); border-radius: 8px; background: transparent; color: var(--rb-text-secondary); font-weight: 500; font-size: 0.82rem; cursor: pointer; transition: all 0.2s; margin-bottom: 8px;">
          Cancel Ride
        </button>

        <!-- End Trip Button -->
        <button id="end-trip-btn" class="complete-btn" style="width: 100%; padding: 12px; background: #0fbd8c; color: #06231b; border: none; border-radius: 8px; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: all 0.2s;">
          ✅ End Trip
        </button>
      `;
    }

    const newCallBtn = document.getElementById('call-driver-btn');
    if (newCallBtn) {
      newCallBtn.addEventListener('click', () => {
        if (currentDriverPhone) {
          window.location.href = `tel:${currentDriverPhone}`;
        } else {
          showToast('Driver phone number not provided.', 'info', 3000);
        }
      });
    }

    const newMessageBtn = document.getElementById('message-driver-btn');
    if (newMessageBtn) {
      newMessageBtn.addEventListener('click', () => {
        if (currentDriverPhone) {
          window.location.href = `sms:${currentDriverPhone}`;
        } else {
          showToast('Driver contact not available for messaging.', 'info', 3000);
        }
      });
    }

    const newCancelBtn = document.getElementById('cancel-driver-btn');
    if (newCancelBtn) {
      newCancelBtn.addEventListener('click', handleCancelRide);
    }

    const endTripBtn = document.getElementById('end-trip-btn');
    if (endTripBtn) {
      endTripBtn.addEventListener('click', () => {

        // Soft check only — never a hard block. If the car (real or
        // simulated) still looks meaningfully far from the dropoff,
        // ask for confirmation instead of silently allowing it, but
        // always let it proceed either way (GPS gaps, early drop-offs,
        // and rider requests are normal and shouldn't be locked out).
        const currentPos = lastDriverPositionRider;
        const farFromDropoff = currentPos && ride.dropoff
          ? haversineDistanceKm(currentPos, ride.dropoff) > 0.3
          : false;

        if (farFromDropoff) {
          const confirmed = confirm(
            "It looks like you're still some distance from the dropoff. End the trip anyway?"
          );
          if (!confirmed) return;
        }

        updateRideFromRider(ride._id, 'completed');
      });
    }

    // Update driver marker with animation
    updateDriverMarker(ride, driver, isDriverPopulated);

    if (routeLine && ride.pickup && ride.dropoff) {
      map.removeLayer(routeLine);
      drawRoadRoute(ride.pickup, ride.dropoff);
    }
  }

  // ==========================================================
  // STATE 4: COMPLETED
  // ==========================================================
  else if (ride.status === 'completed') {
    dismissActiveRideUI();
    activeRideId = null;
    showRatingModal(ride);
    loadRides();
  }

  // ==========================================================
  // STATE 5: CANCELLED
  // ==========================================================
  else if (ride.status === 'cancelled') {
    dismissActiveRideUI();
    activeRideId = null;
    if (typeof showToast === 'function') {
      showToast('Ride cancelled.', 'info', 3000);
    }
    loadRides();
  }
}

// ==========================================================
// UPDATE RIDE FROM RIDER
// ==========================================================

async function updateRideFromRider(id, status) {
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
      sessionStorage.clear();
      window.location.href = 'login.html';
      return;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to update ride. Status: ${response.status}`);
    }

    if (status === 'completed') {
      if (typeof showToast === 'function') {
        showToast('Trip completed! 🎉', 'success', 3000);
      }
      loadRides();
    }
  } catch (err) {
    console.error('Error updating ride:', err);
    if (typeof showToast === 'function') {
      showToast(err.message, 'error', 3000);
    }
  }
}

// ===============================
// DISMISS ACTIVE RIDE UI
// ===============================

function dismissActiveRideUI() {
  const sheet = document.getElementById('ride-status-sheet');

  if (sheet) {
    sheet.classList.remove('visible');
  }
  if (rideStatusBackdrop) {
    rideStatusBackdrop.classList.remove('visible');
  }

  setTimeout(() => {
    if (sheet) {
      sheet.classList.add('hidden');
      sheet.style.display = 'none';
    }
    if (rideStatusBackdrop) {
      rideStatusBackdrop.classList.add('hidden');
    }
  }, 360);

  if (driverMarker) {
    map.removeLayer(driverMarker);
    driverMarker = null;
    lastDriverPositionRider = null;
  }
  cancelSimulatedMotion();

  setBookingFormEnabled(true);
}

// ===============================
// REQUEST BUTTON HANDLER
// ===============================

if (requestBtn) {
  requestBtn.addEventListener('click', async () => {

    if (hasActiveRide()) {
      if (typeof showToast === 'function') {
        showToast('You already have an active ride.', 'warning', 3000);
      }
      return;
    }

    if (!pickupLocation || !dropoffLocation) {
      if (typeof showToast === 'function') {
        showToast('Please set pickup and dropoff first.', 'warning', 3000);
      }
      return;
    }

    requestBtn.disabled = true;
    requestBtn.textContent = 'Requesting...';

    try {
      const res = await fetch('/api/rides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pickup: pickupLocation,
          dropoff: dropoffLocation,
          distanceKm: currentRideEstimate?.distanceKm ?? null,
          durationMin: currentRideEstimate?.durationMin ?? null,
          price: currentRideEstimate?.price ?? null
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Could not request ride');
      }

      if (typeof showToast === 'function') {
        showToast('Ride requested! Finding nearby driver...', 'success', 3000);
      }

      if (rideControls) rideControls.classList.add('hidden');
      if (fareInfo) fareInfo.classList.add('hidden');

      startRideStatusFlow(data);

      loadRides();
    } catch (err) {
      console.error('Request ride error:', err);
      if (typeof showToast === 'function') {
        showToast(err.message, 'error', 3000);
      }
    } finally {
      requestBtn.disabled = false;
      requestBtn.textContent = 'Request Ride';
    }
  });
}

// ===============================
// CANCEL & COMMUNICATION ACTIONS
// ===============================

async function handleCancelRide() {
  if (!activeRideId) return;

  const confirmed = confirm('Are you sure you want to cancel this ride?');
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/rides/${activeRideId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'cancelled' })
    });

    if (res.ok) {
      if (typeof showToast === 'function') showToast('Ride cancelled.', 'info', 3000);
      dismissActiveRideUI();
      activeRideId = null;
      loadRides();
    }
  } catch (err) {
    console.error('Error cancelling ride:', err);
  }
}

if (cancelSearchBtn) cancelSearchBtn.addEventListener('click', handleCancelRide);
if (cancelDriverBtn) cancelDriverBtn.addEventListener('click', handleCancelRide);

if (callDriverBtn) {
  callDriverBtn.addEventListener('click', () => {
    if (currentDriverPhone) {
      window.location.href = `tel:${currentDriverPhone}`;
    } else {
      if (typeof showToast === 'function') showToast('Driver phone number not provided.', 'info', 3000);
    }
  });
}

if (messageDriverBtn) {
  messageDriverBtn.addEventListener('click', () => {
    if (currentDriverPhone) {
      window.location.href = `sms:${currentDriverPhone}`;
    } else {
      if (typeof showToast === 'function') showToast('Driver contact not available for messaging.', 'info', 3000);
    }
  });
}


// ===============================
// RATING MODAL & SUBMIT
// ===============================

function getRatedRideIds() {
  try {
    return JSON.parse(sessionStorage.getItem('ratedRides') || '[]');
  } catch (e) {
    return [];
  }
}

function markRideAsRated(id) {
  if (!id) return;
  const rated = getRatedRideIds();
  if (!rated.includes(id)) {
    rated.push(id);
    sessionStorage.setItem('ratedRides', JSON.stringify(rated));
  }
}

document.querySelectorAll('#star-rating .star').forEach(star => {
  star.addEventListener('click', (e) => {
    selectedRating = Number(e.target.getAttribute('data-val') || 5);
    document.querySelectorAll('#star-rating .star').forEach(s => {
      const val = Number(s.getAttribute('data-val') || 0);
      s.classList.toggle('active', val <= selectedRating);
    });
  });
});

function showRatingModal(ride) {
  if (!ride || getRatedRideIds().includes(ride._id)) return;

  completedRideToRate = ride;

  const ratingDriverNameEl = document.getElementById('rating-driver-name');
  if (ratingDriverNameEl) {
    if (ride.driver && typeof ride.driver === 'object') {
      ratingDriverNameEl.textContent = `${ride.driver.firstName || ''} ${ride.driver.lastName || ''}`.trim() || 'your driver';
    } else {
      ratingDriverNameEl.textContent = 'your driver';
    }
  }

  const ratingModalEl = document.getElementById('rating-modal');
  if (ratingModalEl) {
    ratingModalEl.classList.remove('hidden');
  }
}

function resetAppToInitialState() {
  const ratingModalEl = document.getElementById('rating-modal');
  if (ratingModalEl) ratingModalEl.classList.add('hidden');
  dismissActiveRideUI();

  if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
  if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
  lastDriverPositionRider = null;
  cancelSimulatedMotion();

  pickupLocation = null;
  dropoffLocation = null;
  activeRideId = null;
  completedRideToRate = null;
  currentRideEstimate = null;

  if (pickupSearch) pickupSearch.value = '';
  if (dropoffSearch) dropoffSearch.value = '';
  if (fareInfo) fareInfo.classList.add('hidden');
  if (rideControls) rideControls.classList.add('hidden');
  if (instruction) instruction.textContent = 'Search or click on the map to set pickup.';

  getCurrentLocation();
}

if (submitRatingBtn) {
  submitRatingBtn.onclick = async function (e) {
    e.preventDefault();
    submitRatingBtn.disabled = true;
    submitRatingBtn.textContent = 'Submitting...';

    let targetRideId = completedRideToRate?._id || activeRideId;
    if (!targetRideId && Array.isArray(passengerRides)) {
      const lastCompleted = passengerRides.find(r => r.status === 'completed');
      if (lastCompleted) targetRideId = lastCompleted._id;
    }

    const ratingModalEl = document.getElementById('rating-modal');
    if (ratingModalEl) ratingModalEl.classList.add('hidden');

    if (targetRideId && token) {
      markRideAsRated(targetRideId);
      try {
        await fetch(`/api/rides/${targetRideId}/rate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ rating: selectedRating })
        });
      } catch (err) {
        console.warn('Rating submission error:', err);
      }
    }

    submitRatingBtn.disabled = false;
    submitRatingBtn.textContent = 'Submit Rating';

    if (typeof showToast === 'function') {
      showToast('Thank you for your rating! ⭐', 'success', 3000);
    }

    resetAppToInitialState();
    loadRides();
  };
}

// Run in rider console
fetch('/api/rides', {
  headers: { 'Authorization': `Bearer ${sessionStorage.getItem('token')}` }
})
.then(res => res.json())
.then(rides => {
  const active = rides.find(r => r.status === 'accepted' || r.status === 'in_progress');
  if (active) {
    console.log('📍 Active ride:', active._id);
    console.log('📍 Driver location:', active.driverLocation);
    console.log('📍 Status:', active.status);
  }
})

// ===============================
// RIDE LIST RENDERING
// ===============================

function renderRideList(rides) {
  if (!ridesList) return;

  ridesList.innerHTML = '';

  if (rideCount) {
    rideCount.textContent = `${rides.length} ride${rides.length === 1 ? '' : 's'}`;
  }

  if (rides.length === 0) {
    ridesList.innerHTML = '<li class="no-rides">No rides match this filter.</li>';
    return;
  }

  rides.forEach(ride => {
    const li = document.createElement('li');

    const pickupAddr = ride.pickup?.address || `${ride.pickup?.lat?.toFixed(4)}, ${ride.pickup?.lng?.toFixed(4)}`;
    const dropoffAddr = ride.dropoff?.address || `${ride.dropoff?.lat?.toFixed(4)}, ${ride.dropoff?.lng?.toFixed(4)}`;

    let driverDetails = '';
    if (ride.driver && typeof ride.driver === 'object') {
      const d = ride.driver;
      const vehicle = [d.vehicleColor, d.vehicleMake, d.vehicleModel].filter(Boolean).join(' ') || 'Standard Car';
      const plate = d.licensePlate ? `• <span class="plate-badge">${d.licensePlate}</span>` : '';
      driverDetails = `
        <div style="margin-top: 6px; font-size: 0.85rem; color: #475569;">
          🚗 <strong>${d.firstName} ${d.lastName}</strong> (${d.rating ? d.rating.toFixed(1) : '4.8'} ⭐)<br>
          🚘 ${vehicle} ${plate}
        </div>
      `;
    }

    li.innerHTML = `
      <span class="status ${ride.status}">${ride.status}</span>
      <strong>${new Date(ride.createdAt || Date.now()).toLocaleString()}</strong>
      <br>
      📍 <strong>Pickup:</strong> ${pickupAddr}
      <br>
      🔴 <strong>Dropoff:</strong> ${dropoffAddr}
      ${driverDetails}
    `;

    ridesList.appendChild(li);
  });
}

function getFilteredRides() {
  const sortVal = rideSort ? rideSort.value : 'newest';
  let list = [...passengerRides];

  if (sortVal === 'pending') {
    list = list.filter(r => r.status === 'pending');
  } else if (sortVal === 'completed') {
    list = list.filter(r => r.status === 'completed');
  }

  return list;
}

if (rideSort) {
  rideSort.addEventListener('change', () => {
    renderRideList(getFilteredRides());
  });
}


// ===============================
// RIDE POLLING & AUTO-MODAL TRIGGER
// ===============================

async function loadRides() {
  if (!token) return;

  try {
    const res = await fetch('/api/rides', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      sessionStorage.clear();
      window.location.href = 'login.html';
      return;
    }

    if (!res.ok) return;

    const rides = await res.json();
    passengerRides = rides;

    renderRideList(getFilteredRides());

    const currentActiveRide = passengerRides.find(
      r => r.status === 'pending' || r.status === 'accepted' || r.status === 'in_progress'
    );

    if (currentActiveRide) {
      startRideStatusFlow(currentActiveRide);
    } else {
      if (activeRideId) {
        const justCompleted = passengerRides.find(r => r._id === activeRideId && r.status === 'completed');
        if (justCompleted) {
          showRatingModal(justCompleted);
        }
      }
      dismissActiveRideUI();
      activeRideId = null;
    }
  } catch (err) {
    console.error('Error polling rides:', err);
  }
}


// ===============================
// NAVIGATION & START
// ===============================

if (profileBtn) {
  profileBtn.addEventListener('click', () => {
    window.location.href = 'profile.html';
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.clear();
    window.location.href = 'login.html';
  });
}

// Initial bootstrap
getCurrentLocation();
loadRides();

// Live polling every 5 seconds for smooth status updates
setInterval(loadRides, 5000);