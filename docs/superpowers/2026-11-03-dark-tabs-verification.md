# Studio appearance verification

Mandate: beingenious/studio#11. Implementation spans Studio and Bamboo.

## Checks run

- Bamboo: 241 files / 1,974 tests passed (`vitest run --exclude '**/.claude/**'`).
  The exclusion prevents unrelated nested checkouts from being collected; the first
  targeted invocation collected one of those and hit its duplicate React instance.
- Bamboo: four modified files pass Prettier.
- Production Vite bundle passed. The ordinary build first failed on three
  pre-existing dangling public/studio-theme-* links. Verification used a temporary
  public directory linking all valid public entries, leaving the checkout intact.
- Studio: npm test (ESLint), Home recovery assertions and production wiring passed.
  New wiring assertions failed before the native handler existed and passed after.
  The new Tabs preference test likewise failed before the effect existed.
- Native Home recovery smoke passed in Electron 11.5, including actual renderer
  crash recovery while preserving shell/project sentinels.
- Native macOS About observed dark through CUA in a separate Electron 11.5 process
  with isolated userData; no running Studio user projects were changed.

## Rendered color evidence

Actual before/after Tab and StudioLoadingProject components were rendered into
isolated fixtures and checked using the generated production CSS in Electron 11.5
/ Chromium 87.0.4280.141. CSS transitions were disabled for deterministic color
sampling: sampling a newly loaded hidden window during its initial transition
first returned transparent. No application code was changed to accommodate this.
The toolbar fixture uses the authoring StudioTheme.surface contract; this was not
a full live Flash project replay.

| Surface | Before light | After light | Before dark | After dark |
| --- | --- | --- | --- | --- |
| Active document tab | #ffffff | #ffffff | #262b36 | #1f232c |
| Inactive tab | #f3f4f6 | #f3f4f6 | #1f232c | #171a21 |
| Editor toolbar contract | #ffffff | #ffffff | #1f232c | #1f232c |
| Loading ground | #f3f4f6 | #f3f4f6 | #171a21 | #1f232c |

Selected Home uses the same selected surface branch. Selected hover no longer
matches the inactive-only dark hover rule. The local loading dark wrapper remains
in place while a legacy runtime holds its containing document light.

## Independent review and deliberate limits

Approach advisor, spec shape reviewer, plan reviewer and Codex read-only challenge
ran. Accepted inactive-ground/hover corrections and the separate light loading
expectation. Surface reviewer cleared Tab and loader; native seam reviewer cleared
Tabs effect, shell sender/route/value validation, preload and tests. No new theme
tokens, background sampling, custom About, or persistent preferences were needed.

Both repositories can ship in either order. Hosted tab/loading fixes ship with
Bamboo. Native About needs the compatible hosted Tabs page and a released Studio
binary. Old shells ignore the message; old dashboards leave native appearance on
the system default. No merge, release or deployment was performed.
