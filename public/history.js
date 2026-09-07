const token = sessionStorage.getItem("token");
const user = JSON.parse(sessionStorage.getItem("user") || "null");

if (!token || !user) {
    window.location.href = "login.html";
}

document.getElementById("driverName").textContent =
    `${user.firstName} ${user.lastName}`;

const historyContainer = document.getElementById("history-rides");
const rideCountEl = document.getElementById("ride-count");
const filterSelect = document.getElementById("history-filter");
const dateFilterContainer = document.getElementById("date-filters");

let allRides = [];
let currentStatusFilter = 'all';
let currentDateFilter = 'all';

// ===============================
// HELPERS
// ===============================

function formatAddress(location) {
    if (!location) return 'Unknown location';
    if (location.address && location.address.trim().length > 0) {
        return location.address;
    }
    if (typeof location.lat === 'number' && typeof location.lng === 'number') {
        return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
    }
    return 'Unknown location';
}

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return 'R0.00';
    return `R${amount.toFixed(2)}`;
}

function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}

function isThisWeek(date) {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);
    return date >= startOfWeek;
}

function isThisMonth(date) {
    const now = new Date();
    return date.getMonth() === now.getMonth() &&
           date.getFullYear() === now.getFullYear();
}

function getRideDate(ride) {
    return new Date(ride.createdAt || ride.updatedAt || Date.now());
}

// ===============================
// CALCULATE STATISTICS
// ===============================

function calculateStats(rides) {
    const completed = rides.filter(r => r.status === 'completed');
    const cancelled = rides.filter(r => r.status === 'cancelled');
    const earnings = completed.reduce((sum, r) => sum + (r.price || 0), 0);
    
    return {
        total: rides.length,
        completed: completed.length,
        cancelled: cancelled.length,
        earnings: earnings
    };
}

// ===============================
// RENDER SUMMARY STATS
// ===============================

function renderStats(rides) {
    const stats = calculateStats(rides);
    const statsContainer = document.getElementById('history-stats');
    
    if (!statsContainer) return;
    
    statsContainer.innerHTML = `
        <div class="history-stats-grid">
            <div class="history-stat-card">
                <span class="stat-label">Total Rides</span>
                <span class="stat-value">${stats.total}</span>
            </div>
            <div class="history-stat-card">
                <span class="stat-label">Completed</span>
                <span class="stat-value">${stats.completed}</span>
            </div>
            <div class="history-stat-card">
                <span class="stat-label">Cancelled</span>
                <span class="stat-value">${stats.cancelled}</span>
            </div>
            <div class="history-stat-card">
                <span class="stat-label">Earnings</span>
                <span class="stat-value earnings">${formatCurrency(stats.earnings)}</span>
            </div>
        </div>
    `;
}

// ===============================
// GET FILTERED RIDES
// ===============================

function getFilteredRides() {
    let filtered = [...allRides];
    
    // Status filter
    if (currentStatusFilter !== 'all') {
        filtered = filtered.filter(r => r.status === currentStatusFilter);
    }
    
    // Date filter
    if (currentDateFilter !== 'all') {
        filtered = filtered.filter(r => {
            const date = getRideDate(r);
            switch (currentDateFilter) {
                case 'today': return isToday(date);
                case 'week': return isThisWeek(date);
                case 'month': return isThisMonth(date);
                default: return true;
            }
        });
    }
    
    // Sort by date (newest first)
    return filtered.sort((a, b) => getRideDate(b) - getRideDate(a));
}

// ===============================
// RENDER HISTORY CARDS
// ===============================

function renderHistory() {
    const filteredRides = getFilteredRides();
    
    if (rideCountEl) {
        rideCountEl.textContent = `${filteredRides.length} ride${filteredRides.length === 1 ? '' : 's'}`;
    }
    
    renderStats(allRides);
    
    if (allRides.length === 0) {
        historyContainer.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">🚗</div>
                <h3>No ride history yet</h3>
                <p>Your completed rides will appear here.</p>
                <button class="book-ride-btn" onclick="window.location.href='driver.html'">
                    Go to Dashboard
                </button>
            </div>
        `;
        return;
    }
    
    if (filteredRides.length === 0) {
        historyContainer.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">🔍</div>
                <h3>No rides match this filter</h3>
                <p>Try changing your filter settings.</p>
            </div>
        `;
        return;
    }
    
    historyContainer.innerHTML = '';
    
    filteredRides.forEach(ride => {
        const card = document.createElement('div');
        card.className = 'history-card';
        
        const status = ride.status || 'pending';
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        
        const date = getRideDate(ride);
        const dateStr = date.toLocaleDateString('en-ZA', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        const timeStr = date.toLocaleTimeString('en-ZA', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const pickupAddress = formatAddress(ride.pickup);
        const dropoffAddress = formatAddress(ride.dropoff);
        
        let riderName = 'Rider';
        let riderRating = '4.8';
        if (ride.rider && typeof ride.rider === 'object') {
            riderName = `${ride.rider.firstName || ''} ${ride.rider.lastName || ''}`.trim() || 'Rider';
            riderRating = ride.rider.rating ? Number(ride.rider.rating).toFixed(1) : '4.8';
        }
        
        const fare = ride.price ? formatCurrency(ride.price) : '--';
        const distance = ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km` : '--';
        const duration = ride.durationMin ? `${Math.round(ride.durationMin)} min` : '--';
        
        // Get driver rating if available
        let driverRating = '';
        if (ride.driver && typeof ride.driver === 'object' && ride.driver.rating) {
            driverRating = `⭐ ${Number(ride.driver.rating).toFixed(1)}`;
        }
        
        card.innerHTML = `
            <div class="history-card-header">
                <span class="history-status ${status}">${statusLabel}</span>
                <span class="history-date">${dateStr} · ${timeStr}</span>
            </div>
            
            <div class="history-card-rider">
                <span class="rider-avatar-small">👤</span>
                <span class="rider-name">${riderName}</span>
                <span class="rider-rating">⭐ ${riderRating}</span>
            </div>
            
            <div class="history-card-route">
                <div class="route-item pickup">
                    <span class="route-icon pickup-icon">📍</span>
                    <span class="route-address">${pickupAddress}</span>
                </div>
                <div class="route-connector"></div>
                <div class="route-item dropoff">
                    <span class="route-icon dropoff-icon">🔴</span>
                    <span class="route-address">${dropoffAddress}</span>
                </div>
            </div>
            
            <div class="history-card-footer">
                <div class="footer-item fare">
                    <span class="footer-label">Fare</span>
                    <span class="footer-value">${fare}</span>
                </div>
                <div class="footer-item distance">
                    <span class="footer-label">Distance</span>
                    <span class="footer-value">${distance}</span>
                </div>
                <div class="footer-item duration">
                    <span class="footer-label">Duration</span>
                    <span class="footer-value">${duration}</span>
                </div>
                ${driverRating ? `
                <div class="footer-item rating">
                    <span class="footer-label">Rating</span>
                    <span class="footer-value">${driverRating}</span>
                </div>
                ` : ''}
            </div>
        `;
        
        historyContainer.appendChild(card);
    });
}

// ===============================
// LOAD HISTORY FROM API
// ===============================

async function loadHistory() {
    try {
        const response = await fetch("/api/driver/history", {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (response.status === 401) {
            sessionStorage.clear();
            localStorage.clear();
            window.location.href = "login.html";
            return;
        }

        if (!response.ok) {
            throw new Error("Failed to load ride history.");
        }

        allRides = await response.json();
        renderHistory();

    } catch (err) {
        console.error('Error loading history:', err);
        historyContainer.innerHTML = `
            <div class="history-error">
                <div class="history-error-icon">⚠️</div>
                <h3>Unable to load ride history</h3>
                <p>${err.message}</p>
            </div>
        `;
    }
}

// ===============================
// FILTER EVENT HANDLERS
// ===============================

if (filterSelect) {
    filterSelect.addEventListener('change', () => {
        currentStatusFilter = filterSelect.value;
        renderHistory();
    });
}

// Date filter buttons
document.querySelectorAll('.date-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.date-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDateFilter = btn.dataset.filter;
        renderHistory();
    });
});

// ===============================
// LOGOUT
// ===============================

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = 'login.html';
    });
}

// ===============================
// INITIALIZE
// ===============================

loadHistory();