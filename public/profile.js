const token = sessionStorage.getItem("token");
let user = JSON.parse(sessionStorage.getItem("user") || "null");

if (!token || !user) {
  window.location.href = "login.html";
}

// ==========================================
// DOM REFERENCES
// ==========================================

const driverSection = document.getElementById("driver-details-section");

// All input fields
const phoneInput = document.getElementById("phone");
const makeInput = document.getElementById("vehicleMake");
const modelInput = document.getElementById("vehicleModel");
const colorInput = document.getElementById("vehicleColor");
const plateInput = document.getElementById("licensePlate");
const vehiclePhotoInput = document.getElementById("vehiclePhoto");

// Upload elements
const vehiclePhotoFile = document.getElementById("vehiclePhotoFile");
const vehiclePhotoPreview = document.getElementById("vehiclePhotoPreview");
const noPhotoText = document.getElementById("noPhotoText");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const uploadStatus = document.getElementById("uploadStatus");

const driverForm = document.getElementById("driver-profile-form");
const saveMessage = document.getElementById("saveMessage");

// ==========================================
// DISPLAY VEHICLE PHOTO
// ==========================================

function displayVehiclePhoto(photoUrl) {
  if (photoUrl && photoUrl.startsWith('/uploads/')) {
    vehiclePhotoPreview.src = photoUrl;
    vehiclePhotoPreview.style.display = 'block';
    if (noPhotoText) noPhotoText.style.display = 'none';
  } else if (photoUrl && photoUrl.startsWith('http')) {
    // Handle external URLs
    vehiclePhotoPreview.src = photoUrl;
    vehiclePhotoPreview.style.display = 'block';
    if (noPhotoText) noPhotoText.style.display = 'none';
  } else {
    vehiclePhotoPreview.style.display = 'none';
    if (noPhotoText) noPhotoText.style.display = 'block';
  }
}

// ==========================================
// LOAD PROFILE FROM SERVER
// ==========================================

async function loadProfile() {
  console.log('🔍 Loading profile...');
  console.log('🔍 Token exists?', !!token);
  
  try {
    const res = await fetch("/api/users/profile", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    console.log('🔍 Response status:', res.status);

    if (res.status === 401) {
      console.log('🔍 Unauthorized - redirecting to login');
      sessionStorage.clear();
      window.location.href = "login.html";
      return;
    }

    if (!res.ok) {
      const errorText = await res.text();
      console.error('🔍 Error response:', errorText);
      throw new Error(`Failed to load profile. Status: ${res.status}`);
    }

    const freshUser = await res.json();
    console.log('🔍 Profile loaded successfully:', freshUser.email);

    // Keep sessionStorage in sync
    user = { ...user, ...freshUser };
    sessionStorage.setItem("user", JSON.stringify(user));

    // Populate basic info
    document.getElementById("firstName").textContent = freshUser.firstName || "";
    document.getElementById("lastName").textContent = freshUser.lastName || "";
    document.getElementById("email").textContent = freshUser.email || "";
    document.getElementById("role").textContent = freshUser.role || "";

    // Show driver section if user is a driver
    if (freshUser.role === "driver" && driverSection) {
      driverSection.classList.remove("hidden");

      // Populate driver fields
      if (phoneInput) phoneInput.value = freshUser.phone || "";
      if (makeInput) makeInput.value = freshUser.vehicleMake || "";
      if (modelInput) modelInput.value = freshUser.vehicleModel || "";
      if (colorInput) colorInput.value = freshUser.vehicleColor || "";
      if (plateInput) plateInput.value = freshUser.licensePlate || "";
      if (vehiclePhotoInput) vehiclePhotoInput.value = freshUser.vehiclePhoto || "";

      // Display vehicle photo
      if (freshUser.vehiclePhoto) {
        displayVehiclePhoto(freshUser.vehiclePhoto);
      } else {
        displayVehiclePhoto(null);
      }
    }

  } catch (err) {
    console.error("❌ Error loading profile:", err);
    if (typeof showToast === "function") {
      showToast("Could not load profile details. Please try again.", "error", 3000);
    }
  }
}

// ==========================================
// VEHICLE PHOTO UPLOAD
// ==========================================

if (vehiclePhotoFile) {
  vehiclePhotoFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    
    if (!file) return;

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      if (typeof showToast === 'function') {
        showToast('File is too large. Maximum size is 5MB.', 'error', 3000);
      }
      vehiclePhotoFile.value = '';
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      if (typeof showToast === 'function') {
        showToast('Only JPEG, PNG, GIF, and WEBP images are allowed.', 'error', 3000);
      }
      vehiclePhotoFile.value = '';
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
      vehiclePhotoPreview.src = e.target.result;
      vehiclePhotoPreview.style.display = 'block';
      if (noPhotoText) noPhotoText.style.display = 'none';
    };
    reader.readAsDataURL(file);

    // Show progress bar
    uploadProgress.style.display = 'block';
    uploadProgressBar.style.width = '0%';
    uploadStatus.textContent = 'Uploading... 0%';

    // Upload the file
    const formData = new FormData();
    formData.append('vehiclePhoto', file);

    try {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          uploadProgressBar.style.width = percentComplete + '%';
          uploadStatus.textContent = `Uploading... ${percentComplete}%`;
        }
      });

      // Handle response
      xhr.onload = function() {
        uploadProgress.style.display = 'none';
        
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          
          // Update user data
          user = { ...user, ...response.user };
          sessionStorage.setItem('user', JSON.stringify(user));
          
          // Update the vehiclePhoto input
          if (vehiclePhotoInput) {
            vehiclePhotoInput.value = response.vehiclePhoto;
          }
          
          // Display the uploaded photo
          displayVehiclePhoto(response.vehiclePhoto);
          
          if (typeof showToast === 'function') {
            showToast('Vehicle photo uploaded successfully! ✅', 'success', 3000);
          }
          
          if (saveMessage) {
            saveMessage.style.color = 'green';
            saveMessage.textContent = '✅ Vehicle photo uploaded!';
            setTimeout(() => { if (saveMessage) saveMessage.textContent = ''; }, 3000);
          }
          
          // Clear the file input
          vehiclePhotoFile.value = '';
          
        } else {
          const response = JSON.parse(xhr.responseText);
          throw new Error(response.message || 'Upload failed');
        }
      };

      xhr.onerror = function() {
        uploadProgress.style.display = 'none';
        if (typeof showToast === 'function') {
          showToast('Upload failed. Please try again.', 'error', 3000);
        }
      };

      xhr.open('POST', '/api/users/upload-vehicle-photo', true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);

    } catch (err) {
      uploadProgress.style.display = 'none';
      console.error('Upload error:', err);
      if (typeof showToast === 'function') {
        showToast(err.message, 'error', 3000);
      }
    }
  });
}

// ==========================================
// SAVE DRIVER & VEHICLE DETAILS
// ==========================================

if (driverForm) {
  driverForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (saveMessage) {
      saveMessage.style.color = "#2563eb";
      saveMessage.textContent = "Saving details...";
    }

    // Build update data - only include fields that exist
    const updatedData = {};
    
    if (phoneInput) updatedData.phone = phoneInput.value.trim();
    if (makeInput) updatedData.vehicleMake = makeInput.value.trim();
    if (modelInput) updatedData.vehicleModel = modelInput.value.trim();
    if (colorInput) updatedData.vehicleColor = colorInput.value.trim();
    if (plateInput) updatedData.licensePlate = plateInput.value.trim().toUpperCase();
    if (vehiclePhotoInput) updatedData.vehiclePhoto = vehiclePhotoInput.value.trim();

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

      // Update local sessionStorage
      user = { ...user, ...data.user };
      sessionStorage.setItem("user", JSON.stringify(user));

      if (saveMessage) {
        saveMessage.style.color = "green";
        saveMessage.textContent = "✅ Vehicle details saved successfully!";
        // Clear message after 3 seconds
        setTimeout(() => {
          if (saveMessage) saveMessage.textContent = "";
        }, 3000);
      }

      if (typeof showToast === "function") {
        showToast("Profile updated successfully!", "success", 3000);
      }

    } catch (err) {
      console.error("❌ Error saving profile:", err);
      if (saveMessage) {
        saveMessage.style.color = "red";
        saveMessage.textContent = `❌ ${err.message}`;
      }
      if (typeof showToast === "function") {
        showToast(err.message, "error", 3000);
      }
    }
  });
}

// ==========================================
// LOGOUT HANDLER
// ==========================================

function logout() {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  localStorage.clear();
  window.location.href = "login.html";
}

// ==========================================
// DASHBOARD NAVIGATION
// ==========================================

function goHome() {
  const currentUser = JSON.parse(sessionStorage.getItem("user") || "null");

  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  switch (currentUser.role) {
    case "driver":
      window.location.href = "driver.html";
      break;
    case "admin":
      window.location.href = "admin.html";
      break;
    default:
      window.location.href = "index.html";
  }
}

// ==========================================
// INITIALIZE
// ==========================================

loadProfile();