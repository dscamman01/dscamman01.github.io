/* Eaglewood front page: calendar, price, weather, gallery, checkout. */
(function () {
  'use strict';
  var EW = window.EW, CFG = EW.cfg;
  var $ = function (id) { return document.getElementById(id); };

  /* ================= phone + config wiring ================= */
  document.querySelectorAll('.phone').forEach(function (el) { el.textContent = CFG.PHONE_DISPLAY; });
  document.querySelectorAll('a[href^="sms:"]').forEach(function (a) { a.href = 'sms:' + CFG.PHONE_SMS; });
  $('tourLink').href = CFG.MATTERPORT_URL;
  if (EW.demo) $('demoBar').hidden = false;

  // Old-style success URL (index.html?booked=cs_...) → confirmation page
  var bookedParam = EW.qs('booked');
  if (bookedParam) { location.replace('confirmed.html?booked=' + encodeURIComponent(bookedParam)); return; }

  /* ================= state ================= */
  var state = {
    view: null,           // Date: first visible month
    checkin: null,        // 'YYYY-MM-DD'
    checkout: null,
    hover: null,
    bookings: []          // [{checkin, checkout, name}]
  };
  var today = EW.today();
  var t0 = EW.parse(today);
  state.view = new Date(t0.getFullYear(), t0.getMonth(), 1);
  // Near the end of a month, open on next month (prev button still goes back).
  var daysLeft = new Date(t0.getFullYear(), t0.getMonth() + 1, 0).getDate() - t0.getDate();
  if (daysLeft < 7) state.view = new Date(t0.getFullYear(), t0.getMonth() + 1, 1);
  var MAX_MONTHS_AHEAD = 18;

  function demoBookings() {
    // Clearly fake sample stays, placed relative to today so the preview always shows some.
    function r(a, b) { return { checkin: EW.addDays(today, a), checkout: EW.addDays(today, b) }; }
    return [
      Object.assign(r(4, 7), { name: 'Sample G.' }),
      Object.assign(r(12, 16), { name: 'Example F.' }),
      Object.assign(r(16, 19), { name: 'Demo T.' }),
      Object.assign(r(33, 40), { name: 'Sample G.' })
    ];
  }

  /* ================= booking helpers ================= */
  function bookingOn(ds) {
    for (var i = 0; i < state.bookings.length; i++) {
      var b = state.bookings[i];
      if (ds >= b.checkin && ds < b.checkout) return b;
    }
    return null;
  }
  function startsOn(ds) { return state.bookings.some(function (b) { return b.checkin === ds; }); }
  /** First booked night on/after `from`, i.e. the latest allowed check-out. */
  function nextBlocked(from) {
    var best = null;
    state.bookings.forEach(function (b) {
      if (b.checkout > from && (b.checkin >= from) && (!best || b.checkin < best)) best = b.checkin;
    });
    return best;
  }
  function maxCheckout(ci) {
    var lim = EW.addDays(ci, CFG.MAX_NIGHTS);
    var nb = nextBlocked(ci);
    return nb && nb < lim ? nb : lim;
  }
  function rangeLabel(b) { return EW.fmt(b.checkin, { month: 'short', day: 'numeric' }) + '–' + EW.fmt(b.checkout, { month: 'short', day: 'numeric' }); }

  /* ================= calendar ================= */
  var mqTwo = window.matchMedia('(min-width: 720px)');
  var DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  function renderCalendar() {
    var months = mqTwo.matches ? 2 : 1;
    var box = $('calMonths');
    box.className = 'cal-months' + (months === 2 ? ' two' : '');
    var html = '';
    var choosingOut = state.checkin && !state.checkout;
    var limit = choosingOut ? maxCheckout(state.checkin) : null;
    var endSel = state.checkout || (choosingOut && state.hover && state.hover > state.checkin && state.hover <= limit ? state.hover : null);

    for (var m = 0; m < months; m++) {
      var first = new Date(state.view.getFullYear(), state.view.getMonth() + m, 1);
      var title = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      html += '<div class="cal-month"><p class="cal-title">' + title + '</p><div class="cal-grid" role="grid" aria-label="' + title + '">';
      DOW.forEach(function (d) { html += '<div class="cal-dow" aria-hidden="true">' + d + '</div>'; });
      for (var e = 0; e < first.getDay(); e++) html += '<span class="day empty"></span>';
      var dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (var d = 1; d <= dim; d++) {
        var ds = EW.ds(new Date(first.getFullYear(), first.getMonth(), d));
        var cls = ['day'], disabled = false, tip = '', label = EW.fmt(ds, { weekday: 'long', month: 'long', day: 'numeric' });
        var b = bookingOn(ds);
        if (ds === today) cls.push('today');
        if (ds < today) { cls.push('past'); disabled = true; }
        if (b) {
          cls.push('booked');
          if (ds === b.checkin) cls.push('b-start');
          if (EW.addDays(ds, 1) === b.checkout) cls.push('b-end');
          tip = b.name + ' · ' + rangeLabel(b);
          label += ', booked: ' + tip;
          if (choosingOut && ds === limit) cls.push('can-checkout');
        }
        if (choosingOut && !b && ds > limit) { cls.push('blocked-out'); }
        // selection classes
        if (state.checkin && ds === state.checkin) { cls.push('sel-start'); if (!endSel) cls.push('only'); }
        if (endSel && ds === endSel) cls.push('sel-end');
        if (state.checkin && endSel && ds > state.checkin && ds < endSel) cls.push(state.checkout ? 'in-range' : 'preview');
        html += '<button type="button" class="' + cls.join(' ') + '" data-ds="' + ds + '"' + (disabled ? ' disabled' : '') +
          ' aria-label="' + EW.esc(label) + '"' + (cls.indexOf('sel-start') > -1 || cls.indexOf('sel-end') > -1 ? ' aria-pressed="true"' : '') + '>' +
          '<span class="n">' + d + '</span>' + (tip ? '<span class="cal-tip">' + EW.esc(tip) + '</span>' : '') + '</button>';
      }
      html += '</div></div>';
    }
    box.innerHTML = html;
    var thisMonth = new Date(t0.getFullYear(), t0.getMonth(), 1);
    $('calPrev').disabled = state.view <= thisMonth;
    var maxView = new Date(t0.getFullYear(), t0.getMonth() + MAX_MONTHS_AHEAD - (months - 1), 1);
    $('calNext').disabled = state.view >= maxView;
    renderStatus();
  }

  function renderStatus() {
    var s = $('calStatus'), html;
    if (!state.checkin) html = '<span>Select your <strong>check-in</strong> date</span>';
    else if (!state.checkout) html = '<span>Check-in <strong>' + EW.fmt(state.checkin) + '</strong> · now pick <strong>check-out</strong></span><button type="button" class="link-btn" data-clear>Clear</button>';
    else {
      var n = EW.nights(state.checkin, state.checkout);
      html = '<span><strong>' + EW.fmt(state.checkin) + ' → ' + EW.fmt(state.checkout) + '</strong> · ' + n + ' night' + (n > 1 ? 's' : '') + '</span><button type="button" class="link-btn" data-clear>Clear</button>';
    }
    s.innerHTML = html;
  }

  function info(msg, isErr) {
    var el = $('calInfo');
    el.textContent = msg || '';
    el.className = 'cal-info' + (msg ? ' show' : '') + (isErr ? ' err' : '');
  }

  function onDay(ds) {
    if (ds < today) return;
    var b = bookingOn(ds);
    info('');
    if (!state.checkin || state.checkout) {
      if (b) { info('Booked: ' + b.name + ' is staying ' + rangeLabel(b) + '.'); return; }
      state.checkin = ds; state.checkout = null;
    } else {
      var limit = maxCheckout(state.checkin);
      if (ds === state.checkin) { state.checkin = null; }               // tap again = clear (no 0-night stays)
      else if (ds < state.checkin) {
        if (b) { info('Booked: ' + b.name + ' is staying ' + rangeLabel(b) + '.'); return; }
        state.checkin = ds;
      } else if (ds <= limit) {
        state.checkout = ds;                                             // checkout may equal next guest's check-in
      } else {
        var nb = nextBlocked(state.checkin);
        if (!b && (!nb || nb >= ds)) {                                   // only the length cap is in the way
          info('Stays are limited to ' + CFG.MAX_NIGHTS + ' nights. Text Dan for longer stays.', true);
          return;
        }
        if (b) { info('That overlaps ' + b.name + "'s stay (" + rangeLabel(b) + '). Your latest check-out is ' + EW.fmt(limit) + '.', true); return; }
        info('Those dates overlap another stay, so we moved your check-in to ' + EW.fmt(ds) + '.', true);
        state.checkin = ds;
      }
    }
    state.hover = null;
    renderCalendar(); renderPrice(); updateWeather();
  }

  $('calMonths').addEventListener('click', function (e) {
    var btn = e.target.closest('.day'); if (!btn || btn.disabled) return;
    onDay(btn.getAttribute('data-ds'));
  });
  // Desktop hover preview: toggle classes in place (no re-render, so clicks stay stable).
  function paintPreview(hover) {
    var limit = maxCheckout(state.checkin);
    var end = hover && hover > state.checkin && hover <= limit ? hover : null;
    $('calMonths').querySelectorAll('.day[data-ds]').forEach(function (el) {
      var ds = el.getAttribute('data-ds');
      el.classList.toggle('preview', !!end && ds > state.checkin && ds < end);
      el.classList.toggle('sel-end', !!end && ds === end);
      if (ds === state.checkin) el.classList.toggle('only', !end);
    });
  }
  $('calMonths').addEventListener('mouseover', function (e) {
    if (!state.checkin || state.checkout || !window.matchMedia('(hover: hover)').matches) return;
    var btn = e.target.closest('.day'); var ds = btn && btn.getAttribute('data-ds');
    if (ds && ds !== state.hover) { state.hover = ds; paintPreview(ds); }
  });
  $('calMonths').addEventListener('mouseleave', function () {
    if (state.checkin && !state.checkout) { state.hover = null; paintPreview(null); }
  });
  $('calStatus').addEventListener('click', function (e) {
    if (e.target.closest('[data-clear]')) { state.checkin = state.checkout = null; info(''); renderCalendar(); renderPrice(); updateWeather(); }
  });
  $('calPrev').addEventListener('click', function () { state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1); renderCalendar(); });
  $('calNext').addEventListener('click', function () { state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1); renderCalendar(); });
  (mqTwo.addEventListener ? mqTwo.addEventListener('change', renderCalendar) : mqTwo.addListener(renderCalendar));

  function renderStays() {
    var up = state.bookings.filter(function (b) { return b.checkout >= today; })
      .sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; }).slice(0, 8);
    $('staysList').innerHTML = up.length ? up.map(function (b) {
      var n = EW.nights(b.checkin, b.checkout);
      var md = { month: 'short', day: 'numeric' };
      return '<li><span>' + EW.fmt(b.checkin, md) + ' → ' + EW.fmt(b.checkout, md) + ' <span class="nn">· ' + n + ' night' + (n > 1 ? 's' : '') + '</span></span><span class="who">' + EW.esc(b.name) + '</span></li>';
    }).join('') : '<li class="none">No upcoming stays yet. Every date is open!</li>';
  }

  function loadBookings() {
    if (EW.demo) { state.bookings = demoBookings(); renderCalendar(); renderStays(); return Promise.resolve(); }
    return EW.apiGet('bookings').then(function (j) {
      state.bookings = (j.bookings || []).filter(function (b) { return b.checkin && b.checkout; });
    }).catch(function () {
      $('staysList').innerHTML = '<li class="none">Couldn\'t load bookings right now. Refresh to try again, or text Dan.</li>';
    }).then(function () { renderCalendar(); if (state.bookings.length || !$('staysList').querySelector('.none')) renderStays(); });
  }

  /* ================= price ================= */
  function price(n) { return { cleaning: CFG.CLEANING_FEE, utilities: CFG.UTILITIES_PER_NIGHT * n, total: CFG.CLEANING_FEE + CFG.UTILITIES_PER_NIGHT * n }; }
  var payVisible = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { payVisible = es[0].isIntersecting; updateSticky(); }, { threshold: 0.15 }).observe($('payCard'));
  }
  function updateSticky() {
    var st = $('stickyTotal'), has = state.checkin && state.checkout;
    st.hidden = !has || payVisible;
    if (has) {
      var n = EW.nights(state.checkin, state.checkout);
      $('stNights').textContent = EW.fmt(state.checkin, { month: 'short', day: 'numeric' }) + ' → ' + EW.fmt(state.checkout, { month: 'short', day: 'numeric' }) + ' · ' + n + ' night' + (n > 1 ? 's' : '');
      $('stTotal').textContent = 'Total ' + EW.money(price(n).total);
    }
  }
  function renderPrice() {
    updateSticky();
    var box = $('priceBox');
    if (!state.checkin || !state.checkout) {
      box.innerHTML = '<div class="price-hint">Pick dates to see your total. It\'s a <strong>' + EW.money(CFG.CLEANING_FEE) + '</strong> cleaning fee per stay plus <strong>' + EW.money(CFG.UTILITIES_PER_NIGHT) + '</strong> per night for utilities.</div>';
      return;
    }
    var n = EW.nights(state.checkin, state.checkout), p = price(n);
    box.innerHTML = '<div class="price" data-nights="' + n + '" data-total="' + p.total + '">' +
      '<div class="price-row"><span>Cleaning fee <small>(flat, per stay)</small></span><span>' + EW.money(p.cleaning) + '</span></div>' +
      '<div class="price-row"><span>Utilities ' + EW.money(CFG.UTILITIES_PER_NIGHT) + ' × ' + n + ' night' + (n > 1 ? 's' : '') + '</span><span>' + EW.money(p.utilities) + '</span></div>' +
      '<div class="price-row total"><span>Total</span><span id="totalAmt">' + EW.money(p.total) + '</span></div></div>';
  }

  /* ================= weather ================= */
  var ICONS = {
    sun: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="#f2b33d"/><g stroke="#f2b33d" stroke-width="3" stroke-linecap="round"><path d="M24 5v5M24 38v5M5 24h5M38 24h5M10.6 10.6l3.5 3.5M33.9 33.9l3.5 3.5M10.6 37.4l3.5-3.5M33.9 14.1l3.5-3.5"/></g></svg>',
    partly: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="17" r="8" fill="#f2b33d"/><path d="M15 38h20a8 8 0 0 0 0-16 11 11 0 0 0-20.6 3.5A6.3 6.3 0 0 0 15 38z" fill="#cfd6d2"/></svg>',
    cloud: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 37h22a9 9 0 0 0 0-18 12 12 0 0 0-22.5 4A7 7 0 0 0 13 37z" fill="#aab4af"/></svg>',
    fog: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 27h22a8 8 0 0 0 0-16 11 11 0 0 0-20.6 3.5A6.3 6.3 0 0 0 13 27z" fill="#c4ccc8"/><g stroke="#9aa49f" stroke-width="3" stroke-linecap="round"><path d="M9 33h30M13 39h22"/></g></svg>',
    rain: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 29h22a8 8 0 0 0 0-16 11 11 0 0 0-20.6 3.5A6.3 6.3 0 0 0 13 29z" fill="#9fa9a4"/><g stroke="#3f7fbf" stroke-width="3" stroke-linecap="round"><path d="M16 34l-2 6M24 34l-2 6M32 34l-2 6"/></g></svg>',
    snow: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 28h22a8 8 0 0 0 0-16 11 11 0 0 0-20.6 3.5A6.3 6.3 0 0 0 13 28z" fill="#b4bdb8"/><g fill="#6aa0d4"><circle cx="15" cy="35" r="2.4"/><circle cx="24" cy="38" r="2.4"/><circle cx="33" cy="35" r="2.4"/><circle cx="19.5" cy="42" r="2"/><circle cx="28.5" cy="42" r="2"/></g></svg>',
    storm: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 28h22a8 8 0 0 0 0-16 11 11 0 0 0-20.6 3.5A6.3 6.3 0 0 0 13 28z" fill="#8c9691"/><path d="M25 29l-6 9h5l-3 7 9-11h-5l3-5z" fill="#f2b33d"/></svg>'
  };
  function iconFor(code) {
    if (code === 0) return ['sun', 'Clear'];
    if (code <= 2) return ['partly', 'Partly cloudy'];
    if (code === 3) return ['cloud', 'Cloudy'];
    if (code === 45 || code === 48) return ['fog', 'Fog'];
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return ['snow', 'Snow'];
    if (code >= 95) return ['storm', 'Thunderstorms'];
    if (code >= 51) return ['rain', 'Rain'];
    return ['partly', ''];
  }

  var wxBase = '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FLos_Angeles&latitude=' + CFG.LAT + '&longitude=' + CFG.LON;
  var forecastP = null, forecast = {}, forecastLast = null;
  function loadForecast() {
    if (!forecastP) {
      forecastP = fetch('https://api.open-meteo.com/v1/forecast?daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max&forecast_days=16' + wxBase)
        .then(function (r) { if (!r.ok) throw new Error('wx'); return r.json(); })
        .then(function (j) {
          var d = j.daily;
          d.time.forEach(function (t, i) {
            forecast[t] = { code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], precip: d.precipitation_sum[i], snow: d.snowfall_sum[i], pop: d.precipitation_probability_max[i] };
          });
          forecastLast = d.time[d.time.length - 1];
          return forecast;
        });
      forecastP.catch(function () { forecastP = null; });
    }
    return forecastP;
  }

  // Typical conditions: average the same calendar days (±3) over the past 10 years from the Open-Meteo archive.
  var typicalCache = {};
  function loadTypical(dates) {
    var need = dates.filter(function (d) { return !typicalCache[d]; });
    if (!need.length) return Promise.resolve(typicalCache);
    var start = EW.addDays(need[0], -3), end = EW.addDays(need[need.length - 1], 3);
    var thisYear = t0.getFullYear(), YEARS = 10, reqs = [];
    for (var k = 1; k <= YEARS; k++) {
      (function (k) {
        var s = shiftYear(start, -k), e = shiftYear(end, -k);
        if (e >= today) return;
        reqs.push(fetch('https://archive-api.open-meteo.com/v1/archive?daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&start_date=' + s + '&end_date=' + e + wxBase)
          .then(function (r) { if (!r.ok) throw new Error('arch'); return r.json(); })
          .then(function (j) { return { k: k, d: j.daily }; }));
      })(k);
    }
    return Promise.allSettled(reqs).then(function (res) {
      var byYear = res.filter(function (r) { return r.status === 'fulfilled'; }).map(function (r) { return r.value; });
      if (!byYear.length) throw new Error('No climate data');
      need.forEach(function (ds) {
        var hi = [], lo = [], wet = 0, snowy = 0, snowSum = 0, n = 0;
        byYear.forEach(function (y) {
          var center = shiftYear(ds, -y.k);
          for (var off = -3; off <= 3; off++) {
            var idx = y.d.time.indexOf(EW.addDays(center, off));
            if (idx < 0 || y.d.temperature_2m_max[idx] == null) continue;
            hi.push(y.d.temperature_2m_max[idx]); lo.push(y.d.temperature_2m_min[idx]);
            if (y.d.precipitation_sum[idx] >= 0.02) wet++;
            if (y.d.snowfall_sum[idx] >= 0.1) snowy++;
            snowSum += y.d.snowfall_sum[idx] || 0; n++;
          }
        });
        if (!n) return;
        var avg = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };
        typicalCache[ds] = { hi: avg(hi), lo: avg(lo), wetPct: Math.round(100 * wet / n), snowPct: Math.round(100 * snowy / n), snowAvg: snowSum / n, years: byYear.length };
      });
      return typicalCache;
    });
  }
  function shiftYear(ds, dy) {
    var p = ds.split('-'), y = +p[0] + dy, m = p[1], d = p[2];
    if (m === '02' && d === '29') d = '28';
    return y + '-' + m + '-' + d;
  }

  var wxSeq = 0;
  function updateWeather() {
    var seq = ++wxSeq;
    var days = [], title, selected = !!(state.checkin && state.checkout);
    if (selected) {
      for (var d = state.checkin; d <= state.checkout && days.length < 21; d = EW.addDays(d, 1)) days.push(d);
      title = 'Weather for your stay';
    } else {
      for (var i = 0; i < 7; i++) days.push(EW.addDays(today, i));
      title = 'Sunriver: next 7 days';
    }
    $('wxTitle').textContent = title;
    var body = $('wxBody');
    if (!body.querySelector('.wx-strip')) body.innerHTML = '<div class="wx-msg">Loading weather…</div>';

    loadForecast().catch(function () { return null; }).then(function () {
      var typicalDays = days.filter(function (d) { return !forecast[d]; });
      var p = typicalDays.length ? loadTypical(typicalDays).catch(function () { return null; }) : Promise.resolve();
      return p.then(function () {
        if (seq !== wxSeq) return;
        var nF = 0, nT = 0;
        var cards = days.map(function (ds) {
          var label = EW.fmt(ds, { weekday: 'short' }) + ' ' + EW.fmt(ds, { month: 'numeric', day: 'numeric' });
          var f = forecast[ds];
          if (f) {
            nF++;
            var ic = iconFor(f.code);
            var precip = f.snow >= 0.1 ? '❄ ' + f.snow.toFixed(1) + '″ snow' : (f.precip >= 0.01 ? f.precip.toFixed(2) + '″ rain' : 'Dry');
            return '<div class="wx-day" data-kind="forecast" title="' + ic[1] + '"><div class="d">' + label + '</div>' + ICONS[ic[0]] +
              '<div class="t">' + Math.round(f.hi) + '° <small>' + Math.round(f.lo) + '°</small></div><div class="p">' + precip + (f.pop != null ? '<br>' + f.pop + '% chance' : '') + '</div></div>';
          }
          var t = typicalCache[ds];
          if (!t) return '<div class="wx-day typical"><div class="d">' + label + '</div><div class="p" style="margin-top:20px">No data</div></div>';
          nT++;
          var key = t.snowPct >= 30 ? 'snow' : t.wetPct >= 35 ? 'rain' : t.wetPct >= 18 ? 'partly' : 'sun';
          var pText = t.wetPct + '% wet days' + (t.snowPct >= 5 ? '<br>' + t.snowPct + '% snow' : '');
          return '<div class="wx-day typical" data-kind="typical"><div class="d">' + label + '</div>' + ICONS[key] +
            '<div class="t">' + Math.round(t.hi) + '° <small>' + Math.round(t.lo) + '°</small></div><div class="p">' + pText + '</div><div class="tag">Typical</div></div>';
        });
        if (!nF && !nT) { body.innerHTML = '<div class="wx-msg">Weather is unavailable right now.</div>'; $('wxNote').textContent = ''; return; }
        body.innerHTML = '<div class="wx-strip" id="wxStrip">' + cards.join('') + '</div>';
        var badge = $('wxBadge');
        if (nT && !nF) { badge.textContent = 'Typical'; badge.className = 'wx-label ty'; }
        else if (nT) { badge.textContent = 'Forecast + typical'; badge.className = 'wx-label ty'; }
        else { badge.textContent = 'Forecast'; badge.className = 'wx-label fc'; }
        var notes = [];
        if (nF) notes.push('Forecast: daily high and low (°F), plus precipitation, from Open-Meteo.');
        if (nT) notes.push('Dashed "Typical" days are past the 16-day forecast. They show the average for those dates over the last ' + (typicalCache[days[days.length - 1]] || {}).years + ' years, not a prediction.');
        if (selected && EW.nights(state.checkin, state.checkout) > 20) notes.push('Showing the first 3 weeks of your stay.');
        $('wxNote').textContent = notes.join(' ');
      });
    });
  }

  /* ================= guest form + pay ================= */
  var gSel = $('fGuests');
  for (var g = 1; g <= CFG.MAX_GUESTS; g++) { var o = document.createElement('option'); o.value = g; o.textContent = g + (g === 1 ? ' guest' : ' guests'); gSel.appendChild(o); }

  var validators = {
    fName: function (v) { return /^\S+(\s+\S+)+$/.test(v.trim()) && v.trim().length <= 100; },
    fEmail: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); },
    fPhone: function (v) { var d = v.replace(/\D/g, ''); return d.length === 10 || (d.length === 11 && d[0] === '1') || (v.trim()[0] === '+' && d.length >= 10 && d.length <= 15); },
    fGuests: function (v) { return +v >= 1 && +v <= CFG.MAX_GUESTS; }
  };
  function validate(id) {
    var el = $(id), ok = validators[id](el.value);
    el.closest('.field').classList.toggle('invalid', !ok);
    el.setAttribute('aria-invalid', ok ? 'false' : 'true');
    return ok;
  }
  Object.keys(validators).forEach(function (id) {
    $(id).addEventListener('blur', function () { if ($(id).value) validate(id); });
    $(id).addEventListener('input', function () { if ($(id).closest('.field').classList.contains('invalid')) validate(id); });
  });

  function formMsg(html, kind) { var m = $('formMsg'); m.innerHTML = html || ''; m.className = 'form-msg' + (html ? ' show ' + kind : ''); }

  $('guestForm').addEventListener('submit', function (e) {
    e.preventDefault();
    formMsg('');
    if (!state.checkin || !state.checkout) {
      formMsg('Pick your check-in and check-out dates on the calendar first.', 'err');
      $('calCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var bad = Object.keys(validators).filter(function (id) { return !validate(id); });
    if (bad.length) { $(bad[0]).focus(); return; }
    var n = EW.nights(state.checkin, state.checkout);
    var payload = {
      checkin: state.checkin, checkout: state.checkout,
      name: $('fName').value.trim(), email: $('fEmail').value.trim(), phone: $('fPhone').value.trim(),
      guests: +$('fGuests').value, notes: $('fNotes').value.trim(),
      expectedTotal: price(n).total
    };
    if (EW.demo) {
      formMsg('<strong>Payments aren\'t connected yet.</strong> This is a preview. Your ' + n + '-night stay would be <strong>' + EW.money(price(n).total) + '</strong>. To book now, text Dan at <a href="sms:' + CFG.PHONE_SMS + '">' + CFG.PHONE_DISPLAY + '</a>.', 'info');
      return;
    }
    var btn = $('payBtn'); btn.disabled = true;
    formMsg('Opening secure checkout…', 'info');
    EW.api('checkout', payload).then(function (j) {
      try { sessionStorage.setItem('ew_pending', JSON.stringify({ id: j.bookingId, checkin: payload.checkin, checkout: payload.checkout })); } catch (_) {}
      location.href = j.url;
    }).catch(function (err) {
      btn.disabled = false;
      formMsg(EW.esc(err.message) + ' If this keeps happening, text Dan at <a href="sms:' + CFG.PHONE_SMS + '">' + CFG.PHONE_DISPLAY + '</a>.', 'err');
      if (/booked|available|overlap/i.test(err.message)) loadBookings();
    });
  });

  /* ================= canceled checkout ================= */
  var canceled = EW.qs('canceled');
  if (canceled) {
    var cb = $('cancelBanner');
    cb.hidden = false;
    cb.textContent = 'Checkout was canceled, and you weren\'t charged. Those dates are open again, so you can try below.';
    if (!EW.demo) EW.api('release', { b: canceled, t: EW.qs('t') || '' }).catch(function () {}).then(loadBookings);
    history.replaceState(null, '', location.pathname + '#book');
  }

  /* ================= 3D tour ================= */
  $('tourLoad').addEventListener('click', function () {
    var f = document.createElement('iframe');
    f.src = CFG.MATTERPORT_URL + (CFG.MATTERPORT_URL.indexOf('?') > -1 ? '&' : '?') + 'play=1&qs=1';
    f.title = 'Eaglewood 3D tour (Matterport)';
    f.allow = 'fullscreen; xr-spatial-tracking; gyroscope; accelerometer';
    $('tourMedia').innerHTML = '';
    $('tourMedia').appendChild(f);
  });

  /* ================= gallery + lightbox ================= */
  var PHOTOS = {
    exterior: ['01-front', '02-front-porch', '03-back-deck', '04-front-summer', '05-back-yard-and-deck', '06-pool-and-lawn'],
    interior: ['01-entry-hallway', '02-primary-suite', '03-primary-suite-sitting-area', '04-primary-lounge', '05-primary-suite-tv',
      '06-primary-bath-double-vanity', '07-queen-bedroom', '08-bath-tub-shower', '09-twin-bedroom', '10-twin-bedroom-tv',
      '11-bath-walk-in-shower', '12-shower-detail', '13-laundry', '14-garage-ping-pong-ev']
  };
  // Alt text derived from the file names.
  function altFrom(file) {
    var words = file.replace(/^\d+-/, '').split('-').map(function (w) { return w === 'ev' ? 'EV charger' : w === 'tv' ? 'TV' : w; });
    var s = words.join(' ');
    var nicer = {
      'front summer': 'Front of the house in summer',
      'back yard and deck': 'Backyard and deck',
      'primary bath double vanity': 'Primary bath with a double vanity',
      'bath tub shower': 'Bath with a tub and shower',
      'bath walk in shower': 'Bath with a walk-in shower',
      'garage ping pong EV charger': 'Garage with ping-pong and an EV charger'
    };
    if (nicer[s]) return nicer[s];
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  var group = 'exterior', lbIndex = 0, lastFocus = null;
  function list() { return PHOTOS[group]; }
  function renderGallery() {
    $('gallery').innerHTML = list().map(function (f, i) {
      return '<button type="button" data-i="' + i + '" aria-label="Open photo: ' + altFrom(f) + '"><img src="photos/thumbs/' + group + '/' + f + '.jpg" alt="' + altFrom(f) + '" loading="lazy" decoding="async" width="600" height="400"></button>';
    }).join('');
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.getAttribute('data-group') === group;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.querySelector('.count').textContent = PHOTOS[t.getAttribute('data-group')].length;
    });
    $('gallery').setAttribute('aria-labelledby', 'tab-' + group);
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { group = t.getAttribute('data-group'); renderGallery(); });
  });
  $('gallery').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]'); if (b) openLb(+b.getAttribute('data-i'));
  });
  function showLb() {
    var f = list()[lbIndex];
    $('lbImg').src = 'photos/' + group + '/' + f + '.jpg';
    $('lbImg').alt = altFrom(f);
    $('lbCap').innerHTML = EW.esc(altFrom(f)) + '<small>' + (lbIndex + 1) + ' / ' + list().length + '</small>';
    // preload neighbor
    var nx = new Image(); nx.src = 'photos/' + group + '/' + list()[(lbIndex + 1) % list().length] + '.jpg';
  }
  function openLb(i) { lastFocus = document.activeElement; lbIndex = i; showLb(); $('lightbox').classList.add('open'); document.body.style.overflow = 'hidden'; $('lbClose').focus(); }
  function closeLb() { $('lightbox').classList.remove('open'); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  function step(d) { lbIndex = (lbIndex + d + list().length) % list().length; showLb(); }
  $('lbClose').addEventListener('click', closeLb);
  $('lbPrev').addEventListener('click', function () { step(-1); });
  $('lbNext').addEventListener('click', function () { step(1); });
  $('lightbox').addEventListener('click', function (e) { if (e.target === this) closeLb(); });
  document.addEventListener('keydown', function (e) {
    if (!$('lightbox').classList.contains('open')) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  var tx = null;
  $('lightbox').addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
  $('lightbox').addEventListener('touchend', function (e) {
    if (tx == null) return; var dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
  });

  /* ================= amenities ================= */
  var check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
  $('amenities').innerHTML = ['Private hot tub', 'Seasonal pool next door', 'BBQ grill', 'EV / Tesla charger', 'Ping-pong table', 'Air conditioning', 'Near Woodlands Golf Course', 'Bike paths nearby']
    .map(function (a) { return '<li>' + check + a + '</li>'; }).join('');

  /* ================= init ================= */
  renderCalendar(); renderPrice(); renderGallery(); updateWeather(); loadBookings();

  // Test hook (harmless): lets automated checks read state.
  window.__ew = { state: state, price: price };
})();
