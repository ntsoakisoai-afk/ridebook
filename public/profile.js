const user = JSON.parse(localStorage.getItem("user"));

if (!user) {
    window.location.href = "login.html";
}

document.getElementById("firstName").textContent = user.firstName;
document.getElementById("lastName").textContent = user.lastName;
document.getElementById("email").textContent = user.email;
document.getElementById("role").textContent = user.role;

function logout() {

    localStorage.removeItem("token");
    localStorage.removeItem("user");

    window.location.href = "login.html";
}

function goHome() {
    const user = JSON.parse(localStorage.getItem("user"));

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    switch (user.role) {
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