# Paseo Workboard

[简体中文](README.zh-CN.md)

A task board for [Paseo](https://paseo.sh) workspaces, from quick ideas to completed work.

Workboard brings active workspaces into one board, with one task per workspace. Capture an idea as a draft, create or attach a workspace when you start, and track progress in a board or grouped list. Task status stays under your control; an Agent finishing does **not** mark the task done.

![Workboard with sample tasks in English](images/workboard-en.png)

## Features

- **Workspaces and drafts together.** Existing workspaces appear automatically. Drafts need only a title, with no workspace, directory, or Agent required.
- **Board and list views.** Switch layouts while keeping the same tasks, filters, and ordering. Each view remembers its own collapsed groups.
- **Status linked to workspace labels.** Move a task between groups or change its managed label in Paseo. Both update the same status while preserving unrelated labels. Optional exclusive status labels replace a previous managed label when a new one can be identified.
- **Activity at a glance.** See Agent activity, conversation dates, and PR/MR, CI, and review information supplied by Paseo. Filter by project, activity, PR/MR condition, attention, or last conversation date.
- **A configurable workflow.** Customize groups and their defaults, reorder tasks and groups by dragging or keyboard controls, and optionally pin In progress and Review workspaces in the sidebar.
- **Optional automatic archiving.** Archive eligible completed or canceled workspaces after a configurable delay from their last verified conversation, with activity and Git safety checks. Disabled by default.
- **Multiple hosts on one board.** Combine every connected host running Workboard, writing each change to the host that owns the task. Optionally mirror one master host's groups to the others.

The interface follows Paseo's desktop/Web language and theme, with English and Chinese text and dates.

## See it in action

The same tasks appear in the board and grouped list. Filters are shared; each view remembers its own collapsed groups.

![Grouped list of fictional tasks](images/list-en.png)

The **Filters** panel includes last conversation date. Choose today, the last three calendar days, this week, or this month; tasks without a conversation date do not match a date range.

![Date and activity filters](images/filters-en.png)

![Switching views and filtering fictional tasks](images/views-filter-en.gif)

Move a task to another group to update its managed status label. The recent move can be undone from the toolbar while its brief undo window is open.

![Moving a fictional task and undoing the move](images/move-undo-en.gif)

Group defaults, exclusive status labels, sidebar pinning, and optional automatic archive live in **Settings**.

![Workboard settings](images/settings-en.png)

## Installation

Use Paseo 0.11.0 or later, as required by [paseo-plugin.json](paseo-plugin.json). See [verification](docs/verification.md) for tested hosts and client coverage. Plugins run as trusted, unsandboxed code in the daemon; review the source before installing.

Install from GitHub into the selected Paseo daemon:

```sh
paseo plugin install github:fxbing/paseo-workboard
```

Enable plugins in Paseo, then open **Workboard** from the sidebar.

## Quick start

1. **Find your workspaces.** Active workspaces appear as tasks. With the default settings, workspaces without a managed status label enter **Inbox**; importing them does not write a label.
2. **Capture an idea.** Create a title-only draft. It starts in the configured draft group, **To do** by default, without creating a workspace or Agent.
3. **Start work.** Create a workspace or attach an existing one. Start a conversation from the native workspace when needed; Workboard does not send a prompt for you.
4. **Track progress.** Move tasks between groups using the status menu or drag handle. Use **Settings** to adjust groups, defaults, sidebar pinning, and automatic archiving.

The [user guide](docs/user-guide.md) covers filters, ordering, undo, draft recovery, and settings.

## Documentation

| Guide                                | Contents                                                   |
| ------------------------------------ | ---------------------------------------------------------- |
| [User guide](docs/user-guide.md)     | Task workflow, views, groups, and settings                 |
| [Architecture](docs/architecture.md) | Data ownership, synchronization, and safety checks         |
| [Verification](docs/verification.md) | Tested versions, recorded results, and unverified behavior |
| [Releasing](docs/releasing.md)       | Package validation and release procedure                   |
| [Changelog](CHANGELOG.md)            | Release history                                            |

## Contributing

**Open an issue before opening a pull request**, or join an existing issue covering the same change. Describe the problem or use case and the intended result first. Keep each PR focused and link its issue.

See [CONTRIBUTING.md](CONTRIBUTING.md) for issue and PR contents, local setup, and required checks. AI coding assistants must also follow [AGENTS.md](AGENTS.md); `CLAUDE.md` links to the same instructions.

For development, use the runtime pinned in `mise.toml`:

```sh
mise install
mise exec -- npm ci --ignore-scripts
mise exec -- npm run check
mise exec -- npm run format:check
```

Use the [isolated integration fixture](tests/integration/README.md) for host-level checks and local plugin evaluation.

## Limitations

- Some label and workspace operations use an internal Paseo bridge that reuses the host session and validates responses. The manifest minimum does not guarantee compatibility with every later Paseo release; consult [verification](docs/verification.md) before upgrading.
- Automatic archiving can stop Agents and terminals and may remove a managed worktree. Missing conversation evidence or unsafe state postpones it. Workboard cannot restore a native archive or a removed worktree.
- Labels, archive state, and sidebar pins can change outside Workboard. The host does not expose every atomic operation; uncertain outcomes require manual review instead of destructive retries.
- The multi-host board and group mirroring run in the Paseo client, so they work only while a client with those hosts connected is open. They rely on Paseo loading one plugin client per connected host in a shared JavaScript context, which is not a public SDK contract; see [architecture](docs/architecture.md#multiple-hosts).
- The List view has recorded Chrome checks. Electron, native mobile, long-duration edge autoscroll, and `Escape` or blur during an active drag remain unverified; see the verification guide for the full scope.

## License and acknowledgements

[MIT](LICENSE).

Inspired by [Paseo Thread Board](https://github.com/samgbafa/paseo-thread-board) and [Paseo Kanban](https://github.com/breathi3552/paseo-kanban).
