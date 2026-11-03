# Studio dark tabs and native appearance

Mandate: beingenious/studio#11. Preserve light appearance and join active tabs to
the project toolbar and loading ground in dark mode. Home and projects use the
existing surface token (#fff / #1f232c); inactive tabs retain their distinction.
No editor content, artwork, palette or layout redesign.

## Design

Bamboo Tab.jsx drops dark:bg-gray-50 on selected tabs and keeps selected hover on
the same surface. Inactive tabs use bg-gray-100 rather than dark:bg-surface, so
selection stays distinguishable; apply the existing dark hover only to inactive tabs. The loading ground keeps
bg-gray-100 in light mode and gains dark:bg-surface, including its local dark
wrapper during the legacy runtime compatibility island. No runtime color sampling
or loading-state synchronization: these surfaces have an existing common token.

The Tabs shell sends the stored choice auto/light/dark on mount and preference
changes. Electron maps auto to system in nativeTheme.themeSource, so native About
and dialogs follow PandaSuite. Never send the resolved color for auto: that would
freeze the native override and feed back through prefers-color-scheme. Preload
accepts this message only from its own window; main accepts it only from that
BrowserWindow's webContents, with a finite value allowlist. BrowserViews cannot
set app appearance. No replacement About window or new persisted preference.

Both repositories can ship independently: old shells ignore the new postMessage;
new shells retain native system appearance until a compatible Tabs page sends.
The native portion requires an app release; hosted color fixes require Bamboo.
No deployment is authorized by this implementation workflow.

## Verification

Failing regression first: compiled CSS/computed surface comparison for selected
Home/project and loader, both modes and hover; bridge mount/live changes and auto;
native sender/value rejection and preload self-source. Run existing theme/tab/
loader tests, full Bamboo tests/build, shell lint/recovery checks. Render light and
dark cases in Chromium 87 (Electron 11). Inspect native About on macOS with an
isolated app rather than touching running user projects. Usage is unmeasured.

## Alternatives

Dynamic selected-view color reporting adds lifecycle state across processes for a
static design token; reject unless runtime evidence shows a genuinely variable
toolbar. Replacing About is outside the user's low-effort condition; use Electron's
existing nativeTheme API instead.

## Challenge log

- Approach advisor: fresh subagent theme_advisor ran; recommended shared surfaces
  and stored-choice native bridge; rejected dynamic view color reporting.
- Codex companion read-only spec/plan review ran: accepted correction separating
  white light tabs from gray light loader in verification, no behavior change.
- Fresh spec_shape reviewer ran twice: accepted inactive-only hover; final review
  found no material shape issues. Inactive ground correction explicitly preserves
  selection. Accepted minor test wording correction also found by Codex.
- No scope escalations. Mandate resolves design approval on issue #11.
