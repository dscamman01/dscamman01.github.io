/*
 * Eaglewood site settings.
 *
 * BACKEND_URL: paste the Google Apps Script web app URL here (it ends in /exec).
 * While it is empty, the site runs in DEMO mode: sample bookings are shown and
 * the pay button explains that payments are not connected yet.
 */
window.EAGLEWOOD_CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyO92a68sAHIGmcF9hCeheR82cOo6EgYMDDRNXWp4T3Hyf-FsbMcPHsJ10SZfkriBgB/exec',

  // Display prices only. The backend recomputes the real price server-side.
  CLEANING_FEE: 350,
  UTILITIES_PER_NIGHT: 50,
  MAX_GUESTS: 8,
  MAX_NIGHTS: 30,

  PHONE_DISPLAY: '(360) 480-8390',
  PHONE_SMS: '+13604808390',
  MATTERPORT_URL: 'https://my.matterport.com/show/?m=YsL4c1QA3fg',

  // Sunriver, OR (for the Open-Meteo weather panel)
  LAT: 43.88,
  LON: -121.44
};
