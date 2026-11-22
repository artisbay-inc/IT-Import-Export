// Admin page (admin.html): the Inventory and Invoices tabs.
// Loaded after admin.js; every action is checked again on the server.

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const val = (sel) => $(sel).value.trim();
  let currency = "N$";
  let items = [];            // inventory, kept for the invoice line pickers
  let openItemId = null;
  let openItemData = null;
  let deleteArmed = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 1234567 cents -> "N$ 12,345.67"
  const money = (cents) => `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const plain = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, "");
  // "289,000.50" -> 28900050 cents, or null
  function toCents(text) {
    const clean = String(text).replace(/[,\s]/g, "").replace(/^N\$/, "");
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(clean)) return null;
    return Math.round(parseFloat(clean) * 100);
  }
  const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function handle(form, fn) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      setFormStatus(form, "");
      try {
        await fn();
      } catch (err) {
        setFormStatus(form, err.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  // ── Drawers (share the page's backdrop) ────────────────────────────────

  function openDrawer(drawer) {
    drawer.hidden = false;
    $("#drawer-backdrop").hidden = false;
    document.body.classList.add("modal-open");
    const first = drawer.querySelector("input:not([type=hidden]), select, textarea");
    if (first) first.focus();
  }
  function closeDrawers() {
    ["#item-drawer", "#invoice-drawer", "#customer-drawer"].forEach((id) => { $(id).hidden = true; });
    if ($("#drawer").hidden) {
      $("#drawer-backdrop").hidden = true;
      document.body.classList.remove("modal-open");
    }
  }
  document.querySelectorAll("[data-close-drawer]").forEach((b) => b.addEventListener("click", closeDrawers));
  $("#drawer-backdrop").addEventListener("click", closeDrawers);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawers(); });

  // ── Tabs ───────────────────────────────────────────────────────────────

  document.querySelectorAll(".cl-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.tab === "inventory") loadItems();
      if (tab.dataset.tab === "invoices") loadInvoices();
      if (tab.dataset.tab === "calculator") loadCalculator();
      if (tab.dataset.tab === "me") loadSettings();
      history.replaceState(null, "", tab.dataset.tab === "customers" ? "/admin" : `/admin#${tab.dataset.tab}`);
    });
  });

  function headRow(labels) {
    const head = el("div", "cl-tr cl-th");
    labels.forEach((h) => head.append(el("span", "", h)));
    return head;
  }

  // ── Cars ───────────────────────────────────────────────────────────────

  const CONDITION = { good: "Good", very_good: "Very good", excellent: "Excellent" };
  const num = (n) => Number(n).toLocaleString("en-US");
  function itemDetails(it) {
    if (it.kind !== "car") return it.category;
    return [it.chassis_no, it.mileage_km != null ? `${num(it.mileage_km)} km` : "", it.engine_cc ? `${num(it.engine_cc)} cc` : "",
      it.color, CONDITION[it.condition] || ""].filter(Boolean).join(" · ");
  }
  // What goes on an invoice line: "2018 Toyota Hilux 2.4 GD-6 · Chassis GUN126-1234567 · 85,000 km · White"
  function lineDescription(it) {
    if (it.kind !== "car") return it.name;
    return [it.name, it.chassis_no ? `Chassis ${it.chassis_no}` : "", it.mileage_km != null ? `${num(it.mileage_km)} km` : "",
      it.engine_cc ? `${num(it.engine_cc)} cc` : "", it.color].filter(Boolean).join(" · ");
  }

  function setKind(kind) {
    document.querySelectorAll('input[name="i-kind"]').forEach((r) => { r.checked = r.value === kind; });
    $("#i-car-fields").hidden = kind !== "car";
    $("#i-name-group").hidden = kind === "car";
    $("#i-make").required = $("#i-model").required = kind === "car";
    $("#i-name").required = kind !== "car";
  }
  document.querySelectorAll('input[name="i-kind"]').forEach((r) => r.addEventListener("change", () => {
    setKind(r.value);
    if (!openItemId) $("#i-low").value = r.value === "car" ? "0" : "1";
  }));
  const kindValue = () => document.querySelector('input[name="i-kind"]:checked').value;

  // ── Inventory ──────────────────────────────────────────────────────────

  async function loadItems() {
    const table = $("#item-table");
    try {
      const data = await ITIE.post("admin_items", { q: val("#item-search") });
      currency = data.currency || currency;
      if (!val("#item-search")) items = data.items;
      $("#inv-stat-items").textContent = data.stats.items;
      $("#inv-stat-units").textContent = data.stats.units.toLocaleString("en-US");
      $("#inv-stat-value").textContent = money(data.stats.value_cents);
      $("#inv-stat-low").textContent = data.stats.low;
      $("#item-categories").replaceChildren(...data.categories.map((c) => { const o = el("option"); o.value = c; return o; }));

      table.replaceChildren(headRow(["Item", "Stock code", "Details", "In stock", "Price", "Updated"]));
      if (!data.items.length) {
        table.append(el("p", "cl-table-empty", val("#item-search") ? "No items match that search." : "No items yet. Use “Add item” to list your first vehicle or part."));
        return;
      }
      data.items.forEach((it) => {
        const row = el("button", "cl-tr");
        row.type = "button";
        const qty = el("span", "cl-qty");
        qty.append(String(it.quantity));
        if (it.quantity <= 0) qty.append(" ", el("span", "cl-badge cl-badge-void", "Out"));
        else if (it.quantity <= it.low_stock) qty.append(" ", el("span", "cl-badge cl-badge-overdue", "Low"));
        row.append(
          el("span", "cl-td-name", it.name),
          el("span", "", it.sku || "—"),
          el("span", "", itemDetails(it) || "—"),
          qty,
          el("span", "", money(it.price_cents)),
          el("span", "", ITIE.ago(it.updated_at)),
        );
        row.addEventListener("click", () => openItem(it.id));
        table.append(row);
      });
    } catch (err) {
      table.replaceChildren(el("p", "cl-table-empty", err.message));
    }
  }

  let itemSearchTimer = null;
  $("#item-search").addEventListener("input", () => {
    clearTimeout(itemSearchTimer);
    itemSearchTimer = setTimeout(loadItems, 250);
  });

  function resetItemDrawer() {
    deleteArmed = false;
    $("#item-delete").textContent = "Delete item";
    document.querySelectorAll("#item-drawer .cl-form-status").forEach((s) => { s.hidden = true; });
    $("#i-currency").textContent = `(${currency})`;
    $("#stock-form").reset();
  }

  $("#item-new").addEventListener("click", () => {
    openItemId = null;
    resetItemDrawer();
    $("#item-form").reset();
    setKind("car");
    $("#i-low").value = "0"; // one car in stock is normal: only warn when it's sold
    $("#item-invoice-row").hidden = true;
    $("#item-title").textContent = "New item";
    $("#item-meta").textContent = "";
    $("#i-qty-group").hidden = false;
    $("#item-stock-section").hidden = true;
    $("#item-save").textContent = "Add item";
    openDrawer($("#item-drawer"));
  });

  async function openItem(id) {
    openItemId = id;
    resetItemDrawer();
    try {
      const { item, moves } = await ITIE.post("admin_item", { id });
      $("#item-title").textContent = item.name;
      $("#item-meta").textContent = `Added ${ITIE.date(item.created_at)}${item.sku ? ` · ${item.sku}` : ""}`;
      setKind(item.kind === "car" ? "car" : "other");
      $("#i-name").value = item.name;
      $("#i-make").value = item.make;
      $("#i-model").value = item.model;
      $("#i-grade").value = item.grade;
      $("#i-year").value = item.year ?? "";
      $("#i-km").value = item.mileage_km ?? "";
      $("#i-cc").value = item.engine_cc ?? "";
      $("#i-chassis").value = item.chassis_no;
      $("#i-color").value = item.color;
      $("#i-condition").value = item.condition;
      $("#i-sku").value = item.sku;
      $("#i-category").value = item.category;
      $("#i-price").value = plain(item.price_cents);
      $("#i-low").value = item.low_stock;
      $("#i-notes").value = item.notes;
      $("#i-qty-group").hidden = true; // stock changes go through "Update stock" so they're recorded
      $("#item-save").textContent = "Save details";
      $("#item-qty-now").textContent = item.quantity;
      $("#item-invoice-row").hidden = item.quantity <= 0;
      openItemData = item;
      $("#item-stock-section").hidden = false;
      const list = $("#item-moves");
      list.replaceChildren();
      if (!moves.length) list.append(el("li", "cl-list-empty", "No stock changes yet."));
      moves.forEach((m) => {
        const li = el("li");
        li.append(el("span", "", `${m.change > 0 ? "+" : ""}${m.change} · ${m.reason}`),
          el("small", "", `${ITIE.dateTime(m.created_at)} · ${m.quantity_after} left`));
        list.append(li);
      });
      if ($("#item-drawer").hidden) openDrawer($("#item-drawer"));
    } catch (err) {
      setFormStatus($("#item-form"), err.message, "error");
    }
  }

  handle($("#item-form"), async () => {
    const price = toCents(val("#i-price"));
    if (price === null) throw new Error("Enter the price as a number, for example 289000 or 1250.50.");
    const data = {
      id: openItemId || 0,
      kind: kindValue(),
      name: val("#i-name"),
      make: val("#i-make"),
      model: val("#i-model"),
      grade: val("#i-grade"),
      year: val("#i-year"),
      mileage_km: val("#i-km"),
      engine_cc: val("#i-cc"),
      chassis_no: val("#i-chassis"),
      color: val("#i-color"),
      condition: $("#i-condition").value,
      sku: val("#i-sku"),
      category: val("#i-category"),
      price: val("#i-price"),
      low_stock: val("#i-low") || "0",
      notes: $("#i-notes").value,
    };
    if (!openItemId) data.quantity = val("#i-qty") || "0";
    const { id } = await ITIE.post("admin_item_save", data);
    loadItems();
    await openItem(id);
    setFormStatus($("#item-form"), "Saved.", "ok");
  });

  handle($("#stock-form"), async () => {
    const { quantity } = await ITIE.post("admin_item_stock", { id: openItemId, change: val("#s-change"), reason: val("#s-reason") });
    loadItems();
    await openItem(openItemId);
    setFormStatus($("#stock-form"), `Updated. ${quantity} in stock now.`, "ok");
  });

  $("#item-invoice").addEventListener("click", () => {
    const item = openItemData;
    closeDrawers();
    newInvoice(item);
  });

  $("#item-delete").addEventListener("click", async () => {
    // Two clicks: the first one asks, the second one deletes.
    if (!deleteArmed) {
      deleteArmed = true;
      $("#item-delete").textContent = "Click again to delete for good";
      return;
    }
    try {
      await ITIE.post("admin_item_delete", { id: openItemId });
      closeDrawers();
      loadItems();
    } catch (err) {
      setFormStatus($("#item-form"), err.message, "error");
    }
  });

  // ── Invoices list ──────────────────────────────────────────────────────

  const STATUS = { unpaid: ["Unpaid", "new"], paid: ["Paid", "done"], void: ["Cancelled", "void"], overdue: ["Overdue", "overdue"] };
  function statusBadge(inv, today) {
    const key = inv.status === "unpaid" && inv.due_date < today ? "overdue" : inv.status;
    return el("span", `cl-badge cl-badge-${STATUS[key][1]}`, STATUS[key][0]);
  }

  async function loadInvoices() {
    const table = $("#invoice-table");
    try {
      const data = await ITIE.post("admin_invoices", { q: val("#invoice-search"), status: $("#invoice-filter").value });
      currency = data.currency || currency;
      $("#bill-stat-owed").textContent = money(data.stats.owed_cents);
      $("#bill-stat-overdue").textContent = money(data.stats.overdue_cents);
      $("#bill-stat-overdue-label").textContent = `Overdue (${data.stats.overdue_count} invoice${data.stats.overdue_count === 1 ? "" : "s"})`;
      $("#bill-stat-month").textContent = money(data.stats.paid_month_cents);
      $("#bill-stat-total").textContent = data.stats.total;

      table.replaceChildren(headRow(["Invoice", "Customer", "Date", "Due", "Total", "Status"]));
      if (!data.invoices.length) {
        const filtered = val("#invoice-search") || $("#invoice-filter").value;
        table.append(el("p", "cl-table-empty", filtered ? "No invoices match." : "No invoices yet. Use “New invoice” to bill a customer."));
        return;
      }
      data.invoices.forEach((inv) => {
        const row = el("a", "cl-tr");
        row.href = `/invoice?id=${inv.id}`;
        const status = el("span");
        status.append(statusBadge(inv, data.today));
        row.append(
          el("span", "cl-td-name", inv.number),
          el("span", "", inv.bill_name + (inv.bill_company ? ` · ${inv.bill_company}` : "")),
          el("span", "", shortDate(inv.issue_date)),
          el("span", "", shortDate(inv.due_date)),
          el("span", "", money(inv.total_cents)),
          status,
        );
        table.append(row);
      });
    } catch (err) {
      table.replaceChildren(el("p", "cl-table-empty", err.message));
    }
  }

  let invoiceSearchTimer = null;
  $("#invoice-search").addEventListener("input", () => {
    clearTimeout(invoiceSearchTimer);
    invoiceSearchTimer = setTimeout(loadInvoices, 250);
  });
  $("#invoice-filter").addEventListener("change", loadInvoices);

  // ── New invoice ────────────────────────────────────────────────────────

  let customers = [];

  let defaultVat = 15;
  $("#invoice-new").addEventListener("click", () => newInvoice(null));

  async function newInvoice(prefillItem) {
    const form = $("#invoice-form");
    form.reset();
    setFormStatus(form, "");
    const today = new Date();
    const due = new Date();
    due.setDate(due.getDate() + 14);
    $("#b-issue").value = isoDay(today);
    $("#b-due").value = isoDay(due);
    $("#invoice-lines").replaceChildren();
    try {
      const [c, i, b] = await Promise.all([ITIE.post("admin_customers", { q: "" }), ITIE.post("admin_items", { q: "" }), ITIE.post("admin_settings")]);
      customers = c.customers;
      items = i.items;
      currency = i.currency || currency;
      defaultVat = b.business.vat_rate;
    } catch (err) {
      setFormStatus(form, err.message, "error");
    }
    const pick = $("#b-customer");
    pick.replaceChildren(new Option("Someone without an account", ""));
    customers.forEach((cu) => pick.append(new Option(cu.name + (cu.company ? ` · ${cu.company}` : "") + ` (${cu.email})`, cu.id)));
    $("#b-vat").value = defaultVat;
    addLine();
    if (prefillItem) {
      const line = $("#invoice-lines .cl-line");
      $(".l-item", line).value = String(prefillItem.id);
      $(".l-item", line).dispatchEvent(new Event("change"));
    }
    updateTotals();
    openDrawer($("#invoice-drawer"));
    if (prefillItem) $("#b-customer").focus();
  }

  $("#b-customer").addEventListener("change", () => {
    const cu = customers.find((x) => String(x.id) === $("#b-customer").value);
    $("#b-name").value = cu ? cu.name : "";
    $("#b-company").value = cu ? cu.company : "";
    $("#b-email").value = cu ? cu.email : "";
    $("#b-phone").value = cu ? cu.phone : "";
    $("#b-address").value = cu ? [cu.city, cu.country].filter(Boolean).join(", ") : "";
  });

  let lineSeq = 0;
  function addLine() {
    const n = ++lineSeq;
    const line = el("div", "cl-line");

    const pickLabel = el("label", "cl-sr", "Inventory item");
    pickLabel.htmlFor = `l-item-${n}`;
    const pick = el("select", "l-item");
    pick.id = `l-item-${n}`;
    pick.append(new Option("Service or other charge (type it below)", ""));
    items.forEach((it) => {
      const o = new Option(`${it.name}${it.chassis_no ? ` · ${it.chassis_no}` : it.sku ? ` · ${it.sku}` : ""} — ${it.quantity} in stock`, it.id);
      o.disabled = it.quantity <= 0;
      pick.append(o);
    });

    const desc = el("input", "l-desc");
    desc.type = "text";
    desc.maxLength = 300;
    desc.placeholder = "Description, e.g. Customs clearing fee";
    desc.required = true;
    desc.setAttribute("aria-label", "Description");

    const nums = el("div", "cl-line-nums");
    const qty = el("input", "l-qty");
    qty.type = "number"; qty.min = "1"; qty.step = "1"; qty.value = "1"; qty.required = true;
    qty.setAttribute("aria-label", "Quantity");
    const price = el("input", "l-price");
    price.type = "text"; price.inputMode = "decimal"; price.placeholder = "Unit price"; price.required = true;
    price.setAttribute("aria-label", "Unit price");
    const total = el("span", "l-total", money(0));
    const remove = el("button", "cl-linkbtn l-remove", "Remove");
    remove.type = "button";
    nums.append(el("span", "cl-line-x", "Qty"), qty, el("span", "cl-line-x", "×"), price, total, remove);

    pick.addEventListener("change", () => {
      const it = items.find((x) => String(x.id) === pick.value);
      if (it) {
        desc.value = lineDescription(it);
        price.value = plain(it.price_cents);
        qty.max = String(it.quantity);
      } else {
        qty.removeAttribute("max");
      }
      updateTotals();
    });
    [qty, price].forEach((i) => i.addEventListener("input", updateTotals));
    remove.addEventListener("click", () => {
      line.remove();
      if (!$("#invoice-lines").children.length) addLine();
      updateTotals();
    });

    line.append(pickLabel, pick, desc, nums);
    $("#invoice-lines").append(line);
  }
  $("#line-add").addEventListener("click", () => { addLine(); $("#invoice-lines").lastElementChild.querySelector(".l-item").focus(); });

  function readLines() {
    return [...document.querySelectorAll("#invoice-lines .cl-line")].map((line) => ({
      item_id: $(".l-item", line).value || null,
      description: $(".l-desc", line).value.trim(),
      qty: $(".l-qty", line).value,
      unit_price: $(".l-price", line).value.trim(),
      el: line,
    }));
  }

  function updateTotals() {
    let sub = 0;
    readLines().forEach((l) => {
      const unit = toCents(l.unit_price);
      const lineCents = unit !== null && +l.qty > 0 ? unit * Math.floor(+l.qty) : 0;
      sub += lineCents;
      $(".l-total", l.el).textContent = money(lineCents);
    });
    const rate = Math.max(0, parseFloat($("#b-vat").value) || 0);
    const vat = Math.round(sub * rate / 100);
    $("#t-vat-label").textContent = `VAT ${rate}%`;
    $("#t-sub").textContent = money(sub);
    $("#t-vat").textContent = money(vat);
    $("#t-total").textContent = money(sub + vat);
  }
  $("#b-vat").addEventListener("input", updateTotals);

  handle($("#invoice-form"), async () => {
    const lines = readLines();
    lines.forEach((l, i) => {
      if (toCents(l.unit_price) === null) throw new Error(`Line ${i + 1}: enter the price as a number, for example 1250.50.`);
    });
    const { id } = await ITIE.post("admin_invoice_create", {
      customer_id: $("#b-customer").value || 0,
      bill_name: val("#b-name"),
      bill_company: val("#b-company"),
      bill_email: val("#b-email"),
      bill_phone: val("#b-phone"),
      bill_address: $("#b-address").value,
      issue_date: $("#b-issue").value,
      due_date: $("#b-due").value,
      vat_rate: $("#b-vat").value || "0",
      notes: $("#b-notes").value,
      lines: lines.map(({ el: _el, ...l }) => l),
    });
    window.location.href = `/invoice?id=${id}`;
  });

  // ── Add a customer by hand ─────────────────────────────────────────────

  ITIE_COUNTRY.fill($("#c-country"));
  ITIE_COUNTRY.link($("#c-country"), $("#c-phone"));
  $("#customer-new").addEventListener("click", () => {
    $("#customer-form").reset();
    ITIE_COUNTRY.setValue($("#c-country"), "Namibia");
    $("#c-country").dispatchEvent(new Event("change"));
    setFormStatus($("#customer-form"), "");
    openDrawer($("#customer-drawer"));
  });
  handle($("#customer-form"), async () => {
    await ITIE.post("admin_customer_create", {
      name: val("#c-name"), email: val("#c-email"), phone: /^\+\d+$/.test(val("#c-phone")) ? "" : val("#c-phone"),
      company: val("#c-company"), country: $("#c-country").value, city: val("#c-city"), note: $("#c-note").value,
    });
    closeDrawers();
    $("#customer-search").value = "";
    $("#customer-search").dispatchEvent(new Event("input")); // reloads the list
  });

  // ── Settings: details printed on invoices ──────────────────────────────

  async function loadSettings() {
    try {
      const { business: b } = await ITIE.post("admin_settings");
      $("#biz-name").value = b.name;
      $("#biz-address").value = b.address;
      $("#biz-phone").value = b.phone;
      $("#biz-email").value = b.email;
      $("#biz-vatno").value = b.vat_number;
      $("#biz-bank").value = b.bank;
      $("#biz-currency").value = b.currency;
      $("#biz-vat").value = b.vat_rate;
    } catch (err) {
      setFormStatus($("#biz-form"), err.message, "error");
    }
  }
  handle($("#biz-form"), async () => {
    await ITIE.post("admin_settings_save", {
      name: val("#biz-name"), address: $("#biz-address").value, phone: val("#biz-phone"), email: val("#biz-email"),
      vat_number: val("#biz-vatno"), bank: $("#biz-bank").value, currency: val("#biz-currency"), vat_rate: val("#biz-vat"),
    });
    currency = val("#biz-currency");
    setFormStatus($("#biz-form"), "Saved. New and existing invoices now show these details.", "ok");
  });

  // ── Clearing calculator ────────────────────────────────────────────────

  const KINDS = [["percent_value", "% of the car's value"], ["percent_running", "% of value + charges above"], ["fixed", "Fixed amount"]];
  const RATE_CODES = ["JPY", "USD", "ZAR", "EUR"];

  function calcLine(l = { label: "", kind: "percent_value", rate: "", amount_cents: 0 }) {
    const row = el("div", "cl-line cl-calc-line");
    const label = el("input", "k-label");
    label.type = "text"; label.maxLength = 120; label.placeholder = "Charge name, e.g. Customs duty"; label.required = true;
    label.value = l.label;
    label.setAttribute("aria-label", "Charge name");
    const kind = el("select", "k-kind");
    kind.setAttribute("aria-label", "How it is worked out");
    KINDS.forEach(([v, t]) => kind.append(new Option(t, v)));
    kind.value = l.kind;
    const amount = el("input", "k-amount");
    amount.type = "text"; amount.inputMode = "decimal";
    amount.setAttribute("aria-label", "Rate or amount");
    amount.value = l.kind === "fixed" ? plain(l.amount_cents) : (l.rate === "" ? "" : String(+l.rate));
    const unit = el("span", "cl-line-x k-unit");
    const up = el("button", "cl-linkbtn", "↑"); up.type = "button"; up.setAttribute("aria-label", "Move up");
    const remove = el("button", "cl-linkbtn l-remove", "Remove"); remove.type = "button";
    const sync = () => {
      unit.textContent = kind.value === "fixed" ? currency : "%";
      amount.placeholder = kind.value === "fixed" ? "3500" : "15";
      calcPreview();
    };
    kind.addEventListener("change", sync);
    [label, amount].forEach((i) => i.addEventListener("input", calcPreview));
    up.addEventListener("click", () => { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); calcPreview(); });
    remove.addEventListener("click", () => { row.remove(); calcPreview(); });
    const nums = el("div", "cl-calc-nums");
    nums.append(kind, amount, unit, up, remove);
    row.append(label, nums);
    $("#calc-lines").append(row);
    sync();
  }

  function readCalcLines() {
    return [...document.querySelectorAll("#calc-lines .cl-calc-line")].map((r) => {
      const kind = $(".k-kind", r).value;
      const raw = $(".k-amount", r).value.trim();
      return { label: $(".k-label", r).value.trim(), kind, raw,
        rate: kind === "fixed" ? 0 : raw, amount: kind === "fixed" ? raw : "",
        amount_cents: kind === "fixed" ? (toCents(raw) ?? 0) : 0 };
    });
  }

  function calcRates() {
    const rates = {};
    RATE_CODES.forEach((c) => { const v = $(`#rate-${c}`).value.trim(); if (v) rates[c] = v; });
    return rates;
  }

  function calcPreview() {
    const cur = $("#calc-try-cur");
    const keep = cur.value;
    cur.replaceChildren(new Option(currency, ""));
    Object.keys(calcRates()).forEach((c) => cur.append(new Option(c, c)));
    cur.value = [...cur.options].some((o) => o.value === keep) ? keep : "";
    const entered = ITIE_CALC.cents($("#calc-try-value").value);
    const out = $("#calc-try-result");
    out.replaceChildren();
    if (entered === null) { out.append(el("dt", "", "Enter a value to see the charges")); return; }
    const rate = cur.value ? parseFloat(calcRates()[cur.value]) || 0 : 1;
    const value = Math.round(entered * rate);
    const r = ITIE_CALC.compute(value, readCalcLines().filter((l) => l.label));
    const add = (t, v, cls = "") => { out.append(el("dt", cls, t), el("dd", cls, v)); };
    add(cur.value ? `Car value (${cur.value} → ${currency})` : "Car value", ITIE_CALC.money(value, currency));
    r.rows.forEach((row) => add(row.label + (row.kind === "fixed" ? "" : ` (${row.rate}%)`), ITIE_CALC.money(row.cents, currency)));
    add("Charges", ITIE_CALC.money(r.charges, currency), "cl-totals-grand");
    add("Car + charges", ITIE_CALC.money(r.total, currency));
  }
  $("#calc-try-value").addEventListener("input", calcPreview);
  $("#calc-try-cur").addEventListener("change", calcPreview);
  RATE_CODES.forEach((c) => $(`#rate-${c}`).addEventListener("input", calcPreview));
  $("#calc-add").addEventListener("click", () => { calcLine(); $("#calc-lines").lastElementChild.querySelector(".k-label").focus(); });

  async function loadCalculator() {
    try {
      const d = await ITIE.post("admin_calculator");
      currency = d.currency || currency;
      document.querySelectorAll(".js-currency").forEach((n) => { n.textContent = currency; });
      $("#calc-lines").replaceChildren();
      (d.lines.length ? d.lines : [undefined]).forEach((l) => calcLine(l));
      RATE_CODES.forEach((c) => { $(`#rate-${c}`).value = d.rates[c] ?? ""; });
      $("#calc-note").value = d.note;
      $("#calc-enabled").checked = d.enabled;
      calcPreview();
    } catch (err) {
      setFormStatus($("#calc-form"), err.message, "error");
    }
  }

  handle($("#calc-form"), async () => {
    const lines = readCalcLines().filter((l) => l.label || l.raw);
    await ITIE.post("admin_calculator_save", {
      lines: lines.map(({ label, kind, rate, amount }) => ({ label, kind, rate, amount })),
      rates: calcRates(),
      note: $("#calc-note").value,
      enabled: $("#calc-enabled").checked,
    });
    setFormStatus($("#calc-form"), $("#calc-enabled").checked ? "Saved. Customers can use it at /calculator." : "Saved. The calculator is hidden from customers.", "ok");
  });

  // ── Open a tab from the address (/admin#invoices, /admin#inventory) ────

  ITIE.session().then((user) => {
    if (!user || user.role !== "admin") return;
    const tab = document.querySelector(`.cl-tab[data-tab="${location.hash.slice(1)}"]`);
    if (tab) tab.click();
  });
})();
