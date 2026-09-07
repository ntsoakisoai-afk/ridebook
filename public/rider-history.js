// ===============================
// AUTHENTICATION CHECK
// ===============================

const token = sessionStorage.getItem('token');
const user = JSON.parse(sessionStorage.getItem('user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
}

const riderNameEl = document.getElementById('riderName');

if (riderNameEl && user) {
  riderNameEl.textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Rider';
}

// ===============================
// DOM ELEMENTS
// ===============================

const historyContainer = document.getElementById('history-rides');
const filterSelect = document.getElementById('history-filter');
const filterButtons = document.querySelectorAll('.filter-btn');
const searchInput = document.getElementById('search-rides');

// Statistics elements
const statTotal = document.getElementById('stat-total');
const statCompleted = document.getElementById('stat-completed');
const statCancelled = document.getElementById('stat-cancelled');
const statUpcoming = document.getElementById('stat-upcoming');

// ===============================
// STATE MANAGEMENT
// ===============================

let allRides = [];
let currentFilter = 'all';
let currentSearchTerm = '';

// ===============================
// UTILITY FUNCTIONS
// ===============================

/**
 * Format address for display with truncation
 */
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

/**
 * Truncate long text with ellipsis
 */
function truncateText(text, maxLength = 45) {
  if (!text) return 'Unknown';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Mask phone number for privacy
 * Example: 0118765432 -> 0118******
 */
function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 4) return '';
  const masked = cleaned.slice(0, 4) + ''.padEnd(cleaned.length - 4, '*');
  return masked;
}

/**
 * Sort rides by date (newest first)
 */
function sortRidesNewestFirst(rides) {
  return [...rides].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const dateB = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * Filter rides based on current filter and search term
 */
function getFilteredRides() {
  let filtered = allRides;

  // Apply status filter
  if (currentFilter !== 'all') {
    filtered = filtered.filter(ride => ride.status === currentFilter);
  }

  // Apply search filter
  if (currentSearchTerm.trim()) {
    const searchLower = currentSearchTerm.toLowerCase();
    filtered = filtered.filter(ride => {
      const pickupAddr = formatAddress(ride.pickup).toLowerCase();
      const dropoffAddr = formatAddress(ride.dropoff).toLowerCase();
      const driverInfo = getDriverInfo(ride);
      const driverName = driverInfo ? driverInfo.name.toLowerCase() : '';
      
      return pickupAddr.includes(searchLower) || 
             dropoffAddr.includes(searchLower) || 
             driverName.includes(searchLower);
    });
  }

  return sortRidesNewestFirst(filtered);
}

/**
 * Extract and format driver information
 */
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
    maskedPhone: maskPhoneNumber(driver.phone || ''),
    vehicle: vehicleName || 'Standard Vehicle',
    plate: driver.licensePlate || 'NO PLATE'
  };
}

/**
 * Calculate ride statistics
 */
function calculateStats() {
  const completed = allRides.filter(r => r.status === 'completed').length;
  const cancelled = allRides.filter(r => r.status === 'cancelled').length;
  const upcoming = allRides.filter(r => r.status === 'accepted' || r.status === 'pending').length;

  return { total: allRides.length, completed, cancelled, upcoming };
}

/**
 * Update statistics display
 */
function updateStats() {
  const stats = calculateStats();
  if (statTotal) statTotal.textContent = stats.total;
  if (statCompleted) statCompleted.textContent = stats.completed;
  if (statCancelled) statCancelled.textContent = stats.cancelled;
  if (statUpcoming) statUpcoming.textContent = stats.upcoming;
}

// ===============================
// RENDER FUNCTIONS
// ===============================

/**
 * Render empty state
 */
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

/**
 * Render no results state
 */
function renderNoMatchState() {
  if (!historyContainer) return;
  historyContainer.innerHTML = `
    <div class="history-empty">
      <div class="history-empty-icon">🔍</div>
      <h3>No rides found</h3>
      <p>Try adjusting your filters or search term.</p>
    </div>
  `;
}

/**
 * Render all rides
 */
function renderRides() {
  if (!historyContainer) return;

  const filteredRides = getFilteredRides();

  // Show empty state if no rides exist at all
  if (allRides.length === 0) {
    renderEmptyState();
    return;
  }

  // Show no results if filter/search returned nothing
  if (filteredRides.length === 0) {
    renderNoMatchState();
    return;
  }

  historyContainer.innerHTML = '';

  filteredRides.forEach(ride => {
    const card = document.createElement('div');
    card.className = 'rider-history-card';

    // Extract status
    const status = ride.status || 'pending';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

    // Format date
    const dateObj = new Date(ride.createdAt || ride.updatedAt || Date.now());
    const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Format addresses
    const pickupAddress = formatAddress(ride.pickup);
    const dropoffAddress = formatAddress(ride.dropoff);
    const pickupTruncated = truncateText(pickupAddress, 40);
    const dropoffTruncated = truncateText(dropoffAddress, 40);

    // Get driver info
    const driverInfo = getDriverInfo(ride);

    // Build driver HTML
    let driverHtml = '';
    if (driverInfo) {
      const phoneDisplay = driverInfo.maskedPhone ? `📞 ${driverInfo.maskedPhone}` : '';
      driverHtml = `
        <div class="history-driver-section">
          <div><strong>🚗</strong> ${driverInfo.name} <strong>⭐${driverInfo.rating}</strong></div>
          <div>🚘 ${truncateText(driverInfo.vehicle, 35)} • <span class="plate-badge">${driverInfo.plate}</span></div>
          ${phoneDisplay ? `<div>${phoneDisplay}</div>` : ''}
        </div>
      `;
    }

    // Build card HTML
    card.innerHTML = `
      <div class="rider-history-card-header">
        <span class="history-status ${status}">
          ${statusLabel}
        </span>
        <span class="history-date">${dateStr}</span>
      </div>

      <div class="rider-history-route">
        <div class="history-location">
          <div class="history-location-icon">📍</div>
          <div class="history-location-info">
            <span>Pickup</span>
            <strong title="${pickupAddress}">${pickupTruncated}</strong>
          </div>
        </div>

        <div class="history-route-line"></div>

        <div class="history-location">
          <div class="history-location-icon">🔴</div>
          <div class="history-location-info">
            <span>Dropoff</span>
            <strong title="${dropoffAddress}">${dropoffTruncated}</strong>
          </div>
        </div>
      </div>

      ${driverHtml}
    `;

    historyContainer.appendChild(card);
  });
}

// ===============================
// LOAD HISTORY
// ===============================

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
    updateStats();
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

// ===============================
// EVENT LISTENERS
// ===============================

// Filter button click handlers
filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all buttons
    filterButtons.forEach(b => b.classList.remove('active'));
    
    // Add active class to clicked button
    btn.classList.add('active');
    
    // Update filter and render
    currentFilter = btn.dataset.filter || 'all';
    if (filterSelect) {
      filterSelect.value = currentFilter;
    }
    renderRides();
  });
});

// Filter select change handler (for compatibility)
if (filterSelect) {
  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value;
    
    // Update active button
    filterButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === currentFilter);
    });
    
    renderRides();
  });
}

// Search input handler with debounce
let searchTimeout;
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    currentSearchTerm = e.target.value;
    
    searchTimeout = setTimeout(() => {
      renderRides();
    }, 300);
  });
}

// Logout button handler
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.clear();
    window.location.href = 'login.html';
  });
}

// ===============================
// INITIAL LOAD
// ===============================

loadHistory();