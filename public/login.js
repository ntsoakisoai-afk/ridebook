const form = document.getElementById("loginForm");
const message = document.getElementById("message");

form.addEventListener("submit", async (e) => {

    e.preventDefault();

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

    console.log("Login response:", data); // Log the response data for debugging
    console.log("Role:", data.user.role);
    
    if (response.ok) {

        // Save token
        localStorage.setItem("token", data.token);

        // Save user information
        localStorage.setItem("user", JSON.stringify(data.user));

        message.style.color = "lime";
        message.textContent = "Login successful!";

        setTimeout(() => {

            switch (data.user.role) {

                case "driver":
                    window.location.href = "driver.html";
                    break;

                case "admin":
                    window.location.href = "admin.html";
                    break;

                default:
                    window.location.href = "index.html";
            }

        }, 1000);

    } else {

        message.style.color = "red";
        message.textContent = data.message;

    }

});