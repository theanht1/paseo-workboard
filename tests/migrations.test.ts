import { expect, it } from "vitest";
import { z } from "zod";
import {
  migrateData,
  InvalidStorageDataError,
  UNSUPPORTED_STORAGE_VERSION_ERROR_CODE,
  UnsupportedStorageVersionError,
} from "../shared/migrations";
import {
  DATA_SCHEMA_VERSION,
  dataSchema,
  DEFAULT_GROUPS,
  DEFAULT_LABELS,
  groupsSchema,
  groupOrderSchema,
  settingsSchema,
  newTask,
  orderedGroups,
} from "../shared/model";
import { mutationSchema } from "../shared/rpc";

/** Paseo persists a migration only when the result is JSON, without undefined values. */
const expectStorable = (data: unknown) =>
  expect(() => z.json().parse(data)).not.toThrow();

it("preserves schema 12 archives and does not infer a recovery intent or pause", () => {
  const task = newTask("task", "Task", "2026-09-01T00:00:00Z");
  const archive = {
    operationId: "archive",
    kind: "automatic",
    status: "archived",
    stage: "done",
    group: null,
    startedAt: task.createdAt,
    archivedAt: task.createdAt,
    lastConversationAt: null,
    detail: "Archived",
  };
  const previous = {
    ...dataSchema.parse({ tasks: [{ ...task, archived: archive }] }),
    schemaVersion: 12,
  };
  const migrated = migrateData(previous, 12);
  expect(migrated.schemaVersion).toBe(DATA_SCHEMA_VERSION);
  expect(migrated.tasks[0].archived).toEqual(archive);
  expect(migrated.tasks[0].autoArchivePaused).toBeUndefined();
  expect(dataSchema.safeParse(previous).success).toBe(false);
});

it("migrates legacy archive gates to independent effective rules without losing delays", () => {
  for (const autoArchive of [false, true])
    for (const archiveDoneEnabled of [false, true])
      for (const archiveCanceledEnabled of [false, true]) {
        const previous = {
          schemaVersion: 8,
          settings: {
            autoArchive,
            archiveDoneEnabled,
            archiveCanceledEnabled,
            archiveAfterDays: 45,
            archiveDoneAfterDays: 12,
            archiveCanceledAfterDays: null,
          },
          tasks: [newTask("idea", "Keep me", "2026-09-23T00:00:00Z")],
          cardOrderByStage: { todo: ["idea"] },
        };
        const migrated = migrateData(previous, 8);
        expect(migrated.settings).toMatchObject({
          archiveDoneEnabled: autoArchive && archiveDoneEnabled,
          archiveCanceledEnabled: autoArchive && archiveCanceledEnabled,
          archiveAfterDays: 45,
          archiveDoneAfterDays: 12,
          archiveCanceledAfterDays: null,
        });
        expect(migrated.settings).not.toHaveProperty("autoArchive");
        expect(migrated.tasks).toEqual(previous.tasks);
        expect(migrated.cardOrderByStage).toEqual(previous.cardOrderByStage);
        expect(migrateData(migrated, migrated.schemaVersion)).toEqual(migrated);
      }
  for (const autoArchive of [false, true]) {
    const migrated = migrateData(
      { schemaVersion: 8, settings: { autoArchive } },
      8,
    );
    expect(migrated.settings.archiveDoneEnabled).toBe(autoArchive);
    expect(migrated.settings.archiveCanceledEnabled).toBe(autoArchive);
  }
  expect(settingsSchema.parse({})).toMatchObject({
    archiveDoneEnabled: false,
    archiveCanceledEnabled: false,
  });
});

it.each(["zh", "en"])(
  "removes the v4 language preference %s while retaining tasks, groups and pin ownership",
  (language) => {
    const settings = {
      ...settingsSchema.parse({
        archiveDoneEnabled: true,
        archiveCanceledEnabled: true,
      }),
      autoArchive: true,
      pinInProgressWorkspaces: false,
      groups: [
        ...DEFAULT_GROUPS,
        {
          id: "ideas",
          kind: "todo",
          name: "Ideas",
          label: "task:ideas",
          color: "violet",
        },
      ],
      groupOrder: ["ideas", "todo"],
    };
    const previous = {
      schemaVersion: 4,
      revision: 7,
      serverId: "fixture-host",
      settings: { ...settings, language },
      tasks: [newTask("draft", "Idea", "2026-09-23T00:00:00Z")],
      autoPins: { "workspace-1": "2026-09-23T00:00:00Z" },
    };
    const migrated = migrateData(previous, 4);
    expect(migrated).toEqual({
      ...previous,
      schemaVersion: DATA_SCHEMA_VERSION,
      exclusiveStatusLabelsPending: false,
      settings: settingsSchema.parse(settings),
      cardOrderByStage: {},
    });
    expect(migrated.settings).not.toHaveProperty("language");
  },
);

it.each([true, false])(
  "migrates the v3 pin preference %s to sidebar pinning without adopting manual pins",
  (value) => {
    const task = newTask("existing", "Existing", "2026-09-24T00:00:00Z");
    const result = migrateData(
      {
        schemaVersion: 3,
        settings: { pinRunningWorkspaces: value, language: "zh" },
        tasks: [task],
      },
      3,
    );
    expect(result.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(result.settings.pinInProgressWorkspaces).toBe(value);
    expect(result.settings).not.toHaveProperty("pinRunningWorkspaces");
    expect(result.settings).not.toHaveProperty("language");
    expect(result.settings.groups).toEqual(DEFAULT_GROUPS);
    expect(result.autoPins).toEqual({});
    expect(result.tasks).toEqual([task]);
  },
);

it("retains implicit defaults when upgrading v1 settings", () => {
  expect(migrateData({ schemaVersion: 1 }, 1).settings.groups).toEqual(
    DEFAULT_GROUPS,
  );
});

it("adds Inbox to v2 without replacing colliding custom groups, labels, order or tasks", () => {
  const groups = [
    ...DEFAULT_GROUPS.filter((group) => group.id !== "inbox"),
    { id: "inbox", kind: "todo", name: "Ideas", label: " TASK:INBOX " },
  ];
  const previous = {
    schemaVersion: 2,
    revision: 9,
    serverId: "fixture-host",
    settings: {
      autoArchive: true,
      pinRunningWorkspaces: false,
      language: "zh",
      groups,
      groupOrder: [
        "review",
        "todo",
        "in-progress",
        "done",
        "canceled",
        "inbox",
      ],
    },
    tasks: [newTask("draft", "Idea", "2026-09-23T00:00:00Z")],
  };
  const result = migrateData(previous, 2);
  expect(result.schemaVersion).toBe(DATA_SCHEMA_VERSION);
  expect(
    result.settings.groups.find((group) => group.kind === "inbox"),
  ).toEqual({
    id: "inbox-2",
    kind: "inbox",
    name: null,
    label: "task:inbox-2",
  });
  expect(
    result.settings.groups.find((group) => group.id === "inbox"),
  ).toMatchObject({ kind: "todo", name: "Ideas", label: "TASK:INBOX" });
  expect(orderedGroups(result.settings).map((group) => group.id)).toEqual([
    "inbox-2",
    "review",
    "todo",
    "in-progress",
    "done",
    "canceled",
    "inbox",
  ]);
  expect(result.tasks).toEqual(previous.tasks);
  expect(result.settings).toMatchObject({
    archiveDoneEnabled: true,
    archiveCanceledEnabled: true,
    pinInProgressWorkspaces: false,
  });
  expect(result.revision).toBe(9);
});

it("migrates v1 settings, task identities, pending binding and archived history without resetting preferences", () => {
  const task = newTask("draft", "Idea", "2026-09-23T00:00:00Z");
  const binding = {
    operationId: "bind-1",
    workspaceId: null,
    target: { kind: "new", source: { kind: "directory", path: "/fixture" } },
  };
  const archived = {
    operationId: "archive-1",
    kind: "automatic",
    status: "archived",
    stage: "done",
    startedAt: "2026-09-22T00:00:00Z",
    archivedAt: "2026-09-22T00:00:01Z",
    lastConversationAt: "2026-08-01T00:00:00Z",
    detail: "Archived",
  };
  const result = migrateData(
    {
      schemaVersion: 1,
      revision: 42,
      serverId: "fixture-host",
      settings: {
        autoArchive: true,
        pinRunningWorkspaces: false,
        language: "en",
        labels: { ...DEFAULT_LABELS, done: "workflow:shipped" },
      },
      tasks: [
        task,
        { ...task, id: "binding", binding },
        {
          ...task,
          id: "finished",
          workspaceId: "workspace-1",
          lastStage: "done",
          archived,
        },
      ],
    },
    1,
  );
  expect(result).toMatchObject({
    schemaVersion: DATA_SCHEMA_VERSION,
    revision: 42,
    serverId: "fixture-host",
    settings: {
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
      pinInProgressWorkspaces: false,
      groupOrder: [],
    },
  });
  expect(result.settings.groups).toEqual(
    DEFAULT_GROUPS.map((group) =>
      group.id === "done" ? { ...group, label: "workflow:shipped" } : group,
    ),
  );
  expect(result.tasks[0]).toEqual(task);
  expect(result.tasks[1].binding).toEqual({ ...binding, stage: "in-progress" });
  expect(result.tasks[2].archived).toEqual({
    ...archived,
    group: { id: "done", kind: "done", name: null, label: "workflow:shipped" },
  });
});

it("rejects unsupported storage and ambiguous legacy mappings instead of replacing data", () => {
  expect(() => migrateData({}, DATA_SCHEMA_VERSION + 1)).toThrow(
    "unsupported-storage-version",
  );
  expect(() => migrateData({ schemaVersion: 2 }, 1)).toThrow();
  expect(() =>
    migrateData(
      { settings: { labels: { ...DEFAULT_LABELS, done: "task:todo" } } },
      1,
    ),
  ).toThrow();
});

it("classifies unsupported versions and unparseable data as deterministic, not transient", () => {
  for (const [values, fromVersion] of [
    [{}, DATA_SCHEMA_VERSION + 1],
    [{ schemaVersion: 2 }, 1],
    [{ settings: { labels: { ...DEFAULT_LABELS, done: "task:todo" } } }, 1],
  ] as const) {
    let caught: unknown;
    try {
      migrateData(values, fromVersion);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(
      fromVersion === DATA_SCHEMA_VERSION + 1
        ? UnsupportedStorageVersionError
        : InvalidStorageDataError,
    );
  }
});

it("preserves the unsupported-version message and stable error code through the wrapper", () => {
  expect(() => migrateData({}, DATA_SCHEMA_VERSION + 1)).toThrow(
    "unsupported-storage-version",
  );
  try {
    migrateData({}, DATA_SCHEMA_VERSION + 1);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedStorageVersionError);
    expect(UNSUPPORTED_STORAGE_VERSION_ERROR_CODE).toBe(
      "unsupported-storage-version",
    );
  }
});

it("splits the v5 conversation status into display and gate evidence", () => {
  const result = migrateData(
    {
      schemaVersion: 5,
      revision: 3,
      serverId: "fixture-host",
      settings: settingsSchema.parse({}),
      tasks: [
        {
          ...newTask("known", "Known", "2026-09-23T00:00:00Z"),
          workspaceId: "w1",
          lastConversationAt: "2026-08-01T00:00:00Z",
          conversationStatus: "known",
          conversationAgents: ["a1", "a1/provider/c1"],
        },
        {
          ...newTask("stale", "Stale", "2026-09-23T00:00:00Z"),
          workspaceId: "w2",
          lastConversationAt: "2026-08-02T00:00:00Z",
          conversationStatus: "unknown",
        },
        {
          ...newTask("empty", "Empty", "2026-09-23T00:00:00Z"),
          workspaceId: "w3",
          conversationStatus: "none",
        },
      ],
    },
    5,
  );
  expect(result.schemaVersion).toBe(DATA_SCHEMA_VERSION);
  expect(result.tasks[0]).toMatchObject({
    conversationDisplayEvidence: "exact",
    conversationGateAt: "2026-08-01T00:00:00Z",
    conversationGateEvidence: "exact",
    // Pre-v6 storage never recorded an observation time for these ids; migration drops them
    // rather than fabricating unverifiable entries that would permanently block the gate.
    conversationAgents: [],
  });
  // A once exact observation stays a lower bound: the real last message may be newer, so it
  // must never gate archiving.
  expect(result.tasks[1]).toMatchObject({
    conversationDisplayEvidence: "lower-bound",
    conversationGateAt: null,
    conversationGateEvidence: "unknown",
  });
  expect(result.tasks[2]).toMatchObject({
    conversationDisplayEvidence: "none",
    conversationGateEvidence: "unknown",
  });
});

it("rejects ambiguous labels or identities and missing default destinations", () => {
  for (const groups of [
    [
      ...DEFAULT_GROUPS,
      { id: "another", kind: "review", name: "Other", label: " TASK:TODO " },
    ],
    [
      ...DEFAULT_GROUPS,
      { id: "todo", kind: "todo", name: "Other", label: "task:another" },
    ],
    [
      ...DEFAULT_GROUPS,
      { id: "conflict", kind: "todo", name: "Other", label: "task:another" },
    ],
    DEFAULT_GROUPS.filter((group) => group.kind !== "todo"),
    DEFAULT_GROUPS.filter((group) => group.kind !== "inbox"),
    [{ id: "todo", kind: "todo", name: " ", label: "task:todo" }],
  ])
    expect(groupsSchema.safeParse(groups).success).toBe(false);
  expect(groupOrderSchema.safeParse(["todo", "todo"]).success).toBe(false);
  expect(
    mutationSchema.safeParse({
      action: "settings",
      revision: 1,
      settings: { language: "en", labels: DEFAULT_LABELS },
    }).success,
  ).toBe(false);
});

it("migrates v6 through the current schema without discarding observed agents, notes or preferences", () => {
  const task = {
    ...newTask("t", "Task", "2026-09-01T00:00:00Z"),
    description: "Keep notes",
    conversationAgents: [
      { id: "null-time", lastObservedAt: null },
      { id: "missing-time" },
      {
        id: "observed",
        lastObservedAt: "2026-08-01T00:00:00Z",
        seenWhileLive: true,
      },
    ],
  };
  const result = migrateData(
    {
      schemaVersion: 6,
      revision: 12,
      settings: { autoArchive: true, pinInProgressWorkspaces: false },
      tasks: [task],
    },
    6,
  );
  expect(result).toMatchObject({
    schemaVersion: DATA_SCHEMA_VERSION,
    revision: 12,
    settings: {
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
      pinInProgressWorkspaces: false,
      archiveAfterDays: 30,
      defaultDraftGroup: null,
      defaultStartGroup: null,
    },
    tasks: [
      {
        id: "t",
        description: "Keep notes",
        mergedDrafts: [],
        conversationAgents: [
          {
            id: "observed",
            lastObservedAt: "2026-08-01T00:00:00Z",
            seenWhileLive: true,
          },
        ],
      },
    ],
  });
});

it("adds a noncolliding canceled group for valid legacy settings that removed all canceled groups", () => {
  const groups = [
    ...DEFAULT_GROUPS.filter((g) => g.kind !== "canceled"),
    {
      id: "canceled",
      kind: "review",
      name: "Custom",
      label: " TASK:CANCELED ",
    },
  ];
  for (const version of [3, 4, 5, 6]) {
    const result = migrateData(
      {
        schemaVersion: version,
        settings: { groups, groupOrder: ["canceled", "todo"] },
      },
      version,
    );
    expect(result.settings.groups.find((g) => g.kind === "canceled")).toEqual({
      id: "canceled-2",
      kind: "canceled",
      name: null,
      label: "task:canceled-2",
    });
    expect(orderedGroups(result.settings).map((g) => g.id)).toEqual([
      "canceled",
      "todo",
      "inbox",
      "in-progress",
      "review",
      "done",
      "canceled-2",
    ]);
    expect(result.settings.groups.find((g) => g.id === "canceled")?.name).toBe(
      "Custom",
    );
  }
});

it("runs the complete v1 to current schema chain with new settings and empty merge records", () => {
  const result = migrateData(
    {
      schemaVersion: 1,
      settings: { autoArchive: true, pinRunningWorkspaces: false },
      tasks: [newTask("legacy", "Legacy", "2026-09-01T00:00:00Z")],
    },
    1,
  );
  expect(result.schemaVersion).toBe(DATA_SCHEMA_VERSION);
  expect(result.settings).toMatchObject({
    archiveAfterDays: 30,
    defaultDraftGroup: null,
    defaultStartGroup: null,
    archiveDoneEnabled: true,
    archiveCanceledEnabled: true,
    pinInProgressWorkspaces: false,
  });
  expect(result.tasks[0]).toMatchObject({ id: "legacy", mergedDrafts: [] });
  expect(result.settings.groups).toEqual(DEFAULT_GROUPS);
});

it("upgrades priority metadata without changing tasks, order, archive rules or pin ownership", () => {
  const previous = {
    schemaVersion: 10,
    exclusiveStatusLabelsPending: true,
    revision: 12,
    serverId: "fixture-host",
    settings: settingsSchema.parse({
      archiveDoneEnabled: true,
      archiveDoneAfterDays: 45,
    }),
    tasks: [newTask("draft", "Existing draft", "2026-09-23T00:00:00Z")],
    cardOrderByStage: { todo: ["draft"] },
    autoPins: { "workspace-1": "2026-09-23T00:00:00Z" },
  };
  const migrated = migrateData(previous, 10);
  expect(migrated).toEqual({ ...previous, schemaVersion: DATA_SCHEMA_VERSION });
  expect(migrated.tasks[0].priority).toBeUndefined();
  expectStorable(migrated);
  expect(migrateData(migrated, DATA_SCHEMA_VERSION)).toEqual(migrated);
});

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
  "migrates every supported storage version %s to the priority-aware schema",
  (version) => {
    const migrated = migrateData({ schemaVersion: version }, version);
    expect(migrated.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expectStorable(migrated);
    expect(migrateData(migrated, DATA_SCHEMA_VERSION)).toEqual(migrated);
    expect(migrated.settings.priorityStyles).toBeUndefined();
  },
);

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
  "defers a missing exclusivity preference from schema %s without overriding saved choices",
  (schemaVersion) => {
    for (const choice of [undefined, false, true]) {
      const migrated = migrateData(
        { schemaVersion, settings: { exclusiveStatusLabels: choice } },
        schemaVersion,
      );
      expect(migrated.exclusiveStatusLabelsPending).toBe(choice === undefined);
      expect(migrated.settings.exclusiveStatusLabels).toBe(choice ?? false);
      expect(migrateData(migrated, DATA_SCHEMA_VERSION)).toEqual(migrated);
    }
  },
);

it.each([9, 10, 11])(
  "converts old priority metadata from schema %s before current validation",
  (schemaVersion) => {
    const previous = dataSchema.parse({
      tasks: [newTask("draft", "Draft", "2026-09-01T00:00:00Z")],
    });
    const old = {
      ...previous,
      schemaVersion,
      tasks: [
        {
          ...previous.tasks[0],
          priority: "high",
          mergedDrafts: [
            {
              draftId: "merged",
              priority: "low",
              title: "Merged",
              description: "",
              mergedAt: "2026-09-01T00:00:00Z",
              appendedText: "Merged",
            },
          ],
        },
      ],
      settings: {
        ...previous.settings,
        priorityStyles: {
          high: { name: "Urgent", color: "violet" },
          normal: { name: "Planned", color: "blue" },
          low: { name: null, color: "gray" },
        },
      },
    };
    const migrated = migrateData(old, schemaVersion);
    expect(migrated.schemaVersion).toBe(13);
    expect(migrated.tasks[0].priority).toBe("p1");
    expect(migrated.tasks[0].mergedDrafts[0].priority).toBe("p3");
    expectStorable(migrated);
    expect(migrated.settings.priorityStyles).toMatchObject({
      p0: { name: null, color: "red" },
      p1: { name: "Urgent", color: "violet" },
      p2: { name: "Planned", color: "blue" },
      p3: { name: null, color: "gray" },
    });
  },
);
