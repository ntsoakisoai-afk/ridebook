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

// ===============================
// COORDINATE VALIDATION UTILITY
// ===============================

/**
 * Validates a single coordinate object {lat, lng}
 * @param {Object} coord - Coordinate object with lat and lng properties
 * @returns {Object} { valid: boolean, error: string | null }
 */
function validateCoordinate(coord) {
  if (!coord || typeof coord !== 'object') {
    return { valid: false, error: 'Coordinate must be an object' };
  }

  const lat = Number(coord.lat);
  const lng = Number(coord.lng);

  // Check if values can be converted to numbers
  if (isNaN(lat) || isNaN(lng)) {
    return { valid: false, error: `NaN values: lat=${coord.lat}, lng=${coord.lng}` };
  }

  // Validate latitude range: -90 <= lat <= 90
  if (lat < -90 || lat > 90) {
    return { valid: false, error: `Invalid latitude: ${lat} (must be between -90 and 90)` };
  }

  // Validate longitude range: -180 <= lng <= 180
  if (lng < -180 || lng > 180) {
    return { valid: false, error: `Invalid longitude: ${lng} (must be between -180 and 180)` };
  }

  return { valid: true, error: null };
}

function isSouthAfricanCoordinate(coord) {
  return coord.lat >= -35 && coord.lat <= -22 && coord.lng >= 16 && coord.lng <= 33;
}

function normalizeGeocodedLocation(result) {
  const location = {
    lat: Number(result.lat),
    lng: Number(result.lon),
    address: result.display_name
  };

  const validation = validateCoordinate(location);
  if (!validation.valid || !isSouthAfricanCoordinate(location)) {
    console.warn('Geocoder returned a coordinate outside South Africa', {
      result,
      location
    });
    return null;
  }

  console.log('Geocoded location', location);
  return location;
}

/**
 * Validates a pair of coordinates for routing
 * @param {Object} pickup - Pickup location object
 * @param {Object} dropoff - Dropoff location object
 * @returns {Object} { valid: boolean, pickup: Object | null, dropoff: Object | null, errors: string[] }
 */
function validateRouteCoordinates(pickup, dropoff) {
  const errors = [];

  if (!pickup) {
    errors.push('Pickup location is missing');
  } else {
    const pickupValidation = validateCoordinate(pickup);
    if (!pickupValidation.valid) {
      errors.push(`Pickup: ${pickupValidation.error}`);
    }
  }

  if (!dropoff) {
    errors.push('Dropoff location is missing');
  } else {
    const dropoffValidation = validateCoordinate(dropoff);
    if (!dropoffValidation.valid) {
      errors.push(`Dropoff: ${dropoffValidation.error}`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      pickup: null,
      dropoff: null,
      errors: errors
    };
  }

  // Normalize to ensure numbers
  const normalizedPickup = {
    lat: Number(pickup.lat),
    lng: Number(pickup.lng),
    address: pickup.address || 'Pickup'
  };

  const normalizedDropoff = {
    lat: Number(dropoff.lat),
    lng: Number(dropoff.lng),
    address: dropoff.address || 'Dropoff'
  };

  if (!isSouthAfricanCoordinate(normalizedPickup) || !isSouthAfricanCoordinate(normalizedDropoff)) {
    return {
      valid: false,
      pickup: null,
      dropoff: null,
      errors: ['Pickup or dropoff is outside South Africa']
    };
  }

  // Ride routes are local. Do not ask OSRM to route across oceans when a
  // coordinate pair has been swapped or corrupted in the stored ride data.
  const distanceKm = haversineDistanceKm(normalizedPickup, normalizedDropoff);
  if (distanceKm > 500) {
    return {
      valid: false,
      pickup: null,
      dropoff: null,
      errors: [`Pickup and dropoff are ${Math.round(distanceKm)} km apart; refusing a local ride route`]
    };
  }

  return {
    valid: true,
    pickup: normalizedPickup,
    dropoff: normalizedDropoff,
    errors: []
  };
}

async function drawRoutePreview() {
  if (!pickupLocation || !dropoffLocation) return;

  // Use comprehensive validation
  const validation = validateRouteCoordinates(pickupLocation, dropoffLocation);
  if (!validation.valid) {
    console.error('Invalid route coordinates', {
      pickup: pickupLocation,
      dropoff: dropoffLocation,
    });
    console.warn('Skipping OSRM preview request:', validation.errors);
    return;
  }

  const { pickup, dropoff } = validation;

  try {
    // OSRM expects lng,lat order
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`;

    console.log('Route Request', {
      pickup: { lat: pickup.lat, lng: pickup.lng },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng },
      distanceKm: haversineDistanceKm(pickup, dropoff)
    });

    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      console.warn('No route found for preview');
      return;
    }

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
    console.error('⚠️ Error drawing preview route:', err.message);
    console.log('Fallback: No route preview available');
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
        const context = 'Gqeberha, Eastern Cape, South Africa';
        const geocodeQuery = /south africa/i.test(query) ? query : `${query}, ${context}`;
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=za&addressdetails=1&q=${encodeURIComponent(geocodeQuery)}&limit=5`);
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

            const location = normalizeGeocodedLocation(item);
            if (!location) {
              if (typeof showToast === 'function') {
                showToast('Unable to verify route location. Please select a valid South African address.', 'error', 4000);
              }
              return;
            }

            inputEl.value = item.display_name;
            resultsEl.innerHTML = '';
            resultsEl.style.display = 'none';

            if (isPickup) {
              pickupLocation = location;
              if (pickupMarker) map.removeLayer(pickupMarker);
              pickupMarker = L.marker([location.lat, location.lng]).addTo(map).bindPopup('📍 Pickup').openPopup();
            } else {
              dropoffLocation = location;
              if (dropoffMarker) map.removeLayer(dropoffMarker);
              dropoffMarker = L.marker([location.lat, location.lng]).addTo(map).bindPopup('🔴 Dropoff').openPopup();
            }

            if (pickupLocation && dropoffLocation) {
              drawRoutePreview();
            } else {
              map.setView([location.lat, location.lng], 14);
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
  // Validate coordinates using comprehensive validation
  const validation = validateRouteCoordinates(pickup, dropoff);
  if (!validation.valid) {
    console.error('Invalid route coordinates', {
      pickup,
      dropoff
    });
    console.warn('⚠️ Skipping OSRM request; markers will remain visible only', validation.errors);
    return;
  }

  const { pickup: normalizedPickup, dropoff: normalizedDropoff } = validation;
  const distanceKm = haversineDistanceKm(normalizedPickup, normalizedDropoff);
  console.log('Route Request', {
    pickup: normalizedPickup,
    dropoff: normalizedDropoff,
    distanceKm
  });

  try {
    // Build OSRM URL with validated coordinates (requires lng,lat order)
    const url = `https://router.project-osrm.org/route/v1/driving/${normalizedPickup.lng},${normalizedPickup.lat};${normalizedDropoff.lng},${normalizedDropoff.lat}?overview=full&geometries=geojson`;

    console.log('📍 Fetching road route from OSRM', {
      url: url.substring(0, 100) + '...',
      pickup: { lat: normalizedPickup.lat, lng: normalizedPickup.lng },
      dropoff: { lat: normalizedDropoff.lat, lng: normalizedDropoff.lng }
    });

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`OSRM returned ${res.status}: ${res.statusText}`);
    }

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
    console.warn('⚠️ OSRM routing failed, drawing fallback line:', err.message);
    console.log('Fallback using coordinates:', {
      pickup: normalizedPickup,
      dropoff: normalizedDropoff
    });

    if (routeLine) map.removeLayer(routeLine);
    // Draw straight line fallback
    routeLine = L.polyline([
      [normalizedPickup.lat, normalizedPickup.lng],
      [normalizedDropoff.lat, normalizedDropoff.lng]
    ], { color: '#fbbf24', weight: 4, dashArray: '6, 8' }).addTo(map);
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
    const validation = validateRouteCoordinates(pointA, pointB);
    if (!validation.valid) {
      console.error('Invalid route coordinates', {
        pickup: pointA,
        dropoff: pointB
      });
      console.warn('Skipping OSRM route fetch:', validation.errors);
      return null;
    }

    const { pickup, dropoff } = validation;

    // OSRM expects lng,lat order
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`;
    
    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      console.warn('No route found for coordinates');
      return null;
    }

    return {
      coords: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
      distanceKm: data.routes[0].distance / 1000,
      durationSec: data.routes[0].duration
    };
  } catch (err) {
    console.warn('fetchRouteCoords failed:', err.message);
    return null;
  }
}

// ===============================
// SIMULATED MOTION FALLBACK (RIDER VIEW) - FIXED
// ===============================

let simRideId = null;
let simPhase = null; // 'to_pickup' | 'to_dropoff'
let simRouteCoords = null;
let simStartTime = null;
let simDurationMs = null;
let simRafId = null;
let simCompletedForPhase = false;
let simClaimed = false;
let simEtaIntervalId = null;

function cancelSimulatedMotion() {
  console.log('🧹 cancelSimulatedMotion called');
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

function tickSimulatedEta() {
  if (!simStartTime || !simDurationMs) return;

  const elapsed = Date.now() - simStartTime;
  const remainingMs = Math.max(simDurationMs - elapsed, 0);
  const minutesRemaining = Math.max(Math.ceil(remainingMs / 60000), 0);

  const target = document.getElementById('driver-eta-value')
    || document.getElementById('searching-eta-value');

  if (target) {
    target.textContent = minutesRemaining <= 0 ? 'Arriving' : `${minutesRemaining} min`;
  }
}

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

function placeDriverMarkerAt(lat, lng, bearingDeg, isStale) {
  if (!driverMarker) {
    console.warn('⚠️ driverMarker is null, cannot place');
    return;
  }
  console.log('📍 Marker placed at:', lat.toFixed(6), lng.toFixed(6));
  driverMarker.setIcon(createRiderCarIcon(bearingDeg || 0, isStale || false));
  driverMarker.setLatLng([lat, lng]);
  lastDriverPositionRider = { lat, lng };
}

// ==========================================================
// FIXED: startSimulatedApproach - Uses same logic as driver side
// ==========================================================

async function startSimulatedApproach(ride, phaseKey, targetStop) {
  console.log('🚗 startSimulatedApproach called:', phaseKey, 'ride:', ride._id);

  // Cancel any existing simulation
  cancelSimulatedMotion();

  // Set up new simulation state
  simRideId = ride._id;
  simPhase = phaseKey;
  simClaimed = true;
  simCompletedForPhase = false;

  // Get start position
  let startPoint = lastDriverPositionRider;
  if (!startPoint) {
    startPoint = phaseKey === 'to_pickup'
      ? { lat: ride.pickup.lat + 0.0025, lng: ride.pickup.lng + 0.0025 }
      : { lat: ride.pickup.lat, lng: ride.pickup.lng };
  }

  console.log('📍 Start point:', startPoint);

  // Create marker if needed
  if (!driverMarker) {
    console.log('🆕 Creating driver marker');
    const driverName = ride.driver?.firstName || 'Driver';
    driverMarker = L.marker([startPoint.lat, startPoint.lng], {
      icon: createRiderCarIcon(0, false)
    }).addTo(map);
    driverMarker.bindPopup(`<b>${driverName}</b> is on the way!`);
    lastDriverPositionRider = { lat: startPoint.lat, lng: startPoint.lng };
  }

  // ==========================================================
  // FIX: Validate coordinates and fetch route properly
  // ==========================================================
  console.log('🔄 Fetching route from OSRM...');
  let route = null;
  let coords = [];
  let distanceKm = 0;

  // Validate coordinates
  const validStart = startPoint && typeof startPoint.lat === 'number' && typeof startPoint.lng === 'number' && !isNaN(startPoint.lat) && !isNaN(startPoint.lng);
  const validTarget = targetStop && typeof targetStop.lat === 'number' && typeof targetStop.lng === 'number' && !isNaN(targetStop.lat) && !isNaN(targetStop.lng);

  if (validStart && validTarget) {
    try {
      route = await fetchRouteCoords(startPoint, targetStop);
    } catch (err) {
      console.warn('⚠️ Route fetch failed:', err.message);
      route = null;
    }
  } else {
    console.warn('⚠️ Invalid coordinates for route fetch, using fallback');
  }

  if (simRideId !== ride._id || simPhase !== phaseKey) {
    console.log('⚠️ Simulation cancelled during fetch');
    return;
  }

  // Use route or fallback
  if (route && route.coords && route.coords.length > 0) {
    coords = route.coords;
    distanceKm = route.distanceKm || haversineDistanceKm(startPoint, targetStop);
  } else {
    // Fallback: straight line with valid coordinates
    const fallbackStart = validStart ? startPoint : { lat: -33.9608, lng: 25.6022 };
    const fallbackTarget = validTarget ? targetStop : { lat: -33.9608, lng: 25.6022 };
    coords = [[fallbackStart.lat, fallbackStart.lng], [fallbackTarget.lat, fallbackTarget.lng]];
    distanceKm = haversineDistanceKm(fallbackStart, fallbackTarget);
    console.log('📍 Using fallback straight line route');
  }

  console.log('📍 Route:', coords.length, 'points,', distanceKm.toFixed(2), 'km');

  // ==========================================================
  // SAME DURATION CALCULATION AS DRIVER SIDE (3x speed)
  // ==========================================================
  let estimatedMs;
  if (phaseKey === 'to_dropoff' && ride.durationMin) {
    estimatedMs = ride.durationMin * 60 * 1000;
  } else if (route && route.durationSec) {
    estimatedMs = route.durationSec * 1000;
  } else {
    estimatedMs = (distanceKm / 30) * 3600 * 1000;
  }

  const SIM_SPEED_MULTIPLIER = 3;
  estimatedMs = estimatedMs / SIM_SPEED_MULTIPLIER;
  simDurationMs = Math.max(estimatedMs, 12000);
  
  console.log('⏱ Duration:', simDurationMs / 1000, 'seconds');

  // ==========================================================
  // SAME START TIME AS DRIVER SIDE
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

  simStartTime = serverTimestamp.getTime();
  simRouteCoords = coords;

  // Calculate progress so far
  const elapsedMs = Date.now() - simStartTime;
  const progressSoFar = Math.min(1, elapsedMs / simDurationMs);
  console.log('📊 Progress so far:', (progressSoFar * 100).toFixed(0), '%');

  // If already completed
  if (progressSoFar >= 1) {
    const last = coords[coords.length - 1];
    console.log('✅ Already complete, snapping to end');
    placeDriverMarkerAt(last[0], last[1], 0, false);
    simCompletedForPhase = true;
    simClaimed = false;
    return;
  }

  // Apply progress so far
  const pos = pointAlongRoute(simRouteCoords, progressSoFar);
  if (pos) {
    console.log('📍 Placing marker at progress:', progressSoFar);
    placeDriverMarkerAt(pos.lat, pos.lng, pos.bearingDeg, false);
  }

  // Start ETA timer
  if (simEtaIntervalId) clearInterval(simEtaIntervalId);
  simEtaIntervalId = setInterval(tickSimulatedEta, 1000);
  tickSimulatedEta();

  // ==========================================================
  // ANIMATION LOOP - Same as driver side
  // ==========================================================
  
  function animateStep(now) {
    // Check if animation should continue
    if (simRideId !== ride._id || simPhase !== phaseKey) {
      console.log('⚠️ Animation stopped - phase/ride changed');
      return;
    }

    // Calculate current progress using Date.now() timestamp
    const elapsed = now - simStartTime;
    const t = Math.min(elapsed / simDurationMs, 1);

    // Get position along route
    const pos = pointAlongRoute(simRouteCoords, t);
    
    if (pos) {
      placeDriverMarkerAt(pos.lat, pos.lng, pos.bearingDeg, false);
    }

    // Check if complete
    if (t >= 1) {
      console.log('✅ Animation complete!');
      simCompletedForPhase = true;
      simClaimed = false;
      
      // Snap to final position
      const last = simRouteCoords[simRouteCoords.length - 1];
      placeDriverMarkerAt(last[0], last[1], 0, false);
      return;
    }

    // Continue animation
    simRafId = requestAnimationFrame(animateStep);
  }

  // Start the animation loop
  console.log('🚀 Starting animation loop');
  simRafId = requestAnimationFrame(animateStep);
}

// ===============================
// CAR ANIMATION FOR RIDER VIEW (smooth transition between GPS points)
// ===============================

function animateRiderCar(newLat, newLng, isStale = false) {
  if (!driverMarker) return;

  const newPos = { lat: newLat, lng: newLng };

  if (!lastDriverPositionRider) {
    const icon = createRiderCarIcon(0, isStale);
    driverMarker.setIcon(icon);
    driverMarker.setLatLng([newLat, newLng]);
    lastDriverPositionRider = newPos;
    return;
  }

  const angle = Math.atan2(
    newLat - lastDriverPositionRider.lat,
    newLng - lastDriverPositionRider.lng
  ) * (180 / Math.PI);

  const newIcon = createRiderCarIcon(angle, isStale);
  driverMarker.setIcon(newIcon);

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
// DRIVER MARKER WITH ANIMATION - FIXED
// ===============================

function updateDriverMarker(ride, driver, isDriverPopulated) {
  if (!ride.pickup) return;

  const phaseKey = ride.status === 'in_progress' ? 'to_dropoff' : 'to_pickup';
  const targetStop = phaseKey === 'to_dropoff' ? ride.dropoff : ride.pickup;

  // ==========================================================
  // CRITICAL FIX: If phase changed for the same ride, we MUST
  // restart the animation with the new phase
  // ==========================================================
  if (simRideId && simRideId === ride._id && simPhase !== phaseKey) {
    console.log('🔄 Phase changed for same ride, resetting animation');
    cancelSimulatedMotion();
  }

  // Check if animation is already running for this ride+phase
  const animationAlreadyRunning = (simRafId || simClaimed) && simRideId === ride._id && simPhase === phaseKey;
  
  if (animationAlreadyRunning) {
    console.log('⏭️ Animation already running for this ride+phase, skipping');
    return;
  }

  const hasLiveLoc = !!(ride.driverLocation && ride.driverLocation.lat != null);

  let isStale = false;
  if (hasLiveLoc && ride.driverLocation.updatedAt) {
    const ageMs = Date.now() - new Date(ride.driverLocation.updatedAt).getTime();
    isStale = ageMs > DRIVER_LOCATION_STALE_MS;
  }

  const driverNameForPopup = isDriverPopulated ? (driver.firstName || 'Driver') : 'Driver';

  // ==========================================================
  // PRIORITY 1: Fresh real GPS available: use it
  // ==========================================================
  if (hasLiveLoc && !isStale) {
    console.log('📍 Fresh GPS available, using it');
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

  // ==========================================================
  // PRIORITY 2: No fresh GPS - use shared simulation
  // ==========================================================
  
  // If animation is already running (after phase check), don't restart
  if (simRafId || simClaimed) {
    console.log('⏭️ Simulation already running, skipping');
    return;
  }

  console.log('📍 No fresh GPS, starting simulation for phase:', phaseKey);

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

  if (hasLiveLoc && isStale) {
    driverMarker.bindPopup(
      `<b>${driverNameForPopup}</b><br><small>Live location hasn't updated recently — showing estimated position.</small>`
    );
  }
}

// ===============================
// ACTIVE STATUS FLOW - FIXED
// ===============================

function startRideStatusFlow(ride) {
  if (!ride) return;
  
  // Store the ride ID for comparison
  const rideId = ride._id;
  
  // Only set activeRideId if it's different
  if (activeRideId !== rideId) {
    activeRideId = rideId;
  }

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

    // ==========================================================
    // FIX: Start animation for ACCEPTED state
    // ==========================================================
    const phaseKeyAccepted = 'to_pickup';
    const targetStopAccepted = ride.pickup;
    
    if (targetStopAccepted) {
      // Only start animation if not already running
      if (!simRafId && !simClaimed) {
        console.log('🚗 Starting animation for ACCEPTED state');
        updateDriverMarker(ride, driver, isDriverPopulated);
      } else {
        console.log('⏭️ Animation already running, skipping restart');
      }
    }
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

        <!-- Cancel Button (Rider's only action during trip) -->
        <button id="cancel-driver-btn" class="btn-cancel-ride-secondary" style="width: 100%; padding: 10px; border: 1px solid var(--rb-border-strong); border-radius: 8px; background: transparent; color: var(--rb-text-secondary); font-weight: 500; font-size: 0.82rem; cursor: pointer; transition: all 0.2s;">
          Cancel Ride
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

    // No end trip button for riders - only drivers can end trips

    // ==========================================================
    // FIX: Start animation for IN_PROGRESS state
    // ==========================================================
    const phaseKeyInProgress = 'to_dropoff';
    const targetStopInProgress = ride.dropoff;
    
    if (targetStopInProgress) {
      // Only start animation if not already running
      if (!simRafId && !simClaimed) {
        console.log('🚗 Starting animation for IN_PROGRESS state');
        updateDriverMarker(ride, driver, isDriverPopulated);
      } else {
        console.log('⏭️ Animation already running, skipping restart');
      }
    }

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

    const routeValidation = validateRouteCoordinates(pickupLocation, dropoffLocation);
    if (!routeValidation.valid) {
      console.error('Invalid route coordinates', {
        pickup: pickupLocation,
        dropoff: dropoffLocation
      });
      if (typeof showToast === 'function') {
        showToast('Unable to verify route location. Please select a valid South African address.', 'error', 4000);
      }
      return;
    }

    const { pickup, dropoff } = routeValidation;
    const distanceKm = currentRideEstimate?.distanceKm ?? haversineDistanceKm(pickup, dropoff);
    console.log('Route Request', { pickup, dropoff, distanceKm });

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
          pickup,
          dropoff,
          distanceKm,
          durationMin: currentRideEstimate?.durationMin ?? null,
          price: currentRideEstimate?.price ?? null
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Could not request ride');
      }

      const ride = data;
      console.log('Ride created', ride);
      console.log('Pickup coordinates', ride.pickupCoordinates || ride.pickup);
      console.log('Dropoff coordinates', ride.dropoffCoordinates || ride.dropoff);

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

// ===============================
// STATUS CHANGE NOTIFICATIONS
// ===============================

let lastNotifiedRideStatus = {};

function notifyRiderOfStatusChange(ride) {
  if (!ride || !ride._id) return;

  const previous = lastNotifiedRideStatus[ride._id];
  const current = ride.status;

  if (previous === undefined) {
    lastNotifiedRideStatus[ride._id] = current;
    return;
  }

  if (previous === current) return;

  lastNotifiedRideStatus[ride._id] = current;

  if (current === 'accepted') {
    showToast('Your ride has been accepted by the driver.', 'success', 4000);
  } else if (current === 'in_progress') {
    showToast('Your driver has arrived and your trip has started.', 'success', 4000);
  } else if (current === 'completed') {
    showToast('Your ride has been completed.', 'success', 4000);
  } else if (current === 'cancelled') {
    showToast('Your ride was cancelled.', 'warning', 4000);
  }
}

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
// RIDE POLLING & AUTO-MODAL TRIGGER - FIXED
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
    rides.forEach(ride => {
      console.log('Ride loaded', ride);
      console.log('Pickup coordinates', ride.pickupCoordinates || ride.pickup);
      console.log('Dropoff coordinates', ride.dropoffCoordinates || ride.dropoff);
    });
    passengerRides = rides;

    renderRideList(getFilteredRides());

    const currentActiveRide = passengerRides.find(
      r => r.status === 'pending' || r.status === 'accepted' || r.status === 'in_progress'
    );

    if (currentActiveRide) {
      // ==========================================================
      // FIX: Only call startRideStatusFlow if the ride ID changed
      // ==========================================================
      if (activeRideId !== currentActiveRide._id) {
        console.log('🔄 New active ride detected, starting flow');
        activeRideId = currentActiveRide._id;
        notifyRiderOfStatusChange(currentActiveRide);
        startRideStatusFlow(currentActiveRide);
      } else {
        // Ride is the same - just update UI without restarting animation
        console.log('🔄 Same active ride, updating UI only');
        
        // Update the status text if it changed
        const statusText = document.getElementById('driver-status-text');
        if (statusText) {
          if (currentActiveRide.status === 'accepted') {
            statusText.textContent = '🚗 Driver is on the way to your pickup location';
            statusText.style.color = 'var(--rb-teal)';
          } else if (currentActiveRide.status === 'in_progress') {
            statusText.textContent = '🚕 Trip in progress - heading to destination';
            statusText.style.color = '#0fbd8c';
          }
        }
        
        // ==========================================================
        // CRITICAL FIX: Update driver marker from fresh GPS data
        // ==========================================================
        if (currentActiveRide.driverLocation && currentActiveRide.driverLocation.lat != null) {
          const ageMs = Date.now() - new Date(currentActiveRide.driverLocation.updatedAt).getTime();
          const isStale = ageMs > DRIVER_LOCATION_STALE_MS;
          
          if (!isStale && driverMarker) {
            // Fresh GPS - update marker directly with smooth animation
            console.log('📍 Updating marker from fresh GPS data');
            animateRiderCar(
              currentActiveRide.driverLocation.lat,
              currentActiveRide.driverLocation.lng,
              false
            );
          }
        }
        
        // Update distance/ETA values without restarting animation
        updateRideUIValues(currentActiveRide);
      }
    } else {
      if (activeRideId) {
        const justCompleted = passengerRides.find(r => r._id === activeRideId && r.status === 'completed');
        if (justCompleted) {
          notifyRiderOfStatusChange(justCompleted);
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

// ==========================================================
// NEW: Update UI values without restarting animation
// ==========================================================

function updateRideUIValues(ride) {
  const distanceEl = document.getElementById('driver-distance-value');
  const etaEl = document.getElementById('driver-eta-value');
  
  // Don't update ETA if animation is running - it manages itself
  if (simRafId || simClaimed) {
    return;
  }
  
  // If no animation is running, update from ride data
  if (distanceEl && ride.driverLocation && ride.driverLocation.lat != null) {
    const targetStop = ride.status === 'in_progress' ? ride.dropoff : ride.pickup;
    if (targetStop) {
      const dist = haversineDistanceKm(
        { lat: ride.driverLocation.lat, lng: ride.driverLocation.lng },
        targetStop
      );
      distanceEl.textContent = `${dist.toFixed(1)} km`;
    }
  }
  
  if (etaEl && ride.durationMin) {
    const remaining = Math.max(0, ride.durationMin - (Date.now() - new Date(ride.inProgressAt || ride.acceptedAt || Date.now()).getTime()) / 60000);
    etaEl.textContent = `${Math.ceil(remaining)} min`;
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