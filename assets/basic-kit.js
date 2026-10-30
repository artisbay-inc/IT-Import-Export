/*
 * Basic Light kit: customer sign-up / sign-in and a simple back office
 * (customer list, contact details, notes, search) for the Basic Light demos.
 *
 * Drop in with one tag, after the demo's own main.js:
 *   <script src="../_basic-kit/basic-kit.js" data-site="mechanic"
 *     data-business="Pitline Auto Lab" data-accent="var(--accent)"
 *     data-on-accent="#14100c" data-tone="dark"></script>
 *
 * data-tone is "light", "dark", or "auto" to follow <html data-theme>.
 *
 * Demo only: everything is kept in this browser's localStorage and emails
 * are shown on screen instead of being sent. The real kit runs on PHP/MySQL.
 */
(function () {
  "use strict";

  const script = document.currentScript;
  const cfg = {
    site: script?.dataset.site || location.pathname,
    business: script?.dataset.business || document.title,
    accent: script?.dataset.accent || "#2563eb",
    onAccent: script?.dataset.onAccent || "#ffffff",
    tone: ["dark", "auto"].includes(script?.dataset.tone) ? script.dataset.tone : "light",
  };

  const OWNER = { email: "owner@demo.com", password: "demo1234" };
  const KEY = `basic-kit:${cfg.site}`;
  const DAY = 86400000;

  // ── Storage ────────────────────────────────────────────────────────────
  const store = {
    get(name, fallback) {
      try {
        const raw = localStorage.getItem(`${KEY}:${name}`);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(name, value) {
      try {
        localStorage.setItem(`${KEY}:${name}`, JSON.stringify(value));
      } catch {
        /* private mode: the demo still works until the tab closes */
      }
    },
    clear() {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(`${KEY}:`))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* ignore */
      }
    },
  };

  const memory = {};
  const load = (name, fallback) => (name in memory ? memory[name] : (memory[name] = store.get(name, fallback)));
  const save = (name, value) => {
    memory[name] = value;
    store.set(name, value);
  };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  async function hash(email, password) {
    const text = `${email.toLowerCase()}::${password}`;
    if (window.crypto?.subtle && window.TextEncoder) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return `plain:${text}`;
  }

  function seedCustomers() {
    const now = Date.now();
    const sample = (name, email, phone, daysAgo, notes, activity) => ({
      id: uid(),
      name,
      email,
      phone,
      pass: "",
      sample: true,
      createdAt: now - daysAgo * DAY,
      lastSeen: now - Math.min(...activity.map(([, d]) => d)) * DAY,
      notes: notes.map(([text, d]) => ({ id: uid(), text, at: now - d * DAY })),
      activity: activity.map(([text, d]) => ({ text, at: now - d * DAY })),
    });
    return [
      sample("Kenji Watanabe", "kenji.w@example.com", "+81 90 1234 5678", 1, [["Asked for a quote by Friday. Prefers email.", 1]], [["Signed up", 1], ["Sent a form: request a quote", 1]]),
      sample("Maria Santos", "maria.santos@example.com", "+63 917 555 0142", 3, [], [["Signed up", 3]]),
      sample("David Mwangi", "d.mwangi@example.com", "+254 712 345 678", 9, [["Repeat customer. Call before 10am Nairobi time.", 6], ["Paid deposit on the last order.", 2]], [["Signed up", 9], ["Sent a form: inquiry", 6], ["Signed in", 2]]),
      sample("Aiko Tanaka", "aiko.t@example.com", "+81 80 9876 5432", 14, [["Interested in the spring offer.", 13]], [["Signed up", 14]]),
      sample("Tom Becker", "tom.becker@example.com", "+49 151 2345 6789", 22, [], [["Signed up", 22], ["Sent a form: inquiry", 20]]),
      sample("Grace Nambala", "grace.n@example.com", "+264 81 234 5678", 35, [["Wants updates by WhatsApp.", 30]], [["Signed up", 35], ["Signed in", 12]]),
    ];
  }

  const customers = () => load("customers", null) || (save("customers", seedCustomers()), load("customers"));
  const putCustomers = (list) => save("customers", list);
  const session = () => load("session", null);
  const setSession = (s) => {
    save("session", s);
    // Fill the demo's own forms with the new customer's details.
    if (s?.type === "customer") setTimeout(prefillForms, 0);
  };
  const currentCustomer = () => {
    const s = session();
    return s?.type === "customer" ? customers().find((c) => c.id === s.id) || null : null;
  };
  const isOwner = () => session()?.type === "owner";

  function updateCustomer(id, change) {
    const list = customers().map((c) => (c.id === id ? { ...c, ...change(c) } : c));
    putCustomers(list);
    return list.find((c) => c.id === id);
  }

  const logActivity = (id, text) =>
    updateCustomer(id, (c) => ({ activity: [...(c.activity || []), { text, at: Date.now() }], lastSeen: Date.now() }));

  // ── Helpers ────────────────────────────────────────────────────────────
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtWhen = (t) => {
    const days = Math.floor((Date.now() - t) / DAY);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return `${days} days ago`;
    return fmtDate(t);
  };
  const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Account";
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // ── Styles ─────────────────────────────────────────────────────────────
  const css = `
.bk-root{--bk-accent:${cfg.accent};--bk-on:${cfg.onAccent};font-family:inherit;color:var(--bk-text);font-size:15px;line-height:1.5}
.bk-root.bk-light{--bk-bg:#ffffff;--bk-panel:#f5f7fa;--bk-text:#111827;--bk-muted:#6b7280;--bk-line:#e5e7eb;--bk-field:#ffffff;--bk-shade:rgba(15,23,42,.55)}
.bk-root.bk-dark{--bk-bg:#171b22;--bk-panel:#1f242e;--bk-text:#f1f4fa;--bk-muted:#a3acbb;--bk-line:rgba(255,255,255,.12);--bk-field:#11151b;--bk-shade:rgba(0,0,0,.7)}
.bk-root *{box-sizing:border-box}
:where(.bk-root) :where(button,input,textarea){font:inherit;color:inherit}
.bk-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--bk-shade);display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto}
.bk-modal{position:relative;width:100%;max-width:420px;background:var(--bk-bg);color:var(--bk-text);border-radius:16px;padding:28px 26px 20px;box-shadow:0 24px 60px rgba(0,0,0,.35);margin:auto}
.bk-close{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:50%;background:var(--bk-panel);cursor:pointer;font-size:18px;line-height:1}
.bk-modal h2{margin:0 0 4px;font-size:22px;line-height:1.25;letter-spacing:normal;text-transform:none;font-family:inherit;color:var(--bk-text)}
.bk-sub{margin:0 0 18px;color:var(--bk-muted);font-size:14px}
.bk-form{display:grid;gap:12px}
.bk-field{display:grid;gap:5px;font-size:13px;font-weight:600;color:var(--bk-text)}
.bk-field input,.bk-field textarea,.bk-search{width:100%;padding:11px 12px;border:1px solid var(--bk-line);border-radius:10px;background:var(--bk-field);font-size:15px;font-weight:400;outline:none}
.bk-field input:focus,.bk-field textarea:focus,.bk-search:focus{border-color:var(--bk-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--bk-accent) 25%,transparent)}
.bk-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:10px;border:1px solid transparent;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none}
.bk-btn-primary{background:var(--bk-accent);color:var(--bk-on)}
.bk-btn-primary:hover{filter:brightness(1.07)}
.bk-btn-ghost{background:transparent;border-color:var(--bk-line);color:var(--bk-text)}
.bk-btn-danger{background:transparent;border-color:#dc2626;color:#dc2626}
.bk-btn-block{width:100%}
.bk-link{background:none;border:0;padding:0;color:var(--bk-accent);font-weight:700;cursor:pointer;font-size:14px;text-decoration:underline;text-underline-offset:2px}
.bk-row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px}
.bk-error{margin:0;padding:9px 12px;border-radius:10px;background:rgba(220,38,38,.12);color:#ef4444;font-size:14px}
.bk-ok{margin:0;padding:9px 12px;border-radius:10px;background:rgba(22,163,74,.14);color:#16a34a;font-size:14px}
.bk-note{margin:16px 0 0;padding-top:12px;border-top:1px solid var(--bk-line);color:var(--bk-muted);font-size:12.5px}
.bk-hint{margin:0 0 4px;padding:10px 12px;border-radius:10px;background:var(--bk-panel);font-size:13.5px;color:var(--bk-text)}
.bk-hint code{font-family:ui-monospace,Consolas,monospace;font-size:13px}
.bk-mail{border:1px dashed var(--bk-line);border-radius:12px;padding:12px 14px;background:var(--bk-panel);font-size:14px;display:grid;gap:6px}
.bk-mail small{color:var(--bk-muted)}
.bk-divider{border:0;border-top:1px solid var(--bk-line);margin:18px 0}
.bk-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.bk-list li{padding:9px 12px;border-radius:10px;background:var(--bk-panel);font-size:14px}
.bk-list li small{display:block;color:var(--bk-muted);font-size:12px}
.bk-empty{color:var(--bk-muted);font-size:14px;margin:0}

.bk-office{position:fixed;inset:0;z-index:2147483000;background:var(--bk-panel);color:var(--bk-text);display:flex;flex-direction:column;overflow:hidden}
.bk-office-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;background:var(--bk-bg);border-bottom:1px solid var(--bk-line);flex-wrap:wrap}
.bk-office-bar strong{font-size:17px}
.bk-office-bar span{color:var(--bk-muted);font-size:13px;display:block}
.bk-office-actions{display:flex;gap:8px;flex-wrap:wrap}
.bk-office-actions .bk-btn{padding:8px 14px;font-size:14px}
.bk-office-body{flex:1;overflow-y:auto;padding:22px}
.bk-office-inner{max-width:1100px;margin:0 auto;display:grid;gap:18px}
.bk-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.bk-stat{background:var(--bk-bg);border:1px solid var(--bk-line);border-radius:14px;padding:14px 16px}
.bk-stat b{display:block;font-size:26px;line-height:1.1}
.bk-stat small{color:var(--bk-muted);font-size:13px}
.bk-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bk-toolbar .bk-search{flex:1;min-width:200px}
.bk-table{background:var(--bk-bg);border:1px solid var(--bk-line);border-radius:14px;overflow:hidden}
.bk-tr{display:grid;grid-template-columns:1.4fr 1.6fr 1.1fr .9fr .9fr;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid var(--bk-line);font-size:14px}
.bk-tr:first-child{border-top:0}
.bk-th{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--bk-muted);background:var(--bk-panel)}
button.bk-tr{width:100%;text-align:left;background:none;border-left:0;border-right:0;border-bottom:0;cursor:pointer}
button.bk-tr:hover{background:color-mix(in srgb,var(--bk-accent) 8%,transparent)}
.bk-tr span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk-tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:var(--bk-panel);color:var(--bk-muted);font-size:11px;font-weight:700;vertical-align:middle}
.bk-drawer{position:fixed;top:0;right:0;bottom:0;z-index:2147483001;width:min(440px,100%);background:var(--bk-bg);border-left:1px solid var(--bk-line);box-shadow:-20px 0 50px rgba(0,0,0,.25);overflow-y:auto;padding:24px 22px}
.bk-drawer h3{margin:0 0 2px;font-size:20px;font-family:inherit;text-transform:none;letter-spacing:normal;color:var(--bk-text)}
.bk-drawer h4{margin:20px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--bk-muted);font-family:inherit}
.bk-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin:12px 0 0}
.bk-dl dt{color:var(--bk-muted)}
.bk-dl dd{margin:0;word-break:break-word}
.bk-dl a{color:var(--bk-accent)}
@media (max-width:720px){
  .bk-stats{grid-template-columns:1fr 1fr 1fr;gap:8px}
  .bk-stat{padding:10px 12px}.bk-stat b{font-size:20px}
  .bk-th{display:none}
  .bk-tr{grid-template-columns:1fr auto;gap:2px 10px}
  .bk-tr span:nth-child(1){font-weight:700}
  .bk-tr span:nth-child(2){grid-column:1/-1;grid-row:2;color:var(--bk-muted)}
  .bk-tr span:nth-child(3),.bk-tr span:nth-child(5){display:none}
  .bk-tr span:nth-child(4){grid-column:2;grid-row:1;color:var(--bk-muted);font-size:12px}
  .bk-office-body{padding:14px}
  .bk-office-bar{padding:12px 14px}
  .bk-modal{padding:24px 18px 16px}
}
.bk-nav-link{cursor:pointer}
.bk-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

  // ── Root + rendering ───────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement("div");
  // data-tone="auto" follows the page's own theme switch (<html data-theme="dark">).
  const applyTone = () => {
    const tone = cfg.tone === "auto" ? (document.documentElement.dataset.theme === "dark" ? "dark" : "light") : cfg.tone;
    root.className = `bk-root bk-${tone}`;
  };
  applyTone();
  if (cfg.tone === "auto") {
    new MutationObserver(applyTone).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  document.body.appendChild(root);

  let lastFocus = null;
  const lockScroll = (on) => {
    document.documentElement.style.overflow = on ? "hidden" : "";
  };

  function closeAll() {
    root.innerHTML = "";
    lockScroll(false);
    refreshNav();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function openModal(view, data) {
    lastFocus = lastFocus || document.activeElement;
    lockScroll(true);
    root.innerHTML = `<div class="bk-overlay" data-bk-backdrop><div class="bk-modal" role="dialog" aria-modal="true" aria-label="Account">
      <button type="button" class="bk-close" data-bk="close" aria-label="Close">&times;</button>
      ${views[view](data || {})}
      <p class="bk-note">Demo: accounts are saved only in this browser. Emails are shown on screen instead of being sent.</p>
    </div></div>`;
    root.querySelector("input")?.focus();
  }

  const field = (label, name, type = "text", value = "", extra = "") =>
    `<label class="bk-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} /></label>`;
  const message = (d) => (d.error ? `<p class="bk-error">${esc(d.error)}</p>` : d.ok ? `<p class="bk-ok">${esc(d.ok)}</p>` : "");

  const views = {
    signin: (d) => `
      <h2>Sign in</h2>
      <p class="bk-sub">Welcome back to ${esc(cfg.business)}.</p>
      <form class="bk-form" data-bk-form="signin" novalidate>
        ${message(d)}
        ${field("Email", "email", "email", d.email, 'autocomplete="email" required')}
        ${field("Password", "password", "password", "", 'autocomplete="current-password" required')}
        <div class="bk-row"><span></span><button type="button" class="bk-link" data-bk="forgot">Forgot password?</button></div>
        <button class="bk-btn bk-btn-primary bk-btn-block" type="submit">Sign in</button>
        <div class="bk-row"><span>New here?</span><button type="button" class="bk-link" data-bk="signup">Create an account</button></div>
      </form>
      <hr class="bk-divider" />
      <div class="bk-row"><span>Own this business?</span><button type="button" class="bk-link" data-bk="owner">Open the back office</button></div>`,

    signup: (d) => `
      <h2>Create your account</h2>
      <p class="bk-sub">Save your details and get faster replies from ${esc(cfg.business)}.</p>
      <form class="bk-form" data-bk-form="signup" novalidate>
        ${message(d)}
        ${field("Full name", "name", "text", d.name, 'autocomplete="name" required')}
        ${field("Email", "email", "email", d.email, 'autocomplete="email" required')}
        ${field("Phone (optional)", "phone", "tel", d.phone, 'autocomplete="tel"')}
        ${field("Password (8 characters or more)", "password", "password", "", 'autocomplete="new-password" required minlength="8"')}
        <button class="bk-btn bk-btn-primary bk-btn-block" type="submit">Create account</button>
        <div class="bk-row"><span>Already have an account?</span><button type="button" class="bk-link" data-bk="signin">Sign in</button></div>
      </form>`,

    forgot: (d) => `
      <h2>Reset your password</h2>
      <p class="bk-sub">Enter your email and we'll send you a reset link.</p>
      <form class="bk-form" data-bk-form="forgot" novalidate>
        ${message(d)}
        ${field("Email", "email", "email", d.email, 'autocomplete="email" required')}
        <button class="bk-btn bk-btn-primary bk-btn-block" type="submit">Send reset link</button>
        <div class="bk-row"><span></span><button type="button" class="bk-link" data-bk="signin">Back to sign in</button></div>
      </form>`,

    mailed: (d) => `
      <h2>Check your email</h2>
      <p class="bk-sub">On the real site this arrives in your inbox. Here it is on screen:</p>
      <div class="bk-mail">
        <small>To: ${esc(d.email)}</small>
        <strong>Reset your ${esc(cfg.business)} password</strong>
        <span>Click the button below to choose a new password. The link expires in 1 hour.</span>
        <div><button type="button" class="bk-btn bk-btn-primary" data-bk="reset" data-email="${esc(d.email)}">Choose a new password</button></div>
      </div>`,

    reset: (d) => `
      <h2>Choose a new password</h2>
      <p class="bk-sub">For ${esc(d.email)}</p>
      <form class="bk-form" data-bk-form="reset" novalidate>
        ${message(d)}
        <input type="hidden" name="email" value="${esc(d.email)}" />
        ${field("New password (8 characters or more)", "password", "password", "", 'autocomplete="new-password" required minlength="8"')}
        <button class="bk-btn bk-btn-primary bk-btn-block" type="submit">Save password</button>
      </form>`,

    account: (d) => {
      const c = currentCustomer();
      if (!c) return views.signin(d);
      const activity = [...(c.activity || [])].reverse().slice(0, 6);
      return `
      <h2>Hi, ${esc(firstName(c.name))}</h2>
      <p class="bk-sub">Your ${esc(cfg.business)} account · ${esc(c.email)}</p>
      <form class="bk-form" data-bk-form="profile" novalidate>
        ${message(d)}
        ${field("Full name", "name", "text", c.name, 'autocomplete="name" required')}
        ${field("Phone", "phone", "tel", c.phone, 'autocomplete="tel"')}
        <button class="bk-btn bk-btn-primary bk-btn-block" type="submit">Save details</button>
      </form>
      <hr class="bk-divider" />
      <form class="bk-form" data-bk-form="password" novalidate>
        ${field("Current password", "current", "password", "", 'autocomplete="current-password"')}
        ${field("New password", "password", "password", "", 'autocomplete="new-password" minlength="8"')}
        <button class="bk-btn bk-btn-ghost bk-btn-block" type="submit">Change password</button>
      </form>
      <hr class="bk-divider" />
      <p class="bk-sub" style="margin-bottom:8px">Recent activity</p>
      <ul class="bk-list">${activity.map((a) => `<li>${esc(a.text)}<small>${fmtWhen(a.at)}</small></li>`).join("")}</ul>
      <div class="bk-row" style="margin-top:16px"><span></span><button type="button" class="bk-btn bk-btn-ghost" data-bk="signout">Sign out</button></div>`;
    },

    owner: (d) => `
      <h2>Back office sign in</h2>
      <p class="bk-sub">For the ${esc(cfg.business)} team.</p>
      <form class="bk-form" data-bk-form="owner" novalidate>
        <p class="bk-hint">Demo owner login: <code>${OWNER.email}</code> / <code>${OWNER.password}</code></p>
        ${message(d)}
        ${field("Email", "email", "email", OWNER.email, 'autocomplete="username"')}
        ${field("Password", "password", "password", OWNER.password, 'autocomplete="current-password"')}
        <button class="bk-btn bk-btn-primary bk-btn-block" type="submit">Open the back office</button>
        <div class="bk-row"><span></span><button type="button" class="bk-link" data-bk="signin">Customer sign in</button></div>
      </form>`,
  };

  // ── Back office ────────────────────────────────────────────────────────
  let officeQuery = "";
  let openId = null;
  let confirmDelete = false;

  function officeRows() {
    const q = officeQuery.trim().toLowerCase();
    return customers()
      .filter((c) => !q || [c.name, c.email, c.phone, ...(c.notes || []).map((n) => n.text)].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function renderOffice() {
    lockScroll(true);
    const all = customers();
    const week = Date.now() - 7 * DAY;
    const rows = officeRows();
    const open = openId ? all.find((c) => c.id === openId) : null;
    const scroller = root.querySelector(".bk-office-body");
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const searchHadFocus = document.activeElement?.classList.contains("bk-search");

    root.innerHTML = `<div class="bk-office" role="dialog" aria-modal="true" aria-label="Back office">
      <div class="bk-office-bar">
        <div><strong>${esc(cfg.business)}</strong><span>Back office · customers</span></div>
        <div class="bk-office-actions">
          <button type="button" class="bk-btn bk-btn-ghost" data-bk="close">Back to website</button>
          <button type="button" class="bk-btn bk-btn-ghost" data-bk="signout">Sign out</button>
        </div>
      </div>
      <div class="bk-office-body"><div class="bk-office-inner">
        <div class="bk-stats">
          <div class="bk-stat"><b>${all.length}</b><small>Customers</small></div>
          <div class="bk-stat"><b>${all.filter((c) => c.createdAt >= week).length}</b><small>New this week</small></div>
          <div class="bk-stat"><b>${all.filter((c) => (c.lastSeen || 0) >= week).length}</b><small>Active this week</small></div>
        </div>
        <div class="bk-toolbar">
          <input class="bk-search" type="search" placeholder="Search name, email, phone or notes" value="${esc(officeQuery)}" aria-label="Search customers" />
          <button type="button" class="bk-link" data-bk="reset-demo">Reset demo data</button>
        </div>
        <div class="bk-table" role="table">
          <div class="bk-tr bk-th" role="row"><span>Name</span><span>Email</span><span>Phone</span><span>Joined</span><span>Last active</span></div>
          ${rows
            .map(
              (c) => `<button type="button" class="bk-tr" role="row" data-bk="open" data-id="${c.id}">
                <span>${esc(c.name)}${c.sample ? '<em class="bk-tag">sample</em>' : ""}</span>
                <span>${esc(c.email)}</span><span>${esc(c.phone || "—")}</span>
                <span>${fmtDate(c.createdAt)}</span><span>${fmtWhen(c.lastSeen || c.createdAt)}</span>
              </button>`
            )
            .join("") || `<div class="bk-tr"><span class="bk-empty">No customers match “${esc(officeQuery)}”.</span></div>`}
        </div>
        <p class="bk-empty">Tip: sign out, create a customer account on the website, then come back. It shows up here.</p>
      </div></div>
      ${open ? drawer(open) : ""}
    </div>`;

    const body = root.querySelector(".bk-office-body");
    if (body) body.scrollTop = scrollTop;
    if (searchHadFocus) {
      const s = root.querySelector(".bk-search");
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }
  }

  function drawer(c) {
    const notes = [...(c.notes || [])].reverse();
    const activity = [...(c.activity || [])].reverse();
    return `<aside class="bk-drawer" aria-label="Customer details">
      <button type="button" class="bk-close" data-bk="close-drawer" aria-label="Close details">&times;</button>
      <h3>${esc(c.name)}</h3>
      <p class="bk-sub" style="margin:0">Customer since ${fmtDate(c.createdAt)}</p>
      <dl class="bk-dl">
        <dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
        <dt>Phone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s+/g, ""))}">${esc(c.phone)}</a>` : "—"}</dd>
        <dt>Last active</dt><dd>${fmtWhen(c.lastSeen || c.createdAt)}</dd>
      </dl>
      <h4>Notes</h4>
      <form class="bk-form" data-bk-form="note" data-id="${c.id}">
        <label class="bk-field"><span class="bk-sr">Add a note</span><textarea name="text" rows="3" placeholder="Add a note only your team can see"></textarea></label>
        <button class="bk-btn bk-btn-primary" type="submit">Add note</button>
      </form>
      <ul class="bk-list" style="margin-top:12px">${
        notes.map((n) => `<li>${esc(n.text)}<small>${fmtWhen(n.at)} · <button type="button" class="bk-link" data-bk="del-note" data-id="${c.id}" data-note="${n.id}">Remove</button></small></li>`).join("") ||
        '<li class="bk-empty">No notes yet.</li>'
      }</ul>
      <h4>Activity</h4>
      <ul class="bk-list">${activity.map((a) => `<li>${esc(a.text)}<small>${fmtWhen(a.at)}</small></li>`).join("") || '<li class="bk-empty">Nothing yet.</li>'}</ul>
      <hr class="bk-divider" />
      <button type="button" class="bk-btn bk-btn-danger" data-bk="delete" data-id="${c.id}">${confirmDelete ? "Click again to delete for good" : "Delete customer"}</button>
    </aside>`;
  }

  // ── Actions ────────────────────────────────────────────────────────────
  root.addEventListener("click", (e) => {
    if (e.target.matches("[data-bk-backdrop]")) return closeAll();
    const btn = e.target.closest("[data-bk]");
    if (!btn) return;
    const action = btn.dataset.bk;
    if (action === "close") return closeAll();
    if (["signin", "signup", "forgot", "owner"].includes(action)) return openModal(action);
    if (action === "reset") return openModal("reset", { email: btn.dataset.email });
    if (action === "signout") {
      setSession(null);
      openId = null;
      return closeAll();
    }
    if (action === "open") {
      openId = btn.dataset.id;
      confirmDelete = false;
      return renderOffice();
    }
    if (action === "close-drawer") {
      openId = null;
      return renderOffice();
    }
    if (action === "del-note") {
      updateCustomer(btn.dataset.id, (c) => ({ notes: c.notes.filter((n) => n.id !== btn.dataset.note) }));
      return renderOffice();
    }
    if (action === "delete") {
      if (!confirmDelete) {
        confirmDelete = true;
        return renderOffice();
      }
      putCustomers(customers().filter((c) => c.id !== btn.dataset.id));
      openId = null;
      confirmDelete = false;
      return renderOffice();
    }
    if (action === "reset-demo") {
      store.clear();
      Object.keys(memory).forEach((k) => delete memory[k]);
      setSession({ type: "owner" });
      openId = null;
      return renderOffice();
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.classList.contains("bk-search")) {
      officeQuery = e.target.value;
      openId = null;
      renderOffice();
    }
  });

  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-bk-form]");
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const email = String(f.email || "").trim();
    const kind = form.dataset.bkForm;

    if (kind === "signin") {
      const c = customers().find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (c?.sample) return openModal("signin", { email, error: "That's a sample customer. Create your own account to try signing in." });
      if (!c || c.pass !== (await hash(email, f.password || ""))) return openModal("signin", { email, error: "Email or password is wrong." });
      setSession({ type: "customer", id: c.id });
      logActivity(c.id, "Signed in");
      return openModal("account", { ok: "You're signed in." });
    }

    if (kind === "signup") {
      const name = String(f.name || "").trim();
      const phone = String(f.phone || "").trim();
      const keep = { name, email, phone };
      if (!name) return openModal("signup", { ...keep, error: "Please enter your name." });
      if (!validEmail(email)) return openModal("signup", { ...keep, error: "Please enter a valid email address." });
      if (String(f.password || "").length < 8) return openModal("signup", { ...keep, error: "Your password needs 8 characters or more." });
      if (email.toLowerCase() === OWNER.email) return openModal("signup", { ...keep, error: "That email is the demo owner login. Use another one." });
      if (customers().some((c) => c.email.toLowerCase() === email.toLowerCase()))
        return openModal("signup", { ...keep, error: "There's already an account with that email. Try signing in." });
      const now = Date.now();
      const c = { id: uid(), name, email, phone, pass: await hash(email, f.password), createdAt: now, lastSeen: now, notes: [], activity: [{ text: "Signed up", at: now }] };
      putCustomers([...customers(), c]);
      setSession({ type: "customer", id: c.id });
      return openModal("account", { ok: "Your account is ready. The business can now see you in its customer list." });
    }

    if (kind === "forgot") {
      if (!validEmail(email)) return openModal("forgot", { email, error: "Please enter a valid email address." });
      const c = customers().find((x) => x.email.toLowerCase() === email.toLowerCase() && !x.sample);
      // Same answer either way on a real site; the demo only "sends" when the account exists.
      if (!c) return openModal("forgot", { email, ok: "If that email has an account, a reset link is on its way." });
      return openModal("mailed", { email: c.email });
    }

    if (kind === "reset") {
      if (String(f.password || "").length < 8) return openModal("reset", { email, error: "Your password needs 8 characters or more." });
      const c = customers().find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (c) {
        const pass = await hash(c.email, f.password);
        updateCustomer(c.id, () => ({ pass }));
        logActivity(c.id, "Reset password");
      }
      return openModal("signin", { email, ok: "Password saved. You can sign in now." });
    }

    if (kind === "profile") {
      const c = currentCustomer();
      const name = String(f.name || "").trim();
      if (!name) return openModal("account", { error: "Please enter your name." });
      updateCustomer(c.id, () => ({ name, phone: String(f.phone || "").trim() }));
      logActivity(c.id, "Updated their details");
      return openModal("account", { ok: "Details saved." });
    }

    if (kind === "password") {
      const c = currentCustomer();
      if (c.pass !== (await hash(c.email, f.current || ""))) return openModal("account", { error: "Your current password is wrong." });
      if (String(f.password || "").length < 8) return openModal("account", { error: "Your new password needs 8 characters or more." });
      const pass = await hash(c.email, f.password);
      updateCustomer(c.id, () => ({ pass }));
      logActivity(c.id, "Changed password");
      return openModal("account", { ok: "Password changed." });
    }

    if (kind === "owner") {
      if (email.toLowerCase() !== OWNER.email || f.password !== OWNER.password)
        return openModal("owner", { error: "Email or password is wrong." });
      setSession({ type: "owner" });
      lastFocus = null;
      return renderOffice();
    }

    if (kind === "note") {
      const text = String(f.text || "").trim();
      if (!text) return;
      updateCustomer(form.dataset.id, (c) => ({ notes: [...(c.notes || []), { id: uid(), text, at: Date.now() }] }));
      return renderOffice();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !root.firstChild) return;
    if (openId) {
      openId = null;
      return renderOffice();
    }
    closeAll();
  });

  // ── Site hooks: nav link, form prefill, inquiry log ─────────────────────
  const nav = document.querySelector("header nav");
  let navLink = null;

  function closeMobileNav() {
    if (nav && (nav.classList.contains("open") || nav.classList.contains("is-open"))) {
      document.querySelector('[class*="nav-backdrop"]')?.click();
    }
  }

  function refreshNav() {
    if (!navLink) return;
    const c = currentCustomer();
    navLink.textContent = isOwner() ? "Back office" : c ? `My account` : "Sign in";
  }

  if (nav) {
    navLink = document.createElement("a");
    navLink.href = "#account";
    navLink.className = "bk-nav-link";
    const cta = nav.querySelector('a[class*="cta"]');
    nav.insertBefore(navLink, cta || null);
    navLink.addEventListener("click", (e) => {
      e.preventDefault();
      closeMobileNav();
      lastFocus = navLink;
      if (isOwner()) renderOffice();
      else openModal(currentCustomer() ? "account" : "signin");
    });
    refreshNav();
  }

  function prefillForms() {
    const c = currentCustomer();
    if (!c) return;
    document.querySelectorAll("form").forEach((form) => {
      if (root.contains(form)) return;
      form.querySelectorAll("input").forEach((input) => {
        if (input.value) return;
        const key = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
        if (input.type === "email") input.value = c.email;
        else if (input.type === "tel" && c.phone) input.value = c.phone;
        else if (input.type === "text" && /name/.test(key) && !/company|business|vehicle|model|make|port/.test(key)) input.value = c.name;
      });
    });
  }

  // Log the demo's own forms (booking, quote, inquiry) on the signed-in customer.
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (root.contains(form)) return;
      const c = currentCustomer();
      if (!c) return;
      const filled = form.checkValidity() && Array.from(form.querySelectorAll("[data-required]")).every((el) => el.value.trim());
      if (!filled) return;
      const label = (form.querySelector('[type="submit"]')?.textContent || "inquiry").trim().toLowerCase();
      logActivity(c.id, `Sent a form: ${label}`);
    },
    true
  );

  prefillForms();

  if (location.hash === "#account" && navLink) navLink.click();
})();
