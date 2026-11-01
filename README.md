# Eaglewood, Sunriver: friends & family booking site

Static site (plain HTML/CSS/vanilla JS, no build step) for GitHub Pages, with a free Google Apps Script
backend (Google Sheet as database, Stripe Checkout for Apple Pay/cards, Gmail via MailApp for emails).
See **SETUP.md** for step-by-step go-live instructions.

## Structure
```
site/                     ← upload the contents of this folder to YOUR-USERNAME.github.io
  index.html              front page: hero, booking card, weather, 3D tour, gallery, the house, footer
  confirmed.html          success page (Stripe returns here with ?booked=SESSION_ID → verifies + shows booking)
  out.html                "We're out" page linked from the checkout-morning email (?b=BOOKING_ID&t=TOKEN)
  config.js               BACKEND_URL (empty = DEMO mode), display prices, phone, Matterport URL, lat/lon
  common.js               shared helpers (API calls, date math, formatting)
  app.js                  calendar, price, weather (Open-Meteo), gallery + lightbox, checkout
  styles.css              all styles (mobile-first, pine / sand palette)
  favicon.svg             pine-tree icon
  .nojekyll               tells GitHub Pages to serve files as-is
  photos/exterior/*.jpg   6 photos, ≤1600px wide, ~82% JPEG
  photos/interior/*.jpg   14 photos
  photos/thumbs/…         600px-wide thumbnails for the gallery grid
apps-script/
  Code.gs                 backend: bookings / checkout / confirm / release / out + daily & hourly triggers
  appsscript.json         manifest (Pacific time zone, web app settings, scopes)
tests/
  e2e.py                  Playwright checks (calendar, prices, weather, gallery, lightbox, demo pay, console)
  gas-harness.js          runs Code.gs in Node with mocked Google/Stripe services to test the flows
screenshots/              mobile (390×844) and desktop (1280×900) captures
SETUP.md                  go-live steps for Dan
```

## How it works
- **Availability:** `GET BACKEND_URL?action=bookings` returns `{checkin, checkout, name}` with the name shortened to
  first name + last initial (no emails or phones). Pending checkouts show as "On hold" for ~31 minutes.
- **Dates:** a stay blocks the nights from check-in up to (not including) check-out, so same-day turnover works.
  The calendar won't allow a 0-night stay, a stay over an existing booking, or more than 30 nights. The server
  re-checks all of this under a lock.
- **Price:** $350 cleaning fee (flat) + $50 × nights utilities, computed again on the server and sent to Stripe as two
  line items.
- **Payment:** the backend creates a Stripe Checkout Session (mode=payment, no fixed payment_method_types, so
  Apple Pay / Google Pay / cards come from the Stripe Dashboard settings) and the browser redirects to it.
- **Confirmation:** `confirmed.html` calls `action=confirm`, which fetches the session from Stripe, requires
  `payment_status=paid` and the right amount, marks the row confirmed, and sends the guest + owner emails exactly once.
  An hourly job and an optional webhook use the same idempotent function.
- **Checkout flow:** the daily trigger emails Dan the day before checkout and emails the guest on checkout morning with a
  "We're out" link. Tapping it emails Dan "Eaglewood is ready for cleaning" with the next arrival date.
- **Weather:** Open-Meteo forecast (16 days) for 43.88, -121.44 in °F. Days past that show "Typical" averages for the same
  calendar days (±3 days) over the previous 10 years from the Open-Meteo archive, clearly labeled.
- **Demo mode:** with `BACKEND_URL` empty, sample stays ("Sample G.", "Example F.", "Demo T.") are shown and the pay
  button explains payments aren't connected.

## Local preview
```
cd site && python3 -m http.server 8000   # then open http://localhost:8000
```
