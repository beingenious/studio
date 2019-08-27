const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (function i18n() {
  const locale = app.getLocale();
  let loadedLanguage;

  if (fs.existsSync(path.join(__dirname, `${locale}.json`))) {
    loadedLanguage = JSON.parse(fs.readFileSync(path.join(__dirname, `${locale}.json`), 'utf8'));
  } else {
    loadedLanguage = JSON.parse(fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8'));
  }

  // eslint-disable-next-line no-underscore-dangle
  this.__ = function translate(phrase) {
    let translation = loadedLanguage[phrase];
    if (translation === undefined) {
      translation = phrase;
    }
    return translation;
  };
  return this;
}());
