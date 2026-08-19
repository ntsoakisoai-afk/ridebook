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

// Store user ID as string for comparison
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
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let driverLocation = null;
let driverMarker = null;
let stopMarker = null;
let approachLine = null;
let tripOverviewLine = null;
let currentMapRideId = null;
let currentMapStage = null; // 'to_pickup' or 'to_dropoff'

const driverCarIcon = L.divIcon({
  className: 'driver-car-icon',
  html: '<div style="font-size: 26px;">🚖</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});


// ===============================
// LIVE DRIVER LOCATION + PUSH TO SERVER
// ===============================

let activeTripId = null;
let lastLocationPushAt = 0;
const LOCATION_PUSH_INTERVAL_MS = 5000;

function watchDriverLocation() {

  if (!navigator.geolocation) {
    return;
  }

  navigator.geolocation.watchPosition(

    (position) => {

      driverLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };

      if (!driverMarker) {
        driverMarker = L.marker(
          [driverLocation.lat, driverLocation.lng],
          { icon: driverCarIcon }
        ).addTo(map).bindPopup('You are here');
        map.setView([driverLocation.lat, driverLocation.lng], 14);
      } else {
        driverMarker.setLatLng([driverLocation.lat, driverLocation.lng]);
      }

      if (activeTripId) {
        checkAndPushLocation();
      }

    },

    (error) => {
      console.warn('Driver geolocation error:', error);
    },

    {
      enableHighAccuracy: true,
      maximumAge: 5000
    }

  );

}

async function checkAndPushLocation() {
  if (!driverLocation || !activeTripId) {
    return;
  }
  
  try {
    const response = await fetch(`/api/rides/${activeTripId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      console.warn('Failed to verify ride status:', response.status);
      return;
    }

    const ride = await response.json();

    if (ride.status !== 'accepted' && ride.status !== 'in_progress') {
      return;
    }

    if (!ride.driver) {
      return;
    }

    let driverId = null;
    if (typeof ride.driver === 'object' && ride.driver._id) {
      driverId = ride.driver._id.toString();
    } else if (typeof ride.driver === 'string') {
      driverId = ride.driver;
    }

    if (!driverId || driverId !== currentUserId) {
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

      if (pushResponse.status === 403) {
        console.warn('Driver not authorized for this ride, clearing activeTripId');
        activeTripId = null;
        loadPendingRides();
      }
    }
  } catch (err) {
    console.warn('Error in checkAndPushLocation:', err);
  }
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
// ROUTE (road-following, via OSRM)
// ===============================

async function getRoadRoute(pointA, pointB) {

  try {

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${pointA.lng},${pointA.lat};${pointB.lng},${pointB.lat}` +
      `?overview=full&geometries=geojson`;

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.routes || !data.routes.length) {
      return null;
    }

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


// ===============================
// MAP LAYERS FOR ACTIVE TRIP
// ===============================

function clearTripLayers() {

  if (stopMarker) { map.removeLayer(stopMarker); stopMarker = null; }
  if (approachLine) { map.removeLayer(approachLine); approachLine = null; }
  if (tripOverviewLine) { map.removeLayer(tripOverviewLine); tripOverviewLine = null; }

  currentMapRideId = null;
  currentMapStage = null;

}

async function drawTripOnMap(ride, stage) {

  if (currentMapRideId === ride._id && currentMapStage === stage) {
    return;
  }

  clearTripLayers();
  currentMapRideId = ride._id;
  currentMapStage = stage;

  const nextStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;

  // ==========================================
  // 1. ADD PICKUP AND DROPOFF MARKERS
  // ==========================================

  // Add destination marker (pickup or dropoff)
  stopMarker = L.marker([nextStop.lat, nextStop.lng])
    .addTo(map)
    .bindPopup(stage === 'to_pickup' ? '📍 Pickup' : '🔴 Dropoff')
    .openPopup();

  // Add pickup marker if we're in dropoff stage
  if (stage === 'to_dropoff' && ride.pickup) {
    L.marker([ride.pickup.lat, ride.pickup.lng])
      .addTo(map)
      .bindPopup('📍 Pickup');
  }

  // ==========================================
  // 2. DRAW FULL ROUTE (Pickup → Dropoff) USING OSRM
  // ==========================================

  if (ride.pickup && ride.dropoff) {
    try {
      const fullRouteUrl = `https://router.project-osrm.org/route/v1/driving/${ride.pickup.lng},${ride.pickup.lat};${ride.dropoff.lng},${ride.dropoff.lat}?overview=full&geometries=geojson`;
      const fullRes = await fetch(fullRouteUrl);
      const fullData = await fullRes.json();

      if (fullData.routes && fullData.routes.length > 0) {
        const coords = fullData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        tripOverviewLine = L.polyline(coords, {
          color: '#94a3b8',
          weight: 2.5,
          opacity: 0.5,
          dashArray: '8, 10'
        }).addTo(map);
        console.log('✅ Full route (pickup → dropoff) drawn');
      } else {
        // Fallback: straight line
        tripOverviewLine = L.polyline(
          [
            [ride.pickup.lat, ride.pickup.lng],
            [ride.dropoff.lat, ride.dropoff.lng]
          ],
          {
            color: '#94a3b8',
            weight: 2,
            opacity: 0.4,
            dashArray: '6, 8'
          }
        ).addTo(map);
        console.log('⚠️ Using fallback full route (straight line)');
      }
    } catch (err) {
      console.warn('Error fetching full route:', err);
      tripOverviewLine = L.polyline(
        [
          [ride.pickup.lat, ride.pickup.lng],
          [ride.dropoff.lat, ride.dropoff.lng]
        ],
        {
          color: '#94a3b8',
          weight: 2,
          opacity: 0.4,
          dashArray: '6, 8'
        }
      ).addTo(map);
    }
  }

  // ==========================================
  // 3. DRAW APPROACH ROUTE (Driver → Next Stop) USING OSRM
  // ==========================================

  if (driverLocation) {
    try {
      const route = await getRoadRoute(driverLocation, nextStop);

      if (route && route.coordinates && route.coordinates.length > 0) {
        // Remove any existing approach line
        if (approachLine) {
          map.removeLayer(approachLine);
        }

        approachLine = L.polyline(route.coordinates, {
          color: '#00d4aa',
          weight: 5,
          opacity: 0.95,
          lineJoin: 'round',
          smoothFactor: 1
        }).addTo(map);

        // Add a glow effect
        const glowLine = L.polyline(route.coordinates, {
          color: '#00d4aa',
          weight: 12,
          opacity: 0.12,
          lineJoin: 'round'
        }).addTo(map);

        // Store glow line reference to remove later
        approachLine._glow = glowLine;

        // Fit map to show both the approach and full route
        if (tripOverviewLine) {
          const bounds = tripOverviewLine.getBounds();
          bounds.extend(approachLine.getBounds());
          map.fitBounds(bounds, { padding: [50, 50] });
        } else {
          map.fitBounds(approachLine.getBounds(), { padding: [50, 50] });
        }

        console.log('✅ Approach route drawn successfully');
      } else {
        // Fallback: draw straight line
        if (approachLine) map.removeLayer(approachLine);
        approachLine = L.polyline(
          [
            [driverLocation.lat, driverLocation.lng],
            [nextStop.lat, nextStop.lng]
          ],
          {
            color: '#00d4aa',
            weight: 4,
            opacity: 0.8,
            dashArray: '6, 8'
          }
        ).addTo(map);
        console.log('⚠️ Using fallback approach route (straight line)');
      }
    } catch (err) {
      console.warn('Error drawing approach route:', err);
      // Fallback: draw straight line
      if (approachLine) map.removeLayer(approachLine);
      approachLine = L.polyline(
        [
          [driverLocation.lat, driverLocation.lng],
          [nextStop.lat, nextStop.lng]
        ],
        {
          color: '#00d4aa',
          weight: 4,
          opacity: 0.8,
          dashArray: '6, 8'
        }
      ).addTo(map);
    }
  } else {
    console.warn('⚠️ No driver location available for approach route');
    
    // If no driver location, center map on pickup
    if (ride.pickup) {
      map.setView([ride.pickup.lat, ride.pickup.lng], 13);
    }
  }
}

// Update clearTripLayers to also remove glow line
function clearTripLayers() {

  if (stopMarker) { map.removeLayer(stopMarker); stopMarker = null; }
  
  if (approachLine) {
    if (approachLine._glow) {
      map.removeLayer(approachLine._glow);
      approachLine._glow = null;
    }
    map.removeLayer(approachLine);
    approachLine = null;
  }
  
  if (tripOverviewLine) { map.removeLayer(tripOverviewLine); tripOverviewLine = null; }

  currentMapRideId = null;
  currentMapStage = null;

}


// ===============================
// RENDER RIDE REQUEST CARD (CSS handles styling)
// ===============================

function renderRideRequestCard(ride) {
  const pickupAddr = ride.pickup?.address || `${ride.pickup?.lat?.toFixed(4)}, ${ride.pickup?.lng?.toFixed(4)}`;
  const dropoffAddr = ride.dropoff?.address || `${ride.dropoff?.lat?.toFixed(4)}, ${ride.dropoff?.lng?.toFixed(4)}`;
  
  // Calculate distance from driver to pickup
  let distanceToPickup = 'Calculating...';
  let etaToPickup = '...';
  if (driverLocation && ride.pickup) {
    const dist = haversineDistanceKm(driverLocation, ride.pickup);
    distanceToPickup = `${dist.toFixed(1)} km`;
    etaToPickup = `${Math.round(dist / 0.5)} min`;
  }

  // Trip details
  const tripDistance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';
  const tripDuration = ride.durationMin ? `${Math.round(ride.durationMin)} min` : '--';
  const price = ride.price ? `R${ride.price.toFixed(2)}` : '--';

  // Rider info
  let passengerName = 'Passenger';
  let passengerRating = '4.8';
  if (ride.rider && typeof ride.rider === 'object') {
    passengerName = `${ride.rider.firstName || ''} ${ride.rider.lastName || ''}`.trim() || 'Passenger';
    passengerRating = ride.rider.rating ? Number(ride.rider.rating).toFixed(1) : '4.8';
  }

  // Request time
  const requestTime = ride.createdAt ? new Date(ride.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

  const card = document.createElement('div');
  card.className = 'ride-request-card';

  card.innerHTML = `
    <!-- Header: Request Time & Status -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 0.7rem;">🚗</span>
        <span style="font-weight: 700; color: var(--rb-teal); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em;">New</span>
        <span style="font-size: 0.5rem; background: rgba(0,212,170,0.12); color: var(--rb-teal); padding: 1px 6px; border-radius: 8px; font-weight: 600;">PENDING</span>
      </div>
      <span style="font-size: 0.55rem; color: var(--rb-text-muted);">${requestTime}</span>
    </div>

    <!-- Rider & Fare -->
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
      <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; border: 1px solid var(--rb-border-teal);">👤</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.75rem; font-weight: 600; color: var(--rb-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${passengerName}</div>
        <div style="font-size: 0.6rem; color: var(--rb-text-secondary);">⭐ ${passengerRating}</div>
      </div>
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--rb-teal);">${price}</div>
    </div>

    <!-- Route - Compact -->
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

    <!-- Trip Details & Distance to Pickup -->
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

    <!-- Actions -->
    <div style="display: grid; grid-template-columns: 1fr 1.5fr; gap: 5px;">
      <button class="decline-btn" data-ride-id="${ride._id}">Decline</button>
      <button class="accept-btn" data-ride-id="${ride._id}">Accept</button>
    </div>
  `;

  // Event listeners
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
// RENDER ACTIVE TRIP SCREEN (CSS handles styling)
// ===============================

function renderActiveTripScreen(ride) {
  const stage = ride.status === 'accepted' ? 'to_pickup' : 'to_dropoff';

  // Call drawTripOnMap with a small delay to ensure map is ready
  setTimeout(() => {
    drawTripOnMap(ride, stage);
  }, 100);

  const nextStop = stage === 'to_pickup' ? ride.pickup : ride.dropoff;

  const riderName = ride.rider
    ? `${ride.rider.firstName || ''} ${ride.rider.lastName || ''}`.trim()
    : 'Rider';

  const riderPhone = ride.rider?.phone || '';

  // Calculate distance to stop
  let distanceToStop = 'Getting location...';
  let etaToStop = '...';
  if (driverLocation && nextStop) {
    const distKm = haversineDistanceKm(driverLocation, nextStop);
    distanceToStop = `${distKm.toFixed(1)} km`;
    etaToStop = `${Math.round(distKm / 0.5)} min`;
  }

  // Get driver/vehicle info
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

  // Build action buttons
  let actionButtons = '';
  if (isPickupStage) {
    actionButtons = `
      <button id="confirm-pickup-btn" class="confirm-pickup-btn">
        ✅ Confirm Pickup
      </button>
    `;
  } else {
    actionButtons = `
      <button class="complete-btn" onclick="updateRide('${ride._id}', 'completed')">
        ✅ End Trip
      </button>
    `;
  }

  // Build the card - CSS handles styling via .active-trip-screen class
  const cardHtml = `
    <div class="active-trip-screen">
      <!-- Status Banner -->
      <div style="
        background: ${statusBg};
        border-radius: 8px;
        padding: 8px 14px;
        margin-bottom: 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      ">
        <span style="font-size: 0.8rem; font-weight: 600; color: ${statusColor};">
          ${stageEmoji} ${statusText}
        </span>
        <span style="font-size: 0.7rem; color: var(--rb-text-muted);">
          ${distanceToStop} · ETA ${etaToStop}
        </span>
      </div>

      <!-- Location Details -->
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

      <!-- Rider Info -->
      <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; background: var(--rb-surface); border-radius: 8px; margin-bottom: 12px;">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">👤</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--rb-text);">${riderName}</div>
          <div style="font-size: 0.7rem; color: var(--rb-text-secondary);">⭐ ${driverRating} · ${vehicleDesc}</div>
        </div>
        <div style="font-size: 0.7rem; font-weight: 600; color: var(--rb-text-muted); letter-spacing: 0.04em; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px;">${plate}</div>
      </div>

      <!-- Actions -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
        ${riderPhone ? `
          <button onclick="window.location.href='tel:${riderPhone}'" style="
            padding: 8px;
            border: 1px solid var(--rb-border);
            border-radius: 6px;
            background: transparent;
            color: var(--rb-text);
            font-weight: 600;
            font-size: 0.7rem;
            cursor: pointer;
            transition: all 0.2s;
          ">📞 Call</button>
          <button onclick="window.location.href='sms:${riderPhone}'" style="
            padding: 8px;
            border: 1px solid var(--rb-border);
            border-radius: 6px;
            background: transparent;
            color: var(--rb-text);
            font-weight: 600;
            font-size: 0.7rem;
            cursor: pointer;
            transition: all 0.2s;
          ">💬 Message</button>
        ` : `
          <span style="color: var(--rb-text-muted); font-size: 0.7rem; text-align: center; grid-column: 1 / -1; padding: 4px;">
            No contact info available
          </span>
        `}
      </div>

      <!-- Cancel Button -->
      <button onclick="updateRide('${ride._id}', 'cancelled')" style="
        width: 100%;
        padding: 8px;
        border: 1px solid var(--rb-border-strong);
        border-radius: 6px;
        background: transparent;
        color: var(--rb-text-secondary);
        font-weight: 500;
        font-size: 0.7rem;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 6px;
      ">
        Cancel Ride
      </button>

      <!-- Action Button -->
      ${actionButtons}
    </div>
  `;

  driverRides.innerHTML = cardHtml;

  // Add pickup button handler
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
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      localStorage.clear();
      window.location.href = '/login.html';
      return;
    }

    const rides = await response.json();

    const myActiveTrip = rides.find(
      r => r.status === 'accepted' || r.status === 'in_progress'
    );

    if (myActiveTrip) {
      activeTripId = myActiveTrip._id;
      renderActiveTripScreen(myActiveTrip);
    } else {
      if (activeTripId) {
        clearTripLayers();
      }
      activeTripId = null;
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