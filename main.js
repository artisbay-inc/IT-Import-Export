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
      window.location.href = "vehicles.html" + (query ? `?${query}` : "");
    });
  }
}
