const appElement = document.querySelector("#app");
const navLinks = Array.from(document.querySelectorAll("#nav-links .nav-link"));

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

const difficultyClassMap = {
  Easy: "tb-difficulty-easy",
  Moderate: "tb-difficulty-moderate",
  Hard: "tb-difficulty-hard"
};

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
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`${endpoint} failed (${response.status})`);
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
  return {
    id: normalizeNumber(row.id),
    name: normalizeText(row.name, "Unnamed Trip"),
    location: normalizeText(row.location, "Unknown location"),
    difficulty: normalizeText(row.difficulty, "Moderate"),
    price: normalizeNumber(row.price),
    distance: normalizeText(row.distance, "TBD"),
    date: normalizeText(row.date, "TBD"),
    category: normalizeText(row.category, "General"),
    hikers: normalizeNumber(row.hikers),
    time: normalizeText(row.time, "TBD")
  };
}

function normalizeReservation(row) {
  return {
    id: normalizeText(row.id, "-"),
    trip: normalizeText(row.trip, "Unknown trip"),
    customer: normalizeText(row.customer, "Unknown customer"),
    date: normalizeText(row.date, "-"),
    seats: normalizeNumber(row.seats),
    status: normalizeText(row.status, "Pending")
  };
}

function normalizeCustomer(row) {
  return {
    id: normalizeText(row.id, "-"),
    name: normalizeText(row.name, "Unknown"),
    email: normalizeText(row.email, "-"),
    phone: normalizeText(row.phone, "-"),
    city: normalizeText(row.city, "-")
  };
}

function normalizeEmployee(row) {
  return {
    id: normalizeText(row.id, "-"),
    name: normalizeText(row.name, "Unknown"),
    role: normalizeText(row.role, "-"),
    department: normalizeText(row.department, "-"),
    email: normalizeText(row.email, "-")
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
    const [trips, reservations, customers, employees, reports] = await Promise.all([
      fetchJson("/api/trips"),
      fetchJson("/api/reservations"),
      fetchJson("/api/customers"),
      fetchJson("/api/employees"),
      fetchJson("/api/reports")
    ]);

    dataStore.trips = (Array.isArray(trips) ? trips : []).map(normalizeTrip);
    dataStore.reservations = (Array.isArray(reservations) ? reservations : []).map(normalizeReservation);
    dataStore.customers = (Array.isArray(customers) ? customers : []).map(normalizeCustomer);
    dataStore.employees = (Array.isArray(employees) ? employees : []).map(normalizeEmployee);
    dataStore.reports = (Array.isArray(reports) ? reports : []).map(normalizeReport);
    state.selectedTripId = dataStore.trips[0]?.id ?? null;
  } catch (error) {
    console.error("Failed to load API data:", error);
    dataStore.trips = fallbackSampleData.trips.map(normalizeTrip);
    dataStore.reservations = fallbackSampleData.reservations.map(normalizeReservation);
    dataStore.customers = fallbackSampleData.customers.map(normalizeCustomer);
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

function renderHome() {
  const featured = dataStore.trips.slice(0, 3);
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

    <section class="tb-section">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h2 class="h3 mb-0">Featured Trips</h2>
        <button class="btn btn-sm tb-btn-primary" data-route-btn="trips">See All</button>
      </div>
      <div class="row g-3">
        ${
          featured.length === 0
            ? `
          <div class="col-12">
            <article class="card h-100 tb-card">
              <div class="card-body">
                <h3 class="h5 card-title mb-2">No Featured Trips Yet</h3>
                <p class="tb-muted mb-0">Add trips to the sample data and featured cards will appear here.</p>
              </div>
            </article>
          </div>
        `
            : `
        ${featured
          .map(
            (trip) => `
          <div class="col-md-6 col-lg-4">
            <article class="card h-100 tb-card">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <h3 class="h5 card-title mb-0">${escapeHtml(trip.name)}</h3>
                  <span class="badge tb-badge ${difficultyClassMap[trip.difficulty]}">${trip.difficulty}</span>
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
                  <span class="badge tb-badge ${difficultyClassMap[trip.difficulty]}">${trip.difficulty}</span>
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
              <span class="badge tb-badge ${difficultyClassMap[trip.difficulty]} mb-2">${trip.difficulty}</span>
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
  return `
    <section class="tb-section">
      <h1 class="h2 mb-3">Reservations</h1>
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
            ${
              dataStore.reservations.length === 0
                ? `
              <tr>
                <td colspan="6" class="text-center tb-muted py-4">No reservations yet.</td>
              </tr>
            `
                : dataStore.reservations
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
              </tr>
            `
                  )
                  .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCustomers() {
  return `
    <section class="tb-section">
      <h1 class="h2 mb-3">Customers</h1>
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
            ${
              dataStore.customers.length === 0
                ? `
              <tr>
                <td colspan="5" class="text-center tb-muted py-4">No customers yet.</td>
              </tr>
            `
                : dataStore.customers
                  .map(
                    (customer) => `
              <tr>
                <td>${customer.id}</td>
                <td>${escapeHtml(customer.name)}</td>
                <td>${escapeHtml(customer.email)}</td>
                <td>${escapeHtml(customer.phone)}</td>
                <td>${escapeHtml(customer.city)}</td>
              </tr>
            `
                  )
                  .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEmployees() {
  return `
    <section class="tb-section">
      <h1 class="h2 mb-3">Employees</h1>
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
            ${
              dataStore.employees.length === 0
                ? `
              <tr>
                <td colspan="5" class="text-center tb-muted py-4">No employees yet.</td>
              </tr>
            `
                : dataStore.employees
                  .map(
                    (employee) => `
              <tr>
                <td>${employee.id}</td>
                <td>${escapeHtml(employee.name)}</td>
                <td>${escapeHtml(employee.role)}</td>
                <td>${escapeHtml(employee.department)}</td>
                <td>${escapeHtml(employee.email)}</td>
              </tr>
            `
                  )
                  .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderReports() {
  return `
    <section class="tb-section">
      <h1 class="h2 mb-3">Reports</h1>
      <div class="row g-3">
        ${
          dataStore.reports.length === 0
            ? `
          <div class="col-12">
            <article class="card tb-card tb-report-card h-100">
              <div class="card-body">
                <h2 class="h5 card-title">No Reports Loaded</h2>
                <p class="mb-0 tb-muted">Report placeholders will render from your sample data.</p>
              </div>
            </article>
          </div>
        `
            : `
        ${dataStore.reports
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
