sessionStorage.clear();
localStorage.clear();

const form = document.getElementById("loginForm");
const message = document.getElementById("message");

form.addEventListener("submit", async (e) => {

    e.preventDefault();

    if (!email.value.trim() || !password.value.trim()) {
        showToast("Please enter your email and password.", "warning", 3000);
        return;
    }

    try {
        const response = await fetch("/api/login", {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({

            email: email.value,
            password: password.value

        })

    });

        const data = await response.json();

        if (!response.ok) {
            message.style.color = "red";
            message.textContent = data.message || "Invalid email or password.";
            showToast(data.message || "Invalid email or password.", "error", 3000);
            return;
        }

        console.log("Login response:", data); // Log the response data for debugging
        console.log("Role:", data.user.role);

        // Clear any previous session
        sessionStorage.clear();
        localStorage.clear();

        // Save new session for this browser tab only
        sessionStorage.setItem("token", data.token);
        sessionStorage.setItem("user", JSON.stringify(data.user));

        message.style.color = "lime";
        message.textContent = "Login successful!";
        showToast("Login successful!", "success", 2500);

        setTimeout(() => {

            switch (data.user.role) {

                case "driver":
                    window.location.replace("driver.html");
                    break;

                case "admin":
                    window.location.replace("admin.html");
                    break;

                default:
                    window.location.replace("index.html");
            }

        }, 1000);

    } catch (err) {
        message.style.color = "red";
        message.textContent = "Unable to connect to the server. Please try again.";
        showToast("Unable to connect to the server. Please try again.", "error", 3000);
    }

});