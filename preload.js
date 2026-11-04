const { ipcRenderer } = require('electron');

process.once('loaded', () => {
  Object.defineProperty(window, 'studioNativeWindowFrame', {
    value: process.platform === 'darwin' || process.platform === 'win32',
  });
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'updateNativeTheme') {
      if (event.source === window) ipcRenderer.send(message.type, message.data);
      return;
    }
    if (message.type === 'homeRenderError') {
      if (event.source === window) ipcRenderer.send(message.type, message.data);
      return;
    }

    if (
      [
        'updateMenuItem',
        'updateMenuItems',
        'updateLanguage',
        'triggerFineUploaderLinux',
        'createOrSelectTab',
        'removeTab',
        'updateTab',
        'navigateToHomeTab',
      ].indexOf(message.type) !== -1
    ) {
      ipcRenderer.send(message.type, message.data);
    }
  });
});
