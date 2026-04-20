const appElement = document.querySelector("#app");
const navLinksContainer = document.querySelector("#nav-links");
const navbarCollapse = document.querySelector("#trailBuddyNav");
const headerElement = document.querySelector("header");

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
    {
      title: "View monthly revenue trends",
      description: "Line or bar chart of recognized revenue by month.",
      period: "Placeholder"
    },
    {
      title: "View top customers by spending",
      description: "Ranked customers by total reservation spend.",
      period: "Placeholder"
    },
    {
      title: "View top selling trip categories by revenue",
      description: "Trip categories aggregated by booked revenue.",
      period: "Placeholder"
    },
    {
      title: "View trips by difficulty level",
      description: "Trip counts or share by easy, moderate, and hard.",
      period: "Placeholder"
    },
    {
      title: "View reservation status breakdown",
      description: "Pending, confirmed, cancelled, and other statuses.",
      period: "Placeholder"
    }
  ]
};

/** Admin Reports page: static cards until wired to analytics/export. */
const adminReportPlaceholderRows = fallbackSampleData.reports;

const dataStore = {
  trips: [],
  reservations: [],
  customers: [],
  employees: [],
  reports: [],
  guidedTrips: []
};

const state = {
  route: "home",
  selectedTripId: null,
  /** Set after POST /api/book; cleared after pay, save-for-later, or starting a new book flow. */
  checkout: null,
  /** One-shot message shown on the next full page render (e.g. after checkout). */
  flash: null,
  /** Profile route: idle | loading | loaded | error */
  profile: { status: "idle", error: null, data: null },
  /** Shown once on profile page after a successful save (survives loadData re-render). */
  profileNotice: null,
  /** Trip leaders cache: tripId -> { status, error, leaders[] } */
  tripLeaders: {},
  /** When true, after routing to Trips auto-open the Add Trip modal. */
  openAddTripModal: false
};

/** Previous { route, selectedTripId } snapshots for Back (not browser history). */
const routeHistory = [];
const ROUTE_HISTORY_MAX = 40;

let currentUser = null;
let authView = "login";
const currentUserStorageKey = "trailbuddy.currentUser";

const roleRoutes = {
  hiker: ["home", "trips", "reservations"],
  employee: ["home", "trips", "reservations", "customers"],
  admin: ["home", "trips", "reservations", "customers", "employees", "reports"]
};

function isAdmin() {
  return currentUser?.role === "admin";
}

function loadStoredCurrentUser() {
  try {
    const raw = window.localStorage.getItem(currentUserStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const role = normalizeText(parsed.role, "").toLowerCase();
    if (!roleRoutes[role]) return null;

    return {
      role,
      id: parsed.id ?? null,
      name: normalizeText(parsed.name, "User")
    };
  } catch {
    return null;
  }
}

function saveCurrentUser() {
  try {
    if (currentUser) window.localStorage.setItem(currentUserStorageKey, JSON.stringify(currentUser));
    else window.localStorage.removeItem(currentUserStorageKey);
  } catch {
    /* ignore localStorage failures */
  }
}

/** Hikers only see their own rows; staff roles see the full list (API still returns all — filter is UI + trust). */
function reservationBelongsToCurrentUser(reservation) {
  if (!currentUser || currentUser.role !== "hiker" || currentUser.id == null) return true;
  const uid = Number(currentUser.id);
  if (!Number.isFinite(uid)) return true;
  const cid = reservation.customerId;
  if (cid == null) return false;
  return Number(cid) === uid;
}

function reservationsForCurrentView() {
  if (!currentUser || currentUser.role !== "hiker") return dataStore.reservations;
  return dataStore.reservations.filter(
    (r) => reservationBelongsToCurrentUser(r) && reservationStatusIsActiveBooking(r.status)
  );
}

function reservationStatusIsActiveBooking(status) {
  const s = String(status || "").toLowerCase();
  return s === "pending" || s === "confirmed";
}

/** True when the logged-in hiker has a non-cancelled reservation for this trip (home / trip list badges). */
function currentUserHasReservationForTrip(tripId) {
  if (!currentUser || currentUser.role !== "hiker") return false;
  const tid = Number(tripId);
  if (!Number.isFinite(tid)) return false;
  return dataStore.reservations.some((r) => {
    if (!reservationBelongsToCurrentUser(r)) return false;
    const rid = coalesceNumericId(r.tripId);
    if (rid == null || rid !== tid) return false;
    return reservationStatusIsActiveBooking(r.status);
  });
}

function tripReservedBadgeMarkup(tripId) {
  if (!currentUserHasReservationForTrip(tripId)) return "";
  return `<span class="badge tb-trip-reserved align-middle">Reserved</span>`;
}

function pushRouteHistory() {
  routeHistory.push({ route: state.route, selectedTripId: state.selectedTripId });
  while (routeHistory.length > ROUTE_HISTORY_MAX) routeHistory.shift();
}

function clearRouteHistory() {
  routeHistory.length = 0;
}

function goBack() {
  if (state.route === "profile") {
    state.profile = { status: "idle", error: null, data: null };
    state.profileNotice = null;
  }
  const prev = routeHistory.pop();
  if (!prev) {
    state.route = "home";
  } else {
    state.route = prev.route;
    state.selectedTripId = prev.selectedTripId;
  }
  render();
}

function backButtonMarkup() {
  if (!currentUser || state.route === "home") return "";
  const label = routeHistory.length > 0 ? "Back" : "Home";
  return `
    <div class="tb-back-bar mb-3">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-nav-back="1" aria-label="Go back">
        ← ${label}
      </button>
    </div>`;
}

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

function formatTimeAmPm(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  // If already looks like "10:00 AM" / "10 AM", keep as-is.
  if (/(am|pm)\b/i.test(raw)) return raw.replace(/\s+/g, " ").trim();

  // Expect "HH:mm" or "HH:mm:ss" (API normalizes TIME as "hh:mm:ss")
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return raw;

  let hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return raw;

  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function normalizeDateForInput(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const mm = String(m[1]).padStart(2, "0");
    const dd = String(m[2]).padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

/** 24h HH:mm for &lt;input type="time"&gt; from API TIME / string. */
function normalizeTimeForInput(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  const hh = Math.min(23, Number(m[1]));
  const mm = m[2];
  if (!Number.isFinite(hh)) return "";
  return `${String(hh).padStart(2, "0")}:${mm}`;
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

async function postJson(endpoint, payload) {
  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.message || `${endpoint} failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

async function patchJson(endpoint, payload) {
  const response = await fetch(apiUrl(endpoint), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.message || `${endpoint} failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

async function deleteJson(endpoint) {
  const response = await fetch(apiUrl(endpoint), { method: "DELETE" });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.message || `${endpoint} failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function adminHeadersJson() {
  const h = { "Content-Type": "application/json" };
  if (isAdmin() && Number.isFinite(Number(currentUser?.id))) {
    h["X-TrailBuddy-Admin-Id"] = String(currentUser.id);
  }
  return h;
}

function adminHeadersDelete() {
  const h = {};
  if (isAdmin() && Number.isFinite(Number(currentUser?.id))) {
    h["X-TrailBuddy-Admin-Id"] = String(currentUser.id);
  }
  return h;
}

async function adminPatchJson(endpoint, payload) {
  const response = await fetch(apiUrl(endpoint), {
    method: "PATCH",
    headers: adminHeadersJson(),
    body: JSON.stringify(payload)
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.message || `${endpoint} failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

async function adminPostJson(endpoint, payload) {
  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    headers: adminHeadersJson(),
    body: JSON.stringify(payload)
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.message || `${endpoint} failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

async function adminDeleteJson(endpoint) {
  const response = await fetch(apiUrl(endpoint), {
    method: "DELETE",
    headers: adminHeadersDelete()
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.message || `${endpoint} failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function ensureConfirmModal() {
  if (document.querySelector("#tb-confirm-modal")) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="tb-confirm-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content tb-card">
          <div class="modal-header border-0 pb-0">
            <h2 class="modal-title h5 mb-0" id="tb-confirm-title">Are you sure?</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body pt-2">
            <p class="mb-0" id="tb-confirm-message"></p>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" id="tb-confirm-cancel-btn">
              Never mind
            </button>
            <button type="button" class="btn btn-danger" id="tb-confirm-ok-btn">Yes, cancel it</button>
          </div>
        </div>
      </div>
    </div>
  `.trim();
  document.body.appendChild(wrapper.firstElementChild);
}

function confirmDialog({ title = "Are you sure?", message = "" } = {}) {
  ensureConfirmModal();
  const modalEl = document.querySelector("#tb-confirm-modal");
  const titleEl = document.querySelector("#tb-confirm-title");
  const messageEl = document.querySelector("#tb-confirm-message");
  const okBtn = document.querySelector("#tb-confirm-ok-btn");
  const cancelBtn = document.querySelector("#tb-confirm-cancel-btn");
  if (!modalEl || !titleEl || !messageEl || !okBtn || !cancelBtn || !window.bootstrap?.Modal) {
    return Promise.resolve(window.confirm(message || title));
  }

  titleEl.textContent = title;
  messageEl.textContent = message;

  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: "static" });

  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modalEl.removeEventListener("hidden.bs.modal", onHidden);
    };
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };
    const onOk = () => {
      modal.hide();
      finish(true);
    };
    const onCancel = () => {
      modal.hide();
      finish(false);
    };
    const onHidden = () => finish(false);

    okBtn.addEventListener("click", onOk, { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
    modalEl.addEventListener("hidden.bs.modal", onHidden, { once: true });

    modal.show();
  });
}

function ensureEmployeeModal() {
  if (document.querySelector("#tb-employee-modal")) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="tb-employee-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content tb-card">
          <div class="modal-header border-0 pb-0">
            <h2 class="modal-title h5 mb-0" id="tb-employee-title">Guide profile</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body pt-2">
            <div id="tb-employee-body"></div>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `.trim();
  document.body.appendChild(wrapper.firstElementChild);
}

async function showEmployeeProfile(employeeId) {
  ensureEmployeeModal();
  const modalEl = document.querySelector("#tb-employee-modal");
  const titleEl = document.querySelector("#tb-employee-title");
  const bodyEl = document.querySelector("#tb-employee-body");
  if (!modalEl || !titleEl || !bodyEl || !window.bootstrap?.Modal) return;

  bodyEl.innerHTML = `<p class="tb-muted mb-0">Loading…</p>`;
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  try {
    const profile = await fetchJson(`/api/employees/${employeeId}`);
    const name = escapeHtml(profile?.name || profile?.email || `Employee #${employeeId}`);
    const role = escapeHtml(profile?.role || "Employee");
    const dept = profile?.department ? escapeHtml(profile.department) : "—";
    const avail = profile?.availability ? escapeHtml(profile.availability) : "—";
    const email = profile?.email ? escapeHtml(profile.email) : "—";

    titleEl.textContent = name;
    bodyEl.innerHTML = `
      <div class="tb-detail-grid tb-detail-grid-lg">
        <div class="tb-detail-item"><div class="tb-detail-label">Role</div><div class="tb-detail-value">${role}</div></div>
        <div class="tb-detail-item"><div class="tb-detail-label">Department</div><div class="tb-detail-value">${dept}</div></div>
        <div class="tb-detail-item"><div class="tb-detail-label">Availability</div><div class="tb-detail-value">${avail}</div></div>
        <div class="tb-detail-item"><div class="tb-detail-label">Email</div><div class="tb-detail-value">${email}</div></div>
      </div>`;
  } catch (e) {
    titleEl.textContent = "Guide profile";
    bodyEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(e?.message || "Failed to load employee profile.")}</div>`;
  }
}

function normalizeText(value, fallback = "") {
  if (value == null) return fallback;
  // ASP.NET sometimes serializes DateTime inside loosely-typed JSON as { year, month, day }.
  if (typeof value === "object" && value !== null && "year" in value && "month" in value && "day" in value) {
    const y = value.year;
    const m = value.month;
    const d = value.day;
    if (typeof y === "number" && typeof m === "number" && typeof d === "number") {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
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
  const distanceInput =
    dist == null || dist === ""
      ? ""
      : typeof dist === "number"
        ? String(dist)
        : (() => {
            const s = normalizeText(dist, "");
            const n = Number(String(s).replace(/[^0-9.-]/g, ""));
            return Number.isFinite(n) ? String(n) : s;
          })();

  return {
    id: normalizeNumber(row.id),
    name: normalizeText(row.name, "Unnamed Trip"),
    location: normalizeText(row.location, "Unknown location"),
    difficulty: normalizeText(row.difficulty, "Moderate"),
    price: normalizeNumber(row.price),
    distance: distanceLabel,
    distanceInput,
    date: normalizeText(row.date, "TBD"),
    dateInput: normalizeDateForInput(row.date),
    timeInput: normalizeTimeForInput(row.time),
    category: normalizeText(row.category, "General"),
    hikers: normalizeNumber(row.hikers),
    time: formatTimeAmPm(normalizeText(row.time, "TBD")) || "TBD"
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
    time: formatTimeAmPm(normalizeText(row.time, ""))
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
    fname,
    lname,
    name: normalizeText(row.name, fromParts || "Unknown"),
    email: normalizeText(row.email, "-"),
    phone: normalizeText(row.phone, "-"),
    city: normalizeText(row.city, "-"),
    birthday: normalizeText(row.birthday, "-"),
    birthdayInput: normalizeDateForInput(row.birthday),
    registrationdate: normalizeText(row.registrationdate, "-"),
    tripId: coalesceNumericId(row.tripId ?? row.tripid),
    trip: normalizeText(row.trip, "")
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

function ensureAdminCrudModals() {
  if (document.getElementById("tb-admin-trip-edit-modal")) return;
  const maxBday = new Date().toISOString().slice(0, 10);
  document.body.insertAdjacentHTML(
    "beforeend",
    `
<div class="modal fade" id="tb-admin-trip-edit-modal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-scrollable">
    <div class="modal-content">
      <form id="tb-admin-trip-edit-form">
        <div class="modal-header">
          <h2 class="modal-title h5 mb-0" id="tb-admin-trip-edit-title">Edit hike</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div id="tb-admin-trip-edit-message" class="alert d-none mb-3" role="alert"></div>
          <input type="hidden" id="admin-trip-edit-id" name="tripId" value="" />
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label" for="admin-trip-name">Trip name</label><input class="form-control" id="admin-trip-name" name="TripName" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-location">Location</label><input class="form-control" id="admin-trip-location" name="Location" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-distance">Distance</label><input class="form-control" id="admin-trip-distance" name="Distance" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-date">Date</label><input type="date" class="form-control" id="admin-trip-date" name="Date" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-price">Price</label><input type="number" min="0" step="0.01" class="form-control" id="admin-trip-price" name="Price" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-hikers">Max hikers</label><input type="number" min="1" class="form-control" id="admin-trip-hikers" name="NumberOfHikers" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-difficulty">Difficulty</label><input class="form-control" id="admin-trip-difficulty" name="DifficultyLevel" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-category">Category</label><input class="form-control" id="admin-trip-category" name="Category" required /></div>
            <div class="col-md-6"><label class="form-label" for="admin-trip-time">Time</label><input type="time" class="form-control" id="admin-trip-time" name="Time" required /></div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn tb-btn-primary">Save changes</button>
        </div>
      </form>
    </div>
  </div>
</div>
<div class="modal fade" id="tb-admin-customer-modal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-scrollable">
    <div class="modal-content">
      <form id="tb-admin-customer-form">
        <div class="modal-header">
          <h2 class="modal-title h5 mb-0" id="tb-admin-customer-title">Customer</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div id="tb-admin-customer-message" class="alert d-none mb-3" role="alert"></div>
          <input type="hidden" id="admin-customer-id" name="customerId" value="" />
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label" for="admin-customer-fname">First name</label><input class="form-control" id="admin-customer-fname" name="fname" required autocomplete="given-name" /></div>
            <div class="col-md-6"><label class="form-label" for="admin-customer-lname">Last name</label><input class="form-control" id="admin-customer-lname" name="lname" required autocomplete="family-name" /></div>
            <div class="col-12"><label class="form-label" for="admin-customer-email">Email</label><input type="email" class="form-control" id="admin-customer-email" name="email" required autocomplete="email" /></div>
            <div class="col-12"><label class="form-label" for="admin-customer-birthday">Date of birth</label><input type="date" class="form-control" id="admin-customer-birthday" name="birthday" required min="1900-01-01" max="${maxBday}" /></div>
            <div class="col-12"><label class="form-label" for="admin-customer-password">Password</label><input type="password" class="form-control" id="admin-customer-password" name="password" autocomplete="new-password" /><p class="small tb-muted mb-0" id="admin-customer-password-hint"></p></div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn tb-btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>
</div>
`.trim()
  );
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

    // If staff user still has email as display name, hydrate it from profile.
    if (
      (currentUser?.role === "employee" || currentUser?.role === "admin") &&
      String(currentUser?.name || "").includes("@") &&
      Number.isFinite(Number(currentUser?.id))
    ) {
      try {
        const profile = await fetchJson(`/api/auth/profile?role=${currentUser.role}&userId=${Number(currentUser.id)}`);
        const hydratedName = [profile?.fname, profile?.lname].filter(Boolean).join(" ").trim();
        if (hydratedName) {
          currentUser.name = hydratedName;
          saveCurrentUser();
        }
      } catch {
        /* ignore */
      }
    }

    // One request at a time keeps concurrent MySQL connections at ~1 (helps small RDS / low max_connections).
    const trips = await fetchJson("/api/trips");
    const reservations = await fetchJson("/api/reservations");
    const employees = await fetchJson("/api/employees");
    const reports = await fetchJson("/api/reports");

    let customers;
    let guidedTrips;
    if (currentUser?.role === "employee" && Number.isFinite(Number(currentUser?.id))) {
      guidedTrips = await fetchJson(`/api/employees/${Number(currentUser.id)}/guided-trips`);
      customers = await fetchJson(`/api/employees/${Number(currentUser.id)}/guided-customers`);
    } else {
      guidedTrips = [];
      customers = await fetchJson("/api/customers");
    }

    dataStore.trips = (Array.isArray(trips) ? trips : []).map(normalizeTrip);
    dataStore.customers = (Array.isArray(customers) ? customers : []).map(normalizeCustomer);
    dataStore.guidedTrips = (Array.isArray(guidedTrips) ? guidedTrips : []).map(normalizeTrip);
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

function reservationPayButtonMarkup(res) {
  if (currentUser?.role !== "hiker") return "";
  if (String(res.status || "").toLowerCase() !== "pending") return "";
  if (!reservationBelongsToCurrentUser(res)) return "";
  const rid = coalesceNumericId(res.id) ?? Number(String(res.id).replace(/\D/g, ""));
  if (!Number.isFinite(rid) || rid <= 0) return "";
  const tid = res.tripId != null ? Number(res.tripId) : "";
  const seats = Number(res.seats) || 1;
  return `
 <button type="button" class="btn btn-sm btn-outline-primary ms-2" data-pay-reservation="${rid}" data-trip-id="${tid}" data-seats="${seats}">
                    Pay
                  </button>`;
}

function reservationCancelButtonMarkup(res) {
  if (currentUser?.role !== "hiker") return "";
  const st = String(res.status || "").toLowerCase();
  if (st !== "pending" && st !== "confirmed") return "";
  if (!reservationBelongsToCurrentUser(res)) return "";
  const rid = coalesceNumericId(res.id) ?? Number(String(res.id).replace(/\D/g, ""));
  if (!Number.isFinite(rid) || rid <= 0) return "";
  return `
 <button type="button" class="btn btn-sm btn-outline-danger ms-2" data-cancel-reservation="${rid}">
                    Cancel
                  </button>`;
}

function reservationsTableRowsMarkup() {
  const list = reservationsForCurrentView();
  const showReservationId = currentUser?.role !== "hiker";
  if (list.length === 0) {
    const msg =
      currentUser?.role === "hiker" && dataStore.reservations.length > 0
        ? "No reservations match your account."
        : "No reservations yet.";
    const colCount = showReservationId ? 6 : 5;
    return `
              <tr>
                <td colspan="${colCount}" class="text-center tb-muted py-4">${escapeHtml(msg)}</td>
              </tr>`;
  }
  return list
    .map(
      (res) => `
              <tr>
                ${showReservationId ? `<td>${res.id}</td>` : ""}
                <td>
                  ${
                    Number.isFinite(Number(res.tripId)) && Number(res.tripId) > 0
                      ? `<a href="#" class="link-underline link-underline-opacity-0 link-underline-opacity-75-hover" data-trip-detail="${Number(res.tripId)}">${escapeHtml(res.trip)}</a>`
                      : `${escapeHtml(res.trip)}`
                  }
                </td>
                <td>${escapeHtml(res.customer)}</td>
                <td>${res.date}</td>
                <td>${res.seats}</td>
                <td class="text-nowrap">
                  <span class="badge text-dark ${statusBadgeClass(res.status)}">${res.status}</span>
                  ${reservationPayButtonMarkup(res)}
                  ${reservationCancelButtonMarkup(res)}
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
  const title = currentUser?.role === "hiker" ? "My reservations" : "Reservations";
  const showReservationId = currentUser?.role !== "hiker";
  const list = reservationsForCurrentView();
  const countLabel =
    currentUser?.role === "hiker"
      ? `${list.length} booking${list.length === 1 ? "" : "s"}`
      : `${list.length} total`;
  const flash = state.flash;
  if (flash) state.flash = null;
  return `
    ${sectionOpen}
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <${h} class="${hClass}">${title}</${h}>
        <span class="tb-muted">${countLabel}</span>
      </div>
      ${
        flash
          ? `<div class="alert alert-info mb-3" role="status">${escapeHtml(flash)}</div>`
          : ""
      }
      <div class="table-responsive tb-table-wrap">
        <table class="table table-hover mb-0 align-middle">
          <thead>
            <tr>
              ${showReservationId ? "<th>Reservation ID</th>" : ""}
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
  const adm = isAdmin();
  const colspan = adm ? 6 : 5;
  if (dataStore.customers.length === 0) {
    return `
              <tr>
                <td colspan="${colspan}" class="text-center tb-muted py-4">No customers yet.</td>
              </tr>`;
  }
  return dataStore.customers
    .map((customer) => {
      const cid = coalesceNumericId(customer.id);
      const idAttr = Number.isFinite(cid) && cid > 0 ? cid : "";
      const actions =
        adm && idAttr !== ""
          ? `<td class="text-end text-nowrap">
              <button type="button" class="btn btn-sm btn-outline-secondary me-1" data-admin-edit-customer="${idAttr}">Edit</button>
              <button type="button" class="btn btn-sm btn-outline-danger" data-admin-del-customer="${idAttr}">Delete</button>
            </td>`
          : "";
      return `
              <tr>
                <td>${customer.id}</td>
                <td>${escapeHtml(customer.name)}</td>
                <td>${escapeHtml(customer.email)}</td>
                <td>${escapeHtml(customer.phone)}</td>
                <td>${escapeHtml(customer.city)}</td>
                ${actions}
              </tr>`;
    })
    .join("");
}

function customersSectionMarkup(forDashboard) {
  const h = forDashboard ? "h2" : "h1";
  const hClass = forDashboard ? "h3 mb-0" : "h2 mb-0";
  const sectionOpen = forDashboard
    ? '<section id="dash-customers" class="tb-section tb-dashboard-anchor">'
    : '<section class="tb-section">';
  const adm = isAdmin();
  return `
    ${sectionOpen}
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <${h} class="${hClass}">Customers</${h}>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <span class="tb-muted">${dataStore.customers.length} total</span>
          ${
            adm
              ? `<button type="button" class="btn btn-sm tb-btn-primary" data-admin-add-customer="1">Add customer</button>`
              : ""
          }
        </div>
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
              ${adm ? `<th class="text-end">Actions</th>` : ""}
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
  const cards = adminReportPlaceholderRows.map(normalizeReport);
  return cards
    .map(
      (report) => `
          <div class="col-md-6 col-xl-4">
            <article class="card tb-card tb-report-card h-100">
              <div class="card-body d-flex flex-column">
                <h2 class="h5 card-title">${escapeHtml(report.title)}</h2>
                <p class="mb-2 tb-muted">${escapeHtml(report.description)}</p>
                <span class="badge bg-secondary align-self-start">${escapeHtml(report.period)}</span>
                <div class="mt-auto pt-3">
                  <div class="rounded-2 border border-dashed bg-light text-center py-4 px-2 tb-muted small mb-0">
                    Report data and charts will load here.
                  </div>
                </div>
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
  const allowed = getAllowedRoutes().filter((route) => route !== "home");
  const displayName = currentUser?.name && !String(currentUser.name).includes("@") ? currentUser.name : currentUser?.role;
  const heroSecondary =
    currentUser?.role === "hiker"
      ? `<button class="btn tb-btn-outline" data-route-btn="reservations">My Reservations</button>`
      : `<button class="btn tb-btn-outline" data-open-add-trip="1">Create a Trip</button>`;
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
            ${heroSecondary}
          </div>
        </div>
      </div>
    </section>

    <section class="tb-section">
      <article class="card tb-card">
        <div class="card-body">
          <h2 class="tb-welcome-title mb-3">Welcome, ${escapeHtml(displayName || "TrailBuddy user")}</h2>
          <div class="d-flex flex-wrap gap-2">
            ${allowed
              .map((route) => {
                const labelMap = {
                  trips: "Trips",
                  reservations: currentUser?.role === "hiker" ? "My Reservations" : "Reservations",
                  customers: "Customers",
                  employees: "Employees",
                  reports: "Reports"
                };
                return `<button class="btn btn-sm tb-btn-outline tb-home-quicklink" data-route-btn="${route}">${labelMap[route] || route}</button>`;
              })
              .join("")}
          </div>
        </div>
      </article>
    </section>

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
                <div class="d-flex justify-content-between align-items-start mb-2 gap-2 flex-wrap">
                  <div class="d-flex align-items-center flex-wrap gap-2">
                    <h3 class="h5 card-title mb-0">${escapeHtml(trip.name)}</h3>
                    ${tripReservedBadgeMarkup(trip.id)}
                  </div>
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
  `;
}

function renderAuthCard() {
  const isLogin = authView === "login";
  const registerBirthdayMax = new Date().toISOString().slice(0, 10);
  const mailIcon = `
    <svg class="tb-input-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 7.5h15v9h-15v-9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="m5.5 8.5 6.5 5 6.5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const lockIcon = `
    <svg class="tb-input-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 11V8.8a4.5 4.5 0 0 1 9 0V11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M7 11h10a2 2 0 0 1 2 2v5.5A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5V13a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
  return `
    <section class="tb-auth-shell">
      <div class="tb-auth-inner">
        <div class="text-center mb-4">
          <div class="d-inline-flex align-items-center gap-3 mb-2">
            <span class="tb-auth-mark">TB</span>
            <span class="tb-auth-kicker">TrailBuddy Hiking Services</span>
          </div>
          <h1 class="tb-auth-title display-6 mb-2">${isLogin ? "Welcome back." : "Join the trail."}</h1>
          <p class="tb-auth-subtitle mb-0">
            ${isLogin ? "Log in with your email — your dashboard matches the account you registered." : "Create an account to start booking guided hikes."}
          </p>
        </div>

        <article class="card tb-auth-card">
          <div class="card-body p-4 p-md-5">
            <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
              <div>
                <h2 class="h4 mb-1">${isLogin ? "Login" : "Create account"}</h2>
                <p class="tb-muted mb-0">${isLogin ? "Email and password only." : "Takes about 20 seconds."}</p>
              </div>
              <span class="badge text-dark" style="background: rgba(140, 109, 79, 0.22); border: 1px solid rgba(140, 109, 79, 0.32);">
                ${isLogin ? "Returning user" : "New explorer"}
              </span>
            </div>

            <div id="auth-message" class="alert d-none mb-3" role="alert"></div>

            <form id="${isLogin ? "login-form" : "register-form"}" class="d-grid gap-3">
              ${
                !isLogin
                  ? `
                <div class="row g-3">
                  <div class="col-12 col-sm-6">
                    <label class="form-label" for="register-fname">First name</label>
                    <input id="register-fname" name="fname" class="form-control" autocomplete="given-name" required />
                  </div>
                  <div class="col-12 col-sm-6">
                    <label class="form-label" for="register-lname">Last name</label>
                    <input id="register-lname" name="lname" class="form-control" autocomplete="family-name" required />
                  </div>
                  <div class="col-12">
                    <label class="form-label" for="register-birthday">Date of birth</label>
                    <input
                      type="date"
                      id="register-birthday"
                      name="birthday"
                      class="form-control"
                      autocomplete="bday"
                      required
                      min="1900-01-01"
                      max="${registerBirthdayMax}"
                    />
                  </div>
                </div>
                <div>
                  <label class="form-label" for="register-role">Account type</label>
                  <select id="register-role" name="role" class="form-select" required>
                    <option value="hiker" selected>Hiker</option>
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              `
                  : ""
              }

              <div>
                <label class="form-label" for="auth-email">Email</label>
                <div class="input-group">
                  <span class="input-group-text bg-white">${mailIcon}</span>
                  <input
                    id="auth-email"
                    name="email"
                    type="email"
                    class="form-control"
                    placeholder="you@example.com"
                    autocomplete="email"
                    required
                  />
                </div>
              </div>

              <div>
                <label class="form-label" for="auth-password">Password</label>
                <div class="input-group">
                  <span class="input-group-text bg-white">${lockIcon}</span>
                  <input
                    id="auth-password"
                    name="password"
                    type="password"
                    class="form-control"
                    placeholder="${isLogin ? "Your password" : "Create a password"}"
                    autocomplete="${isLogin ? "current-password" : "new-password"}"
                    required
                  />
                </div>
              </div>

              <button class="btn tb-btn-primary py-2" type="submit">${isLogin ? "Login" : "Register"}</button>
            </form>

            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
              <p class="mb-0">
                ${
                  isLogin
                    ? `Need an account? <a href="#" data-auth-view="register">Register</a>`
                    : `Already have an account? <a href="#" data-auth-view="login">Login</a>`
                }
              </p>
              <span class="small tb-muted">Trail vibes only.</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  `;
}

async function loadProfileFromApi() {
  if (!currentUser?.id) return;
  try {
    const role = encodeURIComponent(currentUser.role);
    const userId = encodeURIComponent(currentUser.id);
    const data = await fetchJson(`/api/auth/profile?role=${role}&userId=${userId}`);
    if (state.route !== "profile") return;
    state.profile = { status: "loaded", error: null, data };
  } catch (e) {
    if (state.route !== "profile") return;
    state.profile = {
      status: "error",
      error: e?.message || "Failed to load profile",
      data: null
    };
  }
  if (state.route === "profile") render();
}

function renderProfile() {
  if (!currentUser) {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Your profile</h1>
        ${emptyState("Log in to view your profile.")}
      </section>`;
  }

  const notice = state.profileNotice;
  if (notice) state.profileNotice = null;

  if (state.profile.status === "idle") {
    state.profile = { status: "loading", error: null, data: null };
    void loadProfileFromApi();
  }

  if (state.profile.status === "loading") {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Your profile</h1>
        <p class="tb-muted mb-0">Loading…</p>
      </section>`;
  }

  if (state.profile.status === "error") {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Your profile</h1>
        <div class="alert alert-danger" role="alert">${escapeHtml(state.profile.error)}</div>
        <button type="button" class="btn btn-outline-secondary" id="profile-retry">Try again</button>
      </section>`;
  }

  const d = state.profile.data;
  if (!d) {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Your profile</h1>
        <p class="tb-muted mb-0">No profile data.</p>
      </section>`;
  }

  const profileBirthdayMax = new Date().toISOString().slice(0, 10);
  const isHiker = currentUser.role === "hiker";
  const bday = normalizeDateForInput(d.birthday);
  const email = d.email || "";

  if (isHiker) {
    const fn = d.fname || "";
    const ln = d.lname || "";
    const reg = d.registrationDate || d.registrationdate || "—";
    return `
    <section class="tb-section">
      <h1 class="h2 mb-2">Your profile</h1>
      <p class="tb-muted mb-4">Update your details below. Changes save to your TrailBuddy account.</p>
      <article class="card tb-card" style="max-width: 36rem;">
        <div class="card-body p-4">
          ${notice ? `<div class="alert alert-success mb-3" role="status">${escapeHtml(notice)}</div>` : ""}
          <div id="profile-message" class="alert d-none mb-3" role="alert"></div>
          <form id="profile-form" class="d-grid gap-3">
            <div class="row g-3">
              <div class="col-sm-6">
                <label class="form-label" for="profile-fname">First name</label>
                <input class="form-control" id="profile-fname" name="fname" value="${escapeHtml(fn)}" required autocomplete="given-name" />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="profile-lname">Last name</label>
                <input class="form-control" id="profile-lname" name="lname" value="${escapeHtml(ln)}" required autocomplete="family-name" />
              </div>
            </div>
            <div>
              <label class="form-label" for="profile-email">Email</label>
              <input type="email" class="form-control" id="profile-email" name="email" value="${escapeHtml(email)}" required autocomplete="email" />
            </div>
            <div>
              <label class="form-label" for="profile-birthday">Date of birth</label>
              <input type="date" class="form-control" id="profile-birthday" name="birthday" value="${escapeHtml(bday)}" required min="1900-01-01" max="${profileBirthdayMax}" />
            </div>
            <p class="small tb-muted mb-0">Member since <strong>${escapeHtml(String(reg))}</strong></p>
            <button type="submit" class="btn tb-btn-primary">Save changes</button>
          </form>
        </div>
      </article>
    </section>`;
  }

  const jobRole = d.role || currentUser.role || "";
  const fn = d.fname || "";
  const ln = d.lname || "";
  return `
    <section class="tb-section">
      <h1 class="h2 mb-2">Your profile</h1>
      <p class="tb-muted mb-4">Staff account — update your name, email, or date of birth.</p>
      <article class="card tb-card" style="max-width: 36rem;">
        <div class="card-body p-4">
          ${notice ? `<div class="alert alert-success mb-3" role="status">${escapeHtml(notice)}</div>` : ""}
          <div id="profile-message" class="alert d-none mb-3" role="alert"></div>
          <form id="profile-form" class="d-grid gap-3">
            <div>
              <label class="form-label">Role</label>
              <p class="form-control-plaintext border rounded px-3 py-2 mb-0 bg-light">${escapeHtml(jobRole)}</p>
            </div>
            <div class="row g-3">
              <div class="col-sm-6">
                <label class="form-label" for="profile-fname-staff">First name</label>
                <input class="form-control" id="profile-fname-staff" name="fname" value="${escapeHtml(fn)}" required autocomplete="given-name" />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="profile-lname-staff">Last name</label>
                <input class="form-control" id="profile-lname-staff" name="lname" value="${escapeHtml(ln)}" required autocomplete="family-name" />
              </div>
            </div>
            <div>
              <label class="form-label" for="profile-email-staff">Email</label>
              <input type="email" class="form-control" id="profile-email-staff" name="email" value="${escapeHtml(email)}" required autocomplete="email" />
            </div>
            <div>
              <label class="form-label" for="profile-birthday-staff">Date of birth</label>
              <input type="date" class="form-control" id="profile-birthday-staff" name="birthday" value="${escapeHtml(bday)}" required min="1900-01-01" max="${profileBirthdayMax}" />
            </div>
            <button type="submit" class="btn tb-btn-primary">Save changes</button>
          </form>
        </div>
      </article>
    </section>`;
}

function renderTrips() {
  const isEmployee = currentUser?.role === "employee";
  const isHiker = currentUser?.role === "hiker";
  const leadingIds = new Set((dataStore.guidedTrips || []).map((t) => Number(t.id)).filter((n) => Number.isFinite(n)));
  return `
    <section class="tb-section">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h2 mb-0">All Hiking Trips</h1>
        <div class="d-flex align-items-center gap-2">
          <span class="tb-muted">${dataStore.trips.length} trips available</span>
          <button class="btn btn-sm tb-btn-primary" data-bs-toggle="modal" data-bs-target="#addTripModal">Add Trip</button>
        </div>
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
                <div class="d-flex justify-content-between align-items-start mb-2 gap-2 flex-wrap">
                  <div class="d-flex align-items-center flex-wrap gap-2">
                    <h2 class="h5 card-title mb-0">${escapeHtml(trip.name)}</h2>
                    ${tripReservedBadgeMarkup(trip.id)}
                    ${
                      isEmployee && leadingIds.has(Number(trip.id))
                        ? `<span class="badge tb-trip-reserved align-middle">Leading</span>`
                        : ""
                    }
                  </div>
                  <span class="badge tb-badge ${difficultyBadgeClass(trip.difficulty)}">${trip.difficulty}</span>
                </div>
                <p class="tb-muted mb-1">${escapeHtml(trip.location)}</p>
                <p class="mb-2">${trip.category}</p>
                <p class="mb-4"><strong>${money(trip.price)}</strong></p>
                <div class="mt-auto d-flex gap-2">
                  ${
                    isHiker
                      ? `<button class="btn btn-sm tb-btn-primary flex-grow-1" data-trip-book="${trip.id}">Book Now</button>`
                      : isEmployee
                        ? leadingIds.has(Number(trip.id))
                          ? `<button class="btn btn-sm btn-outline-danger flex-grow-1" data-trip-cancel-lead="${trip.id}">Cancel Guide</button>`
                          : `<button class="btn btn-sm tb-btn-primary flex-grow-1" data-trip-lead="${trip.id}">Guide</button>`
                        : ""
                  }
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

    <div class="modal fade" id="addTripModal" tabindex="-1" aria-labelledby="addTripModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <form id="add-trip-form">
            <div class="modal-header">
              <h2 class="modal-title h5 mb-0" id="addTripModalLabel">Add Trip</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div id="add-trip-message" class="alert d-none mb-3" role="alert"></div>
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label" for="trip-name">Trip Name</label>
                  <input class="form-control" id="trip-name" name="TripName" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-location">Location</label>
                  <input class="form-control" id="trip-location" name="Location" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-distance">Distance</label>
                  <input class="form-control" id="trip-distance" name="Distance" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-date">Date</label>
                  <input type="date" class="form-control" id="trip-date" name="Date" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-price">Price</label>
                  <input type="number" min="0" step="0.01" class="form-control" id="trip-price" name="Price" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-hikers">Number Of Hikers</label>
                  <input type="number" min="1" class="form-control" id="trip-hikers" name="NumberOfHikers" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-difficulty">Difficulty Level</label>
                  <input class="form-control" id="trip-difficulty" name="DifficultyLevel" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-category">Category</label>
                  <input class="form-control" id="trip-category" name="Category" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label" for="trip-time">Time</label>
                  <input type="time" class="form-control" id="trip-time" name="Time" required>
                </div>
                ${
                  currentUser?.role === "employee"
                    ? `
                <div class="col-12">
                  <div class="form-check mt-1">
                    <input class="form-check-input" type="checkbox" id="trip-lead-self" name="LeadTrip" value="1" checked>
                    <label class="form-check-label" for="trip-lead-self">
                      I want to be the guide for this trip
                    </label>
                  </div>
                </div>
                `
                    : ""
                }
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn tb-btn-primary">Create Trip</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderBookTrip() {
  state.checkout = null;
  if (currentUser?.role !== "hiker") {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Book a trip</h1>
        ${emptyState("Only hikers can book trips.")}
      </section>`;
  }

  const trip = dataStore.trips.find((item) => item.id === state.selectedTripId);
  if (!trip) {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Book a trip</h1>
        ${emptyState("Choose a hike from Trips first.")}
      </section>`;
  }

  const cap = Math.max(1, Number(trip.hikers) || 20);

  return `
    <section class="tb-section">
      <h1 class="h2 mb-2">Book this trip</h1>
      <p class="tb-muted mb-4">
        ${escapeHtml(trip.name)} · ${escapeHtml(trip.location)} · ${escapeHtml(String(trip.date))} · ${money(trip.price)} per person
      </p>
      <article class="card tb-card" style="max-width: 32rem;">
        <div class="card-body p-4">
          <div id="book-message" class="alert d-none mb-3" role="alert"></div>
          <form id="book-trip-form" class="d-grid gap-3">
            <input type="hidden" name="tripId" value="${trip.id}" />
            <div>
              <label class="form-label" for="book-party-size">Party size (number of hikers)</label>
              <input
                type="number"
                class="form-control"
                id="book-party-size"
                name="numberOfHikers"
                min="1"
                max="${cap}"
                value="1"
                required
              />
              <div class="form-text">Maximum group size for this trip: ${cap}.</div>
            </div>
            <button type="submit" class="btn tb-btn-primary">Continue to payment</button>
          </form>
        </div>
      </article>
    </section>`;
}

function renderCheckout() {
  if (currentUser?.role !== "hiker") {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Payment</h1>
        ${emptyState("Only hikers can complete checkout.")}
      </section>`;
  }

  const c = state.checkout;
  if (!c || !Number.isFinite(Number(c.reservationId)) || Number(c.reservationId) <= 0) {
    return `
      <section class="tb-section">
        <h1 class="h2 mb-3">Payment</h1>
        ${emptyState("No active checkout. Book a trip from Trips to continue.")}
      </section>`;
  }

  const trip =
    dataStore.trips.find((item) => item.id === c.tripId) ||
    (c.tripId
      ? {
          id: c.tripId,
          name: c.tripName || `Trip #${c.tripId}`,
          location: c.tripLocation || "",
          date: c.tripDate || "—",
          price: Number(c.unitPrice) || 0
        }
      : null);

  const unit = trip ? Number(trip.price) || 0 : Number(c.unitPrice) || 0;
  const party = Math.max(1, Number(c.numberOfHikers) || 1);
  const total = unit * party;
  const tripTitle = trip ? trip.name : String(c.tripName || "Your hike");
  const tripMeta = trip
    ? `${escapeHtml(trip.name)} · ${escapeHtml(trip.location)} · ${escapeHtml(String(trip.date))}`
    : escapeHtml(String(c.tripName || "Reservation"));

  return `
    <section class="tb-section">
      <h1 class="h2 mb-2">Payment</h1>
      <p class="tb-muted mb-4">Reservation #${c.reservationId} · ${tripMeta}</p>
      <div class="row g-4">
        <div class="col-lg-7">
          <article class="card tb-card">
            <div class="card-body p-4">
              <h2 class="h5 mb-3">Order summary</h2>
              <p class="mb-1"><strong>${escapeHtml(tripTitle)}</strong></p>
              <p class="tb-muted small mb-3">${party} hiker${party === 1 ? "" : "s"} × ${money(unit)}</p>
              <p class="h4 mb-0">Total due: ${money(total)}</p>
              <hr class="my-4" />
              <div class="alert alert-secondary mb-0" role="note">
                <strong>Demo checkout.</strong> No real card is charged. Use <strong>Save for later</strong> to keep this booking                in your cart as <span class="badge text-dark tb-status-pending">Pending</span>, or complete payment to mark it
                <span class="badge text-dark tb-status-confirmed">Confirmed</span>.
              </div>
            </div>
          </article>
        </div>
        <div class="col-lg-5">
          <article class="card tb-card">
            <div class="card-body p-4 d-grid gap-3">
              <div id="checkout-message" class="alert d-none mb-0" role="alert"></div>
              <button type="button" class="btn btn-outline-secondary" id="checkout-save-later">
                Save for later (keep in cart)
              </button>
              <p class="small tb-muted mb-0">
                Pending reservations stay in <strong>My reservations</strong>; you can pay anytime with <strong>Pay</strong>.
              </p>
              <hr class="my-0" />
              <form id="checkout-pay-form" class="d-grid gap-3">
                <h2 class="h6 mb-0">Pay now (simulated)</h2>
                <div>
                  <label class="form-label" for="pay-card-name">Name on card</label>
                  <input class="form-control" id="pay-card-name" name="cardName" autocomplete="cc-name" placeholder="Jamie Hiker" />
                </div>
                <div>
                  <label class="form-label" for="pay-card-number">Card number</label>
                  <input class="form-control" id="pay-card-number" name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" />
                </div>
                <div class="row g-2">
                  <div class="col-6">
                    <label class="form-label" for="pay-exp">Expires</label>
                    <input class="form-control" id="pay-exp" name="exp" placeholder="MM/YY" />
                  </div>
                  <div class="col-6">
                    <label class="form-label" for="pay-cvc">CVC</label>
                    <input class="form-control" id="pay-cvc" name="cvc" placeholder="123" />
                  </div>
                </div>
                <button type="submit" class="btn tb-btn-primary">Complete payment</button>
              </form>
            </div>
          </article>
        </div>
      </div>
    </section>`;
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

  const leaderState = state.tripLeaders[trip.id];
  if (currentUser?.role === "hiker" && (!leaderState || leaderState.status === "idle")) {
    state.tripLeaders[trip.id] = { status: "loading", error: null, leaders: [] };
    void (async () => {
      try {
        const leaders = await fetchJson(`/api/trips/${trip.id}/leaders`);
        state.tripLeaders[trip.id] = {
          status: "loaded",
          error: null,
          leaders: Array.isArray(leaders) ? leaders : []
        };
      } catch (e) {
        state.tripLeaders[trip.id] = {
          status: "error",
          error: e?.message || "Failed to load guides",
          leaders: []
        };
      }
      if (state.route === "trip-detail" && state.selectedTripId === trip.id) render();
    })();
  }

  const guidesMarkup =
    currentUser?.role !== "hiker"
      ? ""
      : (() => {
          const st = state.tripLeaders[trip.id];
          if (!st || st.status === "loading") {
            return `<div class="tb-guides card tb-card mt-4"><div class="card-body p-4"><h3 class="h5 mb-2">Guides</h3><p class="tb-muted mb-0">Loading guides…</p></div></div>`;
          }
          if (st.status === "error") {
            return `<div class="tb-guides card tb-card mt-4"><div class="card-body p-4"><h3 class="h5 mb-2">Guides</h3><div class="alert alert-warning mb-0">${escapeHtml(st.error || "Couldn't load guides.")}</div></div></div>`;
          }
          const leaders = Array.isArray(st.leaders) ? st.leaders : [];
          if (leaders.length === 0) {
            return `<div class="tb-guides card tb-card mt-4"><div class="card-body p-4"><h3 class="h5 mb-2">Guides</h3><p class="tb-muted mb-0">No guides are assigned yet.</p></div></div>`;
          }
          const items = leaders
            .map((l) => {
              const id = Number(l.id);
              const name = escapeHtml(l.name || l.email || `Employee #${id}`);
              const role = l.role ? escapeHtml(l.role) : "Guide";
              const dept = l.department ? ` · ${escapeHtml(l.department)}` : "";
              return `
                <li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <div>
                    <button type="button" class="btn btn-link p-0 tb-employee-link" data-employee-profile="${id}">
                      ${name}
                    </button>
                    <div class="small tb-muted">${role}${dept}</div>
                  </div>
                  <span class="badge text-dark" style="background: rgba(79, 109, 79, 0.16); border: 1px solid rgba(79, 109, 79, 0.28);">Leader</span>
                </li>`;
            })
            .join("");
          return `
            <div class="tb-guides card tb-card mt-4">
              <div class="card-body p-4">
                <h3 class="h5 mb-3">Guides</h3>
                <ul class="list-group list-group-flush">${items}</ul>
              </div>
            </div>`;
        })();

  return `
    <section class="tb-section tb-trip-detail-page">
      <div class="mb-3">
        <h1 class="tb-page-title mb-0">Trip Details</h1>
      </div>
      <article class="card tb-card tb-trip-hero">
        <div class="card-body tb-trip-hero-body">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
            <div class="tb-trip-hero-title">
              <h2 class="tb-trip-name mb-1">${escapeHtml(trip.name)}</h2>
              <p class="tb-trip-subtitle mb-0">${escapeHtml(trip.location)}</p>
            </div>
            <div class="text-end tb-trip-hero-price">
              <span class="badge tb-badge ${difficultyBadgeClass(trip.difficulty)} mb-2">${trip.difficulty}</span>
              <p class="tb-trip-price mb-0">${money(trip.price)} <span class="tb-trip-price-unit">per hiker</span></p>
            </div>
          </div>

          <div class="tb-detail-grid tb-detail-grid-lg">
            <div class="tb-detail-item">
              <div class="tb-detail-label">Distance</div>
              <div class="tb-detail-value">${trip.distance}</div>
            </div>
            <div class="tb-detail-item">
              <div class="tb-detail-label">Date</div>
              <div class="tb-detail-value">${trip.date}</div>
            </div>
            <div class="tb-detail-item">
              <div class="tb-detail-label">Time</div>
              <div class="tb-detail-value">${trip.time}</div>
            </div>
            <div class="tb-detail-item">
              <div class="tb-detail-label">Category</div>
              <div class="tb-detail-value">${escapeHtml(trip.category)}</div>
            </div>
            <div class="tb-detail-item">
              <div class="tb-detail-label">Hikers</div>
              <div class="tb-detail-value">${trip.hikers}</div>
            </div>
            <div class="tb-detail-item">
              <div class="tb-detail-label">Difficulty</div>
              <div class="tb-detail-value">${escapeHtml(trip.difficulty)}</div>
            </div>
          </div>

          <div class="mt-5 d-flex gap-3 flex-wrap">
            ${
              currentUser?.role === "hiker"
                ? `<button type="button" class="btn tb-btn-primary btn-lg px-4" data-route-btn="book">Book</button>`
                : ""
            }
            <button type="button" class="btn btn-outline-secondary btn-lg px-4" data-route-btn="trips">Browse More Trips</button>
            ${
              isAdmin()
                ? `<button type="button" class="btn btn-outline-secondary btn-lg px-4" data-admin-edit-trip="${trip.id}">Edit hike</button>
                  <button type="button" class="btn btn-outline-danger btn-lg px-4" data-admin-del-trip="${trip.id}">Delete hike</button>`
                : ""
            }
          </div>
        </div>
      </article>
      ${guidesMarkup}
    </section>
  `;
}

function renderMyHikesForEmployee() {
  const trips = dataStore.guidedTrips || [];
  return `
    <section class="tb-section">
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h1 class="h2 mb-0">My hikes</h1>
        <span class="tb-muted">${trips.length} trip${trips.length === 1 ? "" : "s"} you're leading</span>
      </div>

      <article class="card tb-card mb-4">
        <div class="card-body p-4">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
            <div>
              <h2 class="h5 mb-1">Create a new hike</h2>
              <p class="tb-muted mb-0">This hike will be added to Trips. Choose whether you want to lead it.</p>
            </div>
          </div>

          <div id="add-trip-message" class="alert d-none mb-3" role="alert"></div>

          <form id="add-trip-form" class="row g-2 align-items-end">
            <input type="hidden" name="EmployeeId" value="${escapeHtml(String(currentUser?.id ?? ""))}">

            <div class="col-12 col-lg-3">
              <label class="form-label mb-1" for="emp-trip-name">Trip Name</label>
              <input class="form-control" id="emp-trip-name" name="TripName" required>
            </div>
            <div class="col-12 col-lg-3">
              <label class="form-label mb-1" for="emp-trip-location">Location</label>
              <input class="form-control" id="emp-trip-location" name="Location" required>
            </div>
            <div class="col-6 col-lg-2">
              <label class="form-label mb-1" for="emp-trip-distance">Distance</label>
              <input class="form-control" id="emp-trip-distance" name="Distance" inputmode="decimal" required>
            </div>
            <div class="col-6 col-lg-2">
              <label class="form-label mb-1" for="emp-trip-date">Date</label>
              <input type="date" class="form-control" id="emp-trip-date" name="Date" required>
            </div>
            <div class="col-6 col-lg-2">
              <label class="form-label mb-1" for="emp-trip-time">Time</label>
              <input type="time" class="form-control" id="emp-trip-time" name="Time" required>
            </div>

            <div class="col-6 col-lg-2">
              <label class="form-label mb-1" for="emp-trip-price">Price</label>
              <input type="number" min="0" step="0.01" class="form-control" id="emp-trip-price" name="Price" required>
            </div>
            <div class="col-6 col-lg-2">
              <label class="form-label mb-1" for="emp-trip-hikers">Max hikers</label>
              <input type="number" min="1" class="form-control" id="emp-trip-hikers" name="NumberOfHikers" required>
            </div>
            <div class="col-6 col-lg-2">
              <label class="form-label mb-1" for="emp-trip-difficulty">Difficulty</label>
              <input class="form-control" id="emp-trip-difficulty" name="DifficultyLevel" placeholder="Easy / Moderate / Hard" required>
            </div>
            <div class="col-12 col-lg-3">
              <label class="form-label mb-1" for="emp-trip-category">Category</label>
              <input class="form-control" id="emp-trip-category" name="Category" required>
            </div>

            <div class="col-12 col-lg-3">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="emp-trip-lead-self" name="LeadTrip" value="1" checked>
                <label class="form-check-label" for="emp-trip-lead-self">
                  I want to be the guide for this trip
                </label>
              </div>
            </div>

            <div class="col-12 col-lg-1 d-grid">
              <button type="submit" class="btn tb-btn-primary">Create</button>
            </div>
          </form>
        </div>
      </article>

      <hr class="my-4" />
      <div class="row g-3">
        ${
          trips.length === 0
            ? `<div class="col-12">${emptyState("You aren't assigned to lead any hikes yet. Go to Trips and click Lead.")}</div>`
            : trips
                .map(
                  (trip) => `
          <div class="col-sm-6 col-lg-4">
            <article class="card h-100 tb-card">
              <div class="card-body d-flex flex-column">
                <div class="d-flex justify-content-between align-items-start mb-2 gap-2 flex-wrap">
                  <h2 class="h5 card-title mb-0">${escapeHtml(trip.name)}</h2>
                  <span class="badge tb-badge ${difficultyBadgeClass(trip.difficulty)}">${trip.difficulty}</span>
                </div>
                <p class="tb-muted mb-1">${escapeHtml(trip.location)}</p>
                <p class="mb-2">${escapeHtml(trip.date)} · ${escapeHtml(trip.time)}</p>
                <p class="mb-4"><strong>${money(trip.price)}</strong></p>
                <div class="mt-auto d-flex gap-2">
                  <button class="btn btn-sm btn-outline-secondary flex-grow-1" data-trip-detail="${trip.id}">View</button>
                </div>
              </div>
            </article>
          </div>`
                )
                .join("")
        }
      </div>
    </section>
  `;
}

function renderReservations() {
  if (currentUser?.role === "employee") return renderMyHikesForEmployee();
  return reservationsSectionMarkup(false);
}

function renderCustomers() {
  if (currentUser?.role === "employee") {
    const rows = Array.isArray(dataStore.customers) ? dataStore.customers : [];
    return `
      <section class="tb-section">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h1 class="h2 mb-0">Customers on my hikes</h1>
          <span class="tb-muted">${rows.length} customer${rows.length === 1 ? "" : "s"}</span>
        </div>
        <div class="table-responsive tb-table-wrap">
          <table class="table table-hover mb-0 align-middle">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>Trip</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length === 0
                  ? `<tr><td colspan="3" class="text-center tb-muted py-4">No customers yet.</td></tr>`
                  : rows
                      .map(
                        (c) => `
                  <tr>
                    <td>${escapeHtml(c.name)}</td>
                    <td>${escapeHtml(c.email)}</td>
                    <td>${
                      c.tripId
                        ? `<a href="#" class="link-underline link-underline-opacity-0 link-underline-opacity-75-hover" data-trip-detail="${Number(c.tripId)}">${escapeHtml(c.trip)}</a>`
                        : escapeHtml(c.trip || "—")
                    }</td>
                  </tr>`
                      )
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }
  return customersSectionMarkup(false);
}

function renderEmployees() {
  return employeesSectionMarkup(false);
}

function renderReports() {
  return reportsSectionMarkup(false);
}

function getAllowedRoutes() {
  if (!currentUser) return [];
  return roleRoutes[currentUser.role] || [];
}

function canAccessRoute(route) {
  if (!currentUser) return false;
  if (route === "trip-detail") return true;
  if (route === "profile") return true;
  if (route === "book" || route === "checkout") return currentUser.role === "hiker";
  return getAllowedRoutes().includes(route);
}

function normalizeRoute(route) {
  if (!currentUser) return "login";
  const allowed = getAllowedRoutes();
  if (route === "trip-detail") return "trip-detail";
  if (route === "profile") return "profile";
  if (route === "book") return currentUser.role === "hiker" ? "book" : "trips";
  if (route === "checkout") return currentUser.role === "hiker" ? "checkout" : "trips";
  if (allowed.includes(route)) return route;
  return allowed[0] || "trips";
}

function updateNavbarForRole() {
  if (!navLinksContainer || !navbarCollapse) return;

  if (!currentUser) {
    navLinksContainer.innerHTML = "";
    return;
  }

  const labels = {
    home: "Home",
    trips: "Trips",
    reservations:
      currentUser.role === "hiker" ? "My Reservations" : currentUser.role === "employee" ? "My Hikes" : "Reservations",
    profile: "My Profile",
    customers: "Customers",
    employees: "Employees",
    reports: "Reports"
  };

  navLinksContainer.innerHTML = [...getAllowedRoutes(), "profile"]
    .map((route) => `<li class="nav-item"><a class="nav-link" href="#" data-route="${route}">${labels[route] || route}</a></li>`)
    .join("");

  if (!document.querySelector("#logout-btn")) {
    const logoutWrapper = document.createElement("div");
    logoutWrapper.className = "ms-lg-3 mt-2 mt-lg-0 d-flex align-items-center gap-2";
    const navName =
      currentUser?.name && !String(currentUser.name).includes("@")
        ? currentUser.name
        : `${currentUser.role} #${currentUser.id}`;
    logoutWrapper.innerHTML = `
      <span class="small text-white-50">Hi, ${escapeHtml(navName)}</span>
      <button id="logout-btn" class="btn btn-sm btn-outline-light" type="button">Logout</button>
    `;
    navbarCollapse.appendChild(logoutWrapper);
  } else {
    const userLabel = navbarCollapse.querySelector(".small.text-white-50");
    if (userLabel) {
      const navName =
        currentUser?.name && !String(currentUser.name).includes("@")
          ? currentUser.name
          : `${currentUser.role} #${currentUser.id}`;
      userLabel.textContent = `Hi, ${navName}`;
    }
  }
}

function removeLogoutUi() {
  const logoutButton = document.querySelector("#logout-btn");
  if (logoutButton) {
    const wrapper = logoutButton.parentElement;
    if (wrapper) wrapper.remove();
  }
}

function updateActiveNav() {
  const navLinks = Array.from(document.querySelectorAll("#nav-links .nav-link"));
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.route === state.route);
  });
}

function render() {
  if (!currentUser) {
    document.body.classList.add("tb-auth-mode");
    if (headerElement) headerElement.classList.add("d-none");
    appElement.innerHTML = renderAuthCard();
    removeLogoutUi();
    updateActiveNav();
    return;
  }

  document.body.classList.remove("tb-auth-mode");
  if (headerElement) headerElement.classList.remove("d-none");
  state.route = normalizeRoute(state.route);
  document.body.classList.toggle("tb-trip-detail-bg", state.route === "trip-detail");

  let pageHtml;
  if (state.route === "trips") pageHtml = renderTrips();
  else if (state.route === "trip-detail") pageHtml = renderTripDetail();
  else if (state.route === "book") pageHtml = renderBookTrip();
  else if (state.route === "checkout") pageHtml = renderCheckout();
  else if (state.route === "profile") pageHtml = renderProfile();
  else if (state.route === "reservations") pageHtml = renderReservations();
  else if (state.route === "customers") pageHtml = renderCustomers();
  else if (state.route === "employees") pageHtml = renderEmployees();
  else if (state.route === "reports") pageHtml = renderReports();
  else pageHtml = renderHome();

  appElement.innerHTML = state.route === "home" ? pageHtml : `${backButtonMarkup()}${pageHtml}`;

  if (isAdmin()) ensureAdminCrudModals();

  updateNavbarForRole();
  updateActiveNav();

  if (state.route === "trips" && state.openAddTripModal) {
    state.openAddTripModal = false;
    const modalEl = document.querySelector("#addTripModal");
    if (modalEl && window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }
}

function goToRoute(route) {
  const target = normalizeRoute(route);
  if (state.route === "profile" && target !== "profile") {
    state.profile = { status: "idle", error: null, data: null };
    state.profileNotice = null;
  }
  if (target === state.route) {
    state.route = target;
    render();
    return;
  }
  pushRouteHistory();
  state.route = target;
  render();
}

document.addEventListener("click", async (event) => {
  const backTarget = event.target.closest("[data-nav-back]");
  if (backTarget) {
    event.preventDefault();
    goBack();
    return;
  }

  const profileRetry = event.target.closest("#profile-retry");
  if (profileRetry) {
    event.preventDefault();
    state.profile = { status: "idle", error: null, data: null };
    render();
    return;
  }

  const employeeTarget = event.target.closest("[data-employee-profile]");
  if (employeeTarget) {
    event.preventDefault();
    const employeeId = Number(employeeTarget.dataset.employeeProfile);
    if (!Number.isFinite(employeeId) || employeeId <= 0) return;
    await showEmployeeProfile(employeeId);
    return;
  }

  const payTarget = event.target.closest("[data-pay-reservation]");
  if (payTarget) {
    event.preventDefault();
    if (!canAccessRoute("checkout")) {
      state.route = "login";
      render();
      return;
    }
    const reservationId = Number(payTarget.dataset.payReservation);
    const tripId = Number(payTarget.dataset.tripId);
    const numberOfHikers = Number(payTarget.dataset.seats) || 1;
    if (!Number.isFinite(reservationId) || reservationId <= 0) return;
    const trip =
      Number.isFinite(tripId) && tripId > 0 ? dataStore.trips.find((t) => t.id === tripId) : null;
    state.checkout = {
      reservationId,
      tripId: Number.isFinite(tripId) && tripId > 0 ? tripId : null,
      numberOfHikers,
      unitPrice: trip ? trip.price : 0,
      tripName: trip?.name || `Reservation #${reservationId}`,
      tripLocation: trip?.location || "",
      tripDate: trip?.date || "—"
    };
    goToRoute("checkout");
    return;
  }

  const saveLaterTarget = event.target.closest("#checkout-save-later");
  if (saveLaterTarget) {
    event.preventDefault();
    state.checkout = null;
    state.flash =
      "Saved for later — this booking stays Pending in My reservations. Use Pay when you're ready to confirm.";
    state.route = "reservations";
    void loadData();
    return;
  }

  const routeTarget = event.target.closest("[data-route], [data-route-btn]");
  if (routeTarget) {
    event.preventDefault();
    const route = routeTarget.dataset.route || routeTarget.dataset.routeBtn;
    if (!canAccessRoute(route)) {
      state.route = "login";
      render();
      return;
    }
    goToRoute(route);
    return;
  }

  const authViewTarget = event.target.closest("[data-auth-view]");
  if (authViewTarget) {
    event.preventDefault();
    authView = authViewTarget.dataset.authView === "register" ? "register" : "login";
    render();
    return;
  }

  const openAddTripTarget = event.target.closest("[data-open-add-trip]");
  if (openAddTripTarget) {
    event.preventDefault();
    state.openAddTripModal = true;
    goToRoute("trips");
    return;
  }

  const logoutTarget = event.target.closest("#logout-btn");
  if (logoutTarget) {
    event.preventDefault();
    clearRouteHistory();
    currentUser = null;
    saveCurrentUser();
    authView = "login";
    state.route = "login";
    state.profile = { status: "idle", error: null, data: null };
    state.profileNotice = null;
    render();
    return;
  }

  const bookNowTarget = event.target.closest("[data-trip-book]");
  if (bookNowTarget) {
    event.preventDefault();
    if (!canAccessRoute("book")) {
      state.route = "login";
      render();
      return;
    }
    state.selectedTripId = Number(bookNowTarget.dataset.tripBook);
    goToRoute("book");
    return;
  }

  const leadTarget = event.target.closest("[data-trip-lead]");
  if (leadTarget) {
    event.preventDefault();
    const tripId = Number(leadTarget.dataset.tripLead);
    const employeeId = Number(currentUser?.id);
    if (!Number.isFinite(tripId) || tripId <= 0 || !Number.isFinite(employeeId) || employeeId <= 0) return;
    (async () => {
      try {
        await postJson(`/api/trips/${tripId}/leaders`, { employeeId });
        state.flash = "You're now leading this hike.";
        await loadData();
      } catch (e) {
        window.alert(e?.message || "Could not lead this hike.");
      }
    })();
    return;
  }

  const cancelLeadTarget = event.target.closest("[data-trip-cancel-lead]");
  if (cancelLeadTarget) {
    event.preventDefault();
    const tripId = Number(cancelLeadTarget.dataset.tripCancelLead);
    const employeeId = Number(currentUser?.id);
    if (!Number.isFinite(tripId) || tripId <= 0 || !Number.isFinite(employeeId) || employeeId <= 0) return;
    const ok = await confirmDialog({
      title: "Cancel guiding?",
      message: "Are you sure you want to stop guiding this hike?"
    });
    if (!ok) return;
    (async () => {
      try {
        await deleteJson(`/api/trips/${tripId}/leaders/${employeeId}`);
        state.flash = "You are no longer guiding this hike.";
        await loadData();
      } catch (e) {
        window.alert(e?.message || "Could not cancel guiding.");
      }
    })();
    return;
  }

  const adminEditTrip = event.target.closest("[data-admin-edit-trip]");
  if (adminEditTrip && isAdmin()) {
    event.preventDefault();
    const tripId = Number(adminEditTrip.dataset.adminEditTrip);
    const trip = dataStore.trips.find((t) => Number(t.id) === tripId);
    if (!trip) return;
    ensureAdminCrudModals();
    const msg = document.getElementById("tb-admin-trip-edit-message");
    if (msg) {
      msg.className = "alert d-none mb-3";
      msg.textContent = "";
    }
    const form = document.getElementById("tb-admin-trip-edit-form");
    if (!form || !window.bootstrap?.Modal) return;
    form.tripId.value = String(trip.id);
    document.getElementById("admin-trip-name").value = trip.name || "";
    document.getElementById("admin-trip-location").value = trip.location || "";
    document.getElementById("admin-trip-distance").value =
      trip.distanceInput && trip.distance !== "TBD" ? trip.distanceInput : trip.distance === "TBD" ? "" : trip.distance;
    document.getElementById("admin-trip-date").value = trip.dateInput || normalizeDateForInput(trip.date);
    document.getElementById("admin-trip-price").value = String(trip.price ?? "");
    document.getElementById("admin-trip-hikers").value = String(trip.hikers ?? "");
    document.getElementById("admin-trip-difficulty").value = trip.difficulty || "";
    document.getElementById("admin-trip-category").value = trip.category || "";
    document.getElementById("admin-trip-time").value = trip.timeInput || "";
    window.bootstrap.Modal.getOrCreateInstance(document.getElementById("tb-admin-trip-edit-modal")).show();
    return;
  }

  const adminDelTrip = event.target.closest("[data-admin-del-trip]");
  if (adminDelTrip && isAdmin()) {
    event.preventDefault();
    const tripId = Number(adminDelTrip.dataset.adminDelTrip);
    if (!Number.isFinite(tripId) || tripId <= 0) return;
    const ok = await confirmDialog({
      title: "Delete this hike?",
      message: "This removes the trip and its reservations from the database."
    });
    if (!ok) return;
    (async () => {
      try {
        await adminDeleteJson(`/api/admin/trips/${tripId}`);
        state.flash = "Hike deleted.";
        state.selectedTripId = dataStore.trips.find((t) => t.id !== tripId)?.id ?? null;
        goToRoute("trips");
        await loadData();
      } catch (e) {
        window.alert(e?.message || "Delete failed.");
      }
    })();
    return;
  }

  const adminAddCustomer = event.target.closest("[data-admin-add-customer]");
  if (adminAddCustomer && isAdmin()) {
    event.preventDefault();
    ensureAdminCrudModals();
    const form = document.getElementById("tb-admin-customer-form");
    const msg = document.getElementById("tb-admin-customer-message");
    if (msg) {
      msg.className = "alert d-none mb-3";
      msg.textContent = "";
    }
    if (form) form.reset();
    const idEl = document.getElementById("admin-customer-id");
    if (idEl) idEl.value = "";
    const pw = document.getElementById("admin-customer-password");
    if (pw) {
      pw.required = true;
      pw.value = "";
    }
    const hint = document.getElementById("admin-customer-password-hint");
    if (hint) hint.textContent = "Choose a login password for this customer.";
    const title = document.getElementById("tb-admin-customer-title");
    if (title) title.textContent = "Add customer";
    if (window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(document.getElementById("tb-admin-customer-modal")).show();
    }
    return;
  }

  const adminEditCustomer = event.target.closest("[data-admin-edit-customer]");
  if (adminEditCustomer && isAdmin()) {
    event.preventDefault();
    const cid = Number(adminEditCustomer.dataset.adminEditCustomer);
    const c = dataStore.customers.find((row) => coalesceNumericId(row.id) === cid);
    if (!c) return;
    ensureAdminCrudModals();
    const msg = document.getElementById("tb-admin-customer-message");
    if (msg) {
      msg.className = "alert d-none mb-3";
      msg.textContent = "";
    }
    document.getElementById("admin-customer-id").value = String(cid);
    document.getElementById("admin-customer-fname").value = c.fname || "";
    document.getElementById("admin-customer-lname").value = c.lname || "";
    document.getElementById("admin-customer-email").value = c.email !== "-" ? c.email : "";
    document.getElementById("admin-customer-birthday").value = c.birthdayInput || "";
    const pw = document.getElementById("admin-customer-password");
    if (pw) {
      pw.required = false;
      pw.value = "";
    }
    const hint = document.getElementById("admin-customer-password-hint");
    if (hint) hint.textContent = "Leave blank to keep the current password.";
    const title = document.getElementById("tb-admin-customer-title");
    if (title) title.textContent = "Edit customer";
    if (window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(document.getElementById("tb-admin-customer-modal")).show();
    }
    return;
  }

  const adminDelCustomer = event.target.closest("[data-admin-del-customer]");
  if (adminDelCustomer && isAdmin()) {
    event.preventDefault();
    const cid = Number(adminDelCustomer.dataset.adminDelCustomer);
    if (!Number.isFinite(cid) || cid <= 0) return;
    const ok = await confirmDialog({
      title: "Delete customer?",
      message: "This removes the customer and all of their reservations."
    });
    if (!ok) return;
    (async () => {
      try {
        await adminDeleteJson(`/api/admin/customers/${cid}`);
        state.flash = "Customer deleted.";
        await loadData();
      } catch (e) {
        window.alert(e?.message || "Delete failed.");
      }
    })();
    return;
  }

  const cancelTarget = event.target.closest("[data-cancel-reservation]");
  if (cancelTarget) {
    event.preventDefault();
    const reservationId = Number(cancelTarget.dataset.cancelReservation);
    const customerId = Number(currentUser?.id);
    if (!Number.isFinite(reservationId) || reservationId <= 0 || !Number.isFinite(customerId) || customerId <= 0) return;
    const ok = await confirmDialog({
      title: "Are you sure?",
      message: "Cancel this reservation? This can't be undone."
    });
    if (!ok) return;
    (async () => {
      try {
        await patchJson("/api/reservations/cancel", { reservationId, customerId });
        state.flash = "Reservation cancelled.";
        await loadData();
      } catch (e) {
        window.alert(e?.message || "Cancel failed.");
      }
    })();
    return;
  }

  const detailTarget = event.target.closest("[data-trip-detail]");
  if (detailTarget) {
    event.preventDefault();
    if (!canAccessRoute("trip-detail")) {
      state.route = "login";
      render();
      return;
    }
    state.selectedTripId = Number(detailTarget.dataset.tripDetail);
    goToRoute("trip-detail");
    return;
  }
});

document.addEventListener("submit", async (event) => {
  const adminTripForm = event.target.closest("#tb-admin-trip-edit-form");
  if (adminTripForm && isAdmin()) {
    event.preventDefault();
    const msg = document.getElementById("tb-admin-trip-edit-message");
    if (msg) {
      msg.className = "alert d-none mb-3";
      msg.textContent = "";
    }
    const fd = new FormData(adminTripForm);
    const tid = Number(fd.get("tripId"));
    if (!Number.isFinite(tid) || tid <= 0) return;
    const payload = {
      TripName: String(fd.get("TripName") || "").trim(),
      Location: String(fd.get("Location") || "").trim(),
      Distance: String(fd.get("Distance") || "").trim(),
      Date: String(fd.get("Date") || "").trim(),
      Price: Number(fd.get("Price") || 0),
      NumberOfHikers: Number(fd.get("NumberOfHikers") || 0),
      DifficultyLevel: String(fd.get("DifficultyLevel") || "").trim(),
      Category: String(fd.get("Category") || "").trim(),
      Time: String(fd.get("Time") || "").trim()
    };
    try {
      await adminPatchJson(`/api/admin/trips/${tid}`, payload);
      const modalEl = document.getElementById("tb-admin-trip-edit-modal");
      if (modalEl && window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      state.flash = "Hike updated.";
      await loadData();
    } catch (err) {
      if (msg) {
        msg.className = "alert alert-danger mb-3";
        msg.textContent = err?.message || "Save failed.";
        msg.classList.remove("d-none");
      }
    }
    return;
  }

  const adminCustomerForm = event.target.closest("#tb-admin-customer-form");
  if (adminCustomerForm && isAdmin()) {
    event.preventDefault();
    const msg = document.getElementById("tb-admin-customer-message");
    if (msg) {
      msg.className = "alert d-none mb-3";
      msg.textContent = "";
    }
    const fd = new FormData(adminCustomerForm);
    const idStr = String(fd.get("customerId") || "").trim();
    const fname = String(fd.get("fname") || "").trim();
    const lname = String(fd.get("lname") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const birthday = String(fd.get("birthday") || "").trim();
    const password = String(fd.get("password") || "").trim();
    try {
      if (!idStr) {
        if (!password) throw new Error("Password is required for new customers.");
        await adminPostJson("/api/admin/customers", { Fname: fname, Lname: lname, Email: email, Password: password, Birthday: birthday });
      } else {
        await adminPatchJson(`/api/admin/customers/${Number(idStr)}`, {
          Fname: fname,
          Lname: lname,
          Email: email,
          Birthday: birthday,
          Password: password || null
        });
      }
      const modalEl = document.getElementById("tb-admin-customer-modal");
      if (modalEl && window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      state.flash = idStr ? "Customer updated." : "Customer created.";
      await loadData();
    } catch (err) {
      if (msg) {
        msg.className = "alert alert-danger mb-3";
        msg.textContent = err?.message || "Save failed.";
        msg.classList.remove("d-none");
      }
    }
    return;
  }

  const profileForm = event.target.closest("#profile-form");
  if (profileForm) {
    event.preventDefault();
    const messageEl = document.querySelector("#profile-message");
    if (messageEl) {
      messageEl.className = "alert d-none mb-3";
      messageEl.textContent = "";
    }
    const role = currentUser?.role;
    const userId = Number(currentUser?.id);
    if (!role || !Number.isFinite(userId)) return;
    const fd = new FormData(profileForm);
    const payload = {
      role,
      userId,
      email: String(fd.get("email") || "").trim(),
      birthday: String(fd.get("birthday") || "").trim(),
      fname: String(fd.get("fname") || "").trim(),
      lname: String(fd.get("lname") || "").trim()
    };
    try {
      const updated = await patchJson("/api/auth/profile", payload);
      const newName = [updated?.fname, updated?.lname].filter(Boolean).join(" ").trim();
      if (newName) currentUser.name = newName;
      else if (!currentUser.name || /@/.test(String(currentUser.name))) currentUser.name = `${role} #${userId}`;
      saveCurrentUser();
      state.profile = { status: "loaded", error: null, data: { ...state.profile.data, ...updated } };
      state.profileNotice = "Profile saved.";
      await loadData();
    } catch (err) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-3";
        messageEl.textContent = err?.message || "Could not save profile.";
        messageEl.classList.remove("d-none");
      }
    }
    return;
  }

  const loginForm = event.target.closest("#login-form");
  if (loginForm) {
    event.preventDefault();
    const messageElement = document.querySelector("#auth-message");
    const formData = new FormData(loginForm);
    const payload = {
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || "")
    };
    try {
      const result = await postJson("/api/auth/login", payload);
      clearRouteHistory();
      currentUser = {
        role: normalizeText(result?.role, "hiker").toLowerCase(),
        id: result?.id ?? null,
        name: normalizeText(result?.name, "User")
      };
      saveCurrentUser();
      state.route = "home";
      await loadData();
    } catch (error) {
      if (messageElement) {
        messageElement.className = "alert alert-danger mb-3";
        messageElement.textContent = error?.message || "Login failed.";
      }
    }
    return;
  }

  const registerForm = event.target.closest("#register-form");
  if (registerForm) {
    event.preventDefault();
    const messageElement = document.querySelector("#auth-message");
    const formData = new FormData(registerForm);
    const payload = {
      fname: String(formData.get("fname") || "").trim(),
      lname: String(formData.get("lname") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || ""),
      birthday: String(formData.get("birthday") || "").trim(),
      role: String(formData.get("role") || "hiker").trim().toLowerCase()
    };
    try {
      await postJson("/api/auth/register", payload);
      authView = "login";
      render();
      const nextMessage = document.querySelector("#auth-message");
      if (nextMessage) {
        nextMessage.className = "alert alert-success mb-3";
        nextMessage.textContent = "Registration successful. Please log in.";
      }
    } catch (error) {
      if (messageElement) {
        messageElement.className = "alert alert-danger mb-3";
        messageElement.textContent = error?.message || "Registration failed.";
      }
    }
    return;
  }

  const checkoutPayForm = event.target.closest("#checkout-pay-form");
  if (checkoutPayForm) {
    event.preventDefault();
    const messageEl = document.querySelector("#checkout-message");
    if (messageEl) {
      messageEl.className = "alert d-none mb-0";
      messageEl.textContent = "";
    }
    const c = state.checkout;
    if (!c || !Number.isFinite(Number(c.reservationId))) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-0";
        messageEl.textContent = "Checkout session expired. Open My reservations and use Pay.";
        messageEl.classList.remove("d-none");
      }
      return;
    }
    const customerId = Number(currentUser?.id);
    if (!Number.isFinite(customerId)) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-0";
        messageEl.textContent = "You must be logged in.";
        messageEl.classList.remove("d-none");
      }
      return;
    }
    try {
      await patchJson("/api/reservations/confirm", {
        reservationId: c.reservationId,
        customerId
      });
      state.checkout = null;
      state.flash = "Payment complete — your reservation is confirmed.";
      state.route = "reservations";
      await loadData();
    } catch (err) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-0";
        messageEl.textContent = err?.message || "Payment could not be completed.";
        messageEl.classList.remove("d-none");
      }
    }
    return;
  }

  const bookTripForm = event.target.closest("#book-trip-form");
  if (bookTripForm) {
    event.preventDefault();
    const messageEl = document.querySelector("#book-message");
    if (messageEl) {
      messageEl.className = "alert d-none mb-3";
      messageEl.textContent = "";
    }
    const fd = new FormData(bookTripForm);
    const tripId = Number(fd.get("tripId"));
    const numberOfHikers = Number(fd.get("numberOfHikers"));
    if (!Number.isFinite(tripId) || tripId <= 0 || !Number.isFinite(numberOfHikers) || numberOfHikers < 1) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-3";
        messageEl.textContent = "Enter a valid party size.";
        messageEl.classList.remove("d-none");
      }
      return;
    }
    const customerId = Number(currentUser?.id);
    if (!Number.isFinite(customerId)) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-3";
        messageEl.textContent = "You must be logged in as a hiker to book.";
        messageEl.classList.remove("d-none");
      }
      return;
    }
    const trip = dataStore.trips.find((item) => item.id === tripId);
    if (!trip) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-3";
        messageEl.textContent = "Trip not found. Refresh and try again.";
        messageEl.classList.remove("d-none");
      }
      return;
    }
    try {
      const result = await postJson("/api/book", { tripId, customerId, numberOfHikers });
      const resId = result?.reservationId ?? result?.reservationid;
      if (!Number.isFinite(Number(resId)) || Number(resId) <= 0) {
        throw new Error("Booking saved but no reservation id returned.");
      }
      state.checkout = {
        reservationId: Number(resId),
        tripId,
        numberOfHikers,
        unitPrice: trip.price,
        tripName: trip.name,
        tripLocation: trip.location,
        tripDate: trip.date
      };
      state.route = "checkout";
      await loadData();
    } catch (err) {
      if (messageEl) {
        messageEl.className = "alert alert-danger mb-3";
        messageEl.textContent = err?.message || "Booking failed.";
        messageEl.classList.remove("d-none");
      }
    }
    return;
  }

  const form = event.target.closest("#add-trip-form");
  if (!form) return;

  event.preventDefault();

  const messageElement = document.querySelector("#add-trip-message");
  if (messageElement) {
    messageElement.className = "alert d-none mb-3";
    messageElement.textContent = "";
  }

  const formData = new FormData(form);
  const leadTrip =
    currentUser?.role === "employee" && (formData.get("LeadTrip") === "1" || formData.get("LeadTrip") === "on");
  const payload = {
    TripName: String(formData.get("TripName") || "").trim(),
    Location: String(formData.get("Location") || "").trim(),
    Distance: String(formData.get("Distance") || "").trim(),
    Date: String(formData.get("Date") || "").trim(),
    Price: Number(formData.get("Price") || 0),
    NumberOfHikers: Number(formData.get("NumberOfHikers") || 0),
    DifficultyLevel: String(formData.get("DifficultyLevel") || "").trim(),
    Category: String(formData.get("Category") || "").trim(),
    Time: String(formData.get("Time") || "").trim(),
    EmployeeId: (() => {
      const raw = formData.get("EmployeeId");
      const id = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
      return Number.isFinite(id) && id > 0 ? id : null;
    })()
  };

  try {
    const result = await postJson("/api/trips", payload);
    if (leadTrip && Number.isFinite(Number(result?.id)) && Number(result.id) > 0) {
      const employeeId = Number(currentUser?.id);
      if (Number.isFinite(employeeId) && employeeId > 0) {
        await postJson(`/api/trips/${Number(result.id)}/leaders`, { employeeId });
      }
    }
    window.alert(`Trip created successfully (ID: ${result?.id ?? "N/A"}).`);
    form.reset();
    const modalEl = document.querySelector("#addTripModal");
    if (modalEl && window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    await loadData();
  } catch (error) {
    window.alert(error?.message || "Failed to create trip.");
    if (messageElement) {
      messageElement.className = "alert alert-danger mb-3";
      messageElement.textContent = error?.message || "Failed to create trip.";
    }
  }
});

currentUser = loadStoredCurrentUser();
loadData();
