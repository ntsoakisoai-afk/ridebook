const token = sessionStorage.getItem('token');
const user = JSON.parse(sessionStorage.getItem('user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
}

if (user.role !== 'driver') {
  showToast('Access denied.', 'error', 3000);
  window.location.href = 'login.html';
}

const driverNameEl = document.getElementById('driverName');
if (driverNameEl) driverNameEl.textContent = `${user.firstName} ${user.lastName}`;

// DOM
const availableEl = document.getElementById('wallet-available');
const totalEl = document.getElementById('wallet-total');
const redeemedEl = document.getElementById('wallet-redeemed');
const pendingEl = document.getElementById('wallet-pending');
const rideCountEl = document.getElementById('wallet-ride-count');
const redeemAvailableEl = document.getElementById('redeem-available');

const redeemBtn = document.getElementById('redeem-btn');
const redeemPanel = document.getElementById('redeem-panel');
const closeRedeemBtn = document.getElementById('close-redeem');
const redeemForm = document.getElementById('redeem-form');
const redemptionList = document.getElementById('redemption-list');

let currentBalance = 0;

function formatR(v) {
  return `R${Number(v || 0).toFixed(2)}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

function statusBadge(status) {
  return `<span class="wallet-status wallet-status-${status}">${status}</span>`;
}

async function loadWallet() {
  try {
    const res = await fetch('/api/driver/wallet', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) {
      sessionStorage.clear();
      window.location.href = 'login.html';
      return;
    }

    if (!res.ok) throw new Error('Failed to load wallet.');

    const data = await res.json();

    currentBalance = data.availableBalance || 0;

    availableEl.textContent = formatR(data.availableBalance);
    totalEl.textContent = formatR(data.totalEarned);
    redeemedEl.textContent = formatR(data.totalRedeemedPaid);
    pendingEl.textContent = `${formatR(data.totalRedeemedPending)} pending`;
    rideCountEl.textContent = `${data.completedRideCount} completed ride${data.completedRideCount === 1 ? '' : 's'}`;
    redeemAvailableEl.textContent = formatR(data.availableBalance);

    renderRedemptions(data.redemptions || []);
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error', 3000);
  }
}

function renderRedemptions(list) {
  if (!list.length) {
    redemptionList.innerHTML = `<div class="wallet-empty">No redemptions yet. Request one to get started.</div>`;
    return;
  }

  redemptionList.innerHTML = '';
  list.forEach(r => {
    const row = document.createElement('div');
    row.className = 'wallet-history-row';
    row.innerHTML = `
      <div class="wallet-history-row-main">
        <div class="wallet-history-amount">${formatR(r.amount)}</div>
        <div class="wallet-history-meta">
          ${statusBadge(r.status)}
          <span>${r.method.replace('_', ' ')}</span>
          <span>·</span>
          <span>${formatDate(r.requestedAt)}</span>
        </div>
        ${r.note ? `<div class="wallet-history-note">"${r.note}"</div>` : ''}
      </div>
    `;
    redemptionList.appendChild(row);
  });
}

// Open redeem panel
redeemBtn.addEventListener('click', () => {
  if (currentBalance < 50) {
    showToast(`Minimum redemption is R50. Current balance: ${formatR(currentBalance)}`, 'warning', 3500);
    return;
  }
  redeemPanel.style.display = 'block';
  document.getElementById('redeem-amount').value = currentBalance.toFixed(2);
  document.getElementById('redeem-amount').max = currentBalance.toFixed(2);
});

closeRedeemBtn.addEventListener('click', () => {
  redeemPanel.style.display = 'none';
});

// Submit redemption
redeemForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const amount = Number(document.getElementById('redeem-amount').value);
  const method = document.getElementById('redeem-method').value;
  const note = document.getElementById('redeem-note').value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('Enter a valid amount.', 'warning', 3000);
    return;
  }

  try {
    const res = await fetch('/api/driver/wallet/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount, method, note })
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Redemption failed.');

    showToast(data.message || 'Redemption requested.', 'success', 3000);
    redeemPanel.style.display = 'none';
    redeemForm.reset();
    loadWallet();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error', 3000);
  }
});

loadWallet();