const form = document.getElementById("registerForm");
const message = document.getElementById("message");

window.addEventListener("pageshow", () => {
    if (form) {
        form.reset();
    }
});

form.addEventListener("submit", async (e) => {

    e.preventDefault();

    const user = {

        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        email: email.value.trim(),
        phone: phone.value.trim(),
        role: role.value,
        password: password.value

    };

    if (!firstName.value.trim() || !lastName.value.trim() || !email.value.trim() || !password.value.trim()) {
        showToast("Please fill in all required fields.", "warning", 3000);
        return;
    }

    try {

        const response = await fetch("/api/register", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(user)

        });

        const data = await response.json();

        if (response.ok) {

            message.style.color = "green";
            message.textContent = data.message;
            showToast(data.message || "Registration successful!", "success", 3000);

            form.reset();

            setTimeout(() => {

                window.location.href = "login.html";

            }, 1500);

        } else {

            message.style.color = "red";
            message.textContent = data.message || data.error;
            showToast(data.message || data.error || "Registration failed.", "error", 3000);

        }

    } catch (err) {

        message.style.color = "red";
        message.textContent = "Unable to connect to the server.";
        showToast("Unable to connect to the server.", "error", 3000);

    }

});