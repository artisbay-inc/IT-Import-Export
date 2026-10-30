// ===== LIGHT / DARK THEME =====
// The <head> script sets data-theme before paint; this only handles the toggle.
document.querySelectorAll(".cl-theme-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("iti-theme", next); } catch (e) { /* private mode: theme just isn't remembered */ }
  });
});

// ===== MOBILE NAV =====
const menuBtn = document.querySelector(".cl-menu-btn");
const nav = document.querySelector(".cl-nav");
const navBackdrop = document.querySelector(".cl-nav-backdrop");

function setNavOpen(isOpen) {
  nav.classList.toggle("open", isOpen);
  if (navBackdrop) navBackdrop.classList.toggle("visible", isOpen);
  document.documentElement.classList.toggle("nav-locked", isOpen);
  document.body.classList.toggle("nav-locked", isOpen);
}

if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    setNavOpen(!nav.classList.contains("open"));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });

  if (navBackdrop) navBackdrop.addEventListener("click", () => setNavOpen(false));
}

// ===== VEHICLE STOCK FILTER (brand + body type + model, combined) =====
const stockFilterBtns = document.querySelectorAll(".cl-stock-filter button");
const carCards = document.querySelectorAll(".cl-car-card");
const stockEmptyMsg = document.querySelector("#cl-stock-empty");
const activeFilters = { brand: "all", type: "all", model: "all" };

function setActivePill(group, value) {
  document.querySelectorAll(`.cl-stock-filter button[data-filter-group="${group}"]`).forEach((b) => {
    b.classList.toggle("is-active", b.dataset.filter === value);
  });
}

function applyStockFilters() {
  let visibleCount = 0;
  carCards.forEach((card) => {
    const brandMatch = activeFilters.brand === "all" || card.dataset.brand === activeFilters.brand;
    const typeMatch = activeFilters.type === "all" || card.dataset.type === activeFilters.type;
    const modelMatch = activeFilters.model === "all" || card.dataset.model === activeFilters.model;
    const match = brandMatch && typeMatch && modelMatch;
    card.classList.toggle("cl-hidden", !match);
    if (match) visibleCount += 1;
  });
  if (stockEmptyMsg) stockEmptyMsg.hidden = visibleCount > 0;
}

stockFilterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const group = btn.dataset.filterGroup;
    setActivePill(group, btn.dataset.filter);
    activeFilters[group] = btn.dataset.filter;
    if (group === "brand") {
      activeFilters.model = "all";
    }
    applyStockFilters();
  });
});

if (carCards.length) {
  const params = new URLSearchParams(window.location.search);
  const paramBrand = params.get("brand");
  const paramType = params.get("type");
  const paramModel = params.get("model");
  if (paramBrand) {
    activeFilters.brand = paramBrand;
    setActivePill("brand", paramBrand);
  }
  if (paramType) {
    activeFilters.type = paramType;
    setActivePill("type", paramType);
  }
  if (paramModel) activeFilters.model = paramModel;
  applyStockFilters();
}

// ===== SEARCH VEHICLES MODAL =====
const VEHICLE_MODELS = {
  toyota: [
    { value: "hilux", label: "Hilux" },
    { value: "landcruiser-prado", label: "Land Cruiser Prado" },
    { value: "vitz", label: "Vitz" },
    { value: "mark-x", label: "Mark X" },
  ],
  nissan: [{ value: "x-trail", label: "X-Trail" }],
  honda: [{ value: "ballade", label: "Ballade" }],
};

const searchTriggers = document.querySelectorAll(".cl-search-trigger");
const searchModal = document.querySelector("#cl-search-modal");
const searchBackdrop = document.querySelector("#cl-search-backdrop");
const searchClose = document.querySelector("#cl-search-close");
const searchBrandSelect = document.querySelector("#cl-search-brand");
const searchModelSelect = document.querySelector("#cl-search-model");
const searchTypeSelect = document.querySelector("#cl-search-type");
const searchSubmit = document.querySelector("#cl-search-submit");

function setSearchModalOpen(isOpen) {
  if (!searchModal) return;
  searchModal.classList.toggle("visible", isOpen);
  if (searchBackdrop) searchBackdrop.classList.toggle("visible", isOpen);
  document.documentElement.classList.toggle("modal-open", isOpen);
  document.body.classList.toggle("modal-open", isOpen);
}

if (searchTriggers.length && searchModal) {
  searchTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => setSearchModalOpen(true));
  });
  if (searchClose) searchClose.addEventListener("click", () => setSearchModalOpen(false));
  if (searchBackdrop) searchBackdrop.addEventListener("click", () => setSearchModalOpen(false));

  if (searchBrandSelect && searchModelSelect) {
    searchBrandSelect.addEventListener("change", () => {
      const brand = searchBrandSelect.value;
      const models = VEHICLE_MODELS[brand];
      if (!models) {
        searchModelSelect.innerHTML = '<option value="all">Select a brand first</option>';
        searchModelSelect.disabled = true;
        return;
      }
      searchModelSelect.disabled = false;
      searchModelSelect.innerHTML =
        `<option value="all">All ${brand.charAt(0).toUpperCase() + brand.slice(1)} Models</option>` +
        models.map((m) => `<option value="${m.value}">${m.label}</option>`).join("");
    });
  }

  if (searchSubmit) {
    searchSubmit.addEventListener("click", () => {
      const brand = searchBrandSelect ? searchBrandSelect.value : "all";
      const model = searchModelSelect && !searchModelSelect.disabled ? searchModelSelect.value : "all";
      const type = searchTypeSelect ? searchTypeSelect.value : "all";
      const params = new URLSearchParams();
      if (brand !== "all") params.set("brand", brand);
      if (model !== "all") params.set("model", model);
      if (type !== "all") params.set("type", type);
      const query = params.toString();
      window.location.href = "/vehicles" + (query ? `?${query}` : "");
    });
  }
}

// ===== CUSTOMER ACCOUNTS (api/index.php) =====
// ITIE.session() resolves to the signed-in user or null; ITIE.post() sends an
// action with the CSRF token and throws an Error with a readable message.
const ITIE = (() => {
  const API = "/api/index.php";
  let csrf = null;
  let sessionRequest = null;

  function session(refresh = false) {
    if (!sessionRequest || refresh) {
      sessionRequest = fetch(`${API}?action=session`, { credentials: "same-origin", cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          csrf = d.csrf || null;
          return d.user || null;
        })
        .catch(() => null);
    }
    return sessionRequest;
  }

  async function post(action, data = {}) {
    if (!csrf) await session();
    let result;
    try {
      const r = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf || "" },
        body: JSON.stringify(data),
      });
      result = await r.json();
    } catch (e) {
      throw new Error("We couldn't reach the server. Please check your connection and try again.");
    }
    if (result.csrf) csrf = result.csrf;
    if (!result.ok) throw new Error(result.error || "Something went wrong. Please try again.");
    return result;
  }

  // Timestamps from the API are Unix seconds.
  const date = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const dateTime = (ts) => new Date(ts * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function ago(ts) {
    const days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return days < 30 ? `${days} days ago` : date(ts);
  }

  return { session, post, date, dateTime, ago };
})();
window.ITIE = ITIE;

/** Shows a message in a form's .cl-form-status line. kind: "ok" | "error" | "" */
function setFormStatus(form, message, kind = "") {
  const el = form.querySelector(".cl-form-status");
  if (!el) return;
  el.textContent = message;
  el.className = "cl-form-status" + (kind ? ` is-${kind}` : "");
  el.hidden = !message;
}
window.setFormStatus = setFormStatus;

// Header link: "Sign in", "My account" or "Admin". Pages call this again after signing in or out.
function setAccountLink(user) {
  document.querySelectorAll(".cl-account-link").forEach((link) => {
    link.textContent = !user ? "Sign in" : user.role === "admin" ? "Admin" : "My account";
    link.href = user && user.role === "admin" ? "/admin" : "/account";
  });
}
window.setAccountLink = setAccountLink;
ITIE.session().then(setAccountLink);

// ===== QUOTE FORM =====
const quoteForm = document.querySelector("#cl-quote-form");
if (quoteForm) {
  const val = (id) => quoteForm.querySelector(id).value.trim();

  // Signed-in customers get their details filled in.
  ITIE.session().then((user) => {
    if (!user || user.role !== "customer") return;
    const fill = (id, value) => {
      const input = quoteForm.querySelector(id);
      if (input && !input.value && value) input.value = value;
    };
    fill("#cl-contact-name", user.name);
    fill("#cl-company", user.company);
    fill("#cl-phone", user.phone);
    fill("#cl-email", user.email);
  });

  quoteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!quoteForm.reportValidity()) return;
    const button = quoteForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setFormStatus(quoteForm, "Sending…");
    try {
      const result = await ITIE.post("quote", {
        name: val("#cl-contact-name"),
        company: val("#cl-company"),
        phone: val("#cl-phone"),
        email: val("#cl-email"),
        destination: val("#cl-destination-2"),
        details: val("#cl-details"),
      });
      quoteForm.querySelector("#cl-details").value = "";
      setFormStatus(quoteForm, result.message, "ok");
    } catch (err) {
      setFormStatus(quoteForm, err.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}
