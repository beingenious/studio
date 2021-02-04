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
  const isMac = process.platform === 'darwin';

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
        // icon: path.join(__dirname.includes('.asar') ? process.resourcesPath : __dirname, 'static', 'icon.png'),
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

  const performClick = (menuItem) => {
    if (options && options.studioOnMenuItemUpdate) {
      options.studioOnMenuItemUpdate({ id: menuItem.id, click: true });
    }
  };

  const template = [
    {
      role: 'fileMenu',
      label: __('menu.project'),
      id: 'project',
      submenu: [
        {
          label: __('menu.new'),
          id: 'new',
          accelerator: 'CommandOrControl+N',
          click: performClick,
        },
        {
          label: __('menu.new_window'),
          id: 'new_window',
          accelerator: 'CommandOrControl+Shift+N',
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
          label: __('menu.open'),
          id: 'open',
          accelerator: 'CommandOrControl+O',
          click: performClick,
        },
        {
          type: 'separator',
        },
        {
          label: __('menu.duplicate'),
          id: 'duplicate',
          click: performClick,
        },
        {
          label: __('menu.save'),
          id: 'save',
          accelerator: 'CommandOrControl+S',
          click: performClick,
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
      label: __('menu.edit'),
      id: 'edit',
      submenu: [
        {
          label: __('menu.undo'),
          id: 'undo',
          accelerator: 'CommandOrControl+Z',
          click: performClick,
        },
        {
          label: __('menu.redo'),
          id: 'redo',
          accelerator: isMac ? 'Shift+CommandOrControl+Z' : 'CommandOrControl+Y',
          click: performClick,
        },
        { type: 'separator' },
        {
          label: __('menu.delete'),
          id: 'delete',
          accelerator: 'Backspace',
          click: performClick,
        },
        {
          label: __('menu.select_all'),
          id: 'select_all',
          accelerator: 'CommandOrControl+A',
          click: performClick,
        },
        { type: 'separator' },
      ],
    },
    {
      label: __('menu.view'),
      id: 'view',
      submenu: [
        {
          role: 'togglefullscreen',
          label: __('menu.togglefullscreen'),
          id: 'togglefullscreen',
        },
      ],
    },
    {
      role: 'windowMenu',
    },
    {
      label: __('menu.help'),
      id: 'help',
      submenu: [
        {
          label: __('menu.support'),
          id: 'support',
          click: performClick,
        },
        { type: 'separator' },
        {
          label: __('menu.helpcenter'),
          id: 'helpcenter',
          click: performClick,
        },
        {
          label: __('menu.examples'),
          id: 'examples',
          click: performClick,
        },
        {
          label: __('menu.learn'),
          id: 'learn',
          click: performClick,
        },
        { type: 'separator' },
        {
          label: __('menu.contactus'),
          id: 'contactus',
          click: performClick,
        },
        {
          label: __('menu.hire'),
          id: 'hire',
          click: performClick,
        },
        {
          label: __('menu.bug'),
          id: 'bug',
          click: performClick,
        },
      ],
    },
  ];

  if (isMac) {
    template.unshift(appMenu([]));
  } else {
    /* Remove Window */
    template.splice(template.length - 2, 1);
  }

  if (is.development) {
    template.push({
      label: 'Debug',
      submenu: debugSubmenu,
    });
  }

  return Menu.buildFromTemplate(template);
};
