// Customer account page (account.html): sign in, sign up, password reset and
// the profile. Talks to api/index.php through window.ITIE from main.js.

(() => {
  const views = document.querySelectorAll("[data-view]");
  const title = document.querySelector("#acct-title");
  const sub = document.querySelector("#acct-sub");
  const $ = (sel) => document.querySelector(sel);
  const val = (sel) => $(sel).value.trim();

  const HEADINGS = {
    signin: ["Sign In", "Sign in to see your quote requests and keep your details up to date."],
    signup: ["Create Your Account", "One account for all your clearing and forwarding requests."],
    forgot: ["Reset Your Password", "We'll email you a link to choose a new one."],
    reset: ["Choose a New Password", "Pick a password with 8 characters or more."],
    profile: ["My Account", "Your details, your quote requests and what's happened on your account."],
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

  async function showProfile(user) {
    setAccountLink(user);
    $("#profile-email").textContent = user.email;
    $("#profile-admin-link").hidden = user.role !== "admin";
    $("#profile-name").value = user.name;
    $("#profile-phone").value = user.phone;
    $("#profile-company").value = user.company;
    $("#profile-country").value = user.country;
    $("#profile-city").value = user.city;
    show("profile");
    try {
      const { quotes, activity } = await ITIE.post("my_activity");
      listItems($("#profile-quotes"), quotes, "No quote requests yet.", (q) =>
        row(`${q.destination}${q.details ? ` · ${q.details.slice(0, 80)}` : ""}`, ITIE.date(q.created_at),
          q.status === "done" ? { kind: "done", text: "Handled" } : { kind: "new", text: "Received" }));
      listItems($("#profile-activity"), activity, "Nothing yet.", (a) => row(a.text, ITIE.dateTime(a.created_at)));
    } catch (err) {
      listItems($("#profile-quotes"), [], err.message, () => null);
    }
  }

  handle($("#signin-form"), async () => {
    const { user } = await ITIE.post("signin", { email: val("#signin-email"), password: $("#signin-password").value });
    $("#signin-password").value = "";
    if (user.role === "admin") {
      window.location.href = "admin.html";
      return;
    }
    showProfile(user);
  });

  handle($("#signup-form"), async () => {
    const { user } = await ITIE.post("signup", {
      name: val("#signup-name"),
      email: val("#signup-email"),
      phone: val("#signup-phone"),
      company: val("#signup-company"),
      password: $("#signup-password").value,
    });
    $("#signup-password").value = "";
    await showProfile(user);
    setFormStatus($("#profile-form"), "Welcome! Your account is ready.", "ok");
  });

  handle($("#forgot-form"), async () => {
    const { message } = await ITIE.post("forgot", { email: val("#forgot-email") });
    setFormStatus($("#forgot-form"), message, "ok");
  });

  handle($("#reset-form"), async () => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("reset") || "";
    const { message } = await ITIE.post("reset", { token, password: $("#reset-password").value });
    history.replaceState(null, "", "account.html");
    show("signin");
    setFormStatus($("#signin-form"), message, "ok");
  });

  handle($("#profile-form"), async () => {
    const { user } = await ITIE.post("profile", {
      name: val("#profile-name"),
      phone: val("#profile-phone"),
      company: val("#profile-company"),
      country: val("#profile-country"),
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
    window.location.href = "account.html";
  });

  // Start: a reset link wins, then an existing session, then sign in.
  if (new URLSearchParams(window.location.hash.slice(1)).get("reset")) {
    show("reset");
  } else {
    const start = { "#signup": "signup", "#forgot": "forgot" }[window.location.hash] || "signin";
    ITIE.session().then((user) => (user ? showProfile(user) : show(start)));
  }
})();
