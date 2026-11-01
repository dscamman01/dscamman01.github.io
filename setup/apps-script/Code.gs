/**
 * Eaglewood, Sunriver: booking backend (Google Apps Script web app).
 *
 *   Database : a Google Sheet (tab "Bookings")
 *   Payments : Stripe Checkout (Apple Pay + cards), created via UrlFetchApp
 *   Email    : MailApp, sent from the Google account that owns this script
 *
 * Endpoints (all return JSON):
 *   GET  ?action=bookings                       -> public booked ranges (first name + last initial only)
 *   POST {action:'checkout', checkin, checkout, name, email, phone, guests, notes}
 *                                               -> creates a pending hold + Stripe Checkout Session, returns {url}
 *   POST {action:'confirm', session_id}         -> verifies payment with Stripe, confirms (idempotent), sends emails
 *   POST {action:'release', b, t}               -> guest canceled checkout: expire session and free the dates
 *   POST {action:'out', b, t}                   -> guest tapped "We're out": emails the owner the house is ready for cleaning
 *   POST Stripe event {type:'checkout.session.completed', ...}
 *                                               -> optional webhook; re-verifies the session with the Stripe API
 *
 * Time-driven triggers (run installTriggers() once):
 *   dailyTasks()       every morning ~8 AM Pacific: day-before-checkout reminder to owner,
 *                      checkout-morning "We're out" email to the departing guest
 *   reconcilePending() hourly: confirms paid sessions whose guest closed the tab before returning,
 *                      and expires abandoned holds
 *
 * TODO (later): the cleaning company should receive the check-in and check-out notices
 * (new-booking / day-before-checkout / ready-for-cleaning) instead of, or in addition to, OWNER_EMAIL.
 * Add a CLEANER_EMAIL setting and send to it from notifyOwnerNewBooking_, dailyTasks and out_.
 * Never show the cleaning company's name on the public site.
 */

/* =========================== CONFIG =========================== */
var CONFIG = {
  // The secret key lives in Project Settings > Script Properties as STRIPE_SECRET_KEY (never paste it here).
  STRIPE_SECRET_KEY_PROPERTY: 'STRIPE_SECRET_KEY',
  SHEET_ID: 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE',
  SHEET_NAME: 'Bookings',
  OWNER_EMAIL: 'dscamman01@gmail.com',
  OWNER_NAME: 'Dan',
  OWNER_PHONE: '(360) 480-8390',
  SITE_URL: 'https://YOUR-USERNAME.github.io/',   // must end with a slash

  PROPERTY_NAME: 'Eaglewood, Sunriver',
  ADDRESS: '26 Eaglewood, 57922 Silver Fir Circle, Unit 26, Sunriver, OR 97707',
  // TODO: replace with real check-in instructions (times, door code delivery, parking, Wi-Fi).
  CHECK_IN_INFO: 'Check-in is after 4:00 PM and check-out is by 10:00 AM. Dan will text you the door code and arrival details a few days before your stay.',

  CLEANING_FEE: 350,          // USD, flat per stay
  UTILITIES_PER_NIGHT: 50,    // USD per night
  CURRENCY: 'usd',
  MAX_NIGHTS: 30,
  MAX_GUESTS: 8,
  HOLD_MINUTES: 31,           // Stripe requires Checkout sessions to live at least 30 minutes
  TIMEZONE: 'America/Los_Angeles',
  DAILY_HOUR: 8               // hour (Pacific) for dailyTasks
};

function getStripeKey_() {
  var key = PropertiesService.getScriptProperties().getProperty(CONFIG.STRIPE_SECRET_KEY_PROPERTY);
  if (!key) throw new Error('Payments are not set up yet (missing Stripe key).');
  return key;
}

var HEADERS = ['id', 'created', 'status', 'checkin', 'checkout', 'nights', 'name', 'email', 'phone', 'guests', 'notes',
  'total', 'session_id', 'token', 'hold_expires', 'paid_at', 'confirm_emails_sent', 'reminder_sent',
  'checkout_email_sent', 'out_at', 'ready_email_sent'];
// status: pending -> confirmed -> departed   (or canceled / expired / paid_conflict / error)

/* =========================== HTTP =========================== */
function doGet(e) {
  return handle_(function () { return route_((e && e.parameter) || {}); });
}

function doPost(e) {
  return handle_(function () {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    }
    // Stripe webhook (optional). Never trust the payload: re-fetch the session from Stripe.
    if (body && body.object === 'event' && body.type) {
      if ((body.type === 'checkout.session.completed' || body.type === 'checkout.session.async_payment_succeeded') &&
          body.data && body.data.object && body.data.object.id) {
        confirmSession_(body.data.object.id);
      }
      return { ok: true, received: true };
    }
    var params = {};
    var qp = (e && e.parameter) || {};
    Object.keys(qp).forEach(function (k) { params[k] = qp[k]; });
    Object.keys(body).forEach(function (k) { params[k] = body[k]; });
    return route_(params);
  });
}

function route_(p) {
  switch (String(p.action || '')) {
    case 'bookings': return { ok: true, bookings: publicBookings_() };
    case 'checkout': return checkout_(p);
    case 'confirm':  return confirm_(p);
    case 'release':  return release_(p);
    case 'out':      return out_(p);
    case 'ping':     return { ok: true, time: new Date().toISOString() };
    default: throw new Error('Unknown action');
  }
}

function handle_(fn) {
  var out;
  try { out = fn(); } catch (err) {
    console.error(err && err.stack || err);
    out = { ok: false, error: (err && err.message) || 'Server error' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* =========================== ACTIONS =========================== */
function publicBookings_() {
  var today = todayStr_(), now = Date.now();
  return readRows_().filter(function (r) {
    return r.checkout >= today && (isConfirmedLike_(r) || isLiveHold_(r, now));
  }).map(function (r) {
    return { checkin: r.checkin, checkout: r.checkout, name: r.status === 'pending' ? 'On hold' : shortName_(r.name) };
  }).sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; });
}

function checkout_(p) {
  var checkin = String(p.checkin || ''), checkout = String(p.checkout || '');
  if (!isDateStr_(checkin) || !isDateStr_(checkout)) throw new Error('Please pick valid dates.');
  var nights = nightsBetween_(checkin, checkout);
  if (nights < 1) throw new Error('Check-out must be at least one night after check-in.');
  if (nights > CONFIG.MAX_NIGHTS) throw new Error('Stays are limited to ' + CONFIG.MAX_NIGHTS + ' nights.');
  if (checkin < todayStr_()) throw new Error('Check-in date is in the past.');

  var name = clean_(p.name, 100), email = clean_(p.email, 200).toLowerCase(), phone = clean_(p.phone, 30);
  var guests = parseInt(p.guests, 10), notes = clean_(p.notes, 800);
  if (!/^\S+(\s+\S+)+$/.test(name)) throw new Error('Please enter your first and last name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Please enter a valid email.');
  if (phone.replace(/\D/g, '').length < 10) throw new Error('Please enter a valid cell phone number.');
  if (!(guests >= 1 && guests <= CONFIG.MAX_GUESTS)) throw new Error('Guests must be 1 to ' + CONFIG.MAX_GUESTS + '.');

  var total = priceFor_(nights);   // computed server-side; any client "expectedTotal" is ignored
  var key = getStripeKey_();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var row;
  try {
    var conflict = findConflict_(readRows_(), checkin, checkout, null);
    if (conflict) throw new Error('Sorry, those dates were just booked (' + conflict.checkin + ' to ' + conflict.checkout + '). Please pick different dates.');
    row = {
      id: newId_(), created: new Date().toISOString(), status: 'pending', checkin: checkin, checkout: checkout,
      nights: nights, name: name, email: email, phone: phone, guests: guests, notes: notes, total: total,
      session_id: '', token: Utilities.getUuid().replace(/-/g, ''),
      hold_expires: new Date(Date.now() + CONFIG.HOLD_MINUTES * 60000).toISOString()
    };
    appendRow_(row);
  } finally {
    lock.releaseLock();
  }

  var session;
  try {
    session = stripe_('post', '/v1/checkout/sessions', {
      'mode': 'payment',
      // No payment_method_types: Stripe shows the methods enabled in the Dashboard
      // (cards, Apple Pay on Safari/iOS, Google Pay, Link) automatically.
      'success_url': CONFIG.SITE_URL + 'confirmed.html?booked={CHECKOUT_SESSION_ID}',
      'cancel_url': CONFIG.SITE_URL + '?canceled=' + encodeURIComponent(row.id) + '&t=' + row.token + '#book',
      'customer_email': email,
      'client_reference_id': row.id,
      'expires_at': String(Math.floor(Date.now() / 1000) + CONFIG.HOLD_MINUTES * 60),
      'submit_type': 'book',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': CONFIG.CURRENCY,
      'line_items[0][price_data][unit_amount]': String(CONFIG.CLEANING_FEE * 100),
      'line_items[0][price_data][product_data][name]': 'Cleaning fee (flat, per stay)',
      'line_items[1][quantity]': String(nights),
      'line_items[1][price_data][currency]': CONFIG.CURRENCY,
      'line_items[1][price_data][unit_amount]': String(CONFIG.UTILITIES_PER_NIGHT * 100),
      'line_items[1][price_data][product_data][name]': 'Utilities (per night)',
      'line_items[1][price_data][product_data][description]': CONFIG.PROPERTY_NAME + ': ' + prettyDate_(checkin) + ' to ' + prettyDate_(checkout),
      'payment_intent_data[description]': CONFIG.PROPERTY_NAME + ' ' + checkin + ' to ' + checkout + ' (' + row.id + ')',
      'payment_intent_data[metadata][booking_id]': row.id,
      'metadata[booking_id]': row.id,
      'metadata[checkin]': checkin,
      'metadata[checkout]': checkout,
      'metadata[nights]': String(nights),
      'metadata[name]': name,
      'metadata[phone]': phone,
      'metadata[guests]': String(guests),
      'metadata[total_usd]': String(total),
      'metadata[notes]': notes.slice(0, 450)
    });
  } catch (err) {
    updateRow_(row, { status: 'error', notes: (notes + ' [stripe error: ' + err.message + ']').slice(0, 1000) });
    throw new Error('Could not start checkout. Please try again in a minute.');
  }
  updateRow_(row, { session_id: session.id });
  return { ok: true, url: session.url, bookingId: row.id, total: total, nights: nights };
}

function confirm_(p) {
  var sid = String(p.session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) throw new Error('Invalid booking reference.');
  var r = confirmSession_(sid);
  return { ok: true, already: r.already, booking: {
    id: r.row.id, firstName: String(r.row.name).split(/\s+/)[0], email: r.row.email,
    checkin: r.row.checkin, checkout: r.row.checkout, nights: Number(r.row.nights), total: Number(r.row.total) } };
}

/**
 * Verify a Checkout Session with the Stripe API and confirm its booking.
 * Idempotent: safe to call any number of times (success page, webhook, hourly reconcile).
 */
function confirmSession_(sid) {
  var s = stripe_('get', '/v1/checkout/sessions/' + encodeURIComponent(sid));
  if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') {
    throw new Error('Payment not paid yet (status: ' + s.payment_status + ').');
  }
  var bookingId = s.client_reference_id || (s.metadata && s.metadata.booking_id);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = readRows_();
    var row = rows.filter(function (r) { return r.id === bookingId; })[0];
    if (!row || row.session_id !== sid) throw new Error('Booking not found for this payment. Dan has the payment and will follow up.');
    if (isConfirmedLike_(row)) return { row: row, already: true };
    if (row.status === 'paid_conflict') throw new Error('Those dates were taken while you were paying. Dan will refund you or find new dates.');
    if (Number(s.amount_total) !== Number(row.total) * 100) {
      // Should never happen (price is server-side) but never confirm on a mismatch.
      updateRow_(row, { status: 'paid_conflict' });
      mail_(CONFIG.OWNER_EMAIL, 'ACTION NEEDED: Eaglewood payment amount mismatch (' + row.id + ')',
        '<p>Stripe session ' + esc_(sid) + ' paid ' + (s.amount_total / 100) + ' but booking ' + esc_(row.id) + ' expected ' + row.total + '. Please review in Stripe.</p>');
      throw new Error('Payment amount did not match. Dan will follow up.');
    }
    // A hold that expired might have been re-booked by someone else before this payment landed.
    var conflict = findConflict_(rows, row.checkin, row.checkout, row.id, true);
    if (conflict) {
      updateRow_(row, { status: 'paid_conflict', paid_at: new Date().toISOString() });
      mail_(CONFIG.OWNER_EMAIL, 'ACTION NEEDED: Eaglewood double-booking (' + row.id + ')',
        '<p>' + esc_(row.name) + ' paid for ' + esc_(row.checkin) + ' to ' + esc_(row.checkout) +
        ', but those dates overlap booking ' + esc_(conflict.id) + '. Refund in Stripe or arrange other dates.</p>' +
        '<p>Guest: ' + esc_(row.email) + ' / ' + esc_(row.phone) + '</p>');
      throw new Error('Those dates were taken while you were paying. Dan will refund you or find new dates.');
    }
    updateRow_(row, { status: 'confirmed', paid_at: new Date().toISOString() });
    if (!truthy_(row.confirm_emails_sent)) {
      sendGuestConfirmation_(row);
      notifyOwnerNewBooking_(row);
      updateRow_(row, { confirm_emails_sent: new Date().toISOString() });
    }
    return { row: row, already: false };
  } finally {
    lock.releaseLock();
  }
}

function release_(p) {
  var row = findByIdToken_(p.b, p.t);
  if (row.status !== 'pending') return { ok: true, status: row.status };
  if (row.session_id) {
    var s = stripe_('get', '/v1/checkout/sessions/' + encodeURIComponent(row.session_id));
    if (s.status === 'complete') { confirmSession_(row.session_id); return { ok: true, status: 'confirmed' }; }
    if (s.status === 'open') {
      try { stripe_('post', '/v1/checkout/sessions/' + encodeURIComponent(row.session_id) + '/expire', {}); } catch (err) { /* already expired */ }
    }
  }
  updateRow_(row, { status: 'canceled' });
  return { ok: true, status: 'canceled' };
}

function out_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var row = findByIdToken_(p.b, p.t);
    var first = String(row.name).split(/\s+/)[0];
    if (row.status === 'departed') return { ok: true, already: true, firstName: first };
    if (row.status !== 'confirmed') throw new Error('This booking is not active.');
    updateRow_(row, { status: 'departed', out_at: new Date().toISOString() });
    if (!truthy_(row.ready_email_sent)) {
      var next = nextArrivalAfter_(row);
      // TODO (later): also send this to the cleaning company (CLEANER_EMAIL).
      mail_(CONFIG.OWNER_EMAIL, 'Eaglewood is ready for cleaning',
        '<p><strong>' + esc_(row.name) + '</strong> just tapped "We\'re out" at ' +
        Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'h:mm a') + ' on ' + prettyDate_(todayStr_()) + '.</p>' +
        '<p>Eaglewood is ready for cleaning.</p>' +
        (next ? '<p><strong>Next arrival:</strong> ' + prettyDate_(next.checkin) + ' (' + esc_(next.name) + ', ' + esc_(next.guests) + ' guests, ' + next.nights + ' nights).</p>'
              : '<p>No upcoming arrivals are booked yet.</p>') +
        '<p>Booking ' + esc_(row.id) + ': ' + prettyDate_(row.checkin) + ' to ' + prettyDate_(row.checkout) + '.</p>');
      updateRow_(row, { ready_email_sent: new Date().toISOString() });
    }
    return { ok: true, firstName: first };
  } finally {
    lock.releaseLock();
  }
}

/* =========================== TRIGGERS =========================== */
/** Runs daily (~8 AM Pacific). */
function dailyTasks() {
  var today = todayStr_(), tomorrow = addDays_(today, 1);
  var rows = readRows_();
  rows.forEach(function (r) {
    if (r.status !== 'confirmed') return;
    try {
    // Day before checkout: remind the owner.
    if (r.checkout === tomorrow && !truthy_(r.reminder_sent)) {
      var next = nextArrivalAfter_(r);
      // TODO (later): send check-out notices to the cleaning company instead.
      mail_(CONFIG.OWNER_EMAIL, 'Reminder: ' + shortName_(r.name) + ' checks out of Eaglewood tomorrow',
        '<p><strong>' + esc_(r.name) + '</strong> (' + esc_(r.guests) + ' guests) checks out <strong>tomorrow, ' + prettyDate_(r.checkout) + '</strong>.</p>' +
        '<p>Guest contact: ' + esc_(r.phone) + ' · ' + esc_(r.email) + '</p>' +
        (next ? '<p>Next arrival: ' + prettyDate_(next.checkin) + ' (' + esc_(next.name) + ').</p>' : '<p>No next arrival booked yet.</p>') +
        '<p>They\'ll get a "We\'re out" email tomorrow morning; you\'ll be emailed when they tap it.</p>');
      updateRow_(r, { reminder_sent: new Date().toISOString() });
    }
    // Checkout morning: ask the guest to tap "We're out".
    if (r.checkout === today && !truthy_(r.checkout_email_sent) && r.email) {
      var link = CONFIG.SITE_URL + 'out.html?b=' + encodeURIComponent(r.id) + '&t=' + r.token;
      mail_(r.email, 'Checkout day at Eaglewood: tap "We\'re out" when you leave',
        '<p>Hi ' + esc_(String(r.name).split(/\s+/)[0]) + ',</p>' +
        '<p>Hope you had a great stay! Today is checkout day. When you\'ve left, please tap the button so ' + CONFIG.OWNER_NAME + ' knows the house is ready to be turned over for the next guests.</p>' +
        '<p style="margin:24px 0"><a href="' + link + '" style="background:#1f3d2b;color:#fff;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:17px">We\'re out ✓</a></p>' +
        '<p>Before you go: run the dishwasher, take out the trash, cover the hot tub, and lock up.</p>' +
        '<p>Questions? Text ' + CONFIG.OWNER_NAME + ' at ' + CONFIG.OWNER_PHONE + '.</p>', { replyTo: CONFIG.OWNER_EMAIL });
      updateRow_(r, { checkout_email_sent: new Date().toISOString() });
    }
    } catch (err) { console.error('dailyTasks ' + r.id + ': ' + err.message); }
  });
  reconcilePending();
}

/** Hourly: finish paid sessions whose guest never returned to the site; expire stale holds. */
function reconcilePending() {
  var now = Date.now();
  readRows_().forEach(function (r) {
    if (r.status !== 'pending' || !r.session_id) {
      if (r.status === 'pending' && !r.session_id && Date.parse(r.hold_expires) < now) updateRow_(r, { status: 'expired' });
      return;
    }
    try {
      var s = stripe_('get', '/v1/checkout/sessions/' + encodeURIComponent(r.session_id));
      if (s.payment_status === 'paid') confirmSession_(r.session_id);
      else if (s.status === 'expired') updateRow_(r, { status: 'expired' });
    } catch (err) { console.error('reconcile ' + r.id + ': ' + err.message); }
  });
}

/** Run once from the editor: creates the daily and hourly triggers (removes old copies first). */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'dailyTasks' || f === 'reconcilePending') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyTasks').timeBased().everyDays(1).atHour(CONFIG.DAILY_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('reconcilePending').timeBased().everyHours(1).create();
  return 'Triggers installed';
}

/** Run once from the editor: prepares the sheet and checks settings. */
function setup() {
  var sh = sheet_();
  sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  var hasKey = !!PropertiesService.getScriptProperties().getProperty(CONFIG.STRIPE_SECRET_KEY_PROPERTY);
  console.log('Sheet ready: ' + sh.getParent().getUrl());
  console.log('Stripe key set: ' + hasKey);
  console.log('Site URL: ' + CONFIG.SITE_URL);
  return { sheet: sh.getParent().getUrl(), stripeKeySet: hasKey };
}

/* =========================== EMAILS =========================== */
function sendGuestConfirmation_(r) {
  var first = String(r.name).split(/\s+/)[0];
  var html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;color:#1d2420">' +
    '<h2 style="color:#1f3d2b;margin:0 0 8px">You\'re booked at Eaglewood, ' + esc_(first) + '!</h2>' +
    '<p>Thanks! Your payment went through and your stay is confirmed.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:15px">' +
    tr_('Check-in', prettyDate_(r.checkin)) + tr_('Check-out', prettyDate_(r.checkout)) +
    tr_('Nights', r.nights) + tr_('Guests', r.guests) +
    tr_('Cleaning fee', '$' + CONFIG.CLEANING_FEE) +
    tr_('Utilities', '$' + CONFIG.UTILITIES_PER_NIGHT + ' × ' + r.nights + ' = $' + (CONFIG.UTILITIES_PER_NIGHT * r.nights)) +
    tr_('Total paid', '<strong>$' + r.total + '</strong>') +
    tr_('Booking #', esc_(r.id)) +
    tr_('Address', '<a href="https://maps.apple.com/?address=57922%20Silver%20Fir%20Circle%2C%20Unit%2026%2C%20Sunriver%2C%20OR%2097707&amp;q=26%20Eaglewood" target="_blank" rel="noopener">' + esc_(CONFIG.ADDRESS) + '</a>') +
    '</table>' +
    '<h3 style="color:#1f3d2b;margin:20px 0 6px">Check-in info</h3><p>' + esc_(CONFIG.CHECK_IN_INFO) + '</p>' +
    '<p>On checkout morning you\'ll get an email with a "We\'re out" button. Please tap it when you leave.</p>' +
    '<p>Questions? Text ' + CONFIG.OWNER_NAME + ' at <a href="sms:' + CONFIG.OWNER_PHONE.replace(/[^\d+]/g, '') + '">' + CONFIG.OWNER_PHONE + '</a>.</p>' +
    '<p><a href="' + CONFIG.SITE_URL + '">' + CONFIG.PROPERTY_NAME + '</a></p></div>';
  mail_(r.email, 'Confirmed: Eaglewood, Sunriver · ' + prettyDate_(r.checkin) + ' to ' + prettyDate_(r.checkout), html, { replyTo: CONFIG.OWNER_EMAIL });
}

function notifyOwnerNewBooking_(r) {
  // TODO (later): also send new-booking / check-in notices to the cleaning company.
  mail_(CONFIG.OWNER_EMAIL, 'New Eaglewood booking: ' + r.name + ', ' + prettyDate_(r.checkin) + ' to ' + prettyDate_(r.checkout),
    '<p><strong>' + esc_(r.name) + '</strong> booked and paid <strong>$' + r.total + '</strong>.</p>' +
    '<table style="border-collapse:collapse;font-size:15px">' +
    tr_('Dates', prettyDate_(r.checkin) + ' to ' + prettyDate_(r.checkout) + ' (' + r.nights + ' nights)') +
    tr_('Guests', r.guests) + tr_('Email', esc_(r.email)) + tr_('Cell', esc_(r.phone)) +
    tr_('Notes', esc_(r.notes || '(none)')) + tr_('Booking #', esc_(r.id)) + tr_('Stripe session', esc_(r.session_id)) +
    '</table>', { replyTo: r.email });
}

function tr_(k, v) {
  return '<tr><td style="padding:7px 12px 7px 0;color:#5f6b63;border-bottom:1px solid #eee;vertical-align:top">' + k +
    '</td><td style="padding:7px 0;border-bottom:1px solid #eee">' + v + '</td></tr>';
}

function mail_(to, subject, html, opts) {
  opts = opts || {};
  MailApp.sendEmail({
    to: to, subject: subject, htmlBody: html,
    body: html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|h\d)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' '),
    name: CONFIG.PROPERTY_NAME, replyTo: opts.replyTo || CONFIG.OWNER_EMAIL
  });
}

/* =========================== STRIPE =========================== */
function stripe_(method, path, params) {
  var opts = { method: method, headers: { Authorization: 'Bearer ' + getStripeKey_() }, muteHttpExceptions: true };
  if (method === 'post') opts.payload = params || {};   // object payload is sent form-encoded, as Stripe expects
  var res = UrlFetchApp.fetch('https://api.stripe.com' + path, opts);
  var json = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) {
    throw new Error('Stripe: ' + ((json.error && json.error.message) || ('HTTP ' + res.getResponseCode())));
  }
  return json;
}

/* =========================== SHEET =========================== */
function sheet_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  var first = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (first.join('') === '') {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sh;
}

function readRows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values.map(function (v, i) {
    var r = { _row: i + 2 };
    HEADERS.forEach(function (h, j) { r[h] = normalize_(h, v[j]); });
    return r;
  }).filter(function (r) { return r.id; });
}

function appendRow_(obj) {
  var sh = sheet_();
  var rowNum = sh.getLastRow() + 1;
  var range = sh.getRange(rowNum, 1, 1, HEADERS.length);
  range.setNumberFormat('@');   // keep dates as plain text
  range.setValues([HEADERS.map(function (h) { return obj[h] == null ? '' : String(obj[h]); })]);
  obj._row = rowNum;
}

function updateRow_(obj, fields) {
  var sh = sheet_();
  Object.keys(fields).forEach(function (k) {
    var col = HEADERS.indexOf(k) + 1;
    if (col < 1) return;
    sh.getRange(obj._row, col).setNumberFormat('@').setValue(String(fields[k]));
    obj[k] = fields[k];
  });
}

function normalize_(h, v) {
  if (v instanceof Date) {
    return (h === 'checkin' || h === 'checkout') ? Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd') : v.toISOString();
  }
  return v === null || v === undefined ? '' : String(v).trim();
}

/* =========================== HELPERS =========================== */
function isConfirmedLike_(r) { return r.status === 'confirmed' || r.status === 'departed'; }
function isLiveHold_(r, now) { return r.status === 'pending' && Date.parse(r.hold_expires) > (now || Date.now()); }

/** First booking that overlaps [checkin, checkout). Same-day turnover is allowed. */
function findConflict_(rows, checkin, checkout, excludeId, confirmedOnly) {
  var now = Date.now();
  return rows.filter(function (r) {
    if (r.id === excludeId) return false;
    var blocking = isConfirmedLike_(r) || (!confirmedOnly && isLiveHold_(r, now));
    return blocking && r.checkin < checkout && checkin < r.checkout;
  })[0] || null;
}

function nextArrivalAfter_(row) {
  return readRows_().filter(function (r) { return isConfirmedLike_(r) && r.id !== row.id && r.checkin >= row.checkout; })
    .sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; })[0] || null;
}

function findByIdToken_(id, token) {
  id = String(id || ''); token = String(token || '');
  if (!id || !token) throw new Error('This link is incomplete.');
  var row = readRows_().filter(function (r) { return r.id === id; })[0];
  if (!row || row.token !== token) throw new Error('This link is not valid.');
  return row;
}

function priceFor_(nights) { return CONFIG.CLEANING_FEE + CONFIG.UTILITIES_PER_NIGHT * nights; }
function shortName_(name) {
  var parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return 'Guest';
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : parts[0];
}
function isDateStr_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function utcMs_(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function nightsBetween_(a, b) { return Math.round((utcMs_(b) - utcMs_(a)) / 86400000); }
function addDays_(s, n) { return Utilities.formatDate(new Date(utcMs_(s) + n * 86400000 + 43200000), 'UTC', 'yyyy-MM-dd'); }
function todayStr_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function prettyDate_(s) { return Utilities.formatDate(new Date(utcMs_(s) + 43200000), 'UTC', 'EEE, MMM d, yyyy'); }
function newId_() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 5; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'EW-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd') + '-' + s;
}
function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function truthy_(v) { return !!(v && String(v).trim()); }
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
