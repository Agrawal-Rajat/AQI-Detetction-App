/* ── DOM refs ─────────────────────────────────────────────── */
const cityInput = document.getElementById("cityInput");
const searchBtn = document.getElementById("searchBtn");
const aqiInfo = document.getElementById("aqiInfo");
const pollutantBox = document.getElementById("pollutants");
const chartCanvas = document.getElementById("aqiChart");
const pm25Canvas = document.getElementById("pm25Chart");
const mostPollutedEl = document.getElementById("mostPolluted");
const leastPollutedEl = document.getElementById("leastPolluted");

/* ── API Keys ─────────────────────────────────────────────── */
const OWM_KEY = "af14b0eafbd6e1919add4816052c5d46";
const WAQI_KEY = "f6251f587da5f575cd9cbe82a66b1c8ac19bfda9";

/* ── Leaflet + Chart Globals ─────────────────────────────── */
let map, cityMarker, stationGroup;
let forecastChart, pm25Chart;

/* ── AQI Utility Functions ───────────────────────────────── */
const describeAQI = aqi =>
    ["Good", "Fair", "Moderate", "Poor", "Very Poor"][aqi - 1] || "Unknown";

const aqiColor = aqi => {
    if (aqi <= 50) return "#22c55e";
    if (aqi <= 100) return "#eab308";
    if (aqi <= 150) return "#f97316";
    if (aqi <= 200) return "#ef4444";
    if (aqi <= 300) return "#a855f7";
    return "#6b21a8";
};

const getPM25Color = val => {
    if (val <= 12) return "#22c55e";
    if (val <= 35.4) return "#eab308";
    if (val <= 55.4) return "#f97316";
    if (val <= 150.4) return "#ef4444";
    return "#991b1b";
};

const fetchJSON = async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
};

/* ── Main Search Handler ─────────────────────────────────── */
searchBtn?.addEventListener("click", async e => {
    e.preventDefault();
    const city = cityInput.value.trim();
    if (!city) return;

    aqiInfo.innerHTML = "<p>Loading…</p>";
    pollutantBox.classList.add("hidden");
    chartCanvas.style.display = "none";
    pm25Canvas.style.display = "none";

    try {
        // 1️⃣ Get Coordinates
        const geo = await fetchJSON(
            `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${OWM_KEY}`
        );
        if (!geo.length) throw new Error("City not found");
        const { lat, lon, name, country } = geo[0];

        // 2️⃣ Current AQI
        const air = await fetchJSON(
            `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OWM_KEY}`
        );
        const aqi = air.list[0].main.aqi;
        const comp = air.list[0].components;

        aqiInfo.innerHTML = `
      <h2>${name}, ${country}</h2>
      <p><strong>AQI:</strong> ${aqi} (${describeAQI(aqi)})</p>`;

        pollutantBox.innerHTML = Object.entries(comp)
            .map(([k, v]) => `<div class="tile">${k.toUpperCase()} <strong>${v.toFixed(1)}</strong> µg/m³</div>`)
            .join("");
        pollutantBox.classList.remove("hidden");

        // 3️⃣ Charts
        await renderForecast(lat, lon);
        renderPM25Chart(comp.pm2_5);

        // 4️⃣ Map & Stations
        updateMap(lat, lon, name);
        await addStationMarkers(city);
    } catch (err) {
        console.error(err);
        aqiInfo.innerHTML = `<p>Error: ${err.message}</p>`;
    }
});

/* ── Forecast Chart ──────────────────────────────────────── */
async function renderForecast(lat, lon) {
    try {
        const fc = await fetchJSON(
            `https://api.openweathermap.org/data/2.5/air_pollution/forecast?lat=${lat}&lon=${lon}&appid=${OWM_KEY}`
        );

        const slice = fc.list.slice(0, 16);
        const labels = slice.map(x =>
            new Date(x.dt * 1000).toLocaleString("en-IN", { hour: "2-digit", day: "numeric", month: "short" })
        );
        const data = slice.map(x => x.main.aqi);

        if (forecastChart) forecastChart.destroy();

        const ctx = chartCanvas.getContext("2d");
        forecastChart = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    data,
                    borderWidth: 2,
                    tension: 0.35,
                }],
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 5,
                        ticks: {
                            stepSize: 1,
                            callback: describeAQI,
                        },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: ctx => `AQI ${ctx.parsed.y}` },
                    },
                },
                responsive: true,
                maintainAspectRatio: false,
            },
        });

        chartCanvas.style.display = "block";
    } catch (err) {
        console.warn("Forecast fetch failed:", err);
    }
}

/* ── PM2.5 Bar Chart ─────────────────────────────────────── */
function renderPM25Chart(value) {
    const ctx = pm25Canvas.getContext("2d");
    if (pm25Chart) pm25Chart.destroy();

    pm25Chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["PM2.5 µg/m³"],
            datasets: [{
                label: "Concentration",
                data: [value],
                backgroundColor: getPM25Color(value),
            }],
        },
        options: {
            indexAxis: 'y',
            scales: {
                x: {
                    min: 0,
                    max: 30,
                    title: { display: true, text: "µg/m³" },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.parsed.x} µg/m³`,
                    },
                },
            },
        },
    });

    pm25Canvas.style.display = "block";
}

/* ── Map & WAQI Stations ────────────────────────────────── */
function updateMap(lat, lon, label) {
    if (!map) {
        map = L.map("map").setView([lat, lon], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap",
        }).addTo(map);
        stationGroup = L.layerGroup().addTo(map);
    } else {
        map.setView([lat, lon], 12);
        stationGroup.clearLayers();
        if (cityMarker) map.removeLayer(cityMarker);
    }
    cityMarker = L.marker([lat, lon]).addTo(map).bindPopup(label);
}

async function addStationMarkers(city) {
    try {
        const res = await fetchJSON(
            `https://api.waqi.info/search/?keyword=${encodeURIComponent(city)}&token=${WAQI_KEY}`
        );
        if (res.status !== "ok" || !res.data.length) return;

        res.data.forEach(st => {
            const [lat, lon] = st.station.geo;
            const aqi = Number(st.aqi);
            const color = aqiColor(aqi);
            const marker = L.circleMarker([lat, lon], {
                radius: 12,
                color,
                fillColor: color,
                fillOpacity: 0.8,
            }).bindPopup(`${st.station.name}<br>AQI: ${aqi} (${describeAQI(aqi)})`);
            stationGroup.addLayer(marker);
        });
    } catch (err) {
        console.warn("WAQI station fetch failed:", err);
    }
}

/* ── Dark/Light Mode + Theme Label ───────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
    const themeSwitch = document.getElementById("themeSwitch");
    const themeLabel = document.getElementById("themeLabel");

    if (!themeSwitch || !themeLabel) return;

    const isDark = localStorage.getItem("theme") === "dark";
    document.documentElement.classList.toggle("dark-mode", isDark);
    themeSwitch.checked = isDark;
    themeLabel.textContent = isDark ? "🌙" : "🌞";

    themeSwitch.addEventListener("change", () => {
        const dark = themeSwitch.checked;
        document.documentElement.classList.toggle("dark-mode", dark);
        localStorage.setItem("theme", dark ? "dark" : "light");
        themeLabel.textContent = dark ? "🌙" : "🌞";
    });
});

/* ── Top 10 Country Pollution List ───────────────────────── */
async function loadCountryPollutionList() {
    const most = [
        { country: "India", aqi: 183 },
        { country: "Pakistan", aqi: 175 },
        { country: "Bangladesh", aqi: 166 },
        { country: "China", aqi: 155 },
        { country: "Nepal", aqi: 142 },
        { country: "Nigeria", aqi: 139 },
        { country: "Iraq", aqi: 135 },
        { country: "Egypt", aqi: 130 },
        { country: "Indonesia", aqi: 125 },
        { country: "Iran", aqi: 120 },
    ];

    const least = [
        { country: "Finland", aqi: 10 },
        { country: "Iceland", aqi: 12 },
        { country: "New Zealand", aqi: 14 },
        { country: "Estonia", aqi: 15 },
        { country: "Sweden", aqi: 18 },
        { country: "Norway", aqi: 20 },
        { country: "Canada", aqi: 21 },
        { country: "Ireland", aqi: 23 },
        { country: "Portugal", aqi: 25 },
        { country: "Australia", aqi: 26 },
    ];

    mostPollutedEl.innerHTML = most.map(c => `<li><span>${c.country}</span><span>${c.aqi}</span></li>`).join("");
    leastPollutedEl.innerHTML = least.map(c => `<li><span>${c.country}</span><span>${c.aqi}</span></li>`).join("");
}

loadCountryPollutionList();
