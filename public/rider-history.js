const token = sessionStorage.getItem('token');
const user = JSON.parse(sessionStorage.getItem('user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
}

const riderNameEl = document.getElementById('riderName');

if (riderNameEl && user) {
  riderNameEl.textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Rider';
}

const historyContainer = document.getElementById('history-rides');
const rideCountEl = document.getElementById('ride-count');
const filterSelect = document.getElementById('history-filter');

let allRides = [];
let currentFilter = 'all';

function formatAddress(location) {
  if (!location) {
    return 'Unknown location';
  }

  if (location.address && location.address.trim().length > 0) {
    return location.address;
  }

  if (typeof location.lat === 'number' && typeof location.lng === 'number') {
    return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
  }

  return 'Unknown location';
}

function sortRidesNewestFirst(rides) {
  return [...rides].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const dateB = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return dateB - dateA;
  });
}

function getFilteredRides() {
  if (currentFilter === 'all') {
    return sortRidesNewestFirst(allRides);
  }

  return sortRidesNewestFirst(
    allRides.filter(ride => ride.status === currentFilter)
  );
}

function renderEmptyState() {
  if (!historyContainer) return;
  historyContainer.innerHTML = `
    <div class="history-empty">
      <div class="history-empty-icon">🚗</div>
      <h3>No rides yet</h3>
      <p>Your ride history will show up here once you've taken a trip.</p>
      <button class="book-ride-btn" onclick="window.location.href='index.html'">
        Request a ride
      </button>
    </div>
  `;
}

function renderNoMatchState() {
  if (!historyContainer) return;
  historyContainer.innerHTML = `
    <div class="history-empty">
      <div class="history-empty-icon">🔍</div>
      <h3>No rides match this filter</h3>
      <p>Try choosing a different status from the filter above.</p>
    </div>
  `;
}

function getDriverInfo(ride) {
  const driver = ride.driver || ride.driverId || ride.driverUser;

  if (!driver || typeof driver !== 'object') {
    return null;
  }

  const vehicleName = [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel]
    .filter(Boolean)
    .join(' ');

  return {
    name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Assigned Driver',
    rating: driver.rating !== undefined ? Number(driver.rating).toFixed(1) : '4.8',
    phone: driver.phone || '',
    vehicle: vehicleName || 'Standard Vehicle',
    plate: driver.licensePlate || 'NO PLATE'
  };
}

function renderRides() {
  if (!historyContainer) return;

  const filteredRides = getFilteredRides();

  if (rideCountEl) {
    rideCountEl.textContent = `${filteredRides.length} ride${filteredRides.length === 1 ? '' : 's'}`;
  }

  if (allRides.length === 0) {
    renderEmptyState();
    return;
  }

  if (filteredRides.length === 0) {
    renderNoMatchState();
    return;
  }

  historyContainer.innerHTML = '';

  filteredRides.forEach(ride => {
    const card = document.createElement('div');
    card.className = 'rider-history-card';

    // Extract status & label cleanly
    const status = ride.status || 'pending';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

    const dateStr = new Date(
      ride.createdAt || ride.updatedAt || Date.now()
    ).toLocaleString();

    const pickupAddress = formatAddress(ride.pickup);
    const dropoffAddress = formatAddress(ride.dropoff);
    const driverInfo = getDriverInfo(ride);

    let driverHtml = '';
    if (driverInfo) {
      driverHtml = `
        <div class="history-driver-section" style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
          <div><strong>🚗 Driver:</strong> ${driverInfo.name} (⭐ ${driverInfo.rating})</div>
          <div style="font-size: 0.84rem; color: #cbd5e1; margin-top: 4px;">
            🚘 ${driverInfo.vehicle} • <span class="plate-badge">${driverInfo.plate}</span>
            ${driverInfo.phone ? ` • 📞 ${driverInfo.phone}` : ''}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="rider-history-card-header">
        <span class="history-status ${status}">
          ${statusLabel}
        </span>
        <span class="history-date">
          ${dateStr}
        </span>
      </div>

      <div class="rider-history-route">
        <div class="history-location">
          <div class="history-location-icon pickup-icon">📍</div>
          <div class="history-location-info">
            <span>Pickup</span>
            <strong>${pickupAddress}</strong>
          </div>
        </div>

        <div class="history-route-line"></div>

        <div class="history-location">
          <div class="history-location-icon dropoff-icon">🔴</div>
          <div class="history-location-info">
            <span>Dropoff</span>
            <strong>${dropoffAddress}</strong>
          </div>
        </div>
      </div>

      ${driverHtml}
    `;

    historyContainer.appendChild(card);
  });
}

async function loadHistory() {
  try {
    const response = await fetch('/api/rides', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      sessionStorage.clear();
      localStorage.clear();
      window.location.href = 'login.html';
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to load ride history.');
    }

    allRides = await response.json();
    renderRides();

  } catch (err) {
    console.error('Error loading ride history:', err);

    if (historyContainer) {
      historyContainer.innerHTML = `
        <div class="history-error">
          <div class="history-error-icon">⚠️</div>
          <h3>Unable to load ride history</h3>
          <p>${err.message}</p>
        </div>
      `;
    }
  }
}

if (filterSelect) {
  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value;
    renderRides();
  });
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.clear();
    window.location.href = 'login.html';
  });
}

// Initial load
loadHistory();