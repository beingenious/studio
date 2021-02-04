const { ipcRenderer } = require('electron');

process.once('loaded', () => {
  window.addEventListener('message', (event) => {
    const message = event.data;

    if (['updateMenuItem', 'updateLanguage'].indexOf(message.type) !== -1) {
      ipcRenderer.send(message.type, message.data);
    }
  });
});
