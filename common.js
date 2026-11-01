/* Shared helpers for every Eaglewood page. */
(function () {
  'use strict';
  var CFG = window.EAGLEWOOD_CONFIG || {};
  var EW = (window.EW = {});
  EW.cfg = CFG;
  EW.demo = !CFG.BACKEND_URL;

  /** Call the Apps Script backend. text/plain avoids a CORS preflight. */
  EW.api = function (action, data) {
    if (EW.demo) return Promise.reject(new Error('DEMO'));
    var body = Object.assign({ action: action }, data || {});
    return fetch(CFG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('Network error (' + r.status + ')');
      return r.json();
    }).then(function (j) {
      if (!j || j.ok === false) throw new Error((j && j.error) || 'Something went wrong');
      return j;
    });
  };

  EW.apiGet = function (action) {
    if (EW.demo) return Promise.reject(new Error('DEMO'));
    return fetch(CFG.BACKEND_URL + '?action=' + encodeURIComponent(action), { redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('Network error'); return r.json(); })
      .then(function (j) { if (!j || j.ok === false) throw new Error((j && j.error) || 'Something went wrong'); return j; });
  };

  /* ---------- dates: always plain local YYYY-MM-DD strings ---------- */
  EW.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  EW.ds = function (d) { return d.getFullYear() + '-' + EW.pad(d.getMonth() + 1) + '-' + EW.pad(d.getDate()); };
  EW.parse = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  EW.addDays = function (s, n) { var d = EW.parse(s); d.setDate(d.getDate() + n); return EW.ds(d); };
  EW.nights = function (a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], pa[1] - 1, +pa[2])) / 864e5);
  };
  EW.today = function () { return EW.ds(new Date()); };
  EW.fmt = function (s, opts) {
    return EW.parse(s).toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  };
  EW.money = function (n) { return '$' + n.toLocaleString('en-US'); };
  EW.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  EW.qs = function (k) { return new URLSearchParams(location.search).get(k); };
})();
