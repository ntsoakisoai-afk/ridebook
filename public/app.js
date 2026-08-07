// Initialize the Leaflet map centered on London
const map = L.map('map').setView([51.505, -0.09], 13);

// Add OpenStreetMap tiles as the base layer
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// State variables for tracking markers
let pickupMarker = null;
let dropoffMarker = null;
let clickState = 'pickup';

// Cache DOM element references
const instruction = document.getElementById('instruction');
const rideControls = document.getElementById('ride-controls');
const requestBtn = document.getElementById('request-btn');
const resetBtn = document.getElementById('reset-btn');
const ridesList = document.getElementById('rides-list');
const rideCount = document.getElementById('ride-count');
const rideSort = document.getElementById('ride-sort');

let passengerRides = [];
let currentFilter = 'newest';

const profileBtn = document.getElementById('profile-btn');
const logoutBtn = document.getElementById('logout-btn');
const welcomeUser = document.getElementById('welcome-user');

// Define a green icon for pickup markers
const greenIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Define a red icon for dropoff markers
const redIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Handle map clicks to place pickup and dropoff markers
map.on('click', function (e) {
  if (clickState === 'pickup') {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker(e.latlng, { icon: greenIcon }).addTo(map).bindPopup('Pickup').openPopup();
    clickState = 'dropoff';
    instruction.textContent = 'Now click to set your dropoff location';
  } else if (clickState === 'dropoff') {
    if (dropoffMarker) map.removeLayer(dropoffMarker);
    dropoffMarker = L.marker(e.latlng, { icon: redIcon }).addTo(map).bindPopup('Dropoff').openPopup();
    clickState = 'done';
    instruction.textContent = 'Ready! Click "Request Ride" to submit.';
    rideControls.classList.remove('hidden');
  }
});

// Remove both markers and reset state
function resetMarkers() {
  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  pickupMarker = null;
  dropoffMarker = null;
  clickState = 'pickup';
  instruction.textContent = 'Click the map to set your pickup location';
  rideControls.classList.add('hidden');
}

resetBtn.addEventListener('click', resetMarkers);

function sortRidesNewestFirst(rides) {
  return [...rides].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const dateB = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return dateB - dateA;
  });
}

function getFilteredRides() {
  if (currentFilter === 'pending') {
    return sortRidesNewestFirst(passengerRides.filter(ride => ride.status === 'pending'));
  }
  if (currentFilter === 'completed') {
    return sortRidesNewestFirst(passengerRides.filter(ride => ride.status === 'completed'));
  }
  return sortRidesNewestFirst(passengerRides);
}

function updateRideCount(filteredRides) {
  if (!rideCount) return;
  const count = filteredRides.length;
  rideCount.textContent = `${count} ride${count === 1 ? '' : 's'}`;
}

function renderRideList(rides) {
  ridesList.innerHTML = '';
  updateRideCount(rides);

  if (rides.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'no-rides';
    empty.textContent = 'No rides match this filter yet.';
    ridesList.appendChild(empty);
    return;
  }

  rides.forEach(ride => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="status ${ride.status}">${ride.status}</span>
      <strong>${new Date(ride.createdAt || ride.updatedAt || Date.now()).toLocaleString()}</strong><br>
      Pickup: ${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}<br>
      Dropoff: ${ride.dropoff.lat.toFixed(4)}, ${ride.dropoff.lng.toFixed(4)}
    `;
    ridesList.appendChild(li);
  });
}

function setFilter(filter) {
  currentFilter = filter;
  renderRideList(getFilteredRides());
}

if (rideSort) {
  rideSort.addEventListener('change', () => setFilter(rideSort.value));
}

//Draw ride on the map with pickup and dropoff markers and a connecting line
function addRideToMap(ride) {
  // Draw a teal circle at the pickup location
  L.circleMarker([ride.pickup.lat, ride.pickup.lng], {
    radius: 8,
    color: '#00d4aa',
    fillColor: '#00d4aa',
    fillOpacity: 0.7
  }).addTo(map).bindPopup('Pickup (Ride ' + ride._id.slice(-4) + ')');

  // Draw a red circle at the dropoff location
  L.circleMarker([ride.dropoff.lat, ride.dropoff.lng], {
    radius: 8,
    color: '#e74c3c',
    fillColor: '#e74c3c',
    fillOpacity: 0.7
  }).addTo(map).bindPopup('Dropoff (Ride ' + ride._id.slice(-4) + ')');

  // Connect pickup and dropoff with a purple dashed line
  L.polyline([
    [ride.pickup.lat, ride.pickup.lng],
    [ride.dropoff.lat, ride.dropoff.lng]
  ], { color: '#7c3aed', weight: 2, dashArray: '5, 10' }).addTo(map);
}

requestBtn.addEventListener('click', async function () {
  if (!pickupMarker || !dropoffMarker) return;

  const token = sessionStorage.getItem('token');

  if (!token) {
    showToast('You must be logged in to request a ride.', 'warning', 3000);
    window.location.href = '/login.html'; // Redirect to login page
    return;
  }

  // Build the ride data from marker positions
  const rideData = {
    pickup: {
      lat: pickupMarker.getLatLng().lat,
      lng: pickupMarker.getLatLng().lng
    },
    dropoff: {
      lat: dropoffMarker.getLatLng().lat,
      lng: dropoffMarker.getLatLng().lng
    }
  };

  // Send the ride to the server
  try {
    const response = await fetch('/api/rides', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(rideData)
    });

    if (!response.ok) {
      throw new Error("Failed to request ride. Status: " + response.status);
    }

    const savedRide = await response.json();
    passengerRides.unshift(savedRide);
    renderRideList(getFilteredRides());
    addRideToMap(savedRide);
    resetMarkers();
  } catch (err) {
    console.error('Error requesting ride:', err);
    showToast('Error requesting ride: ' + err.message, 'error', 4000);
  }
});

// Fetch all rides from the database and display them
async function loadRides() {

  const token = sessionStorage.getItem('token');

  if (!token) {
    window.location.href = '/login.html'; // Redirect to login page if not logged in
    return;
  }

  try {
    const response = await fetch('/api/rides', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error("Failed to load rides. Status: " + response.status);
    }

    const rides = await response.json();
    passengerRides = sortRidesNewestFirst(rides);
    renderRideList(getFilteredRides());

    passengerRides.forEach(ride => {
      addRideToMap(ride);
    });
  } catch (err) {
    console.error('Error loading rides:', err);
    showToast('Error loading rides: ' + err.message, 'error', 4000);
  }
}

const user = JSON.parse(sessionStorage.getItem('user') || 'null');
if (!user) {
  window.location.href = '/login.html'; // Redirect to login page if not logged in
} else {
  welcomeUser.textContent = `Welcome, ${user.firstName}!`;
}

profileBtn.addEventListener("click", () =>{
  window.location.href = '/profile.html';
});

logoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  localStorage.clear();
  window.location.href = '/login.html';
});

// Load rides as soon as the page opens
loadRides();