const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (function i18n() {
  let currentLocale = 'en-US';

  const loadedLanguage = {
    'en-US': JSON.parse(fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8')),
    'fr-FR': JSON.parse(fs.readFileSync(path.join(__dirname, 'fr.json'), 'utf8')),
  };

  // eslint-disable-next-line no-underscore-dangle
  this.__ = function translate(phrase) {
    return loadedLanguage[currentLocale][phrase];
  };

  this.changeLocale = (locale) => {
    let newLocale;

    if (locale.startsWith('fr')) {
      newLocale = 'fr-FR';
    } else {
      newLocale = 'en-US';
    }
    if (newLocale !== currentLocale) {
      currentLocale = newLocale;
      return true;
    }
    return false;
  };

  this.changeLocale(app.getLocale());

  return this;
}());
