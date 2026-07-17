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

// ===== VEHICLE STOCK FILTER =====
const stockFilterBtns = document.querySelectorAll(".cl-stock-filter button");
const carCards = document.querySelectorAll(".cl-car-card");

stockFilterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    stockFilterBtns.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    const filter = btn.dataset.filter;
    carCards.forEach((card) => {
      const match = filter === "all" || card.dataset.type === filter;
      card.classList.toggle("cl-hidden", !match);
    });
  });
});

// ===== CLEARANCE TIMELINE ESTIMATOR =====
const destinationSelect = document.querySelector("#cl-destination");
const cargoSelect = document.querySelector("#cl-cargo");
const estimatorResult = document.querySelector("#cl-estimator-result");

const baseDays = {
  local: [1, 2],
  windhoek: [2, 3],
  botswana: [4, 6],
  zambia: [5, 8],
  angola: [5, 8],
};

const cargoAdjust = {
  consolidated: 1,
  fullcontainer: 0,
  bonded: 2,
};

function updateEstimate() {
  if (!destinationSelect || !cargoSelect || !estimatorResult) return;
  const [minDays, maxDays] = baseDays[destinationSelect.value] || baseDays.local;
  const adjust = cargoAdjust[cargoSelect.value] || 0;
  estimatorResult.textContent = `Estimated timeline: ${minDays + adjust} to ${maxDays + adjust} working days`;
}

if (destinationSelect && cargoSelect) {
  destinationSelect.addEventListener("change", updateEstimate);
  cargoSelect.addEventListener("change", updateEstimate);
  updateEstimate();
}
