# PandaSuite Studio

> Create without any coding and publish for mobile, tablet or web - Native iOS/Android/HTML5 - Private or public deployment - Start your project for free.

## Install

_macOS 10.10+, Linux, and Windows 7+ are supported._

**macOS**

[**Download**](https://github.com/beingenious/studio/releases/latest) the `.dmg` file.

**Linux**

[**Download**](https://github.com/beingenious/studio/releases/latest) the `.AppImage` or `.deb` file.

_The AppImage needs to be [made executable](http://discourse.appimage.org/t/how-to-make-an-appimage-executable/80) after download._

**Windows**

[**Download**](https://github.com/beingenious/studio/releases/latest) the `.exe` file.

## Recover Home

If Home stays blank, select its tab and choose **View > Reload** (**Afficher >
Recharger** in French). Only Home reloads; open project documents stay in place.
A native dialog offers the same action after a Home renderer exit, main-frame
load failure, or unresponsive event. Failures in a background Home wait until you
select it. Cancel dismisses the current episode. Waking the computer never
reloads Home automatically.

Local diagnostics are appended to `logs/home-recovery.log` inside Electron's
`userData` directory (on macOS, normally
`~/Library/Application Support/PandaSuite Studio/`). Each file is capped at
256 KiB, with one previous file at `home-recovery.log.1`. Records survive restarts
and contain UTC times, app/runtime versions, Home view ids, structural failure
codes, loading/reload events, hang durations, and suspend/resume times. They exclude
URLs, project names/ids, credentials, raw error text, and page contents. File write
errors do not block recovery. React diagnostics from compatible dashboard versions
are optional and accept only the retained Home renderer.

A finished document load does not prove visual recovery. Native events do not
identify every JavaScript startup failure or blank page; the menu remains
available for those cases. This adds diagnostics and explicit recovery; the
original overnight incident's cause is still unknown.

Development checks: `node scripts/test-home-recovery.js`,
`node scripts/test-home-recovery-wiring.js`, and `npm test` (ESLint). Native smoke
checks must use isolated windows/views rather than a running user's projects.

Run the optional isolated native smoke with
`./node_modules/.bin/electron scripts/test-home-recovery-electron.js`. It checks
Home recovery and shell/project preservation in real Electron, including an actual
Home renderer crash when its process is separate from shell and project views.
The original overnight blank Home is not reproduced by this smoke check.
