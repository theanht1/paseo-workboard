# Verification

中文：[中文](zh-CN/verification.md)

This document records the current reproducible evidence for Workboard. It is
not a claim that every Paseo platform, theme, or host integration has been
tested.

## 0.3.2 release candidate (2026-10-23, unpublished)

On macOS arm64 with Node 22.22.2, `check` passed 414 tests in 28 files;
`format:check` and `check:package` passed. The actual tarball has 52 approved
files (3,483,258 bytes), each byte-matching the reviewed source. Its SHA-256 is
`6bd1a8cc49d3815fb03e037e246104d1f58eacd3b18be1d0a82fe6409336edbc`.

The unpacked package, without development dependencies, installed as `running`
and passed all 13 isolated tests on Paseo 0.12.0-beta.3 in 81.60s. The marked
loopback-only daemon was stopped afterward. This metadata-only preparation did
not repeat the visual checks below. The exact minimum host 0.11.0 is unavailable
locally and remains untested. CI, npm installation and registry rendering are
not verified by these local checks. Publication is pending user approval.

## Listing and media update (2026-10-23, unpublished)

The local listing update passed `check` (414 tests in 28 files),
`format:check`, and `check:package` on macOS arm64 with Node 22.22.2.
The source installation passed all 13 isolated integration tests in 77.13s
on Paseo 0.12.0-beta.3. This is separate from the earlier release candidate.

Chrome exercised the English and Chinese board, list, date filter, and
drag-and-undo flow in a marked, loopback-only disposable home. Fictional
workspaces and a deterministic fixture provider supplied the demonstration
data; no model requests or personal task data were used. Today selected four
dated tasks out of seven, excluding the three unbound drafts; clearing the
filter restored all seven. Moving a task to Review and undoing returned it to
In progress. Settings screenshots show the exclusive-label and archive switches
off; these switches were not visually toggled in this pass.

The PNGs are captured UI views. The GIFs sequence actual captured states with
reading pauses (about 12s for filtering and 9s for moving), rather than continuous
screen recordings. All four are below 0.4 MB. The 512px PNG icon was also
inspected at 24, 32, and 64px on light and dark backgrounds.

The local tarball contains 52 approved files, including both overviews and all
listing assets; every packed file matched its source bytes. Installing the
unpacked tarball without development dependencies in the disposable daemon
reported `running`. The icon/media
metadata raises the declared minimum to 0.11.0, but that exact host version was
not available locally and was not tested. This pass does not establish native
mobile, Electron, registry rendering, publication, or compatibility with every
host above the minimum. Version 0.3.1 remains unchanged pending release review.

## 0.3.1 release candidate

On 2026-10-23, the **0.3.1** candidate passed `check`, `format:check` and
`check:package` on macOS arm64 with Node **22.22.2**: **414 unit tests in 28
files**, including label exclusivity and date-range filtering. The actual tarball
contains **37 approved files**, **109,018 bytes**, all matching the reviewed
source byte for byte. Its SHA-256 is
`8f0ba7d44b133414dd280e990d493c4e047b36437721265b33f34f40528e8486`.

The unpacked tarball, without development dependencies, passed **13/13 isolated
integration tests in 64.87s** on Paseo **0.12.0-beta.3** in a fresh marked home.
These are candidate-package checks; npm publication and registry installation
require separate verification. The new settings switch and date filter have not
been exercised in a rendered client during this release check.

## Verified baseline

On 2026-10-13, the dual-view source (still schema v8) was checked on macOS arm64 with
Node 22.22.2 through `mise`.

```sh
mise exec -- npm run check
```

This command passed with **398 unit tests in 28 files**. The deterministic suite
covers migrations from v1–v7 to v8, persistent column order and reset, complete
column compare-and-swap, filtered drag anchors, compact reorder controls,
optimistic failure recovery, archive recovery and evidence, settings safety,
stage undo races, and independent Start work defaults. The dual-view tests add
host-scoped preferences, independent folds, retained quick-create input/errors,
filtered list anchors and scroll offsets, group/task moves, cancellation and
delayed-measurement races, shared ordering, row actions, and latest-move expiry.
Client handler tests use
primitive and host boundaries; they do not prove actual React focus, rendering,
or browser layout.

## Isolated host integration

On 2026-10-13, the dual-view worktree source passed **13/13 isolated integration
tests in 30.69s** on Paseo **0.11.2** in a fresh marked home. The temporary daemon
was stopped. This was a source-directory installation, not a published-package
or rendered-client test; the client-only change adds no RPC or schema migration.

Historically, on 2026-09-28, that source passed **12 isolated integration tests** against
Paseo 0.10.0-beta.1. The published 0.1.0 source had passed the same suite on
Paseo 0.9.1. That run covered custom-group persistence and colors, label-driven
stages, in-progress pin ownership, draft creation and restart, Inbox import
without writing a label, starting a draft, guarded archive behavior, and a
clean managed-worktree archive path.

On 2026-10-08, the final schema-v8 source passed **13/13 isolated integration
tests in 30.88s** against Paseo **0.11.1** in a fresh marked home. This includes
the archived-parent upper-bound contract, fresh worktree ownership, real
sorting RPCs, plugin reload, stale-order rejection, and reset through host
storage. The SDK dependencies remain at 0.10.0-beta.1; this run establishes
the tested fixture behavior on 0.11.1, not a complete SDK migration.

A separate real-host upgrade of existing v7 storage to v8 preserved all
16 fixture tasks and all previous settings and other data exactly. Only the
storage and data schema versions changed, with empty `cardOrderByStage` and
null `defaultStartWorkGroup` added. Both temporary daemons were stopped.

Reproduce it only with the marked temporary-home procedure in
[the integration guide](../tests/integration/README.md). The test fixture is a
deterministic provider: it replays fixture history and never sends a model
request.

## Visual checks

On 2026-10-13, the new List view was exercised in Chrome against Paseo
**0.11.2**, using the isolated home `/tmp/workboard-list-g8eWnC`. The daemon's
bundled web UI was enabled with `features.webUi.enabled`; its root then returned
HTTP 200 and loaded the plugin. The earlier HTTP 404 was from starting the
daemon without the web UI enabled. A browser surface also returned
`net::ERR_BLOCKED_BY_CLIENT` during setup, but that did not describe the final
daemon or Chrome result.

The rendered checks covered repeated same-group task dragging, moving a task into a
collapsed group (including an empty group), the eight-second move undo, group dragging with the resulting
order shared by Board, quick-create text retained across view changes,
independent List and Board folds, filtered counts and empty-result hints, and `Alt+Down` ordering. The 390px layout was
checked in Chinese with the light theme and in English with the dark theme.

This real UI pass found that browser `onLayout.y` values could remain stale
after collapse or reorder. Drag geometry now rebuilds positions from current
group and row order plus measured heights. Two interaction regressions fail
against the old implementation and pass with the fix; they cover a group moved
by collapse and rows moved by reorder without position-only layout events.

To serve the bundled web UI from another isolated local home, enable it and
restart the selected daemon:

```sh
paseo daemon config set features.webUi.enabled true --home /path/to/test-home
paseo daemon restart --home /path/to/test-home
```

Use `paseo daemon start --home /path/to/test-home` instead when the selected
daemon is stopped, then open its configured HTTP address in a local browser.
Long-duration edge autoscroll, `Escape` or blur during an active drag, native
mobile clients, and Electron remain unverified for the new List view.

The checks below predate the List view and remain as historical Board evidence.

The desktop client was manually checked in light and dark themes. A separate
390px narrow-screen check covered the responsive board, group navigation and
collapse, combined filters, quick Todo creation, settings feedback, contextual
hints, and compact keyboard controls.

The language change was checked in a separate Paseo 0.9.1 Web client on
2026-09-24. System Chinese, explicit English, and explicit Simplified Chinese
produced the expected board text. An already-open archive page changed its
labels and dates after the host language changed in another tab, without a
reload. The plugin settings page had no language control, and custom group
names and task titles were preserved.

## Release package checks

On 2026-10-13, the **0.3.0** candidate passed `check`, `format:check` and
`check:package`: **398 unit tests** and **37** approved package files,
**105,807 bytes**. All unpacked files matched the reviewed source byte for byte.
The unpacked tarball, without development dependencies, was installed into a
fresh marked Paseo **0.11.2** home and passed **13/13 integration tests in
31.89s**. Production dependency auditing reported no vulnerabilities; the
unchanged development dependency tree has outstanding audit findings.

The validated tarball's SHA-256 is
`d0b29afd2f8ef3f8517622f75a816e727b3da9e2d12d5e8754efc8ead1a85425`.
These checks establish the release candidate; npm publication, registry
installation and GitHub Actions results require their own verification.

On 2026-10-08, the 0.2.0 candidate passed `check`, `format:check` and
`check:package`: 356 unit tests and 32 approved package files, 92,969 bytes.
All packaged files matched the reviewed source. The actual tarball was
unpacked without development dependencies and installed in a new marked
Paseo 0.11.1 home: all 13 integration tests passed in 29.22s, and the daemon
was stopped. Publication and registry installation require separate checks.

On 2026-09-24, the `0.1.0` npm tarball contained 31 approved runtime and public
documentation files. The unpacked package was installed without `node_modules`
into a new marked, loopback-only Paseo 0.9.1 daemon. The plugin reached
`running`, and all 12 integration tests passed against that installed package.
The temporary daemon was stopped after the run.

A preseeded v4 settings file also migrated to v5 through that real plugin
installation. Its legacy language field was removed while the fixture task,
custom group, and remaining preferences were preserved.

`npm run check:package` passed for the release candidate. Separate disposable
copies confirmed that it rejects an omitted runtime module and an unexpected
file added to the package. Formatting and local documentation links also
passed. The 0.1.0 package was later published to npm. These local checks do not establish the current npm or GitHub Actions status;
Cafe catalog promotion remains separate from npm publication.

## Unverified boundaries

- Native iOS and Android behavior has not been exercised.
- The new List view has not been exercised in Electron.
- Long-duration edge autoscroll and `Escape` or blur during an active drag have
  not been exercised in the rendered UI.
- The Paseo 0.10.0-beta.1 client UI has not been manually checked.
- A real remote PR/MR merge triggering Paseo's native archive has not been
  exercised.
- The checks do not establish behavior for every custom Paseo theme, future
  SDK versions, or all remote MR/PR state transitions.
- Unit and fixture integration coverage do not replace an end-to-end test with
  a real external model or forge service.
- The combined multi-host board and group mirroring are covered by unit tests
  with simulated per-host plugin runtimes. They have not been exercised with two
  real daemons connected to one Paseo client. The per-host plugin runtime model
  they rely on was read from the Paseo 0.11.2 web client bundle, not from a
  public SDK contract.

Before changing the compatibility bridge, repeat the supported-version checks
and add evidence for the affected host behavior. For package validation, run
`mise exec -- npm run check:package`; it validates package contents without
publishing.
