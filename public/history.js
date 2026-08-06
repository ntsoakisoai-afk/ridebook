const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user"));

if (!token || !user) {
    window.location.href = "login.html";
}

document.getElementById("driverName").textContent =
    `${user.firstName} ${user.lastName}`;

const historyContainer = document.getElementById("history-rides");

async function loadHistory() {

    try {

        const response = await fetch("/api/driver/history", {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (response.status === 401) {
            localStorage.clear();
            window.location.href = "login.html";
            return;
        }

        if (!response.ok) {
            throw new Error("Failed to load ride history.");
        }

        const rides = await response.json();

        historyContainer.innerHTML = "";

        if (rides.length === 0) {
            historyContainer.innerHTML =
                "<p class='no-rides'>No completed rides found.</p>";
            return;
        }

        rides.forEach(ride => {

            const card = document.createElement("div");
            card.className = "ride-card";

            card.innerHTML = `
                <span class="status completed">
                    Completed
                </span>

                <div class="coords">
                    <strong>Pickup:</strong><br>
                    ${ride.pickup.lat.toFixed(4)},
                    ${ride.pickup.lng.toFixed(4)}

                    <br><br>

                    <strong>Dropoff:</strong><br>
                    ${ride.dropoff.lat.toFixed(4)},
                    ${ride.dropoff.lng.toFixed(4)}

                    <br><br>

                    <strong>Date:</strong><br>
                    ${new Date(ride.createdAt).toLocaleString()}
                </div>
            `;

            historyContainer.appendChild(card);

        });

    } catch (err) {

        console.error(err);

        historyContainer.innerHTML =
            "<p class='no-rides'>Unable to load ride history.</p>";

    }

}

loadHistory();