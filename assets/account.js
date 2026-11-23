// Customer account page (account.html): sign in, sign up, password reset and
// the profile. Talks to api/index.php through window.ITIE from main.js.

(() => {
  const views = document.querySelectorAll("[data-view]");
  const title = document.querySelector("#acct-title");
  const sub = document.querySelector("#acct-sub");
  const $ = (sel) => document.querySelector(sel);
  const val = (sel) => $(sel).value.trim();

  const HEADINGS = {
    signin: ["Sign In", "Sign in to keep your details up to date and send quote requests faster."],
    signup: ["Create Your Account", "One account for all your clearing and forwarding requests."],
    forgot: ["Reset Your Password", "We'll email you a link to choose a new one."],
    reset: ["Choose a New Password", "Pick a password with 8 characters or more."],
    verify: ["Confirm Your Email", "One last step: enter the code we emailed you."],
    profile: ["My Account", "Your details and what's happened on your account."],
  };

  function show(name) {
    $("#acct-loading").hidden = true;
    views.forEach((v) => { v.hidden = v.dataset.view !== name; });
    [title.textContent, sub.textContent] = HEADINGS[name];
    const first = document.querySelector(`[data-view="${name}"] input`);
    if (first && name !== "profile") first.focus();
  }

  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cl-form-status").forEach((el) => { el.hidden = true; });
      show(btn.dataset.go);
    });
  });

  /** Runs a form's submit with its button disabled and errors shown in the form. */
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

  function listItems(list, items, empty, render) {
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "cl-list-empty";
      li.textContent = empty;
      list.append(li);
      return;
    }
    items.forEach((item) => list.append(render(item)));
  }

  function row(main, small, badge) {
    const li = document.createElement("li");
    const strong = document.createElement("span");
    strong.textContent = main;
    li.append(strong);
    if (badge) {
      const b = document.createElement("span");
      b.className = `cl-badge cl-badge-${badge.kind}`;
      b.textContent = badge.text;
      li.append(" ", b);
    }
    const s = document.createElement("small");
    s.textContent = small;
    li.append(s);
    return li;
  }

  // Country dropdowns: picking a country puts its dialing code in the phone box.
  // Most customers are in Namibia: start there, with its code in the phone box.
  ITIE_COUNTRY.fill($("#signup-country"), "Namibia");
  ITIE_COUNTRY.link($("#signup-country"), $("#signup-phone"));
  if (!$("#signup-phone").value) $("#signup-phone").value = ITIE_COUNTRY.dialOf("Namibia") + " ";
  ITIE_COUNTRY.fill($("#profile-country"));
  ITIE_COUNTRY.link($("#profile-country"), $("#profile-phone"));

  async function showProfile(user) {
    // The admin has no customer profile. Say so (instead of jumping to /admin),
    // so an admin who wants to try a customer account knows to sign out first.
    if (user.role === "admin") {
      setAccountLink(user);
      show("signin");
      const box = $("#signin-form .cl-form-status");
      box.replaceChildren(`You are signed in as the admin (${user.email}). To use a customer account, sign out first. `);
      const go = document.createElement("a");
      go.href = "/admin";
      go.className = "cl-linkbtn";
      go.textContent = "Go to the admin page";
      const out = document.createElement("button");
      out.type = "button";
      out.className = "cl-linkbtn";
      out.id = "admin-signout";
      out.textContent = "Sign out";
      out.addEventListener("click", async () => {
        try { await ITIE.post("signout"); } catch (e) { /* signed out locally either way */ }
        window.location.reload();
      });
      box.append(go, " · ", out);
      box.className = "cl-form-status is-ok";
      box.hidden = false;
      return;
    }
    setAccountLink(user);
    if (!user.email_verified) return showVerify(user);
    $("#profile-email").textContent = user.email;
    $("#profile-name").value = user.name;
    $("#profile-phone").value = user.phone;
    // Phone (like email) can't be changed by the customer once it is set.
    $("#profile-phone").readOnly = !!user.phone;
    $("#profile-locked").hidden = !user.phone;
    $("#profile-company").value = user.company;
    ITIE_COUNTRY.setValue($("#profile-country"), user.country);
    $("#profile-city").value = user.city;
    show("profile");
    try {
      const { activity } = await ITIE.post("my_activity");
      listItems($("#profile-activity"), activity, "Nothing yet.", (a) => row(a.text, ITIE.dateTime(a.created_at)));
    } catch (err) {
      listItems($("#profile-activity"), [], err.message, () => null);
    }
  }

  handle($("#signin-form"), async () => {
    const { user } = await ITIE.post("signin", { email: val("#signin-email"), password: $("#signin-password").value });
    $("#signin-password").value = "";
    if (user.role === "admin") {
      window.location.href = "/admin";
      return;
    }
    showProfile(user);
  });

  handle($("#signup-form"), async () => {
    const { user, test_code: testCode } = await ITIE.post("signup", {
      name: val("#signup-name"),
      email: val("#signup-email"),
      phone: val("#signup-phone"),
      company: val("#signup-company"),
      country: $("#signup-country").value,
      password: $("#signup-password").value,
    });
    $("#signup-password").value = "";
    showVerify(user, testCode);
  });

  // ── Confirm the email with the 6-digit code ──
  function showVerify(user, testCode) {
    $("#verify-email").textContent = user.email;
    $("#verify-code").value = "";
    show("verify");
    // Only a test site without email sends the code back (config show_email_codes).
    setFormStatus($("#verify-form"), testCode ? `Test site (no email here): your code is ${testCode}` : "", "ok");
  }

  handle($("#verify-form"), async () => {
    const { user } = await ITIE.post("verify_email", { code: val("#verify-code") });
    await showProfile(user);
    setFormStatus($("#profile-form"), "Welcome! Your email is confirmed and your account is ready.", "ok");
  });

  $("#verify-resend").addEventListener("click", async () => {
    try {
      const r = await ITIE.post("resend_code");
      setFormStatus($("#verify-form"), r.test_code ? `${r.message} Test site: your code is ${r.test_code}` : r.message, "ok");
    } catch (err) {
      setFormStatus($("#verify-form"), err.message, "error");
    }
  });

  $("#verify-signout").addEventListener("click", async () => {
    try { await ITIE.post("signout"); } catch (e) { /* signed out locally either way */ }
    window.location.href = "/account";
  });

  handle($("#forgot-form"), async () => {
    const { message } = await ITIE.post("forgot", { email: val("#forgot-email") });
    setFormStatus($("#forgot-form"), message, "ok");
  });

  handle($("#reset-form"), async () => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("reset") || "";
    const { message } = await ITIE.post("reset", { token, password: $("#reset-password").value });
    history.replaceState(null, "", "/account");
    show("signin");
    setFormStatus($("#signin-form"), message, "ok");
  });

  handle($("#profile-form"), async () => {
    const { user } = await ITIE.post("profile", {
      name: val("#profile-name"),
      phone: val("#profile-phone"),
      company: val("#profile-company"),
      country: $("#profile-country").value,
      city: val("#profile-city"),
    });
    setFormStatus($("#profile-form"), "Saved.", "ok");
    showProfile(user);
  });

  handle($("#password-form"), async () => {
    await ITIE.post("password", { current: $("#password-current").value, password: $("#password-new").value });
    $("#password-current").value = "";
    $("#password-new").value = "";
    setFormStatus($("#password-form"), "Password changed.", "ok");
  });

  $("#signout-btn").addEventListener("click", async () => {
    try { await ITIE.post("signout"); } catch (e) { /* signed out locally either way */ }
    window.location.href = "/account";
  });

  // Start: a reset link wins, then an existing session, then sign in.
  if (new URLSearchParams(window.location.hash.slice(1)).get("reset")) {
    show("reset");
  } else {
    const start = { "#signup": "signup", "#forgot": "forgot" }[window.location.hash] || "signin";
    ITIE.session().then((user) => (user ? showProfile(user) : show(start)));
  }
})();
