// ==========================================
// PROFILE.JS - Clean Version
// ==========================================

const token = sessionStorage.getItem("token");
let currentUser = JSON.parse(sessionStorage.getItem("user") || "null");

if (!token || !currentUser) {
  window.location.href = "login.html";
}

const isDriver = currentUser.role === "driver";
const driverNameEl = document.getElementById("driverName");
const welcomeUserEl = document.getElementById("welcome-user");

// ==========================================
// BUILD PROFILE HTML
// ==========================================

function buildProfileHTML(userData) {
  const isDriverUser = userData.role === "driver";
  
  return `
    <div class="profile-card" style="width: 100%;">
      
      <!-- Profile Header -->
      <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.06);">
        <div style="width: 72px; height: 72px; border-radius: 50%; background: var(--rb-teal-glow-soft); display: flex; align-items: center; justify-content: center; font-size: 32px; flex-shrink: 0; border: 2px solid var(--rb-border-teal);">👤</div>
        <div>
          <h2 style="font-size: 1.3rem; color: var(--rb-text); margin-bottom: 2px;">${userData.firstName || ''} ${userData.lastName || ''}</h2>
          <span style="font-size: 0.8rem; color: var(--rb-text-muted);">${isDriverUser ? '🚗 Driver' : '👤 Rider'}</span>
          <span style="font-size: 0.7rem; color: var(--rb-teal); margin-left: 8px; background: var(--rb-teal-glow-soft); padding: 2px 10px; border-radius: 10px;">⭐ ${userData.rating || '4.8'}</span>
        </div>
      </div>

      <!-- Edit Profile Form -->
      <form id="profileEditForm" class="profile-edit-form">
        
        <!-- Personal Information -->
        <div class="profile-section-title">
          📋 Personal Information
          <span class="badge">Edit</span>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="editFirstName">First Name</label>
            <input type="text" id="editFirstName" value="${userData.firstName || ''}" placeholder="Enter your first name" />
          </div>
          <div class="form-group">
            <label for="editLastName">Last Name</label>
            <input type="text" id="editLastName" value="${userData.lastName || ''}" placeholder="Enter your last name" />
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="editEmail">Email Address</label>
            <div class="readonly-field">${userData.email || ''}</div>
          </div>
          <div class="form-group">
            <label for="editPhone">Phone Number</label>
            <input type="tel" id="editPhone" value="${userData.phone || ''}" placeholder="Enter your phone number" />
          </div>
        </div>

        ${isDriverUser ? `
          <!-- Driver & Vehicle Details -->
          <div class="profile-section-title" style="margin-top: 20px;">
            🚗 Driver & Vehicle Details
            <span class="badge">Edit</span>
          </div>

          <!-- Vehicle Photo Upload -->
          <div class="form-group">
            <label>Vehicle Photo</label>
            <div class="profile-photo-upload">
              <div class="preview">
                ${userData.vehiclePhoto ? `<img src="${userData.vehiclePhoto}" alt="Vehicle" />` : '🚗'}
              </div>
              <div class="upload-controls">
                <input type="file" id="vehiclePhotoFile" accept="image/*" />
                <small style="color: var(--rb-text-muted); font-size: 0.65rem;">Max 5MB · JPEG, PNG, GIF, WEBP</small>
                <div id="uploadProgress" style="display: none; margin-top: 6px;">
                  <div style="width: 100%; height: 4px; background: #2d3748; border-radius: 2px; overflow: hidden;">
                    <div id="uploadProgressBar" style="width: 0%; height: 100%; background: #00d4aa; transition: width 0.3s;"></div>
                  </div>
                  <p id="uploadStatus" style="font-size: 0.7rem; color: #94a3b8; margin-top: 2px;">Uploading...</p>
                </div>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="editVehicleMake">Vehicle Make</label>
              <input type="text" id="editVehicleMake" value="${userData.vehicleMake || ''}" placeholder="e.g. Toyota, Volkswagen" />
            </div>
            <div class="form-group">
              <label for="editVehicleModel">Vehicle Model</label>
              <input type="text" id="editVehicleModel" value="${userData.vehicleModel || ''}" placeholder="e.g. Corolla, Polo Vivo" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="editVehicleColor">Vehicle Color</label>
              <input type="text" id="editVehicleColor" value="${userData.vehicleColor || ''}" placeholder="e.g. Silver, White, Black" />
            </div>
            <div class="form-group">
              <label for="editLicensePlate">Number Plate</label>
              <input type="text" id="editLicensePlate" value="${userData.licensePlate || ''}" placeholder="e.g. ABC 123 GP" style="text-transform: uppercase;" />
            </div>
          </div>

          <div class="form-group">
            <label for="editVehiclePhotoUrl">Vehicle Photo URL</label>
            <input type="text" id="editVehiclePhotoUrl" value="${userData.vehiclePhoto || ''}" placeholder="https://example.com/my-car.jpg" />
          </div>
        ` : ''}

        <!-- Save Button -->
        <button type="submit" class="btn-save" id="saveProfileBtn">
          💾 Save Changes
        </button>
        <p id="saveMessage" style="font-size: 0.85rem; margin-top: 8px; text-align: center;"></p>

      </form>

    </div>
  `;
}

// ==========================================
// RENDER PROFILE
// ==========================================

function renderProfile(userData) {
  const driverContent = document.getElementById("driverProfileContent");
  const riderContent = document.getElementById("riderProfileContent");
  
  const html = buildProfileHTML(userData);
  
  if (driverContent) driverContent.innerHTML = html;
  if (riderContent) riderContent.innerHTML = html;

  // Update sidebar names
  if (driverNameEl) {
    driverNameEl.textContent = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Driver';
  }
  if (welcomeUserEl) {
    welcomeUserEl.textContent = `Welcome, ${userData.firstName || 'User'}!`;
  }

  // Re-bind form events
  bindFormEvents(userData);
}

// ==========================================
// BIND FORM EVENTS
// ==========================================

function bindFormEvents(userData) {
  const form = document.getElementById("profileEditForm");
  
  if (!form) return;

  // Vehicle photo upload
  const photoFile = document.getElementById("vehiclePhotoFile");
  if (photoFile) {
    photoFile.addEventListener('change', handlePhotoUpload);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveProfile(userData);
  });
}

// ==========================================
// HANDLE PHOTO UPLOAD
// ==========================================

async function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const uploadProgress = document.getElementById("uploadProgress");
  const uploadProgressBar = document.getElementById("uploadProgressBar");
  const uploadStatus = document.getElementById("uploadStatus");

  if (file.size > 5 * 1024 * 1024) {
    showToast('File is too large. Maximum size is 5MB.', 'error', 3000);
    e.target.value = '';
    return;
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showToast('Only JPEG, PNG, GIF, and WEBP images are allowed.', 'error', 3000);
    e.target.value = '';
    return;
  }

  uploadProgress.style.display = 'block';
  uploadProgressBar.style.width = '0%';
  uploadStatus.textContent = 'Uploading... 0%';

  const formData = new FormData();
  formData.append('vehiclePhoto', file);

  try {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        uploadProgressBar.style.width = percentComplete + '%';
        uploadStatus.textContent = `Uploading... ${percentComplete}%`;
      }
    });

    xhr.onload = function() {
      uploadProgress.style.display = 'none';
      
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        currentUser = { ...currentUser, ...response.user };
        sessionStorage.setItem('user', JSON.stringify(currentUser));
        
        const photoUrlInput = document.getElementById("editVehiclePhotoUrl");
        if (photoUrlInput) photoUrlInput.value = response.vehiclePhoto;
        
        const preview = document.querySelector('.profile-photo-upload .preview img');
        if (preview) preview.src = response.vehiclePhoto;
        
        showToast('Vehicle photo uploaded successfully! ✅', 'success', 3000);
        e.target.value = '';
      } else {
        const response = JSON.parse(xhr.responseText);
        throw new Error(response.message || 'Upload failed');
      }
    };

    xhr.onerror = function() {
      uploadProgress.style.display = 'none';
      showToast('Upload failed. Please try again.', 'error', 3000);
    };

    xhr.open('POST', '/api/users/upload-vehicle-photo', true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);

  } catch (err) {
    uploadProgress.style.display = 'none';
    console.error('Upload error:', err);
    showToast(err.message, 'error', 3000);
  }
}

// ==========================================
// SAVE PROFILE
// ==========================================

async function saveProfile(userData) {
  const saveBtn = document.getElementById("saveProfileBtn");
  const saveMessage = document.getElementById("saveMessage");

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  const updatedData = {};

  // Personal info
  const firstName = document.getElementById("editFirstName");
  const lastName = document.getElementById("editLastName");
  const phone = document.getElementById("editPhone");
  
  if (firstName) updatedData.firstName = firstName.value.trim();
  if (lastName) updatedData.lastName = lastName.value.trim();
  if (phone) updatedData.phone = phone.value.trim();

  // Driver details
  const isDriverUser = userData.role === "driver";
  if (isDriverUser) {
    const vehicleMake = document.getElementById("editVehicleMake");
    const vehicleModel = document.getElementById("editVehicleModel");
    const vehicleColor = document.getElementById("editVehicleColor");
    const licensePlate = document.getElementById("editLicensePlate");
    const vehiclePhotoUrl = document.getElementById("editVehiclePhotoUrl");
    
    if (vehicleMake) updatedData.vehicleMake = vehicleMake.value.trim();
    if (vehicleModel) updatedData.vehicleModel = vehicleModel.value.trim();
    if (vehicleColor) updatedData.vehicleColor = vehicleColor.value.trim();
    if (licensePlate) updatedData.licensePlate = licensePlate.value.trim().toUpperCase();
    if (vehiclePhotoUrl) updatedData.vehiclePhoto = vehiclePhotoUrl.value.trim();
  }

  try {
    const res = await fetch("/api/users/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(updatedData)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || data.error || "Failed to update profile.");
    }

    currentUser = { ...currentUser, ...data.user };
    sessionStorage.setItem("user", JSON.stringify(currentUser));

    if (saveMessage) {
      saveMessage.style.color = "green";
      saveMessage.textContent = "✅ Profile updated successfully!";
      setTimeout(() => { if (saveMessage) saveMessage.textContent = ""; }, 3000);
    }

    showToast("Profile updated successfully!", "success", 3000);

    renderProfile(currentUser);

  } catch (err) {
    console.error("❌ Error saving profile:", err);
    if (saveMessage) {
      saveMessage.style.color = "red";
      saveMessage.textContent = `❌ ${err.message}`;
    }
    showToast(err.message, "error", 3000);
  }

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Changes';
  }
}

// ==========================================
// LOAD PROFILE FROM SERVER
// ==========================================

async function loadProfile() {
  try {
    const res = await fetch("/api/users/profile", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.status === 401) {
      sessionStorage.clear();
      window.location.href = "login.html";
      return;
    }

    if (!res.ok) {
      throw new Error(`Failed to load profile. Status: ${res.status}`);
    }

    const freshUser = await res.json();
    currentUser = { ...currentUser, ...freshUser };
    sessionStorage.setItem("user", JSON.stringify(currentUser));

    renderProfile(currentUser);

  } catch (err) {
    console.error("❌ Error loading profile:", err);
    showToast("Could not load profile details. Please try again.", "error", 3000);
  }
}

// ==========================================
// LOGOUT
// ==========================================

function logout() {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  localStorage.clear();
  window.location.href = "login.html";
}

// ==========================================
// INITIALIZE
// ==========================================

loadProfile();