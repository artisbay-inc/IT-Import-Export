# Clearing & Forwarding Co. — Website Template

A reusable, multi-page frontend template for customs clearing, freight
forwarding, and delivery businesses (with an optional vehicle sales section
bolted on for agents who also import and sell used cars).

All copy, contact details, and partner names on this site are placeholders —
swap in your own branding, colors, and content before use.

## Pages

- **Home** — minimalist photo hero, stats strip, trusted-by row, services overview
- **Clearing** — customs clearing & documentation services
- **Forwarding & Delivery** — consolidation, bonded storage, nationwide and
  cross-border delivery, with a schematic coverage map
- **Vehicles** — filterable stock grid (brand, body type) plus a header-level
  "Search Vehicles" modal with cascading brand → model dropdowns
- **About** — stats, trusted-by, why-us grid, team section
- **Contact** — direct contact list and a quote-request form

## Theming

Multiple color themes are switchable from the header (persisted via
`localStorage`) — see `main.js` and the `[data-theme]` blocks in `styles.css`.

## Viewing it

Static site, no build step — open `index.html` in a browser, or serve the
folder with any static file server.

## Accounts and back office (PHP + SQLite)

`api/index.php` is a small JSON API (one `action` per request) on top of
`api/lib/bootstrap.php`. Data lives in one SQLite file **outside**
`public_html` (`~/itie_data/site.sqlite` on Hostgator); settings live in
`config.php` next to it — copy `api/lib/config.example.php`. Tables are
created and upgraded automatically on the first request, so uploading new
code keeps every customer, note and invoice.

- **Customers:** sign up / sign in / forgot password (email link, 1 hour,
  one use), profile with country + automatic phone code, quote history.
- **Admin (`/admin`):** customers (add by hand, email optional, notes,
  activity), quote requests, inventory (cars with make, model, grade, year,
  mileage, cc, chassis no., colour, condition; parts with stock history),
  invoices (numbering, VAT, paid / overdue / cancelled, stock moves with the
  invoice, printable `/invoice?id=…`), clearing calculator, settings
  (company, bank and VAT details printed on invoices).
- **Clearing calculator (`/calculator`):** charges and exchange rates are set
  in Admin → Calculator. Hidden (and its buttons on Clearing / Vehicles) until
  it is switched on there.
- **Security:** bcrypt passwords, HttpOnly + SameSite session cookie, CSRF
  token on every change, admin role checked on every admin action, sign-in /
  sign-up / reset / quote rate limits.

### Run it locally

    ITIE_CONFIG=/path/to/config.php php -S 127.0.0.1:8000 router.php

### Deploy to Hostgator (cPanel, PHP 8.3)

1. Back up `~/itie_data/site.sqlite` (cPanel File Manager → download).
2. Upload the changed files into `public_html` (not `.git`, not `router.php`).
3. Open `/admin`, sign in, and fill Admin → Settings (bank, VAT number) and
   Admin → Calculator (charges, rates), then switch the calculator on.
4. Test "Forgot password" with a real inbox.
