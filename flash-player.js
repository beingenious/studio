const { app } = require('electron');
const { is } = require('electron-util');
const path = require('path');

module.exports.setupFlashPlayer = function setupFlashPlayer() {
  let pluginName = null;

  if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      pluginName = 'pepflashplayer64.dll';
    } else {
      pluginName = 'pepflashplayer32.dll';
    }
  } else if (process.platform === 'darwin') {
    pluginName = 'PepperFlashPlayer.plugin';
  } else if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      pluginName = 'libpepflashplayer.x86_64.so';
    } else {
      pluginName = 'libpepflashplayer.i386.so';
    }
  }

  if (pluginName != null) {
    if (is.linux) {
      app.commandLine.appendSwitch('no-sandbox');
    }
    app.commandLine.appendSwitch('ppapi-flash-path',
      path.join(__dirname.includes('.asar') ? process.resourcesPath : __dirname, 'static', 'flash_player_ppapi', pluginName));
  }
};
