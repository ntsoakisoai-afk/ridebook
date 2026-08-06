const form = document.getElementById("registerForm");
const message = document.getElementById("message");

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

            form.reset();

            setTimeout(() => {

                window.location.href = "login.html";

            }, 1500);

        } else {

            message.style.color = "red";
            message.textContent = data.message || data.error;

        }

    } catch (err) {

        message.style.color = "red";
        message.textContent = "Unable to connect to the server.";

    }

});