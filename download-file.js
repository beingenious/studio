const path = require('path');
const extName = require('ext-name');

// A download in progress holds its file name, so two downloads never share a file and a
// failed one only removes its own. Compared lowercased: Downloads is often case-insensitive.
const reserved = new Set();
const key = (file) => file.toLowerCase();
// Several calls can wait for the same link at once: each item is handled by one of them.
const claimed = new WeakSet();
// A window shows the progress of all its downloads, until none is left.
const tallies = new WeakMap();

const freePath = (fs, directory, filename, n = 0) => {
  const extension = path.extname(filename);
  const name = n === 0
    ? filename
    : `${filename.slice(0, filename.length - extension.length)} (${n})${extension}`;
  const file = path.join(directory, name);
  if (reserved.has(key(file)) || fs.existsSync(file)) {
    return freePath(fs, directory, filename, n + 1);
  }
  return file;
};

// Chromium keeps a name without extension as is: add the one its type implies, when only one
// does, as electron-dl did.
const nameOf = (item) => {
  const filename = item.getFilename();
  if (path.extname(filename)) return filename;
  const extensions = extName.mime(item.getMimeType());
  return extensions.length === 1 ? `${filename}.${extensions[0].ext}` : filename;
};

const tallyOf = (win) => {
  if (!tallies.has(win)) tallies.set(win, { items: new Set(), total: 0, completed: 0 });
  return tallies.get(win);
};

const showProgress = (win) => {
  const tally = tallyOf(win);
  if (!tally.items.size) {
    tallies.delete(win);
    win.setProgressBar(-1);
    return;
  }
  if (!tally.total) return;
  const received = [...tally.items].reduce(
    (sum, item) => sum + item.getReceivedBytes(),
    tally.completed,
  );
  win.setProgressBar(received / tally.total);
};

// Downloads a link from a Studio window into the Downloads folder. Electron 11 leaves a
// failed download interrupted forever, without a word: say so, and offer to try again.
module.exports = function downloadFile(options) {
  const {
    win, url, directory, showMessageBox, showItemInFolder, downloadFinished, translate, fs,
  } = options;
  const contents = win.webContents;
  const { session } = contents;

  const offer = (filename) => Promise.resolve()
    .then(() => {
      if (win.isDestroyed()) return undefined;
      return showMessageBox(win, {
        type: 'warning',
        message: translate('download.failedMessage'),
        detail: translate('download.failedDetail').replace('{file}', filename),
        buttons: [translate('download.tryAgain'), translate('Cancel')],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0 && !win.isDestroyed()) downloadFile(options);
      });
    })
    .catch(() => {});

  const handle = (item) => {
    const file = freePath(fs, directory, nameOf(item));
    reserved.add(key(file));
    item.setSavePath(file);
    const tally = tallyOf(win);
    tally.items.add(item);
    tally.total += item.getTotalBytes();
    let failed = false;

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        if (failed) return;
        // Set first: cancel() emits 'done' before it returns.
        failed = true;
        // Without this, the interrupted download would wait forever.
        item.cancel();
        return;
      }
      if (!win.isDestroyed()) showProgress(win);
    });
    item.once('done', (event, state) => {
      reserved.delete(key(file));
      tally.items.delete(item);
      tally.completed += item.getTotalBytes();
      if (!win.isDestroyed()) showProgress(win);
      if (state === 'completed') {
        downloadFinished(file);
        showItemInFolder(file);
      } else if (failed || state === 'interrupted') {
        try {
          fs.unlinkSync(file);
        } catch (error) {
          // Already gone, or the system refuses: nothing more to do.
        }
        offer(item.getFilename());
      }
    });
  };

  const stopListening = () => {
    session.removeListener('will-download', onDownload); // eslint-disable-line no-use-before-define
    win.removeListener('closed', stopListening);
  };
  const onDownload = (event, item, source) => {
    if (source !== contents || claimed.has(item) || item.getURLChain()[0] !== url) return;
    claimed.add(item);
    stopListening();
    handle(item);
  };
  session.on('will-download', onDownload);
  win.once('closed', stopListening);
  contents.downloadURL(url);
};
