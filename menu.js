const path = require('path');
const { app, Menu, shell } = require('electron');
const {
  is,
  appMenu,
  aboutMenuItem,
  openUrlMenuItem,
} = require('electron-util');
const config = require('./config');
const { __ } = require('./i18n/i18n');

module.exports = function initMenu(options) {
  const showPreferences = () => {
    // Show the app's preferences here
  };

  const helpSubmenu = [
    openUrlMenuItem({
      label: __('Dashboard'),
      url: 'https://pandasuite.com/dashboard/',
    }),
    openUrlMenuItem({
      label: __('Help Center'),
      url: 'https://learn.pandasuite.com',
    }),
    openUrlMenuItem({
      label: __('Blog'),
      url: 'https://blog.pandasuite.com',
    }),
  ];

  if (!is.macos) {
    helpSubmenu.push(
      {
        type: 'separator',
      },
      aboutMenuItem({
        icon: path.join(__dirname, 'static', 'icon.png'),
        text: 'Created by the PandaSuite Team',
      }),
    );
  }

  const debugSubmenu = [
    {
      label: 'Show Settings',
      click() {
        config.openInEditor();
      },
    },
    {
      label: 'Show App Data',
      click() {
        shell.openItem(app.getPath('userData'));
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Delete Settings',
      click() {
        config.clear();
        app.relaunch();
        app.quit();
      },
    },
    {
      label: 'Delete App Data',
      click() {
        shell.moveItemToTrash(app.getPath('userData'));
        app.relaunch();
        app.quit();
      },
    },
  ];

  const macosTemplate = [
    appMenu([
      {
        label: 'Preferences…',
        accelerator: 'Command+,',
        click() {
          showPreferences();
        },
      },
    ]),
    {
      role: 'fileMenu',
      submenu: [
        {
          label: __('New Window'),
          accelerator: 'Command+Shift+N',
          click() {
            if (options && options.newWindow) {
              options.newWindow();
            }
          },
        },
        {
          type: 'separator',
        },
        {
          role: 'close',
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu',
    },
    {
      role: 'help',
      submenu: helpSubmenu,
    },
  ];

  // Linux and Windows
  const otherTemplate = [
    {
      role: 'fileMenu',
      submenu: [
        {
          label: __('New Window'),
          accelerator: 'Control+Shift+N',
          click() {
            if (options && options.newWindow) {
              options.newWindow();
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Settings',
          accelerator: 'Control+,',
          click() {
            showPreferences();
          },
        },
        {
          type: 'separator',
        },
        {
          role: 'quit',
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: helpSubmenu,
    },
  ];

  const template = process.platform === 'darwin' ? macosTemplate : otherTemplate;

  if (is.development) {
    template.push({
      label: 'Debug',
      submenu: debugSubmenu,
    });
  }

  return Menu.buildFromTemplate(template);
};
