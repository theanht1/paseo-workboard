# Changelog

中文：[中文](CHANGELOG.zh-CN.md)

All notable changes are documented here.

## Unreleased

- Combine every connected host running Workboard on one board. Cards name their host, every change goes to the host that owns the task, new drafts can target any host, and an **All hosts** toolbar toggle limits the board to this host.
- Add a group master in **Settings → Hosts**: other hosts mirror its groups and order while Paseo is open, lock local group edits, refuse mirrors that would orphan their tasks, pause their automatic archive when a mirror makes more labels terminal, and report their sync state. Stored data stays at schema version 8.

## 0.3.2 — 2026-10-23

- Add a dedicated Workboard icon and packaged English/Chinese plugin overviews for the Paseo directory.
- Refresh bilingual screenshots and add short GIF demonstrations for view switching, date filtering, task moves and undo; clarify settings, data access and limitations in the guides.
- Raise the minimum Paseo version to `>=0.11.0` for icon and media metadata. Users on older hosts must upgrade Paseo before installing this version.
- Validate the exact package file list, icon dimensions and referenced media. Runtime behavior, RPC contracts, storage and SDK versions are unchanged from 0.3.1.

## 0.3.1 — 2026-10-23

- Add optional exclusive status labels: a new status label added outside Workboard replaces the previous one, preserving unrelated labels and leaving ambiguous conflicts for manual resolution. Disabled by default.
- Filter tasks by their last conversation date: today, the last three calendar days, the current week, or the current month. Remember the selection per host.
- Reorganize the READMEs and clarify the issue-first contribution workflow and shared AI instructions.

## 0.3.0 — 2026-10-13

- Add a grouped List view alongside Board, sharing task data, filters and saved order while remembering the selected view and separate collapse preferences per host.
- Support task and group dragging, folded and empty drop targets, and keyboard ordering in the list. Tint the whole group with its assigned color in light and dark themes.
- Keep quick-create text and errors across view changes and collapsed groups, and expose the latest cross-group move undo above both views.
- Show task activity, PR/MR status, attention reasons and actions in responsive rows using the same behavior as board cards.
- Rebuild drag targets after layout changes so folding or reordering groups and tasks does not leave stale drop positions.

## 0.2.0 — 2026-10-08

- Add independent defaults for new drafts, unlabeled workspace imports and Start work, plus a configurable automatic archive delay.
- Persist card order within columns, including filtered drag placement, compact and keyboard controls, conflict detection and reset to activity order.
- Recover uncertain archive records, restore archived drafts, cancel failed bindings and detach merged drafts without restoring deleted worktrees.
- Guard move undo against concurrent task or group changes; retain conversation and Git safety checks while backing off deferred archive scans.
- Improve local mutation feedback, filters, touch hints, keyboard focus, card actions and independent group colors.
- Migrate stored data to schema v8 and stop automatic retries for invalid or unsupported storage. Verify 356 unit tests and 13 isolated host tests on Paseo 0.11.1; current visual interactions remain unverified.

- Save general setting switches immediately so their values survive leaving and reopening Settings, while confirming automatic archive when workspaces are already due.
- Accept Paseo `>=0.9.1` and validate the internal host bridge on 0.10.0-beta.1.
- Align the development SDK and isolated integration suite with Paseo 0.10.0-beta.1.
- Split conversation display evidence from the archive gate: cards keep a time (marking `≥` and `≤` bounds), and Paseo's recorded activity gates archiving only as an upper bound.
- Read conversation time from a bounded timeline window, drop hydration-stamped rows instead of failing a whole workspace, and cache provider child listings per parent activity.

## 0.1.0 — 2026-09-24

- Follow Paseo's desktop language for Chinese/English UI and dates; migrate away from the separate plugin language preference.
- Add a Paseo 0.9.1 Workboard plugin for workspace-backed tasks and unbound
  draft todos.
- Add configurable groups, native workspace-label synchronization, group
  colors, saved desktop layout preferences, and combined board filters.
- Add task activity, MR/PR metadata, attention reasons, accessible compact
  controls, keyboard navigation, and contextual hints.
- Confirm group deletion and draft archiving, and report task saves hidden by active filters.
- Preserve desktop collapse preferences during compact navigation and start each compact group at the top.
- Add optional in-progress sidebar pinning that preserves manually managed
  pins, plus guarded automatic archive handling for eligible terminal tasks.
- Add deterministic unit coverage and an isolated, marked Paseo integration
  suite with a fixture provider that does not request a real model.
