# User guide

[中文](zh-CN/user-guide.md) · [README](../README.md)

## Task model

An active Paseo workspace is one Workboard task. Imported workspaces that do not have a managed status label go to the configured default group, falling back to the first **Inbox** group when no valid default is configured; import itself does not add a label.

A draft is a task without a workspace. Create it with a title to capture work for later. By default, new drafts and workspaces with an explicit `task:todo` label use **To do**. A draft may move to Inbox without binding. Moving it into another work group asks you to create or attach a workspace.

Task status is a business decision. Agent states such as running, waiting for input, or error are shown separately. Ending an Agent session never marks a task done.

## Work with tasks

### Create and start

Create a draft from either view or the quick-create control in a To do group. Quick-create text and errors remain in memory when you switch views or collapse its group; a successful submission clears that group's text, while a failed one preserves it and marks the collapsed group header. A draft has no workspace, conversation, or Agent until you choose **Start work**. Only the initiating control and its submitting form are locked while submitting; other cards and settings remain usable. Duplicate submissions from the same control are blocked. Concurrent stage or settings changes can reject a request with a localized message. A failed confirmation stays open with an explanation for retry after refreshing. Missing directories, workspaces, Git projects or destination groups are listed above Start.

Start work by creating a new workspace or attaching an existing one. A new workspace keeps the draft title and description. An attached workspace keeps its workspace name; the draft title and description are added to its notes, so it remains one task. When that workspace already has a task, each merged draft is recorded separately. Choose **Restore merged draft** on its card to restore the original ID, title and description as an unbound draft in the current default draft group. Its appended text is removed only when it still matches exactly once. Changed or ambiguous text, an occupied original ID, or an archived surviving task blocks restoration and keeps the merge records. Starting work does not create an Agent or send a message. Start work uses the configured In progress group, falling back to the first In progress group when the setting is unset, missing or has an invalid type. Configure an In progress group if none exists. An existing pending binding keeps its original destination, and an explicit destination from a cross-column move takes precedence over this default.

After a binding fails, retry its original intent or choose **Cancel binding** on the card. Executing or queued bindings cannot be canceled. Cancellation clears only the pending plugin intent and keeps any created or linked workspace. A draft without a workspace can start again; a linked task can change groups.

### Change status

Each group has a managed workspace label. In the default mapping, those labels are:

| Type        | Default label      |
| ----------- | ------------------ |
| Inbox       | `task:inbox`       |
| To do       | `task:todo`        |
| In progress | `task:in-progress` |
| Review      | `task:review`      |
| Done        | `task:done`        |
| Canceled    | `task:canceled`    |

Use the status menu or drag a desktop card by its handle. Moving a bound task updates its managed label; changing that native label also updates the board. Regular labels are retained. If more than one managed status label is present, Workboard reports a conflict and lets you choose one status to resolve it. A successful move between groups highlights the task and shows the most recent move in a toolbar feedback bar for about 8 seconds. **Undo move** remains available there even if the task is filtered out, its group is collapsed, or you switch views; it returns the task to the previous group while retaining ordinary labels. Expiry, a refreshed card change, or a changed/deleted original group type or label removes the entry. Undo verifies the successful move's task timestamp and original group definition at the server; concurrent task, group or native label changes reject it with a message. Conflict resolution has no single previous group to restore and does not offer this undo.

Board dragging starts after 6px, shows a card preview, highlights a target, and autoscrolls near the horizontal edge. Press `Esc`, leave the window, or release outside the board to cancel. Each group initially uses last activity: bound tasks use the last verified conversation, drafts use their last edit, and workspaces with no conversation stay last. Drag within a desktop column to save an order, using the vertical insertion line; the list scrolls near its top or bottom edge. Narrow layouts offer up/down controls and Alt+Up/Down. With filters, the chosen visible neighbor is an anchor: only the selected task moves, while other tasks keep their relative order. A pending reorder locks that column's ordering controls. Concurrent membership/order changes reject the request, clear its preview, and refresh the board. New cards appear at the tail in activity order. A card returning to a column keeps its saved position until another manual reorder compacts that column's current IDs. Use **Restore activity order** in the group menu to reset. Saved order is shared across clients and survives reload. Ordering does not edit task timestamps, labels, pinning, conversation evidence or archive gates; cross-column moves continue to use the status mutation and undo.

For external label changes, **Exclusive status labels** in Settings is optional and off by default. When Paseo adds one new managed status label alongside the task's previously known label, Workboard can identify the new choice and remove the old managed label. Other labels remain. If the previous status is unknown or several additions make the latest choice ambiguous, Workboard keeps the conflict for manual resolution.

![Move a fictional task and undo the move](../images/move-undo-en.gif)

## Use the board and list

On desktop and Web, Workboard follows Paseo's language setting. Chinese and English are supported; other Paseo languages fall back to English. When Paseo follows the system language, Workboard follows the same locale selection. There is no separate plugin language setting. Built-in group names and dates change with the UI; custom group names, task titles and notes stay as entered.

### Read tasks

Cards and list rows show task title, project, activity, and the latest conversation date. Hovering a title underlines it and explains its action: drafts open editing, bound tasks open their workspace. If navigation is unavailable, a message directs you to the Paseo workspace list. A time written as "No earlier than {date}" or "No later than {date}" means Paseo only supports a bound there: the first is the recorded last user message or the oldest rows of a partially replayed window, the second is Paseo's recorded activity. Workboard never shows Paseo's recorded activity as if it were the message time. Expand a card or row for labels, Agents, and a full PR/MR title. When Paseo supplies it, both layouts show PR/MR state, CI result, and review decision using native-style icons. List rows also keep task issues, unavailable PR/MR data, failed CI, requested changes, binding, and overdue archive warnings visible without opening details; row actions open from a separate More actions control. Workboard does not query your forge directly. A merged or closed PR/MR does not change task status.

Cards reserve space for the drag handle only in desktop columns. Actions wrap within narrow cards, use a two-pixel gap, and highlight on hover or keyboard focus. Warning text uses the same size as card metadata.

Needs attention covers waiting, error, and unread activity; label or synchronization conflicts; conversation, archive, Git, terminal, or directory problems that need verification; and an open or draft PR/MR with failed CI or requested changes. Merged, closed, and unavailable PR/MR data never trigger attention from an older CI result. Focus, hover, or tap an explanatory icon for its reason. Touch-opened hints dismiss after about 4 seconds. Hover and focus hints remain until leaving or blurring the control, scrolling, or pressing Escape.

### Filter and adjust the view

Switch between **Board** and **List** in the toolbar. Both layouts use the same task data, group and task order, and filters; each remembers its own collapsed groups on this client and host. Filter by project, text, attention, Agent activity, or PR/MR condition. Filters apply immediately and are saved to the current client and Paseo host after about 300ms without changes; leaving flushes the latest unsaved values. The search clear button clears only text; Clear filters still resets all conditions. Conflicts follow the current filters and have a separate count, outside the column-task N/M totals. Selected filters use the theme accent, and project and stage choices both use Check icons. Empty filtered results can clear the active filters or create a task. A runtime disconnect offers a refresh button to retry.

The List view scrolls vertically through every group, including empty groups. Each group shows matched/total task counts while filtering. Expand or collapse one group, or use Expand all and Collapse all. A collapsed group with matches offers an expand hint; searching does not rewrite its saved collapsed state. Drag a task within a group to an insertion line, or onto another group header or body to move it there. Empty and collapsed groups accept drops without expanding automatically. Drag group handles to reorder groups. The list autoscrolls near its vertical edges; Escape, window blur, a view switch, or a filter change cancels an unfinished drag. Use menu up/down actions or Alt+Up/Down on focused handles when dragging is inconvenient. Disconnected clients can still switch views, filter, and fold groups, but cannot mutate task data.

In the desktop Board, groups can be reordered, resized, collapsed, colored, and located. Pressing a column title opens group options. Drag its title to reorder, or use Alt/Meta+Left/Right Arrow; plain arrows do not commit a reorder. Group reordering has no undo entry yet; move it back manually. Resize handles widen and use the accent color on hover or focus; arrows change width and Home resets it. Column width and collapsed state are local client preferences scoped to the current host. Collapsing only changes the display. A successful card drop into a collapsed group expands it again.

In the Board, the locate-groups button opens a group list. Selecting a desktop group expands it and scrolls to its column; on a narrow layout it selects that group. Only the Board view uses one group at a time on narrow layouts; the List view keeps all groups visible as compact rows. Active filters show a rounded count badge, distinct from the Archive count. In the narrow Board, arrow keys move between groups, and `Home` and `End` jump to the first or last group.

The **Date** filter uses the displayed last conversation time. **Today** starts at local midnight; **Last 3 days** includes today and the two previous calendar days; **This week** starts Monday; **This month** starts on the first. Tasks without a conversation date do not match a date range. Date ranges filter the displayed task list; they do not alter archive eligibility.

![Filters with date range options](../images/filters-en.png)

![Switch between views and apply a date filter](../images/views-filter-en.gif)

The grouped list and Settings screens are shown below with fictional tasks.

![Grouped list](../images/list-en.png)

![Workboard settings](../images/settings-en.png)

## Configure groups

Groups have a name, type, managed label, and display color. Color is purely visual: it does not change labels, task rules, pinning, or archival. Workboard uses the same group color in column headers, card accents, status choices, narrow tabs, and group settings. All ten group colors have independent light and dark palettes. The default color family follows the native stage label color; custom colors remain visual only. Workboard reads the theme surface RGB channels from 3/6/8-digit hex or rgb/rgba (alpha does not select a backing surface). Unrecognized formats use each color's fixed light fallback. New groups recommend an unused color first, then the least-used color.

Keep at least one Inbox, To do and Canceled group. Settings let you select a default To do group for new drafts and a nonterminal default group (Inbox, To do, In progress or Review) for unlabeled workspaces. Done and Canceled cannot be selected, and changing a selected default to a terminal type requires choosing a different default first. Stored terminal defaults safely fall back to Inbox. Unset or deleted destinations fall back to the first To do or Inbox group, respectively. A separate **Default Start work group** setting selects only In progress groups; it does not change unlabeled workspace imports. Before deleting its selected group or changing its type, change this default first. Existing invalid start-work settings remain readable and safely fall back, while saving an invalid selection is refused. Explicit labels still follow their mapping. Deletion reports remaining tasks separately from default destination use: move tasks or change the corresponding default group first. Group edits apply when the dialog saves; general switches and default selections save immediately.

Workboard settings opened inside Paseo's settings panel omit the Back to board entry; settings opened from the board retain it.

Reordering groups changes only their display order. It does not change the default draft destination or which In progress group Start work chooses.

## Use multiple hosts

Each Paseo host runs its own Workboard with its own tasks and settings. When the Paseo client is connected to several hosts that run this Workboard release, the board shows their tasks together. Each card and row then names its host before the project. The **All hosts** toolbar button switches between the combined board and this host only; the choice is remembered per client.

Columns come from the host whose Workboard you opened. A task from another host joins the group with the same group ID. Tasks in groups this board does not have stay hidden, and a notice counts them per host; mirroring groups from one master (below) avoids this. Every change is sent to the host that owns the task: moving, editing, starting work, ordering, undo and archive actions. A workspace cannot move between hosts. The project filter lists projects with the same name on different hosts once and shows their tasks from every host; a project only another host has names that host. New drafts are created on this host, or on the host chosen in the task form, which keeps a project of the same name when you switch hosts; quick create uses the selected project on this host, or else on the host that has it. Starting work on another host's draft lists only that host's projects and workspaces. Drag order within a group is still saved per host; where two hosts share a group, the board remembers your last combined arrangement locally and otherwise interleaves by recent activity.

In **Settings → Hosts**, **Group master** chooses one host whose groups and group order every other host mirrors. Choosing a master writes the choice to every reachable host after a confirmation; choose **None** to let each host manage its groups again. While Paseo is open, each following host compares itself with the master every 30 seconds and right after the master's groups change, then copies the groups and their order. Group colors, names, labels and types all follow the master. A follower keeps its own general settings, defaults and tasks; a default that no longer fits the mirrored groups falls back to the first group of its type. Groups cannot be edited, reordered or deleted on a follower. If a mirror makes more labels count as Done or Canceled, a follower with automatic archive turns it off and explains why in its Settings, because the mirror cannot show the due-task preview a local edit does; review due tasks there before re-enabling it.

A follower refuses a mirror that would delete a group still used by its tasks, or change the type of a group that still holds its drafts, exactly as a local edit would. The Hosts list then shows the reason; move those tasks on that host and the next check succeeds. It also shows when the master is offline, no longer claims the role, or when a host is offline or runs no compatible Workboard. Hosts that were offline keep their earlier choice until you set the master again.

## Archive workspaces

Automatic archival is off by default. If an upgrade has to add a missing Canceled group, it also turns automatic archive off: the new managed label may match an existing workspace. Settings retain an explanation until you re-enable it; review the due-task preview and confirm before enabling when tasks are due. Upgrades that do not add that group retain your archive preference. The switch saves immediately; when tasks are already due, Workboard asks for confirmation before enabling it. Once enabled, Workboard considers only tasks in Done or Canceled groups whose last verified user or assistant conversation is strictly older than the configured delay (30 days by default; enter an integer from 1 to 365 in settings and save), measured against Paseo's recorded activity when the exact message time is unavailable. It does not use a label-change time, task edit time, tool call, or import time as conversation activity, and a displayed `≥` bound is never used to archive.

Before archiving, Workboard defers when no conversation bound can be proven or the workspace has active/waiting Agents, terminals, running scripts, or unsafe or unverified Git state. It never stashes, commits, pushes, or deletes files itself.

An automatic archive uses Paseo's native workspace archive. That can stop Agents and terminals and may remove a managed worktree. Success requires a native response with `error=null` and `archivedAt`, followed by a refresh in which the workspace leaves the native active list. Uncertain outcomes remain visible for manual review and are not blindly retried.

Operation IDs are shown only for uncertain or external archive records. On the **Archive** page, choose **Confirm archived** for an uncertain or external archive to keep its record, or **Restore to board** to clear the record and return the task to its original group. Restoration does not recover a native workspace or directory. If the workspace is absent from the host active list, the task stays visible with a request to verify its native state. Stale requests are rejected; refresh before resolving them. If the original group was deleted, restoration is refused and the archive record is kept until its group configuration is restored.

Deferred automatic checks back off exponentially from one minute to a maximum of one hour. Relevant state changes, including native worktree ownership becoming available, or a different blocking reason found during a check reset the delay. Restart clears the backoff; archive safety requirements remain unchanged.

An unbound draft in a Canceled group can be manually archived from the board. It has no native workspace and does not wait for the automatic archive delay. Choose **Restore to board** in Archive to keep its title and description and return it to the original group. A deleted group or a type that no longer accepts drafts blocks restoration and keeps the record. This does not restore a worktree.

Paseo's native **Archive merged PR workspaces** setting is separate. It follows its own merge observations and safety checks, does not use Workboard’s waiting period, and does not set a Workboard task to Done.

## Pin In progress workspaces

The sidebar-pin setting is enabled by default. It follows the group's **In progress** type, not Agent runtime state. Workboard adds a sidebar pin when a task enters an In progress group and removes only a pin that it can identify as its own when the task leaves.

Manual pins are preserved. If you manually remove an automatic pin while the task remains In progress, Workboard does not force it back during that stay; leaving and re-entering the group can apply it again. Disabling the setting removes Workboard-owned pins and retains manual pins.

The native pin API has no ownership or compare-and-set operation. When an operation is uncertain because of a crash or concurrent native change, Workboard keeps the pin rather than risk removing a manual one.

When stored data has an unsupported version or cannot be parsed, the board shows the reason and stops automatic retries without resetting data. Contact a maintainer to repair it. Transient connection failures still retry automatically.

## Limits and support boundaries

- The plugin manifest sets the minimum Paseo version. Its internal label bridge may require changes later; see [verification](verification.md) for tested hosts.
- Local filters, view choice, separate board/list collapsed groups, and board column widths are stored per client and host; they are not shared task data.
- The combined board and group mirroring run in the Paseo client. Without an open client connected to both hosts, followers do not update.
- Workspace labels and native archive/pin operations can change outside Workboard. The plugin rechecks state where possible, but native APIs do not provide every atomic operation.
- Paseo 0.9.1 refuses the provider-subagent API for archived parents, and its pi provider replays history without per-row timestamps, so Workboard falls back to displayed bounds and defers only when no bound can be proven.
