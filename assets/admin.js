// Admin page (admin.html): customers, quote requests and the admin's own
// profile. Every action is checked again on the server (role = admin).

(() => {
  const $ = (sel) => document.querySelector(sel);
  const val = (sel) => $(sel).value.trim();
  let openId = null;
  let deleteArmed = false;
  let searchTimer = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

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

  function fillList(list, items, empty, render) {
    list.replaceChildren();
    if (!items.length) {
      list.append(el("li", "cl-list-empty", empty));
      return;
    }
    items.forEach((item) => list.append(render(item)));
  }

  function listRow(main, small) {
    const li = el("li");
    li.append(el("span", "", main), el("small", "", small));
    return li;
  }

  // ── Sign in / out ──────────────────────────────────────────────────────

  function showSignIn(message) {
    $("#admin-loading").hidden = true;
    $("#admin-app").hidden = true;
    $("#admin-signin").hidden = false;
    if (message) setFormStatus($("#admin-signin-form"), message, "error");
    $("#admin-email").focus();
  }

  function showApp(user) {
    $("#admin-loading").hidden = true;
    $("#admin-signin").hidden = true;
    $("#admin-app").hidden = false;
    setAccountLink(user);
    $("#admin-who").textContent = user.name;
    $("#me-name").value = user.name;
    $("#me-email").value = user.email;
    $("#me-phone").value = user.phone;
    loadCustomers();
  }

  handle($("#admin-signin-form"), async () => {
    const { user } = await ITIE.post("signin", { email: val("#admin-email"), password: $("#admin-password").value });
    $("#admin-password").value = "";
    if (user.role !== "admin") {
      await ITIE.post("signout");
      throw new Error("This account is not an admin. Customers sign in from the account page.");
    }
    showApp(user);
  });

  $("#admin-signout").addEventListener("click", async () => {
    try { await ITIE.post("signout"); } catch (e) { /* signed out locally either way */ }
    window.location.href = "admin.html";
  });

  // ── Tabs ───────────────────────────────────────────────────────────────

  document.querySelectorAll(".cl-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".cl-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
      if (tab.dataset.tab === "customers") loadCustomers();
      if (tab.dataset.tab === "quotes") loadQuotes();
    });
  });

  // ── Customers ──────────────────────────────────────────────────────────

  async function loadCustomers() {
    const table = $("#customer-table");
    try {
      const { customers, stats } = await ITIE.post("admin_customers", { q: val("#customer-search") });
      $("#stat-total").textContent = stats.total;
      $("#stat-new").textContent = stats.new_week;
      $("#stat-active").textContent = stats.active_week;
      $("#stat-quotes").textContent = stats.open_quotes;
      const count = $("#tab-quote-count");
      count.textContent = stats.open_quotes;
      count.hidden = !stats.open_quotes;

      table.replaceChildren();
      const head = el("div", "cl-tr cl-th");
      ["Name", "Email", "Phone", "Company", "Joined", "Last active"].forEach((h) => head.append(el("span", "", h)));
      table.append(head);
      if (!customers.length) {
        table.append(el("p", "cl-table-empty", val("#customer-search") ? "No customers match that search." : "No customers yet. They appear here when they create an account."));
        return;
      }
      customers.forEach((c) => {
        const row = el("button", "cl-tr");
        row.type = "button";
        row.append(
          el("span", "cl-td-name", c.name),
          el("span", "", c.email),
          el("span", "", c.phone || "—"),
          el("span", "", c.company || "—"),
          el("span", "", ITIE.date(c.created_at)),
          el("span", "", ITIE.ago(c.last_seen)),
        );
        row.addEventListener("click", () => openCustomer(c.id));
        table.append(row);
      });
    } catch (err) {
      if (/sign in|admins only/i.test(err.message)) return showSignIn(err.message);
      table.replaceChildren(el("p", "cl-table-empty", err.message));
    }
  }

  $("#customer-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadCustomers, 250);
  });

  // ── Customer drawer ────────────────────────────────────────────────────

  function closeDrawer() {
    $("#drawer").hidden = true;
    $("#drawer-backdrop").hidden = true;
    document.body.classList.remove("modal-open");
    openId = null;
  }

  async function openCustomer(id) {
    openId = id;
    deleteArmed = false;
    $("#drawer-delete").textContent = "Delete customer";
    document.querySelectorAll("#drawer .cl-form-status").forEach((s) => { s.hidden = true; });
    try {
      const { customer: c, notes, activity, quotes } = await ITIE.post("admin_customer", { id });
      $("#drawer-name").textContent = c.name;
      $("#drawer-meta").textContent = `Joined ${ITIE.date(c.created_at)} · last active ${ITIE.ago(c.last_seen).toLowerCase()}`;
      $("#d-name").value = c.name;
      $("#d-email").textContent = c.email;
      $("#d-email").href = `mailto:${c.email}`;
      $("#d-phone").value = c.phone;
      $("#d-company").value = c.company;
      $("#d-country").value = c.country;
      $("#d-city").value = c.city;
      fillList($("#drawer-notes"), notes, "No notes yet.", (n) => {
        const li = listRow(n.text, ITIE.dateTime(n.created_at));
        const remove = el("button", "cl-linkbtn cl-note-remove", "Remove");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          await ITIE.post("admin_note_delete", { note_id: n.id });
          openCustomer(id);
        });
        li.append(remove);
        return li;
      });
      fillList($("#drawer-quotes"), quotes, "No quote requests.", (q) =>
        listRow(`${q.destination}${q.details ? ` · ${q.details.slice(0, 120)}` : ""}`, `${ITIE.date(q.created_at)} · ${q.status === "done" ? "Handled" : "Open"}`));
      fillList($("#drawer-activity"), activity, "Nothing yet.", (a) => listRow(a.text, ITIE.dateTime(a.created_at)));
      $("#drawer").hidden = false;
      $("#drawer-backdrop").hidden = false;
      document.body.classList.add("modal-open");
    } catch (err) {
      alert(err.message);
    }
  }

  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
  });

  handle($("#drawer-form"), async () => {
    await ITIE.post("admin_customer_update", {
      id: openId,
      name: val("#d-name"),
      phone: val("#d-phone"),
      company: val("#d-company"),
      country: val("#d-country"),
      city: val("#d-city"),
    });
    $("#drawer-name").textContent = val("#d-name");
    setFormStatus($("#drawer-form"), "Saved.", "ok");
    loadCustomers();
  });

  handle($("#note-form"), async () => {
    await ITIE.post("admin_note_add", { id: openId, text: val("#note-text") });
    $("#note-text").value = "";
    openCustomer(openId);
  });

  $("#drawer-delete").addEventListener("click", async () => {
    // Two clicks: the first one asks, the second one deletes.
    if (!deleteArmed) {
      deleteArmed = true;
      $("#drawer-delete").textContent = "Click again to delete for good";
      return;
    }
    try {
      await ITIE.post("admin_customer_delete", { id: openId });
      closeDrawer();
      loadCustomers();
    } catch (err) {
      alert(err.message);
    }
  });

  // ── Quote requests ─────────────────────────────────────────────────────

  async function loadQuotes() {
    const list = $("#quote-list");
    try {
      const { quotes } = await ITIE.post("admin_quotes");
      list.replaceChildren();
      if (!quotes.length) {
        list.append(el("p", "cl-table-empty", "No quote requests yet. They appear here when someone sends the quote form."));
        return;
      }
      quotes.forEach((q) => {
        const card = el("article", `cl-card cl-quote${q.status === "done" ? " is-done" : ""}`);
        const top = el("div", "cl-quote-top");
        top.append(el("strong", "", q.name + (q.company ? ` · ${q.company}` : "")),
          el("span", `cl-badge cl-badge-${q.status === "done" ? "done" : "new"}`, q.status === "done" ? "Handled" : "Open"));
        const meta = el("p", "cl-muted");
        const mail = el("a", "", q.email);
        mail.href = `mailto:${q.email}`;
        const tel = el("a", "", q.phone);
        tel.href = `tel:${q.phone.replace(/[^\d+]/g, "")}`;
        meta.append(`${ITIE.dateTime(q.created_at)} · ${q.destination} · `, tel, " · ", mail);
        card.append(top, meta);
        if (q.details) card.append(el("p", "cl-quote-details", q.details));
        const actions = el("div", "cl-quote-actions");
        const toggle = el("button", "btn btn-outline", q.status === "done" ? "Reopen" : "Mark as handled");
        toggle.type = "button";
        toggle.addEventListener("click", async () => {
          await ITIE.post("admin_quote_status", { id: q.id, status: q.status === "done" ? "new" : "done" });
          loadQuotes();
        });
        actions.append(toggle);
        if (q.user_id) {
          const view = el("button", "cl-linkbtn", `Open ${q.account_name || "customer"}`);
          view.type = "button";
          view.addEventListener("click", () => openCustomer(q.user_id));
          actions.append(view);
        }
        card.append(actions);
        list.append(card);
      });
    } catch (err) {
      list.replaceChildren(el("p", "cl-table-empty", err.message));
    }
  }

  // ── Admin profile ──────────────────────────────────────────────────────

  handle($("#me-form"), async () => {
    const { user } = await ITIE.post("admin_profile", { name: val("#me-name"), email: val("#me-email"), phone: val("#me-phone") });
    $("#admin-who").textContent = user.name;
    setFormStatus($("#me-form"), "Saved.", "ok");
  });

  handle($("#me-password-form"), async () => {
    await ITIE.post("password", { current: $("#me-current").value, password: $("#me-new").value });
    $("#me-current").value = "";
    $("#me-new").value = "";
    setFormStatus($("#me-password-form"), "Password changed.", "ok");
  });

  // ── Start ──────────────────────────────────────────────────────────────

  ITIE.session().then((user) => {
    if (user && user.role === "admin") showApp(user);
    else showSignIn(user ? "You're signed in as a customer. Sign in with the admin account." : "");
  });
})();
