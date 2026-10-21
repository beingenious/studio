# Studio Home Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover only a failed Home with Recharger and preserve diagnostics without reloading shell or projects.

**Architecture:** Home BrowserView gets an immutable role and a small lifecycle controller. Main-process logging is bounded and structural; a Home-only React boundary supplies fallback and optional diagnostic IPC. Components ship independently; no auth behavior changes.

**Tech Stack:** Electron 11/CommonJS, Node assert/EventEmitter test scripts, React18, react-intl, existing Vitest.

Design: ../specs/2026-10-21-home-recovery-design.md. Mandate: beingenious/Panda.task#1066.

## Chunk 1: Electron

### Task 1: Log and controller
Files: create home-recovery.js (Home view controller), home-recovery-log.js (bounded append/rotation); create scripts/test-home-recovery.js (Node assert/event boundary tests, no new framework).
- [ ] Write executable regression assertions using real EventEmitter mock Electron boundary: event registration before load; unresponsive/responsive transitions for selected/background Home, hang duration and subsequent episodes; background failure deferred; Recharger only calls captured Home reload, project/shell spies remain zero; abort/subframe filtering; dialog cancellation, duplicate failure events, stale/destroyed view, selection change; diagnostic sender filtering. Run node scripts/test-home-recovery.js and observe missing behavior fail.
- [ ] Implement attachHomeRecovery({view,window,isSelected,showMessageBox,translate,log}) returning selected(), reload(), reportReactError(), dispose() as needed. Attach render-process-gone, did-fail-load (main frame excluding -3), unresponsive and responsive before loadURL. Responsive ends only the hang episode and logs duration, not a visual-success claim; a later crash/load failure must remain actionable. State: failure episode + prompt in flight + dismissed; native prompt only while selected. Log/guard all promise failures. Do not forcefullyCrashRenderer, recreate shell, or touch other views. Track reload document-load outcome, not visual-success claim.
- [ ] Log whitelisted fields only with timestamp/versions; cap each record, rotate at 256KiB with one previous file; mkdir recursive; contain filesystem failures; test actual temporary file rotation/reopen, unknown fields/raw URLs/token/message exclusion.
- [ ] Run regression script and npm test (existing ESLint).

### Task 2: Integrate production wiring
Files: index.js, menu.js, preload.js, i18n/en.json, i18n/fr.json, readme.md.
- [ ] Extend createOrSelectBrowserView({url,home},win): recognize home only at creation with home===true and exact configured https dashboard root; store controller by BrowserView identity (WeakMap). Attach prior to initial loadURL, catch its promise. On selection update native reloadHome menu and invoke selected(). Main failure event/promise dedup. Never use broadcast executeJavaScript for recovery.
- [ ] Native menu View reloadHome, translated Recharger/Reload, disabled unless selected Home. Callback revalidates current selection/controller. Language/menu rebuilding must preserve state. Removal/window closure clears stale recovery state; pending callbacks guard liveness.
- [ ] Register homeRenderError once in main process, not inside createPublicationWindow. Authenticate exact sender by Home controller identity; whitelist report fields in main. Preload forwards only same-window postMessage; old Bamboo unaffected. Existing project IPC remains unchanged.
- [ ] Set up logger lazily under userData/logs/home-recovery.log. Attach powerMonitor suspend/resume after ready, log startup versions; no wake reload. Readme: log location, rotation/privacy, manual native menu, limits, verification.
- [ ] Native Electron smoke harness uses installed Electron11 with separate local shell/Home/project BrowserViews. Trigger Home load failure and actual renderer exit in an isolated harness only, choose Recharger through dialog stub, assert shell/project JS sentinels/navigation counts remain stable. Exercise menu and IPC wiring as feasible. Never inject into user's running Studio.
- [ ] Run node regression script, npm test, git diff --check; commit.

## Chunk 2: Bamboo

### Task 3: Adopt PR855 on current master
Files: src/app/App.jsx, src/app/Electron/index.jsx; src/components/ErrorBoundary/{index.jsx,ErrorBoundary.test.jsx}; src/utils/AnalyticsUtils.js and test; src/core/Localization/LocalizedStrings/{en,fr}/error.json; Home route isolation test as warranted.
- [ ] Existing branch posthog-code/react-error-boundary has an in-progress merge of origin/master (clean before start). Resolve src/app/Studio/index.jsx and src/utils/AnalyticsUtils.js to current master first; src/app/Electron/index.jsx likewise, then reapply only Home changes. Restore src/index.jsx to origin/master (drop old root boundary). Preserve old draft authorship/history via merge commit, never rewrite.
- [ ] Write/repair failing tests before implementation: healthy children; Home throwing render displays fallback with button Recharger/Reload; original Error and boundary/component stack reach captureError; each diagnostics channel throwing must not suppress fallback; explicit click reloads current Home only; no reload at mount/failure; integration test starts at /dashboard/ and throws from its initial ProtectedRoute, then checks translated fallback and diagnostic; route tests shell, NewPublication/Data, Studio remain outside boundary. Mock external location.reload via prop/callback rather than redefining jsdom nonconfigurable location.
- [ ] Update adopted class boundary to accept translated strings from Home route parent useIntl (outside boundary). Plain accessible fallback role=alert with existing semantic colors/button class; no new brand illustration. Existing catalogs hold error.home title/message/reload, exact FR Recharger, EN Reload. Button calls only window.location.reload of Home document. Reuse a HomeBoundary wrapper for both App.jsx root-route ProtectedRoute/Navigate and Electron Dashboard catch-all plus its ProtectedRoute. The wrapper resolves strings with useIntl above the class boundary. Do not wrap all of App or alter guards/redirect logic. No project/shell/root boundary or other scope expansion.
- [ ] componentDidCatch: existing Analytics.captureError(error,metadata), structural console report, optional window.postMessage({type:'homeRenderError',data:{boundary:'home',errorName}}). Contain each reporter separately. No error contents in native payload. Analytics.captureError optional properties pass to PostHog only when supplied, preserving old one-argument calls/admin exclusions; leave captureException untouched. Add regression assertion for properties.
- [ ] Run focused Vitest tests, format changed files with existing Prettier, then full yarn test and yarn build; resolve only introduced regressions. Capture screenshot of actual fallback via isolated local fixture/browser, check FR/EN and keyboard accessibility. Report any overnight/real-auth reproduction not performed.
- [ ] Commit merge/adoption and implementation, no push yet.

## Chunk 3: Review and delivery
- [ ] Refactor beat: retain separate log/controller, no generic resilience framework; leave auth/root/bootstrap failure hardening outside this mandate.
- [ ] Independent review scopes: Electron correctness/reliability; Bamboo boundary/analytics correctness; separate cross-repo seam/privacy lens (optional IPC, deployment independence, exact sender and project preservation). Reviewers did not implement. Blind-spot sweep after lenses; validation separate for findings. Fix accepted findings with regression tests and rereview changed scope.
- [ ] Push new codex/home-recovery Electron branch and existing Bamboo draft branch. Create Electron PR, update Bamboo855 title/body to final Home scope. PR sections Summary/Problem/Impact/Evidence/Solution/Repos impacted + merge order, crosslinks, Part of beingenious/Panda.task#1066 except final closing PR. Attach both to chat. Either repo can ship first; full coverage requires both; Electron release versus Bamboo deployment stay human.
- [ ] Invoke pr-review-loop on both current HEADs, collect completed bot review/checks, triage all bot findings, reply disposition, push fixes and repeat; no merge/deploy or human-thread auto replies.
- [ ] Produce dated standalone HTML recap outside repos via explain-diff-html (background/intuition/code/five interactive quiz questions). Final concise FR recap links both PRs, checks, limitations and log location.

## Challenge log
Round1 shape reviewer: ran, no material findings. Codex correctness reviewer: ran, two major findings accepted: initial Home root guard coverage and explicit responsiveness handling/tests. Artifacts revised for round2 before execution. Spec challenge runs separately; draft plan is not authorization to begin code before that gate converges.
Round2: Codex correctness reviewer (same fresh review context resumed) ran, no material findings; fresh-context shape reviewer ran, no material findings. Plan/spec gate converged. Tasks1/2 Electron and Task3 Bamboo are independent implementation scopes after fixing their seam; execute with separate agents under subagent-driven-development, parent owns integration QA and reviews.
