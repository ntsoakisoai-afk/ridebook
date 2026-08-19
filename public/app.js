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
// Custom Car Marker Icon for Leaflet
const carIcon = L.divIcon({
  className: 'custom-car-icon',
  html: '<div style="font-size: 26px; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.35));">🚖</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

// Marker used once a driver's location hasn't updated in a while, so the
// rider can tell "not moving" apart from "signal / driver app not sending".
const carIconStale = L.divIcon({
  className: 'custom-car-icon',
  html: '<div style="font-size: 26px; opacity: 0.45; filter: grayscale(60%);">🚖</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const DRIVER_LOCATION_STALE_MS = 20000; // 20s with no update = show as stale


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
// (prevents requesting a second ride while one is pending/accepted/in_progress)
// ===============================

function hasActiveRide() {
  return !!activeRideId;
}

function setBookingFormEnabled(enabled) {

  if (pickupSearch) pickupSearch.disabled = !enabled;
  if (dropoffSearch) dropoffSearch.disabled = !enabled;
  if (useLocationBtn) useLocationBtn.disabled = !enabled;

  if (!enabled) {

    // Close any open autocomplete dropdowns and stop the user from
    // starting a new pickup/dropoff selection mid-ride.
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

  // Don't let the rider drop new pins while a ride is already
  // pending/accepted/in_progress.
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

    // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
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

// Tracks which ride the map has already drawn the pickup/dropoff pins
// and route line for, so we only do that (and the accompanying
// fitBounds) ONCE per ride instead of on every 5s poll. Re-running
// fitBounds every poll was yanking the view back to the same bounds
// every 5 seconds, which masked any actual driver-marker movement and,
// combined with the backdrop, made the whole map feel frozen/blurry.
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
// UPDATE DRIVER MARKER
// ===============================

function updateDriverMarker(ride, driver, isDriverPopulated) {
  if (!ride.pickup) return;

  const hasLiveLoc = !!(ride.driverLocation && ride.driverLocation.lat != null);
  const liveLoc = hasLiveLoc
    ? ride.driverLocation
    : { lat: ride.pickup.lat + 0.0025, lng: ride.pickup.lng + 0.0025 };

  let isStale = false;
  if (hasLiveLoc && ride.driverLocation.updatedAt) {
    const ageMs = Date.now() - new Date(ride.driverLocation.updatedAt).getTime();
    isStale = ageMs > DRIVER_LOCATION_STALE_MS;
  }

  const iconToUse = (hasLiveLoc && isStale) ? carIconStale : carIcon;
  const driverNameForPopup = isDriverPopulated ? (driver.firstName || 'Driver') : 'Driver';

  if (!driverMarker) {
    driverMarker = L.marker([liveLoc.lat, liveLoc.lng], { icon: iconToUse }).addTo(map);
    driverMarker.bindPopup(`<b>${driverNameForPopup}</b>`);
  } else {
    driverMarker.setLatLng([liveLoc.lat, liveLoc.lng]);
    driverMarker.setIcon(iconToUse);
  }
}

/// ==========================================
// ACTIVE STATUS FLOW (Show Card at Bottom of Map)
// ==========================================
function startRideStatusFlow(ride) {
  if (!ride) return;
  activeRideId = ride._id;

  // Lock the booking form the moment there's an active ride
  setBookingFormEnabled(false);

  const sheet = document.getElementById('ride-status-sheet');
  const searchingState = document.getElementById('sheet-searching');
  const driverState = document.getElementById('sheet-driver');

  // Force the bottom floating card to be visible
  if (sheet) {
    sheet.classList.remove('hidden');
    sheet.style.display = 'block';
    void sheet.offsetWidth;
    sheet.classList.add('visible');
  }

  // Draw pickup/dropoff pins + road route ONCE per ride
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

    // Professional Searching UI
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

    // Re-bind cancel button
    const newCancelBtn = document.getElementById('cancel-search-btn');
    if (newCancelBtn) {
      newCancelBtn.addEventListener('click', handleCancelRide);
    }

    // Remove any existing driver marker
    if (driverMarker) {
      map.removeLayer(driverMarker);
      driverMarker = null;
    }
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

    // Calculate distance to pickup
    let distanceToPickup = 'Calculating...';
    let etaMinutes = '...';
    if (ride.driverLocation && ride.driverLocation.lat != null && ride.pickup) {
      const distKm = haversineDistanceKm(
        { lat: ride.driverLocation.lat, lng: ride.driverLocation.lng },
        ride.pickup
      );
      distanceToPickup = `${distKm.toFixed(1)} km`;
      etaMinutes = `${Math.round(distKm / 0.5)} min`;
    }

    const pickupAddr = ride.pickup?.address || 'Pickup location';
    const dropoffAddr = ride.dropoff?.address || 'Dropoff location';
    const fareDisplay = ride.price ? `R${ride.price}` : '--';
    const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';

    // Driver info
    const driverName = isDriverPopulated ? `${driver.firstName || ''} ${driver.lastName || ''}`.trim() : 'Loading driver...';
    const driverRating = isDriverPopulated ? (driver.rating ? Number(driver.rating).toFixed(1) : '4.8') : '--';
    const vehicleDesc = isDriverPopulated ? [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') : 'Loading vehicle...';
    const plate = isDriverPopulated ? (driver.licensePlate || 'NO PLATE') : '--';
    const vehiclePhoto = isDriverPopulated ? driver.vehiclePhoto : null;

    // Build professional driver card
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
        <div style="text-align: center; font-size: 0.85rem; font-weight: 500; color: var(--rb-teal); padding: 6px 0 10px; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 12px;">
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

    // Re-bind buttons
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

    // Show driver marker on map
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

    // Calculate distance to destination
    let distanceToDest = 'Calculating...';
    let progressPercent = 0;
    if (ride.driverLocation && ride.driverLocation.lat != null && ride.pickup && ride.dropoff) {
      const totalDist = ride.distanceKm || 1;
      const remainingDist = haversineDistanceKm(
        { lat: ride.driverLocation.lat, lng: ride.driverLocation.lng },
        ride.dropoff
      );
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

    // Driver info
    const driverName = isDriverPopulated ? `${driver.firstName || ''} ${driver.lastName || ''}`.trim() : 'Your Driver';
    const driverRating = isDriverPopulated ? (driver.rating ? Number(driver.rating).toFixed(1) : '4.8') : '4.8';
    const vehicleDesc = isDriverPopulated ? [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') : 'Standard Vehicle';
    const plate = isDriverPopulated ? (driver.licensePlate || 'NO PLATE') : 'NO PLATE';
    const vehiclePhoto = isDriverPopulated ? driver.vehiclePhoto : null;

    // Build professional in-progress card
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
        <div style="text-align: center; font-size: 0.85rem; font-weight: 500; color: #0fbd8c; padding: 6px 0 10px; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 12px;">
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

    // Re-bind buttons
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
        updateRideFromRider(ride._id, 'completed');
      });
    }

    // Update driver marker
    updateDriverMarker(ride, driver, isDriverPopulated);

    // Redraw route from pickup to dropoff if needed
    if (routeLine && ride.pickup && ride.dropoff) {
      map.removeLayer(routeLine);
      drawRoadRoute(ride.pickup, ride.dropoff);
    }
  }

  // ==========================================================
  // STATE 4: COMPLETED - Trip finished, show rating modal
  // ==========================================================
  else if (ride.status === 'completed') {
    dismissActiveRideUI();
    activeRideId = null;
    showRatingModal(ride);
    loadRides();
  }

  // ==========================================================
  // STATE 5: CANCELLED - Ride cancelled
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
// UPDATE RIDE FROM RIDER (used by End Trip button)
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


// Dismiss active UI when trip completes or cancels
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
  }, 360); // match the CSS transition duration

  if (driverMarker) {
    map.removeLayer(driverMarker);
    driverMarker = null;
  }

  // No active ride anymore, so unlock the booking form again.
  setBookingFormEnabled(true);
}

// ==========================================
// REQUEST BUTTON HANDLER
// ==========================================
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

      // Hide sidebar buttons & fare info
      if (rideControls) rideControls.classList.add('hidden');
      if (fareInfo) fareInfo.classList.add('hidden');

      // Immediately display the bottom searching card on the map
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

// Helper functions: Store rated ride IDs in sessionStorage so they only prompt ONCE
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

// Star Click Handler
document.querySelectorAll('#star-rating .star').forEach(star => {
  star.addEventListener('click', (e) => {
    selectedRating = Number(e.target.getAttribute('data-val') || 5);
    document.querySelectorAll('#star-rating .star').forEach(s => {
      const val = Number(s.getAttribute('data-val') || 0);
      s.classList.toggle('active', val <= selectedRating);
    });
  });
});

// Open Modal (Protected against already-rated trips)
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

// Full Dashboard Reset back to clean "Request a Ride" view
function resetAppToInitialState() {
  // 1. Hide modal and bottom status sheets
  const ratingModalEl = document.getElementById('rating-modal');
  if (ratingModalEl) ratingModalEl.classList.add('hidden');
  dismissActiveRideUI();

  // 2. Clear Map Polyline and Markers
  if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
  if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }

  // 3. Clear State & Search Inputs
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

  // 4. Center map back on user's current GPS location
  getCurrentLocation();
}

// Submit Button Handler
if (submitRatingBtn) {
  submitRatingBtn.onclick = async function (e) {
    e.preventDefault();
    submitRatingBtn.disabled = true;
    submitRatingBtn.textContent = 'Submitting...';

    // 1. Target ID resolution with fallback to latest completed trip
    let targetRideId = completedRideToRate?._id || activeRideId;
    if (!targetRideId && Array.isArray(passengerRides)) {
      const lastCompleted = passengerRides.find(r => r.status === 'completed');
      if (lastCompleted) targetRideId = lastCompleted._id;
    }

    // 2. Dismiss modal immediately
    const ratingModalEl = document.getElementById('rating-modal');
    if (ratingModalEl) ratingModalEl.classList.add('hidden');

    // 3. Submit to server in the background
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

    // 4. Reset interface and reload rides
    resetAppToInitialState();
    loadRides();
  };
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

    // Check for active in-progress ride
    const currentActiveRide = passengerRides.find(
      r => r.status === 'pending' || r.status === 'accepted' || r.status === 'in_progress'
    );

    if (currentActiveRide) {
      startRideStatusFlow(currentActiveRide);
    } else {
      // Check if a ride was recently completed while active
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