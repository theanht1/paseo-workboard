import { expect, it } from "vitest";
import {
  DEFAULT_GROUPS,
  groupSyncRole,
  newTask,
  sameGroupLayout,
  settingsSchema,
  type Group,
} from "../shared/model";
import { mutationSchema } from "../shared/rpc";
import { fixture, workspace } from "./fixtures";

const blocked: Group = {
  id: "blocked",
  kind: "in-progress",
  name: "Blocked",
  label: "task:blocked",
};
const follower = (groups: Group[] = DEFAULT_GROUPS, extra = {}) =>
  fixture({
    settings: settingsSchema.parse({
      groups,
      groupSyncMaster: "master-host",
      ...extra,
    }),
  });
const sync = (
  groups: Group[],
  groupOrder: string[] = [],
  master = "master-host",
) =>
  mutationSchema.parse({ action: "sync-groups", master, groups, groupOrder });

it("derives each host's role from the shared master designation", () => {
  const settings = settingsSchema.parse({});
  expect(settings.groupSyncMaster).toBeNull();
  expect(groupSyncRole(settings, "a")).toBe("independent");
  expect(groupSyncRole({ groupSyncMaster: "a" }, "a")).toBe("master");
  expect(groupSyncRole({ groupSyncMaster: "a" }, "b")).toBe("follower");
  expect(
    sameGroupLayout(
      { groups: DEFAULT_GROUPS, groupOrder: [] },
      { groups: DEFAULT_GROUPS, groupOrder: ["todo"] },
    ),
  ).toBe(false);
});

it("designates a master only through the group-sync action", async () => {
  const { board } = fixture();
  await board.start();
  try {
    const designated = await board.mutate(
      mutationSchema.parse({ action: "group-sync", master: "fixture-host" }),
    );
    expect(designated.settings.groupSyncMaster).toBe("fixture-host");
    const saved = await board.mutate(
      mutationSchema.parse({
        action: "settings",
        revision: designated.revision,
        settings: {
          ...designated.settings,
          archiveDoneEnabled: true,
          groupSyncMaster: "someone-else",
        },
      }),
    );
    expect(saved.settings.archiveDoneEnabled).toBe(true);
    expect(saved.settings.groupSyncMaster).toBe("fixture-host");
    // A master keeps editing its own groups.
    const edited = await board.mutate(
      mutationSchema.parse({
        action: "settings",
        revision: saved.revision,
        settings: {
          ...saved.settings,
          groups: [...saved.settings.groups, blocked],
        },
      }),
    );
    expect(edited.settings.groups).toContainEqual(blocked);
    const cleared = await board.mutate(
      mutationSchema.parse({ action: "group-sync", master: null }),
    );
    expect(cleared.settings.groupSyncMaster).toBeNull();
  } finally {
    board.dispose();
  }
});

it("locks a follower's groups and order while leaving its other settings editable", async () => {
  const { board } = follower();
  await board.start();
  try {
    const before = board.snapshot();
    await expect(
      board.mutate(
        mutationSchema.parse({
          action: "settings",
          revision: before.revision,
          settings: {
            ...before.settings,
            groups: [...before.settings.groups, blocked],
          },
        }),
      ),
    ).rejects.toThrow("group-sync-follower");
    await expect(
      board.mutate(
        mutationSchema.parse({
          action: "reorder-groups",
          expectedGroupOrder: DEFAULT_GROUPS.map((group) => group.id),
          groupOrder: DEFAULT_GROUPS.map((group) => group.id).reverse(),
        }),
      ),
    ).rejects.toThrow("group-sync-follower");
    const saved = await board.mutate(
      mutationSchema.parse({
        action: "settings",
        revision: board.snapshot().revision,
        settings: { ...before.settings, pinInProgressWorkspaces: false },
      }),
    );
    expect(saved.settings.pinInProgressWorkspaces).toBe(false);
    expect(saved.settings.groups).toEqual(DEFAULT_GROUPS);
  } finally {
    board.dispose();
  }
});

it("mirrors the master's groups and display order, including reordering", async () => {
  const { board, inventory } = follower();
  inventory.workspaces.push(workspace("w", "Task", ["task:review"]));
  await board.start();
  try {
    const groups = [blocked, ...DEFAULT_GROUPS];
    const order = [
      "done",
      "blocked",
      "inbox",
      "todo",
      "in-progress",
      "review",
      "canceled",
    ];
    const mirrored = await board.mutate(sync(groups, order));
    expect(mirrored.settings.groups).toEqual(groups);
    expect(mirrored.settings.groupOrder).toEqual(order);
    expect(mirrored.cards[0].stage).toBe("review");
    const revision = mirrored.revision;
    const again = await board.mutate(sync(groups, order));
    expect(again.revision).toBe(revision);
  } finally {
    board.dispose();
  }
});

it("falls back from defaults that the mirrored groups no longer support", async () => {
  const { board } = follower([...DEFAULT_GROUPS, blocked], {
    defaultStartWorkGroup: "blocked",
    defaultStartGroup: "blocked",
  });
  await board.start();
  try {
    const mirrored = await board.mutate(sync(DEFAULT_GROUPS));
    expect(mirrored.settings.groups).toEqual(DEFAULT_GROUPS);
    expect(mirrored.settings.defaultStartWorkGroup).toBeNull();
    expect(mirrored.settings.defaultStartGroup).toBeNull();
  } finally {
    board.dispose();
  }
});

it("refuses to mirror a deletion that would orphan this host's tasks", async () => {
  const { board, inventory, store } = follower([...DEFAULT_GROUPS, blocked]);
  inventory.workspaces.push(workspace("w", "Task", [blocked.label]));
  await board.start();
  try {
    await expect(board.mutate(sync(DEFAULT_GROUPS))).rejects.toThrow(
      "group-tasks-in-use",
    );
    expect(board.snapshot().settings.groups).toContainEqual(blocked);
    await store.update((data) => {
      data.tasks.push(newTask("draft", "Draft", "2026-09-01T00:00:00Z"));
    });
    const changedKind = DEFAULT_GROUPS.map((group) =>
      group.id === "todo" ? { ...group, kind: "review" as const } : group,
    );
    await expect(
      board.mutate(
        sync([
          ...changedKind,
          { ...blocked, id: "x", label: "x", kind: "todo" },
          blocked,
        ]),
      ),
    ).rejects.toThrow(
      "Move the drafts out before deleting this group or changing its type",
    );
  } finally {
    board.dispose();
  }
});

it("rejects a mirror from a host this board does not follow", async () => {
  const { board } = fixture();
  await board.start();
  try {
    await expect(board.mutate(sync(DEFAULT_GROUPS))).rejects.toThrow(
      "group-sync-not-following",
    );
    await board.mutate(
      mutationSchema.parse({ action: "group-sync", master: "master-host" }),
    );
    await expect(
      board.mutate(sync(DEFAULT_GROUPS, [], "another-host")),
    ).rejects.toThrow("group-sync-not-following");
    await board.mutate(
      mutationSchema.parse({ action: "group-sync", master: "fixture-host" }),
    );
    await expect(
      board.mutate(sync(DEFAULT_GROUPS, [], "fixture-host")),
    ).rejects.toThrow("group-sync-not-following");
  } finally {
    board.dispose();
  }
});

it("pauses only the archive rule whose labels a mirror adds", async () => {
  const { board } = follower(DEFAULT_GROUPS, {
    archiveDoneEnabled: true,
    archiveCanceledEnabled: true,
  });
  await board.start();
  try {
    // Renaming a non-terminal group keeps the terminal labels, so archive stays on.
    const renamed = await board.mutate(
      sync(
        DEFAULT_GROUPS.map((group) =>
          group.id === "review" ? { ...group, name: "QA" } : group,
        ),
      ),
    );
    expect(renamed.settings.archiveDoneEnabled).toBe(true);
    expect(renamed.settings.archiveCanceledEnabled).toBe(true);
    expect(renamed.settings.archivePausedByGroupSync).toBe(false);
    const done = DEFAULT_GROUPS.map((group) =>
      group.id === "review" ? { ...group, kind: "done" as const } : group,
    );
    const paused = await board.mutate(sync(done));
    expect(paused.settings.groups).toEqual(done);
    expect(paused.settings.archiveDoneEnabled).toBe(false);
    expect(paused.settings.archiveCanceledEnabled).toBe(true);
    expect(paused.settings.archivePausedByGroupSync).toBe(true);
    // Saving another preference keeps the notice; turning the rule back on clears it.
    const unrelated = await board.mutate(
      mutationSchema.parse({
        action: "settings",
        revision: paused.revision,
        settings: { ...paused.settings, pinReviewWorkspaces: true },
      }),
    );
    expect(unrelated.settings.archivePausedByGroupSync).toBe(true);
    const resumed = await board.mutate(
      mutationSchema.parse({
        action: "settings",
        revision: unrelated.revision,
        settings: { ...unrelated.settings, archiveDoneEnabled: true },
      }),
    );
    expect(resumed.settings.archiveDoneEnabled).toBe(true);
    expect(resumed.settings.archivePausedByGroupSync).toBe(false);
  } finally {
    board.dispose();
  }
});

it("does not pause archive that was already off", async () => {
  const { board } = follower();
  await board.start();
  try {
    const mirrored = await board.mutate(
      sync(
        DEFAULT_GROUPS.map((group) =>
          group.id === "done" ? { ...group, label: "status:shipped" } : group,
        ),
      ),
    );
    expect(mirrored.settings.archiveDoneEnabled).toBe(false);
    expect(mirrored.settings.archivePausedByGroupSync).toBe(false);
  } finally {
    board.dispose();
  }
});
