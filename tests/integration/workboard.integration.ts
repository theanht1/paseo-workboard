import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { isolatedGitEnvironment } from "../git-environment";
import { isTemporaryIntegrationHome } from "./temporary-home";
import {
  defaultGroup,
  cardsForStage,
  orderedGroups,
  type Board,
  type Group,
} from "../../shared/model";

const run = promisify(execFile);
const markerName = ".paseo-workboard-integration";
const markerValue = "paseo-workboard-integration-v1";
const pluginId = "paseo-workboard";
const fixtureId = "workboard-fixture";
const root = process.env.WORKBOARD_INTEGRATION_HOME;
let home = "";
// With the test-only clock offset the daemon judges time 40 days ahead, so the Agents these
// tests create (always recent) are old enough to archive. That run executes only the
// end-to-end archive group below; the main group assumes the real clock (see the README).
const offsetRun = Boolean(process.env.WORKBOARD_TEST_CLOCK_OFFSET_MS);
let client: DaemonClient;

type Status = { home: string; listen: string; daemonVersion: string };

async function status(): Promise<Status> {
  const { stdout } = await run("paseo", ["status", "--home", home, "--json"], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as Status;
}
async function rpc<T>(method: string, input: unknown): Promise<T> {
  return (await client.invokePluginRpc(pluginId, method, input)) as T;
}
async function snapshot(): Promise<Board> {
  return await rpc<Board>("workboard.snapshot", {});
}
async function undoNativeArchive(board: Board, workspaceId: string) {
  const card = board.cards.find((item) => item.workspaceId === workspaceId)!;
  const pending = await rpc<Board>("workboard.mutate", {
    action: "undo-archive",
    taskId: card.id,
    updatedAt: card.updatedAt,
    operationId: card.archived!.operationId,
  });
  expect(
    pending.cards.find((item) => item.id === card.id)?.archived?.undo,
  ).toBe("pending");
  const restored = await eventually(
    snapshot,
    (board) =>
      board.cards.find((item) => item.id === card.id)?.archived === null,
    "native recovery did not finish",
  );
  expect(restored.cards.find((item) => item.id === card.id)).toMatchObject({
    archived: null,
    stage: "done",
    autoArchivePaused: true,
    dueAt: null,
    recheckAt: null,
  });
  expect(
    (await client.fetchWorkspaces()).entries.some(
      (item) => item.id === workspaceId,
    ),
  ).toBe(true);
  await client.reloadPlugin(pluginId);
  const restarted = await readyBoard();
  expect(restarted.cards.find((item) => item.id === card.id)).toMatchObject({
    archived: null,
    autoArchivePaused: true,
  });
}
async function updateSettings(
  changes: Partial<Board["settings"]>,
): Promise<Board> {
  const current = await snapshot();
  return await rpc<Board>("workboard.mutate", {
    action: "settings",
    revision: current.revision,
    expectedSettings: current.settings,
    settings: { ...current.settings, ...changes },
  });
}
async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run("git", args, {
    ...(cwd ? { cwd } : {}),
    encoding: "utf8",
    env: isolatedGitEnvironment(path.join(home, "git-templates")),
  });
  return stdout.trim();
}
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return false;
    throw error;
  }
}
async function readyBoard(): Promise<Board> {
  let failure: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const board = await snapshot();
      if (board.connected) return board;
      failure = board.error;
    } catch (error) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Workboard did not become ready: ${String(failure)}`);
}
async function eventually<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  message: string,
): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    last = await read();
    if (matches(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${message}; last=${JSON.stringify(last)}`);
}

beforeAll(async () => {
  if (!root)
    throw new Error("Set WORKBOARD_INTEGRATION_HOME to an isolated Paseo home");
  home = await realpath(root);
  if (!(await isTemporaryIntegrationHome(home))) {
    throw new Error(
      "Integration home must be inside a system temporary directory",
    );
  }
  if (
    (await readFile(path.join(home, markerName), "utf8")).trim() !== markerValue
  )
    throw new Error("Integration marker is missing or invalid");
  if (!(await stat(home)).isDirectory())
    throw new Error("Integration home is not a directory");
  await mkdir(path.join(home, "git-templates"), { recursive: true });

  const daemon = await status();
  if ((await realpath(daemon.home)) !== home)
    throw new Error("paseo status resolved a different home");
  if (!/^127\.0\.0\.1:\d+$/.test(daemon.listen))
    throw new Error("Integration daemon must use a loopback listener");
  if (!daemon.daemonVersion)
    throw new Error("Integration daemon did not report its version");

  client = new DaemonClient({
    url: `ws://${daemon.listen}/ws`,
    clientId: `workboard-integration-${Date.now()}`,
    clientType: "cli",
    appVersion: daemon.daemonVersion,
  });
  await client.connect();
  const plugins = await client.listPlugins();
  // Paseo enforces the manifest's version range before a plugin can run.
  if (
    !plugins.some(
      (plugin) => plugin.id === pluginId && plugin.status === "running",
    )
  )
    throw new Error(`Required isolated plugin is not running: ${pluginId}`);
  if (plugins.some((plugin) => plugin.id === fixtureId))
    await client.removePlugin(fixtureId);
  const fixture = await client.installDirectoryPlugin(
    path.resolve("tests/integration/fixture-provider"),
  );
  if (fixture.status !== "running")
    throw new Error(`Fixture provider did not start: ${fixture.status}`);
  await client.reloadPlugin(pluginId);
  await readyBoard();
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe.skipIf(offsetRun)("isolated Paseo workboard", () => {
  test("synchronizes priority labels without replacing status or unrelated labels", async () => {
    const directory = path.join(
      home,
      "integration-priority",
      String(Date.now()),
    );
    await mkdir(directory, { recursive: true });
    const created = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "Priority example",
    });
    const workspaceId = created.workspace!.id;
    for (const name of ["task:todo", "priority:low", "keep:example"]) {
      await client.setWorkspaceLabel({
        workspaceId,
        label: { name, color: "blue" },
        assigned: true,
      });
    }
    await client.reloadPlugin(pluginId);
    let card = (await readyBoard()).cards.find(
      (c) => c.workspaceId === workspaceId,
    )!;
    expect(card.priority).toBe("p3");
    const changed = await rpc<Board>("workboard.mutate", {
      action: "priority",
      taskId: card.id,
      updatedAt: card.updatedAt,
      priority: "p1",
      expectedLabels: ["priority:low"],
    });
    expect(changed.cards.find((c) => c.id === card.id)?.priority).toBe("p1");
    const labels = (await client.fetchWorkspaces()).entries.find(
      (w) => w.id === workspaceId,
    )!.labels;
    expect([...(labels ?? [])].sort()).toEqual([
      "P1",
      "keep:example",
      "task:todo",
    ]);
    card = changed.cards.find((c) => c.id === card.id)!;
    const toP3 = await rpc<Board>("workboard.mutate", {
      action: "priority",
      taskId: card.id,
      updatedAt: card.updatedAt,
      priority: "p3",
      expectedLabels: ["P1"],
    });
    card = toP3.cards.find((c) => c.id === card.id)!;
    expect(card.priority).toBe("p3");
    expect(card.priorityWrite).toBeNull();
    expect(
      (await client.fetchWorkspaces()).entries
        .find((w) => w.id === workspaceId)!
        .labels?.sort(),
    ).toEqual(["P3", "keep:example", "task:todo"]);
    const backToP1 = await rpc<Board>("workboard.mutate", {
      action: "priority",
      taskId: card.id,
      updatedAt: card.updatedAt,
      priority: "p1",
      expectedLabels: ["P3"],
    });
    card = backToP1.cards.find((c) => c.id === card.id)!;
    expect(card.priority).toBe("p1");
    expect(card.priorityWrite).toBeNull();
    expect(
      (await client.fetchWorkspaces()).entries
        .find((w) => w.id === workspaceId)!
        .labels?.sort(),
    ).toEqual(["P1", "keep:example", "task:todo"]);
    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: "P1", color: "red" },
      assigned: false,
    });
    await client.reloadPlugin(pluginId);
    card = (await readyBoard()).cards.find(
      (c) => c.workspaceId === workspaceId,
    )!;
    expect(card.priority ?? "p2").toBe("p2");
    expect(card.stage).toBe("todo");
  });
  test("materializes explicit P2 and exclusively follows a unique external newcomer", async () => {
    const directory = path.join(
      home,
      "integration-priority-p2",
      String(Date.now()),
    );
    await mkdir(directory, { recursive: true });
    const created = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "Default priority example",
    });
    const workspaceId = created.workspace!.id;
    await client.reloadPlugin(pluginId);
    let card = (await readyBoard()).cards.find(
      (c) => c.workspaceId === workspaceId,
    )!;
    expect(card.priority ?? "p2").toBe("p2");
    expect(
      (await client.fetchWorkspaces()).entries.find((w) => w.id === workspaceId)
        ?.labels ?? [],
    ).toEqual([]);
    await rpc<Board>("workboard.mutate", {
      action: "priority",
      taskId: card.id,
      updatedAt: card.updatedAt,
      priority: "p2",
      expectedLabels: [],
    });
    expect(
      (await client.fetchWorkspaces()).entries.find((w) => w.id === workspaceId)
        ?.labels,
    ).toEqual(["P2"]);
    await client.reloadPlugin(pluginId);
    await readyBoard();
    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: "P0", color: "red" },
      assigned: true,
    });
    await eventually(
      async () =>
        (await client.fetchWorkspaces()).entries.find(
          (w) => w.id === workspaceId,
        )?.labels,
      (labels) => JSON.stringify(labels) === '["P0"]',
      "Unique external P0 should replace P2",
    );
    card = (await snapshot()).cards.find((c) => c.workspaceId === workspaceId)!;
    expect(card.priority).toBe("p0");
    expect(card.priorityWrite).toBeNull();
    expect(card.stage).toBe("inbox");
  });
  test("persists custom groups, follows native labels and deletes only after tasks move out", async () => {
    const initial = await readyBoard();
    const stamp = Date.now();
    const group: Group = {
      id: `group-${stamp}`,
      kind: "review",
      name: "待联调",
      label: `task:integration-${stamp}`,
    };
    const added = await updateSettings({
      groups: [...initial.settings.groups, group],
    });
    const initialOrder = orderedGroups(added.settings).map((item) => item.id);
    const groupOrder = [
      group.id,
      ...initialOrder.filter((id) => id !== group.id),
    ];
    const reordered = await rpc<Board>("workboard.mutate", {
      action: "reorder-groups",
      expectedGroupOrder: initialOrder,
      groupOrder,
    });
    expect(orderedGroups(reordered.settings).map((item) => item.id)).toEqual(
      groupOrder,
    );
    expect(defaultGroup(reordered.settings.groups)).toBe(
      defaultGroup(initial.settings.groups),
    );
    await expect(
      rpc<Board>("workboard.mutate", {
        action: "reorder-groups",
        expectedGroupOrder: initialOrder,
        groupOrder: initialOrder,
      }),
    ).rejects.toThrow("Group order changed");
    const directory = path.join(home, "integration-groups", String(stamp));
    await mkdir(directory, { recursive: true });
    const created = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "integration custom group",
    });
    const workspaceId = created.workspace!.id;
    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: group.label, color: "orange" },
      assigned: true,
    });
    const board = await eventually(
      snapshot,
      (value) =>
        value.cards.some(
          (card) => card.workspaceId === workspaceId && card.stage === group.id,
        ),
      "native custom label was not reflected",
    );
    const card = board.cards.find((item) => item.workspaceId === workspaceId)!;
    await expect(
      updateSettings({ groups: initial.settings.groups }),
    ).rejects.toThrow("group-tasks-in-use");
    await updateSettings({
      groups: [...initial.settings.groups, { ...group, name: "联调中" }],
    });
    await client.reloadPlugin(pluginId);
    const restarted = await readyBoard();
    expect(restarted.settings.groups.at(-1)).toEqual({
      ...group,
      name: "联调中",
    });
    expect(orderedGroups(restarted.settings).map((item) => item.id)).toEqual(
      groupOrder,
    );
    expect(restarted.cards.find((item) => item.id === card.id)?.stage).toBe(
      group.id,
    );
    expect(
      (await client.fetchWorkspaces()).entries.find(
        (item) => item.id === workspaceId,
      )?.labels,
    ).toEqual([group.label]);
    await rpc<Board>("workboard.mutate", {
      action: "stage",
      taskId: card.id,
      stage: "todo",
      expectedLabels: [group.label],
    });
    await updateSettings({ groups: initial.settings.groups });
    await client.reloadPlugin(pluginId);
    const removed = await readyBoard();
    expect(removed.settings.groups).toEqual(initial.settings.groups);
    expect(orderedGroups(removed.settings).map((item) => item.id)).toEqual(
      orderedGroups(initial.settings).map((item) => item.id),
    );
    expect(defaultGroup(removed.settings.groups)).toBe(
      defaultGroup(initial.settings.groups),
    );
    expect(removed.cards.find((item) => item.id === card.id)?.stage).toBe(
      "todo",
    );
    expect(
      (await client.fetchWorkspaces()).entries.find(
        (item) => item.id === workspaceId,
      )?.labels,
    ).toEqual(["task:todo"]);
  });

  test("persists independent colors for same-kind groups without changing task labels", async () => {
    const initial = await readyBoard();
    const stamp = Date.now();
    const first: Group = {
      id: `color-first-${stamp}`,
      kind: "todo",
      name: "颜色一",
      label: `task:color-first-${stamp}`,
    };
    const second: Group = {
      id: `color-second-${stamp}`,
      kind: "todo",
      name: "颜色二",
      label: `task:color-second-${stamp}`,
    };
    let workspaceId: string | undefined;
    let cardId: string | undefined;
    let groupsAdded = false;
    const nativeLabels = async (id: string) => {
      const workspace = (
        await client.fetchWorkspaces({
          filter: { idPrefix: id },
        })
      ).entries.find((item) => item.id === id);
      expect(workspace).toBeDefined();
      return workspace!.labels ?? [];
    };
    try {
      await updateSettings({
        groups: [...initial.settings.groups, first, second],
      });
      groupsAdded = true;
      const directory = path.join(home, "integration-colors", String(stamp));
      await mkdir(directory, { recursive: true });
      const created = await client.createWorkspace({
        source: { kind: "directory", path: directory },
        title: "integration group colors",
      });
      workspaceId = created.workspace?.id;
      if (!workspaceId)
        throw new Error("Paseo did not create the color fixture workspace");
      await client.setWorkspaceLabel({
        workspaceId,
        label: { name: first.label, color: "blue" },
        assigned: true,
      });
      const labeled = await eventually(
        snapshot,
        (board) =>
          board.cards.some(
            (card) =>
              card.workspaceId === workspaceId && card.stage === first.id,
          ),
        "custom group label was not reflected before applying colors",
      );
      cardId = labeled.cards.find(
        (card) => card.workspaceId === workspaceId,
      )?.id;
      expect(cardId).toBeDefined();
      const labelsBeforeColor = await nativeLabels(workspaceId);
      const colored = await updateSettings({
        groups: initial.settings.groups.concat(
          { ...first, color: "violet" },
          { ...second, color: "cyan" },
        ),
      });
      expect(colored.settings.pinInProgressWorkspaces).toBe(
        initial.settings.pinInProgressWorkspaces,
      );
      expect(colored.settings.archiveDoneEnabled).toBe(
        initial.settings.archiveDoneEnabled,
      );
      expect(colored.settings.archiveCanceledEnabled).toBe(
        initial.settings.archiveCanceledEnabled,
      );
      expect(await nativeLabels(workspaceId)).toEqual(labelsBeforeColor);
      const groupOrder = orderedGroups(colored.settings).map(
        (group) => group.id,
      );

      await client.reloadPlugin(pluginId);
      const restarted = await readyBoard();
      expect(
        restarted.settings.groups.find((group) => group.id === first.id),
      ).toEqual({
        ...first,
        color: "violet",
      });
      expect(
        restarted.settings.groups.find((group) => group.id === second.id),
      ).toEqual({
        ...second,
        color: "cyan",
      });
      expect(
        orderedGroups(restarted.settings).map((group) => group.id),
      ).toEqual(groupOrder);
      expect(restarted.settings.pinInProgressWorkspaces).toBe(
        initial.settings.pinInProgressWorkspaces,
      );
      expect(restarted.settings.archiveDoneEnabled).toBe(
        initial.settings.archiveDoneEnabled,
      );
      expect(restarted.settings.archiveCanceledEnabled).toBe(
        initial.settings.archiveCanceledEnabled,
      );
      expect(restarted.cards.find((card) => card.id === cardId)?.stage).toBe(
        first.id,
      );
      expect(await nativeLabels(workspaceId)).toEqual(labelsBeforeColor);
    } finally {
      if (workspaceId)
        await client.setWorkspaceLabel({
          workspaceId,
          label: { name: first.label, color: "blue" },
          assigned: false,
        });
      if (cardId)
        await eventually(
          snapshot,
          (board) =>
            board.cards.some(
              (card) => card.id === cardId && card.stage === "inbox",
            ),
          "color fixture did not leave its custom group",
        );
      if (groupsAdded)
        await updateSettings({ groups: initial.settings.groups });
    }
  });

  test("keeps the in-progress workspace pin preference through a plugin restart", async () => {
    const initial = await readyBoard();
    try {
      const updated = await updateSettings({ pinInProgressWorkspaces: false });
      expect(updated.settings).toEqual({
        ...initial.settings,
        pinInProgressWorkspaces: false,
      });
      await client.reloadPlugin(pluginId);
      expect((await readyBoard()).settings.pinInProgressWorkspaces).toBe(false);
    } finally {
      await updateSettings({
        pinInProgressWorkspaces: initial.settings.pinInProgressWorkspaces,
      });
    }
  });

  test("pins only Workboard-owned in-progress workspaces and clears those pins when disabled", async () => {
    const initial = await readyBoard();
    let manualWorkspaceId: string | undefined;
    const native = async (workspaceId: string) => {
      const workspace = (
        await client.fetchWorkspaces({ filter: { idPrefix: workspaceId } })
      ).entries.find((item) => item.id === workspaceId);
      expect(workspace).toBeDefined();
      return workspace!;
    };
    const create = async (name: string) => {
      const directory = path.join(
        home,
        "integration-pins",
        name,
        String(Date.now()),
      );
      await mkdir(directory, { recursive: true });
      const created = await client.createWorkspace({
        source: { kind: "directory", path: directory },
        title: name,
      });
      if (!created.workspace?.id)
        throw new Error(`Paseo did not create ${name}`);
      return created.workspace.id;
    };
    const setInProgress = async (workspaceId: string, assigned: boolean) => {
      await client.setWorkspaceLabel({
        workspaceId,
        label: { name: "task:in-progress", color: "blue" },
        assigned,
      });
      await eventually(
        snapshot,
        (board) =>
          board.cards.some(
            (card) =>
              card.workspaceId === workspaceId &&
              card.stage === (assigned ? "in-progress" : "inbox"),
          ),
        "Workboard did not reconcile the native stage change",
      );
    };
    try {
      await updateSettings({ pinInProgressWorkspaces: true });
      const ownedWorkspaceId = await create("integration plugin pin");
      await setInProgress(ownedWorkspaceId, true);
      await eventually(
        () => native(ownedWorkspaceId),
        (workspace) => workspace.pinnedAt != null,
        "in-progress workspace was not pinned",
      );
      await client.reloadPlugin(pluginId);
      await readyBoard();
      expect((await native(ownedWorkspaceId)).pinnedAt ?? null).not.toBeNull();
      await setInProgress(ownedWorkspaceId, false);
      await eventually(
        () => native(ownedWorkspaceId),
        (workspace) => (workspace.pinnedAt ?? null) === null,
        "plugin-owned pin was not released after leaving in-progress",
      );

      manualWorkspaceId = await create("integration manual pin");
      expect(
        (await client.setWorkspacePinned(manualWorkspaceId, true)).pinnedAt,
      ).not.toBeNull();
      await setInProgress(manualWorkspaceId, true);
      await eventually(
        () => native(manualWorkspaceId!),
        (workspace) => workspace.pinnedAt != null,
        "manual pin disappeared on entering in-progress",
      );
      await setInProgress(manualWorkspaceId, false);
      await eventually(
        () => native(manualWorkspaceId!),
        (workspace) => workspace.pinnedAt != null,
        "manual pin disappeared on leaving in-progress",
      );

      await setInProgress(ownedWorkspaceId, true);
      await eventually(
        () => native(ownedWorkspaceId),
        (workspace) => workspace.pinnedAt != null,
        "re-entering in-progress did not create a plugin pin",
      );
      await updateSettings({ pinInProgressWorkspaces: false });
      await eventually(
        () => native(ownedWorkspaceId),
        (workspace) => (workspace.pinnedAt ?? null) === null,
        "disabling in-progress pinning did not release the plugin pin",
      );
      const disabledWorkspaceId = await create("integration disabled pin");
      await setInProgress(disabledWorkspaceId, true);
      await eventually(
        snapshot,
        (board) =>
          board.cards.some(
            (card) =>
              card.workspaceId === disabledWorkspaceId &&
              card.stage === "in-progress",
          ),
        "native in-progress label was not reflected while pinning was disabled",
      );
      expect((await native(disabledWorkspaceId)).pinnedAt ?? null).toBeNull();
    } finally {
      if (manualWorkspaceId)
        await client.setWorkspacePinned(manualWorkspaceId, false);
      const current = await readyBoard();
      if (
        current.settings.pinInProgressWorkspaces !==
        initial.settings.pinInProgressWorkspaces
      )
        await updateSettings({
          pinInProgressWorkspaces: initial.settings.pinInProgressWorkspaces,
        });
    }
  });

  test("follows a group master through native storage and plugin reload", async () => {
    const initial = await readyBoard();
    const stamp = Date.now();
    const master = `integration-master-${stamp}`;
    const group: Group = {
      id: `mirrored-${stamp}`,
      kind: "in-progress",
      name: "Mirrored",
      label: `task:mirrored-${stamp}`,
      color: "teal",
    };
    const groups = [...initial.settings.groups, group];
    const groupOrder = [group.id, ...initial.settings.groups.map((g) => g.id)];
    try {
      const following = await rpc<Board>("workboard.mutate", {
        action: "group-sync",
        master,
      });
      expect(following.settings.groupSyncMaster).toBe(master);
      await expect(updateSettings({ groups })).rejects.toThrow(
        "group-sync-follower",
      );
      await expect(
        rpc<Board>("workboard.mutate", {
          action: "sync-groups",
          master: `${master}-other`,
          groups,
          groupOrder,
        }),
      ).rejects.toThrow("group-sync-not-following");
      const mirrored = await rpc<Board>("workboard.mutate", {
        action: "sync-groups",
        master,
        groups,
        groupOrder,
      });
      expect(mirrored.settings.groups).toEqual(groups);
      expect(mirrored.settings.groupOrder).toEqual(groupOrder);
      await client.reloadPlugin(pluginId);
      const reloaded = await readyBoard();
      expect(reloaded.settings.groupSyncMaster).toBe(master);
      expect(reloaded.settings.groups).toEqual(groups);
      expect(reloaded.settings.groupOrder).toEqual(groupOrder);
      const removed = await rpc<Board>("workboard.mutate", {
        action: "sync-groups",
        master,
        groups: initial.settings.groups,
        groupOrder: initial.settings.groupOrder,
      });
      expect(removed.settings.groups).toEqual(initial.settings.groups);
    } finally {
      await rpc<Board>("workboard.mutate", {
        action: "group-sync",
        master: null,
      });
      const current = await snapshot();
      if (current.settings.groups.some((item) => item.id === group.id))
        await updateSettings({ groups: initial.settings.groups });
    }
  });

  test("creates an unbound draft and keeps it through a plugin restart", async () => {
    const initial = await readyBoard();
    const agentCount = (
      await client.fetchAgents({ filter: { includeArchived: true } })
    ).entries.length;
    const title = `integration draft ${Date.now()}`;
    const created = await rpc<Board>("workboard.mutate", {
      action: "create",
      title,
      description: "fixture draft",
      projectId: null,
    });
    const draft = created.cards.find(
      (card) => card.workspaceId === null && card.title === title,
    );
    expect(draft).toBeDefined();
    expect(
      (await client.fetchAgents({ filter: { includeArchived: true } })).entries,
    ).toHaveLength(agentCount);

    await client.reloadPlugin(pluginId);
    await readyBoard();
    const restored = await eventually(
      snapshot,
      (board) => board.cards.some((card) => card.id === draft!.id),
      "draft was not restored after reload",
    );
    expect(
      restored.cards.find((card) => card.id === draft!.id)?.workspaceId,
    ).toBeNull();
    expect(restored.revision).toBeGreaterThanOrEqual(initial.revision);
  });

  test("creates drafts in a requested To do group without creating a native workspace", async () => {
    const initial = await readyBoard();
    const stamp = Date.now();
    const customTodo: Group = {
      id: `draft-todo-${stamp}`,
      kind: "todo",
      name: "草稿待办",
      label: `task:draft-todo-${stamp}`,
    };
    const defaultTodo = defaultGroup(initial.settings.groups);
    const canceled = initial.settings.groups.find(
      (group) => group.kind === "canceled",
    );
    const nonTodo = initial.settings.groups.find(
      (group) => group.kind === "review",
    );
    if (!canceled || !nonTodo)
      throw new Error("Workboard did not provide the required fixture groups");
    const draftIds: string[] = [];
    const draftTitles: string[] = [];
    let customGroupAdded = false;
    try {
      await updateSettings({
        groups: [...initial.settings.groups, customTodo],
      });
      customGroupAdded = true;
      const workspaceIds = (await client.fetchWorkspaces()).entries.map(
        (workspace) => workspace.id,
      );
      const agentIds = (
        await client.fetchAgents({ filter: { includeArchived: true } })
      ).entries.map((entry) => entry.agent.id);

      const customTitle = `integration custom draft ${stamp}`;
      draftTitles.push(customTitle);
      const customCreated = await rpc<Board>("workboard.mutate", {
        action: "create",
        title: customTitle,
        description: "",
        projectId: null,
        stage: customTodo.id,
      });
      const customDraft = customCreated.cards.find(
        (card) => card.workspaceId === null && card.title === customTitle,
      );
      expect(customDraft?.stage).toBe(customTodo.id);
      expect(customDraft?.workspaceId).toBeNull();
      if (!customDraft) throw new Error("Custom To do draft was not created");
      draftIds.push(customDraft.id);

      const defaultTitle = `integration default draft ${stamp}`;
      draftTitles.push(defaultTitle);
      const defaultCreated = await rpc<Board>("workboard.mutate", {
        action: "create",
        title: defaultTitle,
        description: "",
        projectId: null,
      });
      const defaultDraft = defaultCreated.cards.find(
        (card) => card.workspaceId === null && card.title === defaultTitle,
      );
      expect(defaultDraft?.stage).toBe(defaultTodo);
      expect(defaultDraft?.workspaceId).toBeNull();
      if (!defaultDraft) throw new Error("Default To do draft was not created");
      draftIds.push(defaultDraft.id);
      expect(
        (await client.fetchWorkspaces()).entries.map(
          (workspace) => workspace.id,
        ),
      ).toEqual(workspaceIds);
      expect(
        (
          await client.fetchAgents({ filter: { includeArchived: true } })
        ).entries.map((entry) => entry.agent.id),
      ).toEqual(agentIds);

      const beforeRejected = await snapshot();
      for (const stage of [nonTodo.id, `missing-draft-stage-${stamp}`]) {
        const title = `integration rejected draft ${stage}`;
        draftTitles.push(title);
        await expect(
          rpc<Board>("workboard.mutate", {
            action: "create",
            title,
            description: "",
            projectId: null,
            stage,
          }),
        ).rejects.toThrow("Choose a To do group for a new draft");
        const afterRejected = await snapshot();
        expect(afterRejected.revision).toBe(beforeRejected.revision);
        expect(afterRejected.cards).toEqual(beforeRejected.cards);
      }
    } finally {
      const drafts = (await snapshot()).cards.filter(
        (card) =>
          (draftIds.includes(card.id) || draftTitles.includes(card.title)) &&
          !card.archived,
      );
      for (const draft of drafts) {
        const taskId = draft.id;
        await rpc<Board>("workboard.mutate", {
          action: "stage",
          taskId,
          stage: canceled.id,
          expectedLabels: draft.managedLabels,
        });
        await rpc<Board>("workboard.mutate", {
          action: "archive-draft",
          taskId,
        });
      }
      if (customGroupAdded)
        await updateSettings({ groups: initial.settings.groups });
    }
  });

  test("imports a no-agent workspace and reflects native label changes", async () => {
    const directory = path.join(
      home,
      "integration-no-agent",
      String(Date.now()),
    );
    await mkdir(directory, { recursive: true });
    const created = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "integration no-agent",
    });
    const workspaceId = created.workspace?.id;
    if (!workspaceId)
      throw new Error("Paseo did not create the no-agent workspace");

    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: "task:done", color: "emerald" },
      assigned: true,
    });
    const board = await eventually(
      snapshot,
      (value) =>
        value.cards.some(
          (card) => card.workspaceId === workspaceId && card.stage === "done",
        ),
      "native label did not update workboard state",
    );
    const card = board.cards.find((item) => item.workspaceId === workspaceId)!;
    expect(card.stage).toBe("done");
  });

  test("keeps unlabeled native workspaces in Inbox without writing labels while drafts stay in To do", async () => {
    const inbox = (await readyBoard()).settings.groups.find(
      (group) => group.kind === "inbox",
    );
    if (!inbox) throw new Error("Workboard did not provide an Inbox group");
    const directory = path.join(home, "integration-inbox", String(Date.now()));
    await mkdir(directory, { recursive: true });
    const created = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "integration unlabeled inbox",
    });
    const workspaceId = created.workspace?.id;
    if (!workspaceId)
      throw new Error("Paseo did not create the unlabeled workspace");
    const nativeWorkspace = async () => {
      const native = (
        await client.fetchWorkspaces({
          filter: { idPrefix: workspaceId },
        })
      ).entries.find((item) => item.id === workspaceId);
      expect(native).toBeDefined();
      return native!;
    };
    const imported = await eventually(
      snapshot,
      (board) =>
        board.cards.some(
          (card) => card.workspaceId === workspaceId && card.stage === inbox.id,
        ),
      "unlabeled workspace was not placed in Inbox",
    );
    const card = imported.cards.find(
      (item) => item.workspaceId === workspaceId,
    )!;
    expect((await nativeWorkspace()).labels ?? []).toEqual([]);
    const todo = await rpc<Board>("workboard.mutate", {
      action: "stage",
      taskId: card.id,
      stage: "todo",
      expectedLabels: [],
    });
    expect(todo.cards.find((item) => item.id === card.id)?.stage).toBe("todo");
    expect((await nativeWorkspace()).labels ?? []).toEqual(["task:todo"]);
    const inboxStage = await rpc<Board>("workboard.mutate", {
      action: "stage",
      taskId: card.id,
      stage: inbox.id,
      expectedLabels: ["task:todo"],
    });
    expect(inboxStage.cards.find((item) => item.id === card.id)?.stage).toBe(
      inbox.id,
    );
    expect((await nativeWorkspace()).labels ?? []).toEqual([inbox.label]);
    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: inbox.label, color: "indigo" },
      assigned: false,
    });
    await eventually(
      snapshot,
      (board) =>
        board.cards.some(
          (item) => item.id === card.id && item.stage === inbox.id,
        ),
      "removing the native Inbox label did not keep Inbox",
    );
    expect((await nativeWorkspace()).labels ?? []).toEqual([]);
    const title = `integration inbox draft ${Date.now()}`;
    const draftBoard = await rpc<Board>("workboard.mutate", {
      action: "create",
      title,
      description: "",
      projectId: null,
    });
    const draft = draftBoard.cards.find(
      (item) => item.workspaceId === null && item.title === title,
    );
    expect(draft?.stage).toBe("todo");
    await client.reloadPlugin(pluginId);
    const restarted = await readyBoard();
    expect(restarted.cards.find((item) => item.id === draft?.id)?.stage).toBe(
      "todo",
    );
  });

  test("starts a board draft as a workspace and preserves ordinary labels on a stage change", async () => {
    const title = `integration start ${Date.now()}`;
    const created = await rpc<Board>("workboard.mutate", {
      action: "create",
      title,
      description: "",
      projectId: null,
    });
    const draft = created.cards.find(
      (card) => card.workspaceId === null && card.title === title,
    );
    if (!draft)
      throw new Error("Workboard did not create the start fixture draft");
    const directory = path.join(home, "integration-start", String(Date.now()));
    await mkdir(directory, { recursive: true });
    const started = await rpc<Board>("workboard.mutate", {
      action: "start",
      taskId: draft.id,
      target: { kind: "new", source: { kind: "directory", path: directory } },
    });
    const card = started.cards.find((item) => item.id === draft.id);
    if (!card?.workspaceId)
      throw new Error("Workboard did not bind the draft to a workspace");
    expect(card.stage).toBe("in-progress");
    await client.setWorkspaceLabel({
      workspaceId: card.workspaceId,
      label: { name: "ordinary-label", color: "blue" },
      assigned: true,
    });
    const staged = await rpc<Board>("workboard.mutate", {
      action: "stage",
      taskId: card.id,
      stage: "done",
      expectedLabels: card.managedLabels,
    });
    expect(staged.cards.find((item) => item.id === card.id)?.stage).toBe(
      "done",
    );
    const native = await client.fetchWorkspaces();
    expect(
      native.entries.find((item) => item.id === card.workspaceId)?.labels,
    ).toEqual(expect.arrayContaining(["task:done", "ordinary-label"]));
  });

  test("answers an idle fixture conversation from recorded bounds and does not archive it early", async () => {
    const directory = path.join(
      home,
      "integration-archive",
      String(Date.now()),
    );
    await mkdir(directory, { recursive: true });
    const workspace = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "integration old conversation",
    });
    const workspaceId = workspace.workspace?.id;
    if (!workspaceId)
      throw new Error("Paseo did not create the fixture workspace");
    const agent = await client.createAgent({
      provider: fixtureId,
      model: "fixture-model",
      cwd: directory,
      workspaceId,
    });
    const agentId = agent.id;
    // A fresh Agent starts with history:"skip". Refresh reopens the persisted,
    // still-active provider session with history:"replay" without archiving it.
    await client.refreshAgent(agentId);
    const history = await client.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 20,
    });
    expect(
      history.entries
        .filter(
          (entry) =>
            entry.item.type === "user_message" ||
            entry.item.type === "assistant_message",
        )
        .map((entry) => entry.timestamp),
    ).toEqual(["2025-01-02T03:04:05.000Z", "2025-01-02T03:04:06.000Z"]);
    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: "task:done", color: "emerald" },
      assigned: true,
    });

    await updateSettings({
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
    });
    // The fixture replays 2025 history, but the Agent is idle and its record is fresh. A refresh
    // does not read an idle Agent, so the card carries only the recorded bound with its gate
    // unknown, and the workspace is not a recheck candidate for another month.
    const board = await eventually(
      snapshot,
      (current) =>
        current.cards.some(
          (card) =>
            card.workspaceId === workspaceId &&
            card.conversationReason === "child-enumeration-unavailable",
        ),
      "idle fixture conversation was not answered from recorded bounds",
    );
    const card = board.cards.find((item) => item.workspaceId === workspaceId)!;
    expect(card.conversationGateEvidence).toBe("unknown");
    expect(card.conversationDisplayEvidence).not.toBe("exact");
    expect(card.archived).toBeNull();
    expect(card.dueAt).toBeNull();
  });

  test("persists column order through native storage and plugin reload, rejects stale CAS and resets activity order", async () => {
    const initial = await readyBoard();
    const stage = defaultGroup(
      initial.settings.groups,
      initial.settings.defaultDraftGroup,
    );
    const created = await rpc<Board>("workboard.mutate", {
      action: "create",
      title: "integration ordered draft",
      description: "fixture order",
      projectId: null,
      stage,
    });
    const draft = created.cards.find(
      (card) =>
        card.title === "integration ordered draft" && card.workspaceId === null,
    )!;
    const second = await rpc<Board>("workboard.mutate", {
      action: "create",
      title: "integration order neighbor",
      description: "",
      projectId: null,
      stage,
    });
    const expectedOrder = cardsForStage(
      second.cards,
      stage,
      second.cardOrderByStage,
    ).map((card) => card.id);
    const mover =
      expectedOrder[0] !== draft.id
        ? draft
        : second.cards.find(
            (card) =>
              card.workspaceId === null &&
              card.title === "integration order neighbor",
          )!;
    const cardOrder = [
      mover.id,
      ...expectedOrder.filter((id) => id !== mover.id),
    ];
    expect(cardOrder).not.toEqual(expectedOrder);
    const ordered = await rpc<Board>("workboard.mutate", {
      action: "reorder-cards",
      taskId: mover.id,
      stage,
      expectedOrder,
      cardOrder,
    });
    expect(ordered.cardOrderByStage[stage]).toEqual(cardOrder);
    await client.reloadPlugin(pluginId);
    const restored = await readyBoard();
    expect(restored.cardOrderByStage[stage]).toEqual(cardOrder);
    expect(
      cardsForStage(restored.cards, stage, restored.cardOrderByStage).map(
        (card) => card.id,
      ),
    ).toEqual(cardOrder);
    await expect(
      rpc("workboard.mutate", {
        action: "reorder-cards",
        taskId: mover.id,
        stage,
        expectedOrder,
        cardOrder,
      }),
    ).rejects.toThrow("card-order-changed");
    const reset = await rpc<Board>("workboard.mutate", {
      action: "reset-card-order",
      stage,
      expectedOrder: cardOrder,
    });
    expect(Object.hasOwn(reset.cardOrderByStage, stage)).toBe(false);
    expect(
      cardsForStage(reset.cards, stage, reset.cardOrderByStage).map(
        (card) => card.id,
      ),
    ).toEqual(cardsForStage(reset.cards, stage).map((card) => card.id));
    expect(reset.cards.find((card) => card.id === draft.id)).toEqual(
      restored.cards.find((card) => card.id === draft.id),
    );
  });

  test("preserves an archived parent's display time but blocks archiving when children cannot be listed", async () => {
    const directory = path.join(
      home,
      "integration-archived-parent",
      String(Date.now()),
    );
    await mkdir(directory, { recursive: true });
    const workspace = await client.createWorkspace({
      source: { kind: "directory", path: directory },
      title: "integration archived parent",
    });
    const workspaceId = workspace.workspace?.id;
    if (!workspaceId)
      throw new Error("Paseo did not create the archived-parent workspace");
    const agent = await client.createAgent({
      provider: fixtureId,
      model: "fixture-model",
      cwd: directory,
      workspaceId,
    });
    await client.archiveAgent(agent.id);
    const recorded = (
      await client.fetchAgents({ filter: { includeArchived: true } })
    ).entries.find((item) => item.agent.id === agent.id)!.agent;
    const recordedAt = new Date(recorded.updatedAt).toISOString();

    const history = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 20,
    });
    expect(
      history.entries
        .filter(
          (entry) =>
            entry.item.type === "user_message" ||
            entry.item.type === "assistant_message",
        )
        .map((entry) => entry.timestamp),
    ).toEqual(["2025-01-02T03:04:05.000Z", "2025-01-02T03:04:06.000Z"]);
    await client.setWorkspaceLabel({
      workspaceId,
      label: { name: "task:done", color: "emerald" },
      assigned: true,
    });
    await updateSettings({
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
    });
    const observed = await eventually(
      snapshot,
      (board) =>
        board.cards.some(
          (card) =>
            card.workspaceId === workspaceId &&
            card.conversationStatus === "known" &&
            card.conversationDisplayEvidence === "upper-bound" &&
            card.lastConversationAt === recordedAt &&
            card.conversationGateEvidence === "unknown" &&
            card.conversationGateAt === null,
        ),
      "archived parent did not retain its display time with an unknown archive gate",
    );
    const card = observed.cards.find(
      (item) => item.workspaceId === workspaceId,
    )!;
    expect(card.conversationStatus).toBe("known");
    expect(card.conversationDisplayEvidence).toBe("upper-bound");
    expect(card.lastConversationAt).toBe(recordedAt);
    expect(card.conversationGateEvidence).toBe("unknown");
    expect(card.conversationGateAt).toBeNull();
    expect(card.conversationReason).toBe("child-enumeration-unavailable");
    expect(card.dueAt).toBeNull();
    expect(card.archived).toBeNull();
  });

  test("keeps a clean, upstreamed Paseo managed worktree with a recently active idle Agent", async () => {
    await updateSettings({
      archiveDoneEnabled: false,
      archiveCanceledEnabled: false,
    });
    const root = path.join(
      home,
      "integration-managed-worktree",
      String(Date.now()),
    );
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    await mkdir(root, { recursive: true });
    await git(["init", "--bare", remote]);
    await git(["init", "--initial-branch=main", seed]);
    await git(
      ["config", "core.hooksPath", path.join(home, "git-templates")],
      seed,
    );
    const emptyConfig = path.join(home, "git-templates", "disabled-config");
    await git(["config", "core.excludesFile", emptyConfig], seed);
    await git(["config", "core.attributesFile", emptyConfig], seed);
    await git(["config", "core.autocrlf", "false"], seed);
    await git(["config", "commit.gpgsign", "false"], seed);
    await git(["config", "user.name", "Test"], seed);
    await git(["config", "user.email", "test@example.invalid"], seed);
    await writeFile(
      path.join(seed, "README.md"),
      "workboard managed-worktree fixture\n",
      "utf8",
    );
    await git(["add", "README.md"], seed);
    await git(["commit", "-m", "seed fixture"], seed);
    await git(["remote", "add", "origin", remote], seed);
    await git(["push", "-u", "origin", "main"], seed);

    const source = await client.createWorkspace({
      source: { kind: "directory", path: seed },
      title: "integration worktree source",
    });
    const projectId = source.workspace?.projectId;
    if (!projectId) throw new Error("Paseo did not register the seed project");
    const slug = `workboard-managed-${Date.now()}`;
    const created = await client.createPaseoWorktree({
      cwd: seed,
      projectId,
      worktreeSlug: slug,
      action: "branch-off",
      refName: "main",
    });
    const workspace = created.workspace;
    if (!workspace)
      throw new Error(
        `Paseo did not create the managed worktree: ${created.error ?? "unknown error"}`,
      );
    expect(workspace.workspaceKind).toBe("worktree");
    expect(workspace.gitRuntime?.isPaseoOwnedWorktree).toBe(true);
    const worktree = workspace.workspaceDirectory;
    const branch = await git(["branch", "--show-current"], worktree);
    expect(branch).not.toBe("");
    await git(["push", "-u", "origin", branch], worktree);

    const agent = await client.createAgent({
      provider: fixtureId,
      model: "fixture-model",
      cwd: worktree,
      workspaceId: workspace.id,
    });
    await client.refreshAgent(agent.id);
    const history = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 20,
    });
    expect(
      history.entries
        .filter(
          (entry) =>
            entry.item.type === "user_message" ||
            entry.item.type === "assistant_message",
        )
        .map((entry) => entry.timestamp),
    ).toEqual(["2025-01-02T03:04:05.000Z", "2025-01-02T03:04:06.000Z"]);
    const fresh = await eventually(
      () => client.fetchWorkspaces({ filter: { idPrefix: workspace.id } }),
      (result) =>
        result.entries.some(
          (item) =>
            item.id === workspace.id &&
            item.gitRuntime?.isPaseoOwnedWorktree === true,
        ),
      "managed worktree ownership was not present in a fresh native inventory",
    );
    expect(
      fresh.entries.find((item) => item.id === workspace.id)?.gitRuntime
        ?.isPaseoOwnedWorktree,
    ).toBe(true);
    await client.setWorkspaceLabel({
      workspaceId: workspace.id,
      label: { name: "task:done", color: "emerald" },
      assigned: true,
    });
    await updateSettings({
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
    });
    // The idle Agent is not read by a refresh, so the workspace is not due and nothing may
    // archive it or remove its worktree early.
    await eventually(
      snapshot,
      (board) =>
        board.cards.some(
          (card) =>
            card.workspaceId === workspace.id &&
            card.conversationReason === "child-enumeration-unavailable",
        ),
      "managed worktree was not answered from recorded bounds",
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const card = (await snapshot()).cards.find(
      (item) => item.workspaceId === workspace.id,
    )!;
    expect(card.archived).toBeNull();
    expect(
      (await client.fetchWorkspaces()).entries.some(
        (item) => item.id === workspace.id,
      ),
    ).toBe(true);
    expect(await exists(worktree)).toBe(true);
  });
});

describe.runIf(offsetRun)(
  "isolated Paseo workboard with a clock offset",
  () => {
    test.each(["workboard", "native"] as const)(
      "archives an old idle fixture conversation and restores through %s",
      async (recovery) => {
        const directory = path.join(
          home,
          "integration-archive",
          String(Date.now()),
        );
        await mkdir(directory, { recursive: true });
        const workspace = await client.createWorkspace({
          source: { kind: "directory", path: directory },
          title: "integration old conversation",
        });
        const workspaceId = workspace.workspace?.id;
        if (!workspaceId)
          throw new Error("Paseo did not create the fixture workspace");
        const agent = await client.createAgent({
          provider: fixtureId,
          model: "fixture-model",
          cwd: directory,
          workspaceId,
        });
        const agentId = agent.id;
        // A fresh Agent starts with history:"skip". Refresh reopens the persisted,
        // still-active provider session with history:"replay" without archiving it.
        await client.refreshAgent(agentId);
        const history = await client.fetchAgentTimeline(agentId, {
          direction: "tail",
          limit: 20,
        });
        expect(
          history.entries
            .filter(
              (entry) =>
                entry.item.type === "user_message" ||
                entry.item.type === "assistant_message",
            )
            .map((entry) => entry.timestamp),
        ).toEqual(["2025-01-02T03:04:05.000Z", "2025-01-02T03:04:06.000Z"]);
        await client.setWorkspaceLabel({
          workspaceId,
          label: { name: "task:done", color: "emerald" },
          assigned: true,
        });

        await updateSettings({
          archiveDoneEnabled: true,
          archiveCanceledEnabled: true,
        });
        const archived = await eventually(
          snapshot,
          (board) =>
            board.cards.some(
              (card) =>
                card.workspaceId === workspaceId &&
                card.archived?.status === "archived",
            ),
          "old fixture conversation was not archived",
        );
        expect(
          archived.cards.find((card) => card.workspaceId === workspaceId)
            ?.archived?.status,
        ).toBe("archived");
        if (recovery === "workboard") {
          await undoNativeArchive(archived, workspaceId);
        } else {
          await client.restoreWorkspace(workspaceId);
          expect(
            await client.inspectWorkspaceRecovery(workspaceId),
          ).toMatchObject({ kind: "unavailable" });
          const restored = await eventually(
            snapshot,
            (board) =>
              board.cards.find((card) => card.workspaceId === workspaceId)
                ?.archived === null,
            "native restoration did not reconcile",
          );
          expect(
            restored.cards.find((card) => card.workspaceId === workspaceId),
          ).toMatchObject({
            autoArchivePaused: true,
            stage: "done",
            dueAt: null,
          });
          await client.reloadPlugin(pluginId);
          const restarted = await readyBoard();
          expect(
            restarted.cards.find((card) => card.workspaceId === workspaceId),
          ).toMatchObject({ archived: null, autoArchivePaused: true });
        }
      },
    );

    test("archives a managed worktree and restores it through native undo", async () => {
      await updateSettings({
        archiveDoneEnabled: false,
        archiveCanceledEnabled: false,
      });
      const root = path.join(
        home,
        "integration-managed-worktree",
        String(Date.now()),
      );
      const remote = path.join(root, "remote.git");
      const seed = path.join(root, "seed");
      await mkdir(root, { recursive: true });
      await git(["init", "--bare", remote]);
      await git(["init", "--initial-branch=main", seed]);
      await git(
        ["config", "core.hooksPath", path.join(home, "git-templates")],
        seed,
      );
      const emptyConfig = path.join(home, "git-templates", "disabled-config");
      await git(["config", "core.excludesFile", emptyConfig], seed);
      await git(["config", "core.attributesFile", emptyConfig], seed);
      await git(["config", "core.autocrlf", "false"], seed);
      await git(["config", "commit.gpgsign", "false"], seed);
      await git(["config", "user.name", "Test"], seed);
      await git(["config", "user.email", "test@example.invalid"], seed);
      await writeFile(
        path.join(seed, "README.md"),
        "workboard managed-worktree fixture\n",
        "utf8",
      );
      await git(["add", "README.md"], seed);
      await git(["commit", "-m", "seed fixture"], seed);
      await git(["remote", "add", "origin", remote], seed);
      await git(["push", "-u", "origin", "main"], seed);

      const source = await client.createWorkspace({
        source: { kind: "directory", path: seed },
        title: "integration worktree source",
      });
      const projectId = source.workspace?.projectId;
      if (!projectId)
        throw new Error("Paseo did not register the seed project");
      const slug = `workboard-managed-${Date.now()}`;
      const created = await client.createPaseoWorktree({
        cwd: seed,
        projectId,
        worktreeSlug: slug,
        action: "branch-off",
        refName: "main",
      });
      const workspace = created.workspace;
      if (!workspace)
        throw new Error(
          `Paseo did not create the managed worktree: ${created.error ?? "unknown error"}`,
        );
      expect(workspace.workspaceKind).toBe("worktree");
      expect(workspace.gitRuntime?.isPaseoOwnedWorktree).toBe(true);
      const worktree = workspace.workspaceDirectory;
      const branch = await git(["branch", "--show-current"], worktree);
      expect(branch).not.toBe("");
      await git(["push", "-u", "origin", branch], worktree);

      const agent = await client.createAgent({
        provider: fixtureId,
        model: "fixture-model",
        cwd: worktree,
        workspaceId: workspace.id,
      });
      await client.refreshAgent(agent.id);
      const history = await client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 20,
      });
      expect(
        history.entries
          .filter(
            (entry) =>
              entry.item.type === "user_message" ||
              entry.item.type === "assistant_message",
          )
          .map((entry) => entry.timestamp),
      ).toEqual(["2025-01-02T03:04:05.000Z", "2025-01-02T03:04:06.000Z"]);
      const fresh = await eventually(
        () => client.fetchWorkspaces({ filter: { idPrefix: workspace.id } }),
        (result) =>
          result.entries.some(
            (item) =>
              item.id === workspace.id &&
              item.gitRuntime?.isPaseoOwnedWorktree === true,
          ),
        "managed worktree ownership was not present in a fresh native inventory",
      );
      expect(
        fresh.entries.find((item) => item.id === workspace.id)?.gitRuntime
          ?.isPaseoOwnedWorktree,
      ).toBe(true);
      await client.setWorkspaceLabel({
        workspaceId: workspace.id,
        label: { name: "task:done", color: "emerald" },
        assigned: true,
      });
      await updateSettings({
        archiveDoneEnabled: true,
        archiveCanceledEnabled: true,
      });
      const archived = await eventually(
        snapshot,
        (board) =>
          board.cards.some(
            (card) =>
              card.workspaceId === workspace.id &&
              card.archived?.status === "archived",
          ),
        "managed worktree was not automatically archived",
      );
      expect(
        archived.cards.find((card) => card.workspaceId === workspace.id)
          ?.archived?.status,
      ).toBe("archived");
      expect(
        (await client.fetchWorkspaces()).entries.some(
          (item) => item.id === workspace.id,
        ),
      ).toBe(false);
      expect(await exists(worktree)).toBe(false);
      await undoNativeArchive(archived, workspace.id);
      expect(await exists(worktree)).toBe(true);
      expect(
        await readFile(path.join(worktree, "README.md"), "utf8"),
      ).toContain("workboard");
    });
  },
);

describe.runIf(offsetRun && process.env.WORKBOARD_TEST_CLOCK_FILE === "1")(
  "isolated empty-workspace clock",
  () => {
    test("real Agent create/delete resets the waiting period before automatic archive", async () => {
      const day = 86400000;
      const initialOffset = Number(process.env.WORKBOARD_TEST_CLOCK_OFFSET_MS);
      const advance = async (elapsed: number) => {
        await writeFile(
          path.join(home, ".workboard-clock-offset-ms"),
          String(initialOffset + elapsed),
        );
        await eventually(
          snapshot,
          (board) => board.clockOffsetMs === initialOffset + elapsed,
          "clock offset did not reach the snapshot",
        );
      };
      await updateSettings({
        archiveDoneEnabled: false,
        archiveCanceledEnabled: false,
        archiveDoneAfterDays: 1,
      });
      const directory = path.join(
        home,
        "integration-empty",
        String(Date.now()),
      );
      await mkdir(directory, { recursive: true });
      const created = await client.createWorkspace({
        source: { kind: "directory", path: directory },
        title: "integration empty waiting period",
      });
      const workspaceId = created.workspace!.id;
      await client.setWorkspaceLabel({
        workspaceId,
        label: { name: "task:done", color: "emerald" },
        assigned: true,
      });
      const cardOf = (board: Board) =>
        board.cards.find((card) => card.workspaceId === workspaceId);
      const first = await eventually(
        snapshot,
        (board) => cardOf(board)?.conversationGateEvidence === "upper-bound",
        "first empty observation was not recorded",
      );
      const firstBound = cardOf(first)!.conversationGateAt!;
      const witnessDirectory = path.join(
        home,
        "integration-empty-witness",
        String(Date.now()),
      );
      await mkdir(witnessDirectory, { recursive: true });
      const witness = await client.createWorkspace({
        source: { kind: "directory", path: witnessDirectory },
        title: "integration due witness",
      });
      const witnessId = witness.workspace!.id;
      await client.setWorkspaceLabel({
        workspaceId: witnessId,
        label: { name: "task:done", color: "emerald" },
        assigned: true,
      });
      const withWitness = await eventually(
        snapshot,
        (board) =>
          board.cards.some(
            (card) =>
              card.workspaceId === witnessId &&
              card.conversationGateEvidence === "upper-bound",
          ),
        "empty witness was not observed",
      );
      // scan visits stored tasks in this order; the target precedes the due witness.
      expect(
        withWitness.cards.findIndex((card) => card.workspaceId === workspaceId),
      ).toBeLessThan(
        withWitness.cards.findIndex((card) => card.workspaceId === witnessId),
      );
      await advance(day / 2);
      const agent = await client.createAgent({
        provider: fixtureId,
        model: "fixture-model",
        cwd: directory,
        workspaceId,
      });
      await client.sendAgentMessage(agent.id, "fixture hold turn");
      await eventually(
        snapshot,
        (board) => {
          const card = cardOf(board);
          return (
            card !== undefined &&
            card.agents.some(
              (item) => item.id === agent.id && item.activity === "running",
            ) &&
            (card.conversationGateEvidence === "upper-bound" ||
              card.conversationGateEvidence === "exact")
          );
        },
        "live fixture did not establish complete bounded evidence before deletion",
      );
      await client.deleteAgent(agent.id);
      const reset = await eventually(
        snapshot,
        (board) => {
          const card = cardOf(board);
          return (
            card?.agents.length === 0 &&
            card.conversationGateEvidence === "upper-bound" &&
            Date.parse(card.conversationGateAt!) > Date.parse(firstBound)
          );
        },
        "real create/delete did not restart the empty waiting period",
      );
      const resetBound = cardOf(reset)!.conversationGateAt!;
      // The old bound is due; the post-deletion bound still has half a day left.
      await advance(day + 60000);
      const enabled = await updateSettings({ archiveDoneEnabled: true });
      const checked = await eventually(
        snapshot,
        (board) =>
          board.cards.some(
            (card) =>
              card.workspaceId === witnessId &&
              card.archived?.status === "archived",
          ),
        "due witness did not complete the automatic scan",
      );
      expect(cardOf(checked)?.archived).toBeNull();
      expect(cardOf(checked)?.conversationGateAt).toBe(resetBound);
      expect(
        (await client.fetchWorkspaces()).entries.some(
          (item) => item.id === workspaceId,
        ),
      ).toBe(true);
      expect(
        Date.now() + enabled.clockOffsetMs! - Date.parse(firstBound),
      ).toBeGreaterThan(day);
      expect(
        Date.now() + enabled.clockOffsetMs! - Date.parse(resetBound),
      ).toBeLessThan(day);
      await advance(2 * day);
      // A real workspace event triggers Workboard's normal refresh and archive scan.
      await client.setWorkspaceLabel({
        workspaceId,
        label: { name: "integration-clock-advanced", color: "blue" },
        assigned: true,
      });
      const archived = await eventually(
        snapshot,
        (board) => cardOf(board)?.archived?.status === "archived",
        "empty workspace was not automatically archived after its new delay",
      );
      expect(cardOf(archived)?.conversationGateAt).toBe(resetBound);
    });
  },
);
