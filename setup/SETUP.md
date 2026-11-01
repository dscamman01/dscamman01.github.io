# Eaglewood booking site: setup steps for Dan

The site works right now in **preview (demo) mode**: sample bookings, and the pay button says
"Payments not connected yet." Follow these steps once to turn on real bookings, payments, and emails.
Plan on about 45 minutes. Everything here is free except Stripe's normal fee (about 2.9% + 30¢ per payment).

You'll need: your Google account (dscamman01@gmail.com), a GitHub account, and a Stripe account.

---

## 1. Put the site on GitHub Pages
1. Sign in at github.com and create a **public** repository named exactly `YOUR-USERNAME.github.io`.
2. Upload everything inside the `site/` folder (including the hidden `.nojekyll` file) to the root of that repo.
3. In the repo, go to **Settings → Pages**, set Source = "Deploy from a branch", Branch = `main` / root. Save.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/`. Write this address down. It's your **SITE_URL**.

## 2. Create the Google Sheet (the booking database)
1. Go to sheets.google.com and create a blank spreadsheet. Name it **Eaglewood Bookings**.
2. Copy its ID from the address bar: the long text between `/d/` and `/edit`.
   Example: `https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`. That's your **SHEET_ID**.
3. Leave it empty. The script will add the header row itself.

## 3. Add the Apps Script backend
1. In the sheet, choose **Extensions → Apps Script**. A code editor opens.
2. Delete whatever is in `Code.gs` and paste in the entire contents of `apps-script/Code.gs`.
3. (Recommended) Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file**, then open
   `appsscript.json` in the editor and replace it with `apps-script/appsscript.json`. This sets the time zone to Pacific.
4. At the top of `Code.gs`, edit the CONFIG block:
   - `SHEET_ID`: paste the ID from step 2.
   - `SITE_URL`: your GitHub Pages address from step 1, **ending with a slash**, e.g. `https://dscamman.github.io/`.
   - `CHECK_IN_INFO`: replace the placeholder with your real check-in instructions.
   - `OWNER_EMAIL` (already `dscamman01@gmail.com`) and `OWNER_PHONE` (already `(360) 480-8390`). Change them if needed.
5. Click **Save** (disk icon).

## 4. Create a Stripe account and add your secret key
1. Sign up at **stripe.com** and finish account activation (business details + the bank account for payouts).
   You can test first in **Test mode** (toggle in the Stripe Dashboard).
2. In Stripe go to **Settings → Payment methods** and make sure **Cards** and **Apple Pay** are turned on
   (Google Pay and Link are fine to leave on).
3. Go to **Developers → API keys** and copy the **Secret key** (`sk_test_...` for testing, `sk_live_...` when you go live).
4. Back in Apps Script: **Project Settings (gear) → Script Properties → Add script property**
   - Property: `STRIPE_SECRET_KEY`
   - Value: paste the secret key
   - Save. (Never paste the key into the code or the website.)

## 5. Run setup once
1. In the Apps Script editor, pick **setup** in the function dropdown and click **Run**.
2. Google will ask for permission. Choose your account, then click **Advanced → Go to (project) (unsafe) → Allow**.
   (It says "unsafe" only because it's your own unpublished script.) It needs access to the sheet, sending email
   as you, connecting to Stripe, and running on a schedule.
3. The log should say `Stripe key set: true`, and the sheet now has a **Bookings** tab with headers.

## 6. Turn on the daily emails
1. Pick **installTriggers** in the function dropdown and click **Run**.
2. This creates two schedules (see **Triggers**, the alarm-clock icon):
   - `dailyTasks`, every morning around 8 AM Pacific: emails you the day before each checkout, and emails the
     departing guest on checkout morning with the "We're out" button.
   - `reconcilePending`, hourly: finishes any paid booking where the guest closed the page before returning,
     and releases abandoned checkouts.

## 7. Deploy the web app
1. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
2. Description: `Eaglewood v1`. **Execute as: Me**. **Who has access: Anyone**.
3. Click **Deploy**, authorize if asked, and copy the **Web app URL** (ends in `/exec`).
4. Quick test: open `YOUR_WEB_APP_URL?action=bookings` in a browser. You should see `{"ok":true,"bookings":[]}`.

> If you change `Code.gs` later: **Deploy → Manage deployments → (pencil) Edit → Version: New version → Deploy**.
> This keeps the same URL. Making a *new* deployment instead would give you a new URL.

## 8. Connect the website to the backend
1. In your GitHub repo, open `config.js`, click the pencil to edit, and set:
   ```js
   BACKEND_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
   ```
2. Commit. In a minute the site leaves demo mode. The brown "Preview mode" bar disappears and real bookings show.

## 9. Apple Pay check
- Payment happens on Stripe's own secure checkout page (checkout.stripe.com), so **Apple Pay appears there
  automatically** on iPhone, iPad, and Mac Safari once Apple Pay is enabled in step 4.2. You don't need to verify your
  github.io domain for this.
- Only if you later embed Stripe's payment buttons directly on your own page would you need
  **Stripe → Settings → Payment method domains → Add `YOUR-USERNAME.github.io`**. It's harmless to add it now.

## 10. Test it end-to-end (in Stripe Test mode)
1. With a `sk_test_` key, book a 1-night stay on your site and pay with card `4242 4242 4242 4242`, any future
   date, any CVC, any ZIP.
2. You should land on the "You're booked!" page. The guest email and your "New Eaglewood booking" email should arrive,
   the sheet row should say `confirmed`, and the calendar should show the stay with first name + last initial.
3. To test the checkout emails, set a test booking's `checkout` cell in the sheet to tomorrow or today, then run
   `dailyTasks` by hand. Tap "We're out" in the guest email to get the "Eaglewood is ready for cleaning" email.
4. When happy: delete test rows, switch Stripe to live, replace `STRIPE_SECRET_KEY` with the `sk_live_` key
   (Script Properties). No redeploy is needed for a property change.

## Optional: Stripe webhook (extra safety net)
The site already confirms bookings when the guest returns from Stripe, plus the hourly `reconcilePending` job.
If you also want a webhook: Stripe → Developers → Webhooks → Add endpoint → your `/exec` URL, event
`checkout.session.completed`. The script never trusts the webhook body. It re-checks the payment with Stripe.
Note: Apps Script answers webhooks with a redirect, so Stripe may show deliveries as "failed" even though
they worked. That's why this step is optional.

## Day-to-day
- **See bookings:** open the Google Sheet. Status is `pending` (in checkout), `confirmed`, `departed`,
  `canceled`/`expired` (abandoned), or `paid_conflict` (rare double-payment; you'll get an email, so refund in Stripe).
- **Block dates for yourself:** add a row with `id` (e.g. `OWNER-1`), `status` = `confirmed`, `checkin`, `checkout`
  (YYYY-MM-DD), `name` (e.g. `Scamman Family`) and `confirm_emails_sent` = `manual`. Check-out day is not blocked, so
  the next guest can arrive that day.
- **Cancel/refund:** refund in Stripe, then set the row's status to `canceled` to reopen the dates.
- **Later: the cleaning company.** `Code.gs` has TODO notes marking where to add a `CLEANER_EMAIL` so they get
  check-in and check-out notices instead of you. Their name is never shown on the website.
