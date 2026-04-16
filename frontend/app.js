const appElement = document.querySelector("#app");
const navLinks = Array.from(document.querySelectorAll("#nav-links .nav-link"));

if (window.location.protocol === "file:") {
  const strip = document.createElement("div");
  strip.className = "text-center py-2 px-3 small";
  strip.style.cssText =
    "background:#7a5a00;color:#fff;font-weight:600;border-bottom:2px solid #5c4300;";
  strip.textContent =
    "This page was opened as a local file (file://). For TrailBuddy, run the API from the api folder (dotnet run) and open http://localhost:5286/ in the browser — not the HTML file from Finder.";
  document.body.insertBefore(strip, document.body.firstChild);
}

const fallbackSampleData = {
  trips: [
    {
      id: 1,
      name: "Pine Ridge Loop",
      location: "Asheville, NC",
      difficulty: "Easy",
      price: 89,
      distance: "4.8 miles",
      date: "2026-05-04",
      category: "Forest",
      hikers: 10,
      time: "08:00 AM"
    },
    {
      id: 2,
      name: "Granite Summit Trek",
      location: "Boulder, CO",
      difficulty: "Hard",
      price: 199,
      distance: "12.4 miles",
      date: "2026-05-11",
      category: "Summit",
      hikers: 8,
      time: "05:45 AM"
    },
    {
      id: 3,
      name: "River Bluff Trail",
      location: "Chattanooga, TN",
      difficulty: "Moderate",
      price: 129,
      distance: "7.1 miles",
      date: "2026-05-18",
      category: "Scenic",
      hikers: 12,
      time: "07:30 AM"
    }
  ],
  reservations: [
    { id: "R-1001", trip: "Pine Ridge Loop", customer: "Ava Martinez", date: "2026-05-04", seats: 2, status: "Pending" },
    { id: "R-1002", trip: "Granite Summit Trek", customer: "Liam Chen", date: "2026-05-11", seats: 1, status: "Confirmed" },
    { id: "R-1003", trip: "River Bluff Trail", customer: "Noah Evans", date: "2026-05-18", seats: 3, status: "Cancelled" }
  ],
  customers: [
    { id: "C-201", name: "Ava Martinez", email: "ava@example.com", phone: "555-212-0192", city: "Nashville" },
    { id: "C-202", name: "Liam Chen", email: "liam@example.com", phone: "555-212-0193", city: "Denver" },
    { id: "C-203", name: "Noah Evans", email: "noah@example.com", phone: "555-212-0194", city: "Charlotte" }
  ],
  employees: [
    { id: "E-301", name: "Sophie Reed", role: "Guide", department: "Field Ops", email: "sophie@trailbuddy.com" },
    { id: "E-302", name: "Mason Bell", role: "Coordinator", department: "Operations", email: "mason@trailbuddy.com" },
    { id: "E-303", name: "Elena Ford", role: "Support", department: "Customer Service", email: "elena@trailbuddy.com" }
  ],
  reports: [
    { title: "Monthly Revenue", description: "Revenue by month with trend comparison.", period: "Last 12 months" },
    { title: "Top Customers", description: "Highest lifetime spend by customer.", period: "Current year" },
    { title: "Difficulty Breakdown", description: "Reservation volume by difficulty.", period: "Quarter to date" }
  ]
};

const dataStore = {
  trips: [],
  reservations: [],
  customers: [],
  employees: [],
  reports: []
};

const state = {
  route: "home",
  selectedTripId: null
};

/**
 * Relative fetch("/api/...") only works when the page is served over http(s) from the same host
 * as the API (e.g. `dotnet run` in /api). Opening index.html as file:// makes the browser resolve
 * /api as file:///api/... which fails. Set window.TRAILBUDDY_API_BASE before this script if needed.
 */
function getApiBase() {
  if (typeof window.TRAILBUDDY_API_BASE === "string" && window.TRAILBUDDY_API_BASE.trim() !== "") {
    return window.TRAILBUDDY_API_BASE.trim().replace(/\/$/, "");
  }
  if (window.location.protocol === "file:") {
    return "http://localhost:5286";
  }
  return "";
}

function apiUrl(path) {
  const base = getApiBase();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

const difficultyClassMap = {
  Easy: "tb-difficulty-easy",
  easy: "tb-difficulty-easy",
  Moderate: "tb-difficulty-moderate",
  moderate: "tb-difficulty-moderate",
  Hard: "tb-difficulty-hard",
  hard: "tb-difficulty-hard",
  Extreme: "tb-difficulty-hard",
  extreme: "tb-difficulty-hard"
};

function difficultyBadgeClass(difficulty) {
  const key = normalizeText(difficulty, "Moderate");
  return difficultyClassMap[key] || difficultyClassMap[key.toLowerCase()] || "tb-difficulty-moderate";
}

function money(amount) {
  const numeric = Number(amount ?? 0);
  return `$${numeric.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "pending") return "tb-status-pending";
  if (normalized === "confirmed") return "tb-status-confirmed";
  return "tb-status-cancelled";
}

async function fetchJson(endpoint) {
  const url = apiUrl(endpoint);
  const response = await fetch(url);
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      if (body && body.message) detail = ` — ${body.message}`;
      else if (body && body.error) detail = ` — ${body.error}`;
    } catch {
      /* ignore */
    }
    throw new Error(`${url} failed (${response.status})${detail}`);
  }
  return response.json();
}

function normalizeText(value, fallback = "") {
  if (value == null) return fallback;
  return String(value);
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeTrip(row) {
  const dist = row.distance;
  const distanceLabel =
    dist == null || dist === "" ? "TBD" : typeof dist === "number" ? `${dist}` : normalizeText(dist, "TBD");

  return {
    id: normalizeNumber(row.id),
    name: normalizeText(row.name, "Unnamed Trip"),
    location: normalizeText(row.location, "Unknown location"),
    difficulty: normalizeText(row.difficulty, "Moderate"),
    price: normalizeNumber(row.price),
    distance: distanceLabel,
    date: normalizeText(row.date, "TBD"),
    category: normalizeText(row.category, "General"),
    hikers: normalizeNumber(row.hikers),
    time: normalizeText(row.time, "TBD")
  };
}

function coalesceNumericId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeReservation(row) {
  return {
    id: normalizeText(row.id, "-"),
    tripId: coalesceNumericId(row.tripId ?? row.tripid),
    customerId: coalesceNumericId(row.customerId ?? row.customerid),
    employeeId: coalesceNumericId(row.employeeId ?? row.employeeid),
    trip: normalizeText(row.trip, ""),
    customer: normalizeText(row.customer, ""),
    date: normalizeText(row.date, "-"),
    seats: normalizeNumber(row.seats),
    status: normalizeText(row.status, "Pending"),
    time: normalizeText(row.time, "")
  };
}

function enrichReservationsWithLabels(reservations, trips, customers) {
  const tripById = new Map(trips.map((t) => [t.id, t.name]));
  const customerById = new Map(customers.map((c) => [Number(c.id), c.name]));

  return reservations.map((r) => ({
    ...r,
    trip:
      r.trip ||
      (r.tripId != null ? tripById.get(r.tripId) : null) ||
      (r.tripId != null ? `Trip #${r.tripId}` : "—"),
    customer:
      r.customer ||
      (r.customerId != null ? customerById.get(r.customerId) : null) ||
      (r.customerId != null ? `Customer #${r.customerId}` : "—")
  }));
}

function normalizeCustomer(row) {
  const fname = normalizeText(row.fname, "");
  const lname = normalizeText(row.lname, "");
  const fromParts = [fname, lname].filter(Boolean).join(" ").trim();
  return {
    id: normalizeText(row.id, "-"),
    name: normalizeText(row.name, fromParts || "Unknown"),
    email: normalizeText(row.email, "-"),
    phone: normalizeText(row.phone, "-"),
    city: normalizeText(row.city, "-"),
    birthday: normalizeText(row.birthday, "-"),
    registrationdate: normalizeText(row.registrationdate, "-")
  };
}

function normalizeEmployee(row) {
  const id = normalizeText(row.id, "-");
  const email = normalizeText(row.email, "");
  return {
    id,
    name: normalizeText(row.name, email ? email : `Employee ${id}`),
    role: normalizeText(row.role, "-"),
    department: normalizeText(row.department, "-"),
    email,
    salary: row.salary != null ? row.salary : "—",
    availability: normalizeText(row.availability, "-")
  };
}

function normalizeReport(row) {
  return {
    title: normalizeText(row.title, "Untitled Report"),
    description: normalizeText(row.description, "No description available."),
    period: normalizeText(row.period, "N/A")
  };
}

async function loadData() {
  try {
    const dbCheck = await fetch(apiUrl("/api/health/database"));
    const dbJson = await dbCheck.json().catch(() => ({}));
    if (!dbCheck.ok) {
      console.warn("MySQL not reachable:", dbJson.message || dbCheck.status);
    } else {
      console.log("MySQL:", dbJson.database === true ? "connected" : dbJson);
    }

    // One request at a time keeps concurrent MySQL connections at ~1 (helps small RDS / low max_connections).
    const trips = await fetchJson("/api/trips");
    const reservations = await fetchJson("/api/reservations");
    const customers = await fetchJson("/api/customers");
    const employees = await fetchJson("/api/employees");
    const reports = await fetchJson("/api/reports");

    dataStore.trips = (Array.isArray(trips) ? trips : []).map(normalizeTrip);
    dataStore.customers = (Array.isArray(customers) ? customers : []).map(normalizeCustomer);
    dataStore.reservations = enrichReservationsWithLabels(
      (Array.isArray(reservations) ? reservations : []).map(normalizeReservation),
      dataStore.trips,
      dataStore.customers
    );
    dataStore.employees = (Array.isArray(employees) ? employees : []).map(normalizeEmployee);
    dataStore.reports = (Array.isArray(reports) ? reports : []).map(normalizeReport);
    state.selectedTripId = dataStore.trips[0]?.id ?? null;
  } catch (error) {
    console.error("Failed to load API data:", error);
    dataStore.trips = fallbackSampleData.trips.map(normalizeTrip);
    dataStore.customers = fallbackSampleData.customers.map(normalizeCustomer);
    dataStore.reservations = enrichReservationsWithLabels(
      fallbackSampleData.reservations.map(normalizeReservation),
      dataStore.trips,
      dataStore.customers
    );
    dataStore.employees = fallbackSampleData.employees.map(normalizeEmployee);
    dataStore.reports = fallbackSampleData.reports.map(normalizeReport);
    state.selectedTripId = dataStore.trips[0]?.id ?? null;
  } finally {
    render();
  }
}

function emptyState(message) {
  return `
    <div class="card tb-card">
      <div class="card-body">
        <p class="tb-muted mb-0">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function reservationsTableRowsMarkup() {
  if (dataStore.reservations.length === 0) {
    return `
              <tr>
                <td colspan="6" class="text-center tb-muted py-4">No reservations yet.</td>
              </tr>`;
  }
  return dataStore.reservations
    .map(
      (res) => `
              <tr>
                <td>${res.id}</td>
                <td>${escapeHtml(res.trip)}</td>
                <td>${escapeHtml(res.customer)}</td>
                <td>${res.date}</td>
                <td>${res.seats}</td>
                <td>
                  <span class="badge text-dark ${statusBadgeClass(res.status)}">${res.status}</span>
                </td>
              </tr>`
    )
    .join("");
}

function reservationsSectionMarkup(forDashboard) {
  const h = forDashboard ? "h2" : "h1";
  const hClass = forDashboard ? "h3 mb-0" : "h2 mb-0";
  const sectionOpen = forDashboard
    ? '<section id="dash-reservations" class="tb-section tb-dashboard-anchor">'
    : '<section class="tb-section">';
  return `
    ${sectionOpen}
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <${h} class="${hClass}">Reservations</${h}>
        <span class="tb-muted">${dataStore.reservations.length} total</span>
      </div>
      <div class="table-responsive tb-table-wrap">
        <table class="table table-hover mb-0 align-middle">
          <thead>
            <tr>
              <th>Reservation ID</th>
              <th>Trip</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Seats</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${reservationsTableRowsMarkup()}
          </tbody>
        </table>
      </div>
    </section>`;
}

function customersTableRowsMarkup() {
  if (dataStore.customers.length === 0) {
    return `
              <tr>
                <td colspan="5" class="text-center tb-muted py-4">No customers yet.</td>
              </tr>`;
  }
  return dataStore.customers
    .map(
      (customer) => `
              <tr>
                <td>${customer.id}</td>
                <td>${escapeHtml(customer.name)}</td>
                <td>${escapeHtml(customer.email)}</td>
                <td>${escapeHtml(customer.phone)}</td>
                <td>${escapeHtml(customer.city)}</td>
              </tr>`
    )
    .join("");
}

function customersSectionMarkup(forDashboard) {
  const h = forDashboard ? "h2" : "h1";
  const hClass = forDashboard ? "h3 mb-0" : "h2 mb-0";
  const sectionOpen = forDashboard
    ? '<section id="dash-customers" class="tb-section tb-dashboard-anchor">'
    : '<section class="tb-section">';
  return `
    ${sectionOpen}
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <${h} class="${hClass}">Customers</${h}>
        <span class="tb-muted">${dataStore.customers.length} total</span>
      </div>
      <div class="table-responsive tb-table-wrap">
        <table class="table table-striped mb-0 align-middle">
          <thead>
            <tr>
              <th>Customer ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City</th>
            </tr>
          </thead>
          <tbody>
            ${customersTableRowsMarkup()}
          </tbody>
        </table>
      </div>
    </section>`;
}

function employeesTableRowsMarkup() {
  if (dataStore.employees.length === 0) {
    return `
              <tr>
                <td colspan="5" class="text-center tb-muted py-4">No employees yet.</td>
              </tr>`;
  }
  return dataStore.employees
    .map(
      (employee) => `
              <tr>
                <td>${employee.id}</td>
                <td>${escapeHtml(employee.name)}</td>
                <td>${escapeHtml(employee.role)}</td>
                <td>${escapeHtml(employee.department)}</td>
                <td>${escapeHtml(employee.email)}</td>
              </tr>`
    )
    .join("");
}

function employeesSectionMarkup(forDashboard) {
  const h = forDashboard ? "h2" : "h1";
  const hClass = forDashboard ? "h3 mb-0" : "h2 mb-0";
  const sectionOpen = forDashboard
    ? '<section id="dash-employees" class="tb-section tb-dashboard-anchor">'
    : '<section class="tb-section">';
  return `
    ${sectionOpen}
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <${h} class="${hClass}">Employees</${h}>
        <span class="tb-muted">${dataStore.employees.length} total</span>
      </div>
      <div class="table-responsive tb-table-wrap">
        <table class="table table-striped mb-0 align-middle">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            ${employeesTableRowsMarkup()}
          </tbody>
        </table>
      </div>
    </section>`;
}

function reportsCardsMarkup() {
  if (dataStore.reports.length === 0) {
    return `
          <div class="col-12">
            <article class="card tb-card tb-report-card h-100">
              <div class="card-body">
                <h2 class="h5 card-title">No Reports Loaded</h2>
                <p class="mb-0 tb-muted">Report placeholders will render from your sample data.</p>
              </div>
            </article>
          </div>`;
  }
  return dataStore.reports
    .map(
      (report) => `
          <div class="col-md-6 col-xl-4">
            <article class="card tb-card tb-report-card h-100">
              <div class="card-body">
                <h2 class="h5 card-title">${escapeHtml(report.title)}</h2>
                <p class="mb-2 tb-muted">${escapeHtml(report.description)}</p>
                <span class="badge bg-secondary">${escapeHtml(report.period)}</span>
              </div>
            </article>
          </div>`
    )
    .join("");
}

function reportsSectionMarkup(forDashboard) {
  const h = forDashboard ? "h2" : "h1";
  const hClass = forDashboard ? "h3 mb-3" : "h2 mb-3";
  const sectionOpen = forDashboard
    ? '<section id="dash-reports" class="tb-section tb-dashboard-anchor">'
    : '<section class="tb-section">';
  return `
    ${sectionOpen}
      <${h} class="${hClass}">Reports</${h}>
      <div class="row g-3">
        ${reportsCardsMarkup()}
      </div>
    </section>`;
}

function renderHome() {
  const allTrips = dataStore.trips;
  return `
    <section class="tb-hero">
      <div class="row align-items-center g-4">
        <div class="col-lg-8">
          <p class="text-uppercase mb-2 fw-semibold">TrailBuddy Hiking Services</p>
          <h1 class="display-5 mb-3">Find your next unforgettable trail.</h1>
          <p class="lead mb-4">
            Guided hikes built for curious explorers, weekend warriors, and summit seekers.
            From old-growth forests to alpine passes, we handle the logistics so you can focus on the journey.
          </p>
          <div class="tb-cta-group">
            <button class="btn tb-btn-primary" data-route-btn="trips">Explore Trips</button>
            <button class="btn tb-btn-outline" data-route-btn="reservations">View Reservations</button>
          </div>
        </div>
      </div>
    </section>

    <p class="tb-muted mb-0 tb-section">
      <strong>Home</strong> shows every section on one page (scroll). Use the nav links for a single full-width view of each area.
    </p>

    <section id="dash-trips" class="tb-section tb-dashboard-anchor">
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 class="h3 mb-0">All Trips <span class="tb-muted fs-6 fw-normal">(${allTrips.length})</span></h2>
        <button class="btn btn-sm tb-btn-primary" data-route-btn="trips">Trips only</button>
      </div>
      <div class="row g-3">
        ${
          allTrips.length === 0
            ? `
          <div class="col-12">
            <article class="card h-100 tb-card">
              <div class="card-body">
                <h3 class="h5 card-title mb-2">No Trips Yet</h3>
                <p class="tb-muted mb-0">Trips from the API will list here.</p>
              </div>
            </article>
          </div>
        `
            : `
        ${allTrips
          .map(
            (trip) => `
          <div class="col-md-6 col-lg-4">
            <article class="card h-100 tb-card">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <h3 class="h5 card-title mb-0">${escapeHtml(trip.name)}</h3>
                  <span class="badge tb-badge ${difficultyBadgeClass(trip.difficulty)}">${trip.difficulty}</span>
                </div>
                <p class="tb-muted mb-1">${escapeHtml(trip.location)}</p>
                <p class="mb-3">${trip.distance} trail • ${trip.date}</p>
                <div class="d-flex justify-content-between align-items-center">
                  <strong>${money(trip.price)}</strong>
                  <button class="btn btn-sm tb-btn-primary" data-trip-detail="${trip.id}">Details</button>
                </div>
              </div>
            </article>
          </div>
        `
          )
          .join("")}
        `
        }
      </div>
    </section>

    ${reservationsSectionMarkup(true)}
    ${customersSectionMarkup(true)}
    ${employeesSectionMarkup(true)}
    ${reportsSectionMarkup(true)}
  `;
}

function renderTrips() {
  return `
    <section class="tb-section">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h2 mb-0">All Hiking Trips</h1>
        <span class="tb-muted">${dataStore.trips.length} trips available</span>
      </div>
      <div class="row g-3">
        ${
          dataStore.trips.length === 0
            ? `
          <div class="col-12">
            <article class="card h-100 tb-card">
              <div class="card-body">
                <h2 class="h5 card-title mb-2">No Trips Loaded</h2>
                <p class="tb-muted mb-0">Trip cards will render here once your sample data is added.</p>
              </div>
            </article>
          </div>
        `
            : `
        ${dataStore.trips
          .map(
            (trip) => `
          <div class="col-sm-6 col-lg-4">
            <article class="card h-100 tb-card">
              <div class="card-body d-flex flex-column">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <h2 class="h5 card-title mb-0">${escapeHtml(trip.name)}</h2>
                  <span class="badge tb-badge ${difficultyBadgeClass(trip.difficulty)}">${trip.difficulty}</span>
                </div>
                <p class="tb-muted mb-1">${escapeHtml(trip.location)}</p>
                <p class="mb-2">${trip.category}</p>
                <p class="mb-4"><strong>${money(trip.price)}</strong></p>
                <div class="mt-auto d-flex gap-2">
                  <button class="btn btn-sm tb-btn-primary flex-grow-1" data-trip-detail="${trip.id}">Book Now</button>
                  <button class="btn btn-sm btn-outline-secondary flex-grow-1" data-trip-detail="${trip.id}">View</button>
                </div>
              </div>
            </article>
          </div>
        `
          )
          .join("")}
        `
        }
      </div>
    </section>
  `;
}

function renderTripDetail() {
  const trip = dataStore.trips.find((item) => item.id === state.selectedTripId) || dataStore.trips[0];
  if (!trip) {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Trip Details</h1>
        ${emptyState("No trip records found.")}
      </section>
    `;
  }

  return `
    <section class="tb-section">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h2 mb-0">Trip Details</h1>
        <button class="btn btn-sm btn-outline-secondary" data-route-btn="trips">Back to Trips</button>
      </div>
      <article class="card tb-card">
        <div class="card-body p-4">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
            <div>
              <h2 class="h3 mb-1">${escapeHtml(trip.name)}</h2>
              <p class="tb-muted mb-0">${escapeHtml(trip.location)}</p>
            </div>
            <div class="text-end">
              <span class="badge tb-badge ${difficultyBadgeClass(trip.difficulty)} mb-2">${trip.difficulty}</span>
              <p class="h4 mb-0">${money(trip.price)}</p>
            </div>
          </div>

          <div class="tb-detail-grid">
            <div class="tb-detail-item"><div class="tb-detail-label">Distance</div><div>${trip.distance}</div></div>
            <div class="tb-detail-item"><div class="tb-detail-label">Date</div><div>${trip.date}</div></div>
            <div class="tb-detail-item"><div class="tb-detail-label">Time</div><div>${trip.time}</div></div>
            <div class="tb-detail-item"><div class="tb-detail-label">Category</div><div>${trip.category}</div></div>
            <div class="tb-detail-item"><div class="tb-detail-label">Hikers</div><div>${trip.hikers}</div></div>
            <div class="tb-detail-item"><div class="tb-detail-label">Difficulty</div><div>${trip.difficulty}</div></div>
          </div>

          <div class="mt-4 d-flex gap-2 flex-wrap">
            <button class="btn tb-btn-primary" data-route-btn="reservations">Proceed to Reservations</button>
            <button class="btn btn-outline-secondary" data-route-btn="trips">Browse More Trips</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderReservations() {
  return reservationsSectionMarkup(false);
}

function renderCustomers() {
  return customersSectionMarkup(false);
}

function renderEmployees() {
  return employeesSectionMarkup(false);
}

function renderReports() {
  return reportsSectionMarkup(false);
}

function updateActiveNav() {
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.route === state.route);
  });
}

function render() {
  if (state.route === "trips") appElement.innerHTML = renderTrips();
  else if (state.route === "trip-detail") appElement.innerHTML = renderTripDetail();
  else if (state.route === "reservations") appElement.innerHTML = renderReservations();
  else if (state.route === "customers") appElement.innerHTML = renderCustomers();
  else if (state.route === "employees") appElement.innerHTML = renderEmployees();
  else if (state.route === "reports") appElement.innerHTML = renderReports();
  else appElement.innerHTML = renderHome();

  updateActiveNav();
}

function goToRoute(route) {
  state.route = route;
  render();
}

document.addEventListener("click", (event) => {
  const routeTarget = event.target.closest("[data-route], [data-route-btn]");
  if (routeTarget) {
    event.preventDefault();
    const route = routeTarget.dataset.route || routeTarget.dataset.routeBtn;
    goToRoute(route);
  }

  const detailTarget = event.target.closest("[data-trip-detail]");
  if (detailTarget) {
    event.preventDefault();
    state.selectedTripId = Number(detailTarget.dataset.tripDetail);
    goToRoute("trip-detail");
  }
});

loadData();
