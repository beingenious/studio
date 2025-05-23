const { ipcRenderer } = require('electron');

process.once('loaded', () => {
  window.addEventListener('message', (event) => {
    const message = event.data;

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
