import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  boardSchema,
  newTask,
  settingsSchema,
  type Board,
  type Settings,
} from "../shared/model";
import { strings } from "../client/strings";
import { migrateData } from "../shared/migrations";
import { fixture, workspace, agentEvidence, observed } from "./fixtures";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useRef: <T>(initial: T) => {
      const index = hooks.cursor++;
      if (index >= hooks.values.length)
        hooks.values[index] = { current: initial };
      return hooks.values[index] as { current: T };
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      const values = hooks.values;
      if (index >= hooks.values.length)
        values[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      const setValue = (next: T | ((current: T) => T)) => {
        values[index] =
          typeof next === "function"
            ? (next as (current: T) => T)(values[index] as T)
            : next;
      };
      return [values[index] as T, setValue] as const;
    },
  };
});

vi.mock("@getpaseo/plugin/client", () => ({ useRpc: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => {
  const component = () => null;
  return {
    Icon: component,
    Modal: component,
    ScrollView: component,
    TextInput: component,
    useToast: vi.fn(),
  };
});
vi.mock("@getpaseo/plugin/client/ui", () => {
  const component = () => null;
  return {
    ExternalLink: component,
    SettingsCard: component,
    SettingsAction: component,
    SettingsInput: component,
    SettingsRow: component,
    SettingsSection: component,
    SettingsSelect: component,
    SettingsSwitch: component,
  };
});

import { ArchivePage, TaskCard, SettingsPage } from "../client/WorkboardScreen";

beforeEach(() => {
  hooks.cursor = 0;
  hooks.values = [];
});

function findElement(
  node: ReactNode,
  matches: (element: ReactElement<Record<string, unknown>>) => boolean,
  description: string,
): ReactElement<Record<string, unknown>> {
  if (!node || typeof node !== "object")
    throw new Error(`${description} not found`);
  const element = node as ReactElement<{
    children?: ReactNode;
    [key: string]: unknown;
  }>;
  if (matches(element)) return element;
  const children = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];
  for (const child of children.flat()) {
    try {
      return findElement(child, matches, description);
    } catch {
      // Keep searching siblings.
    }
  }
  throw new Error(`${description} not found`);
}

const findByTestId = (node: ReactNode, testID: string) =>
  findElement(node, (element) => element.props.testID === testID, testID);

const theme = {
  colors: {
    accent: "#000000",
    accentForeground: "#ffffff",
    foreground: "#111111",
    foregroundMuted: "#777777",
    statusDanger: "#cc0000",
    statusWarning: "#aa7700",
    surface0: "#ffffff",
  },
} as never;
const t = strings("zh");

function renderSettings(
  board: Board,
  mutate: Parameters<typeof SettingsPage>[0]["mutate"],
  localized = t,
) {
  hooks.cursor = 0;
  return SettingsPage({
    board,
    t: localized,
    theme,
    disabled: false,
    saving: false,
    mutate,
    onBack: vi.fn(),
  });
}

function board(
  settings = settingsSchema.parse({}),
  cards: Board["cards"] = [],
) {
  return boardSchema.parse({
    revision: 7,
    serverId: "host",
    version: "0.10.0-beta.1",
    connected: true,
    error: null,
    refreshedAt: null,
    settings,
    cards,
    projects: [],
  });
}

it.each([
  ["Done archive", "workboard-auto-archive-done", "archiveDoneEnabled", true],
  [
    "In progress sidebar pinning",
    "workboard-pin-in-progress",
    "pinInProgressWorkspaces",
    false,
  ],
  [
    "Review sidebar pinning",
    "workboard-pin-review",
    "pinReviewWorkspaces",
    true,
  ],
  [
    "exclusive status labels",
    "workboard-exclusive-status-labels",
    "exclusiveStatusLabels",
    false,
  ],
] as const)(
  "persists %s when its switch changes and keeps it after reopening",
  async (_, testID, key, value) => {
    const settings = settingsSchema.parse({
      archiveDoneEnabled: false,
      pinInProgressWorkspaces: true,
    });
    const initial = board(settings);
    const saved = {
      ...initial,
      revision: 8,
      settings: { ...settings, [key]: value },
    };
    const mutate = vi.fn().mockResolvedValue(saved);
    const screen = renderSettings(initial, mutate);

    const toggle = findByTestId(screen, testID);
    await (
      toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
    ).onValueChange(value);

    expect(mutate).toHaveBeenCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, [key]: value },
      },
      key === "archiveDoneEnabled"
        ? "settings:done-archive"
        : key === "exclusiveStatusLabels"
          ? "settings:exclusive"
          : key === "pinReviewWorkspaces"
            ? "settings:pin-review"
            : "settings:pin",
    );
    expect(
      findByTestId(renderSettings(initial, mutate), testID).props.value,
    ).toBe(value);

    hooks.values = [];
    expect(
      findByTestId(renderSettings(saved, mutate), testID).props.value,
    ).toBe(value);
  },
);

it("keeps automatic archive off when saving fails", async () => {
  const initial = board(settingsSchema.parse({ archiveDoneEnabled: false }));
  const mutate = vi.fn().mockResolvedValue(undefined);
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive-done",
  );

  await (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);

  expect(
    findByTestId(renderSettings(initial, mutate), "workboard-auto-archive-done")
      .props.value,
  ).toBe(false);
});

it("adopts a completed save after leaving and reopening while it is pending", async () => {
  const settings = settingsSchema.parse({ archiveDoneEnabled: false });
  const initial = board(settings);
  const saved = {
    ...initial,
    revision: 8,
    settings: { ...settings, archiveDoneEnabled: true },
  };
  let finish!: (result: Board) => void;
  const mutate = vi.fn(
    () =>
      new Promise<Board>((resolve) => {
        finish = resolve;
      }),
  );
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive-done",
  );

  const pending = (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);
  hooks.values = [];
  expect(
    findByTestId(renderSettings(initial, mutate), "workboard-auto-archive-done")
      .props.value,
  ).toBe(false);

  finish(saved);
  await pending;
  expect(
    findByTestId(renderSettings(saved, mutate), "workboard-auto-archive-done")
      .props.value,
  ).toBe(true);
});

it.each(["zh", "en"] as const)(
  "confirms uncertain archives and undoes completed archives with concurrency fields in %s",
  async (language) => {
    const localized = strings(language);
    const test = board(settingsSchema.parse({}), [
      {
        ...newTask("task", "Task", "2026-08-01T00:00:00Z"),
        stage: "done",
        workspaceId: "w",
        labels: [],
        managedLabels: [],
        agents: [],
        changeRequest: null,
        changeRequestUnavailable: false,
        pinState: "none",
        activity: "idle",
        dueAt: null,
        archived: {
          operationId: "archive-op",
          kind: "automatic",
          status: "uncertain",
          stage: "done",
          group: null,
          startedAt: "2026-08-01T00:00:00Z",
          archivedAt: null,
          lastConversationAt: null,
          detail: "Unknown",
        },
      },
    ]);
    const mutate = vi.fn(async () => test);
    for (const [outcome, status] of [
      ["confirm", "uncertain"],
      ["undo", "uncertain"],
      ["undo", "archived"],
    ] as const) {
      hooks.values = [];
      test.cards[0].archived!.status = status;
      const render = () => {
        hooks.cursor = 0;
        return ArchivePage({
          board: test,
          cards: test.cards,
          t: localized,
          theme,
          disabled: false,
          mutate,
          onBack: vi.fn(),
        });
      };
      const label =
        outcome === "confirm"
          ? localized.confirmArchived
          : localized.undoArchive;
      if (status === "uncertain") {
        const tab = findElement(
          render(),
          (node) =>
            node.props.accessibilityLabel ===
            `${localized.archiveNeedsReview} (1)`,
          "needs review",
        );
        (tab.props.onPress as () => void)();
      }
      const entry = findElement(
        render(),
        (node) => node.props.children === label,
        label,
      );
      expect(entry.props.children).toBe(label);
      const button = findElement(
        render(),
        (node) =>
          node.props.accessibilityRole === "button" &&
          typeof node.props.onPress === "function" &&
          (node.props.children as ReactElement<{ children?: ReactNode }>)?.props
            ?.children === label,
        label,
      );
      (button.props.onPress as () => void)();
      const confirmation = findElement(
        render(),
        (node) => node.props.confirmLabel === label,
        "confirmation",
      );
      await (confirmation.props.onConfirm as () => Promise<boolean>)();
      expect(mutate).toHaveBeenLastCalledWith({
        ...(outcome === "undo"
          ? { action: "undo-archive" }
          : { action: "resolve-archive", outcome }),
        taskId: "task",
        operationId: "archive-op",
        updatedAt: test.cards[0].updatedAt,
      });
    }
  },
);

it("offers cancel binding on a card and respects disabled writes", () => {
  const test = board(settingsSchema.parse({}), [
    {
      ...newTask("task", "Task", "2026-08-01T00:00:00Z"),
      stage: "todo",
      labels: [],
      managedLabels: [],
      agents: [],
      changeRequest: null,
      changeRequestUnavailable: false,
      pinState: "none",
      activity: "idle",
      dueAt: null,
      binding: {
        operationId: "binding-op",
        workspaceId: null,
        stage: "in-progress",
        target: { kind: "existing", workspaceId: "w" },
      },
    },
  ]);
  const cancel = vi.fn();
  for (const disabled of [false, true]) {
    hooks.cursor = 0;
    const tree = TaskCard({
      card: test.cards[0],
      board: test,
      t,
      theme,
      disabled,
      pending: false,
      onOpen: vi.fn(),
      onEdit: vi.fn(),
      onStart: vi.fn(),
      onStatus: vi.fn(),
      onArchive: vi.fn(),
      onCancelBinding: cancel,
      onDetachDraft: vi.fn(),
    });
    const button = findElement(
      tree,
      (node) => node.props.accessibilityLabel === t.cancelBinding,
      "cancel binding",
    );
    expect(button.props.disabled).toBe(disabled);
    if (!disabled) (button.props.onPress as () => void)();
  }
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each(["zh", "en"] as const)(
  "saves independent archive rules and both default destinations in %s",
  async (language) => {
    const localized = strings(language);
    const settings = settingsSchema.parse({
      archiveAfterDays: 14,
      archiveCanceledAfterDays: 7,
      archiveDoneAfterDays: 90,
      archiveCanceledEnabled: true,
      archiveDoneEnabled: false,
    });
    const initial = board(settings);
    const mutate = vi.fn(async (input) => ({
      ...initial,
      revision: 8,
      settings: input.settings,
    }));
    const render = () => {
      hooks.cursor = 0;
      return SettingsPage({
        board: initial,
        t: localized,
        theme,
        disabled: false,
        saving: false,
        mutate,
        onBack: vi.fn(),
      });
    };
    expect(
      findByTestId(render(), "workboard-auto-archive-canceled").props.hint,
    ).toContain(localized.archiveRuleHint.replace("{days}", "7"));
    expect(
      findByTestId(render(), "workboard-auto-archive-done").props.hint,
    ).toBeUndefined();
    expect(
      findByTestId(render(), "workboard-auto-archive-done").props.value,
    ).toBe(false);
    const input = findByTestId(render(), "workboard-archive-canceled-days");
    expect(input.props.value).toBe("7");
    (input.props.onChangeText as (value: string) => void)("0");
    expect(
      findByTestId(render(), "workboard-save-archive-canceled-days").props
        .disabled,
    ).toBe(true);
    (input.props.onChangeText as (value: string) => void)("21");
    await (
      findByTestId(render(), "workboard-save-archive-canceled-days").props
        .onPress as () => Promise<void>
    )();
    expect(mutate).toHaveBeenLastCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, archiveCanceledAfterDays: 21 },
      },
      "settings:canceled-archive-days",
    );
    for (const [testID, key, value] of [
      ["workboard-default-draft", "defaultDraftGroup", "todo"],
      ["workboard-default-workspace", "defaultStartGroup", "review"],
    ] as const) {
      const before = mutate.mock.results.at(-1)
        ? (await mutate.mock.results.at(-1)!.value).settings
        : settings;
      await (
        findByTestId(render(), testID).props.onValueChange as (
          value: string,
        ) => Promise<void>
      )(value);
      expect(mutate).toHaveBeenLastCalledWith(
        {
          action: "settings",
          revision: 8,
          expectedSettings: before,
          settings: { ...before, [key]: value },
        },
        key === "defaultDraftGroup"
          ? "settings:draft-default"
          : "settings:workspace-default",
      );
    }
    for (const kind of ["done", "canceled"] as const) {
      expect(localized.groupTypeHints[kind]).not.toContain("{days}");
    }
  },
);

it.each(["zh", "en"] as const)(
  "enables and disables Done and Canceled archive rules independently in %s",
  async (language) => {
    const localized = strings(language);
    const settings = settingsSchema.parse({
      archiveCanceledEnabled: true,
      archiveDoneEnabled: false,
    });
    const initial = board(settings);
    const saved = {
      ...initial,
      revision: 8,
      settings: { ...settings, archiveDoneEnabled: true },
    };
    const mutate = vi.fn().mockResolvedValue(saved);
    const toggle = findByTestId(
      SettingsPage({
        board: initial,
        t: localized,
        theme,
        disabled: false,
        saving: false,
        mutate,
        onBack: vi.fn(),
      }),
      "workboard-auto-archive-done",
    );

    await (
      toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
    ).onValueChange(true);

    expect(mutate).toHaveBeenCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, archiveDoneEnabled: true },
      },
      "settings:done-archive",
    );
  },
);

it("offers only restoration for an archived draft and sends its concurrency fields", async () => {
  const test = board(settingsSchema.parse({}), []);
  const task = {
    ...newTask("draft", "Draft", "2026-09-01T00:00:00Z", "canceled"),
    archived: {
      operationId: "archive-draft",
      kind: "draft",
      status: "archived",
      stage: "canceled",
      group: null,
      startedAt: "2026-09-01T00:00:00Z",
      archivedAt: "2026-09-01T00:00:00Z",
      lastConversationAt: null,
      detail: "Archived draft",
    },
    stage: "canceled",
    labels: [],
    managedLabels: [],
    agents: [],
    changeRequest: null,
    changeRequestUnavailable: false,
    pinState: "none",
    activity: "idle",
    dueAt: null,
  };
  test.cards = boardSchema.shape.cards.parse([task]);
  const mutate = vi.fn(async () => test);
  const render = () => {
    hooks.cursor = 0;
    return ArchivePage({
      board: test,
      cards: test.cards,
      draftsOnly: true,
      t,
      theme,
      disabled: false,
      mutate,
      onBack: vi.fn(),
    });
  };
  const button = findElement(
    render(),
    (node) =>
      node.props.accessibilityRole === "button" &&
      (node.props.children as ReactElement<{ children?: ReactNode }>)?.props
        ?.children === t.restoreTask,
    "restore draft",
  );
  expect(() =>
    findElement(
      render(),
      (node) => node.props.children === t.confirmArchived,
      "confirm archive",
    ),
  ).toThrow();
  (button.props.onPress as () => void)();
  const confirmation = findElement(
    render(),
    (node) => node.props.confirmLabel === t.restoreTask,
    "restore confirmation",
  );
  await (confirmation.props.onConfirm as () => Promise<boolean>)();
  expect(mutate).toHaveBeenCalledWith({
    action: "resolve-archive",
    taskId: "draft",
    operationId: "archive-draft",
    updatedAt: task.updatedAt,
    outcome: "restore",
  });
});

it("offers a separate detach entry for each merged source on the card", () => {
  const source = (draftId: string) => ({
    draftId,
    title: draftId,
    description: "Plan",
    mergedAt: "2026-09-01T00:00:00Z",
    appendedText: `\n\n[${draftId}]\nPlan`,
  });
  const test = board(settingsSchema.parse({}), []);
  test.cards = boardSchema.shape.cards.parse([
    {
      ...newTask("task", "Task", "2026-09-01T00:00:00Z"),
      workspaceId: "w",
      mergedDrafts: [source("one"), source("two")],
      stage: "todo",
      labels: [],
      managedLabels: [],
      agents: [],
      changeRequest: null,
      changeRequestUnavailable: false,
      pinState: "none",
      activity: "idle",
      dueAt: null,
    },
  ]);
  const detach = vi.fn();
  const tree = TaskCard({
    card: test.cards[0],
    board: test,
    t,
    theme,
    disabled: false,
    pending: false,
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onStart: vi.fn(),
    onStatus: vi.fn(),
    onArchive: vi.fn(),
    onCancelBinding: vi.fn(),
    onDetachDraft: detach,
  });
  for (const id of ["one", "two"])
    (
      findElement(
        tree,
        (node) => node.props.accessibilityLabel === `${t.detachDraft}: ${id}`,
        id,
      ).props.onPress as () => void
    )();
  expect(detach.mock.calls).toEqual([["one"], ["two"]]);
});

it("excludes terminal default destinations and displays safe fallback for an existing terminal choice", () => {
  const initial = board(settingsSchema.parse({ defaultStartGroup: "done" }));
  const select = findByTestId(
    renderSettings(initial, vi.fn()),
    "workboard-default-workspace",
  );
  expect(select.props.value).toBe("");
  expect(
    (select.props.options as Array<{ value: string }>).map(
      (option) => option.value,
    ),
  ).toEqual(["", "inbox", "todo", "in-progress", "review"]);
});

it.each(["zh", "en"] as const)(
  "explains migration-paused archive and requires the existing due-task confirmation in %s",
  async (language) => {
    const localized = strings(language);
    const migrated = migrateData(
      {
        schemaVersion: 6,
        settings: {
          autoArchive: true,
          groups: settingsSchema
            .parse({})
            .groups.filter((g) => g.kind !== "canceled"),
        },
      },
      6,
    );
    const test = fixture(migrated);
    test.inventory.workspaces.push(
      workspace("w", "Existing label", ["task:canceled"]),
    );
    test.inventory.agents.push({
      id: "a",
      workspaceId: "w",
      title: null,
      activity: "idle",
      updatedAt: "2026-08-01T00:00:00Z",
      lastUserMessageAt: "2026-08-01T00:00:00Z",
    });
    test.host.conversation = agentEvidence("2026-08-01T00:00:00Z");
    const time = vi.spyOn(Date, "now").mockReturnValue(test.now());
    try {
      await test.board.start();
      const initial = test.board.snapshot();
      const mutate = vi.fn((input) => test.board.mutate(input));
      const render = () => {
        hooks.cursor = 0;
        return SettingsPage({
          board: initial,
          t: localized,
          theme,
          disabled: false,
          saving: false,
          mutate,
          onBack: vi.fn(),
        });
      };
      const toggle = findByTestId(render(), "workboard-auto-archive-canceled");
      expect(toggle.props.value).toBe(false);
      expect(
        elementText(
          findByTestId(render(), "workboard-archive-migration-notice"),
        ),
      ).toContain(localized.autoArchiveMigrationPaused);
      await (toggle.props.onValueChange as (value: boolean) => Promise<void>)(
        true,
      );
      expect(mutate).not.toHaveBeenCalled();
      expect(test.host.archive).not.toHaveBeenCalled();
      const confirmation = findElement(
        render(),
        (node) => node.props.title === localized.enableAutoArchive,
        "due archive confirmation",
      );
      expect(confirmation.props.description).toBe(
        localized.enableAutoArchiveConfirm
          .replace("{count}", "1")
          .replace("{canceled}", "1")
          .replace("{done}", "0"),
      );
      await (confirmation.props.onConfirm as () => Promise<boolean>)();
      await test.board.refresh();
      expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("w");
      expect(test.store.current.settings.archiveMappingNeedsReview).toBe(false);
      expect(() =>
        findByTestId(render(), "workboard-archive-migration-notice"),
      ).toThrow("not found");
    } finally {
      time.mockRestore();
      test.board.dispose();
    }
  },
);

it.each(["zh", "en"] as const)(
  "settings expose only In progress choices and persist an independent default in %s",
  async (language) => {
    const settings = settingsSchema.parse({
      defaultStartGroup: "review",
      groups: [
        ...settingsSchema.parse({}).groups,
        {
          id: "working-two",
          kind: "in-progress",
          name: "Second",
          label: "task:working-two",
        },
      ],
    });
    const initial = board(settings);
    const saved = {
      ...initial,
      revision: 8,
      settings: { ...settings, defaultStartWorkGroup: "working-two" },
    };
    const mutate = vi.fn().mockResolvedValue(saved);
    hooks.cursor = 0;
    const tree = SettingsPage({
      board: initial,
      t: strings(language),
      theme,
      disabled: false,
      saving: false,
      mutate,
      onBack: vi.fn(),
    });
    const select = findByTestId(tree, "workboard-default-start-work");
    expect(select.props.label).toBe(
      strings(language).defaultStartWorkGroupSetting,
    );
    expect(
      (select.props.options as { value: string }[]).map((item) => item.value),
    ).toEqual(["", "in-progress", "working-two"]);
    await (select.props.onValueChange as (value: string) => Promise<void>)(
      "working-two",
    );
    expect(mutate).toHaveBeenCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: saved.settings,
      },
      "settings:start-work-default",
    );
    hooks.values = [];
    expect(
      findByTestId(
        renderSettings(saved, mutate),
        "workboard-default-start-work",
      ).props.value,
    ).toBe("working-two");
    expect(saved.settings.defaultStartGroup).toBe("review");
  },
);
it("displays a safe automatic choice for a persisted invalid start-work default", () => {
  const initial = board(
    settingsSchema.parse({ defaultStartWorkGroup: "done" }),
  );
  const select = findByTestId(
    renderSettings(initial, vi.fn()),
    "workboard-default-start-work",
  );
  expect(select.props.value).toBe("");
});

const archiveFixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
  for (const test of archiveFixtures.splice(0)) test.board.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function archiveSettingsFixture(
  settings: Partial<Settings> = {},
  conversationAt = "2026-08-01T00:00:00Z",
) {
  const test = fixture({
    settings: settingsSchema.parse({
      archiveDoneEnabled: false,
      archiveCanceledEnabled: false,
      ...settings,
    }),
  });
  archiveFixtures.push(test);
  for (const kind of ["done", "canceled"] as const) {
    test.inventory.workspaces.push(workspace(kind, kind, [`task:${kind}`]));
    test.inventory.agents.push({
      id: `${kind}-agent`,
      workspaceId: kind,
      title: null,
      activity: "idle",
      updatedAt: conversationAt,
      lastUserMessageAt: conversationAt,
    });
  }
  test.host.conversation = agentEvidence(conversationAt);
  vi.spyOn(Date, "now").mockReturnValue(test.now());
  await test.board.start();
  let snapshot = test.board.snapshot();
  const mutate = vi.fn<Parameters<typeof SettingsPage>[0]["mutate"]>((input) =>
    test.board.mutate(input),
  );
  const render = () => renderSettings(snapshot, mutate);
  return {
    ...test,
    mutate,
    render,
    refreshView: () => {
      snapshot = test.board.snapshot();
    },
    toggle: async (control: string, value: boolean) =>
      (
        findByTestId(render(), `workboard-${control}`).props.onValueChange as (
          value: boolean,
        ) => Promise<void>
      )(value),
    days: async (kind: string, value: string) => {
      (
        findByTestId(render(), `workboard-archive-${kind}-days`).props
          .onChangeText as (value: string) => void
      )(value);
      await (
        findByTestId(render(), `workboard-save-archive-${kind}-days`).props
          .onPress as () => Promise<void>
      )();
    },
    confirmation: () =>
      findElement(
        render(),
        (element) => element.props.title === t.enableAutoArchive,
        "archive settings confirmation",
      ),
  };
}

it.each(["done", "canceled"] as const)(
  "saves the disabled %s period without enabling either rule, then previews its saved period on enable",
  async (kind) => {
    vi.useFakeTimers();
    const test = await archiveSettingsFixture();
    const initial = test.store.current.settings;
    const daysKey =
      kind === "done" ? "archiveDoneAfterDays" : "archiveCanceledAfterDays";
    const inputId = `workboard-archive-${kind}-days`;
    expect(findByTestId(test.render(), inputId).props.editable).toBe(true);
    await test.days(kind, "90");
    expect(test.store.current.settings).toEqual({ ...initial, [daysKey]: 90 });
    expect(() => test.confirmation()).toThrow("not found");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.host.archive).not.toHaveBeenCalled();

    await test.toggle(`auto-archive-${kind}`, true);
    expect(() => test.confirmation()).toThrow("not found");
    expect(findByTestId(test.render(), inputId).props.value).toBe("90");
    await test.toggle(`auto-archive-${kind}`, false);
    await test.days(kind, "7");
    expect(test.store.current.settings).toEqual({ ...initial, [daysKey]: 7 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.host.archive).not.toHaveBeenCalled();
    test.mutate.mockClear();

    await test.toggle(`auto-archive-${kind}`, true);
    expect(test.mutate).not.toHaveBeenCalled();
    const confirmation = test.confirmation();
    const rows = findByTestId(confirmation, "workboard-archive-candidates")
      .props.children as ReactElement[];
    expect(rows).toHaveLength(1);
    expect(elementText(rows[0])).toContain(kind);
    expect(findByTestId(test.render(), inputId).props.editable).toBe(false);
    (confirmation.props.onClose as () => void)();
    expect(test.store.current.settings).toEqual({ ...initial, [daysKey]: 7 });
    expect(findByTestId(test.render(), inputId).props.value).toBe("7");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.host.archive).not.toHaveBeenCalled();
  },
);

it.each(["done", "canceled"] as const)(
  "previews overdue %s under the proposed rule, cancels without writes, then confirms the full settings",
  async (kind) => {
    const test = await archiveSettingsFixture();
    const initial = test.board.snapshot();
    const settings = initial.settings;
    await test.toggle(`auto-archive-${kind}`, true);
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.store.current.settings).toEqual(settings);
    await test.board.refresh();
    expect(test.host.archive).not.toHaveBeenCalled();
    expect(test.confirmation().props.description).toBe(
      t.enableAutoArchiveConfirm
        .replace("{count}", "1")
        .replace("{done}", kind === "done" ? "1" : "0")
        .replace("{canceled}", kind === "canceled" ? "1" : "0"),
    );
    (test.confirmation().props.onClose as () => void)();
    expect(() => test.confirmation()).toThrow("not found");
    await test.board.refresh();
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.host.archive).not.toHaveBeenCalled();
    await test.toggle(`auto-archive-${kind}`, true);
    expect(
      await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
    ).toBe(true);
    const key =
      kind === "done" ? "archiveDoneEnabled" : "archiveCanceledEnabled";
    expect(test.mutate).toHaveBeenCalledExactlyOnceWith(
      {
        action: "settings",
        revision: initial.revision,
        expectedSettings: settings,
        settings: { ...settings, [key]: true },
      },
      `settings:${kind}-archive`,
    );
    expect(test.store.current.settings).toEqual({ ...settings, [key]: true });
    await test.board.refresh();
    expect(test.host.archive).toHaveBeenCalledExactlyOnceWith(kind);
  },
);

it("keeps migrated master-off tasks safe through periodic scans and enables only Canceled after confirmation", async () => {
  vi.useFakeTimers();
  const migrated = migrateData(
    {
      schemaVersion: 8,
      settings: {
        autoArchive: false,
        archiveDoneEnabled: true,
        archiveCanceledEnabled: true,
        archiveDoneAfterDays: 7,
        archiveCanceledAfterDays: 14,
      },
    },
    8,
  );
  const test = await archiveSettingsFixture(migrated.settings);
  const original = test.store.current.settings;
  for (const kind of ["done", "canceled"]) {
    expect(
      findByTestId(test.render(), `workboard-auto-archive-${kind}`).props.value,
    ).toBe(false);
    expect(
      findByTestId(test.render(), `workboard-archive-${kind}-days`).props
        .editable,
    ).toBe(true);
  }
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.host.archive).not.toHaveBeenCalled();
  await test.toggle("auto-archive-canceled", true);
  const rows = findByTestId(test.confirmation(), "workboard-archive-candidates")
    .props.children as ReactElement[];
  expect(rows).toHaveLength(1);
  expect(elementText(rows[0])).toContain("canceled");
  expect(elementText(rows[0])).not.toContain("done");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.host.archive).not.toHaveBeenCalled();
  (test.confirmation().props.onClose as () => void)();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.store.current.settings).toEqual(original);
  expect(test.host.archive).not.toHaveBeenCalled();
  await test.toggle("auto-archive-canceled", true);
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  expect(test.mutate).toHaveBeenCalledTimes(1);
  expect(test.store.current.settings).toEqual({
    ...original,
    archiveCanceledEnabled: true,
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("canceled");
  expect(test.inventory.workspaces.map((w) => w.id)).toEqual(["done"]);
});

it("keeps both rules off on a fresh install and does not apply unsaved delays when enabling", async () => {
  vi.useFakeTimers();
  const test = await archiveSettingsFixture(
    settingsSchema.parse({}),
    "2026-09-22T00:00:00Z",
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: false,
    archiveCanceledEnabled: false,
  });
  await test.toggle("auto-archive-canceled", true);
  (
    findByTestId(test.render(), "workboard-archive-canceled-days").props
      .onChangeText as (text: string) => void
  )("1");
  await test.toggle("auto-archive-canceled", false);
  await test.toggle("auto-archive-canceled", true);
  expect(
    findByTestId(test.render(), "workboard-archive-canceled-days").props.value,
  ).toBe("1");
  expect(test.store.current.settings.archiveCanceledAfterDays).toBe(null);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.host.archive).not.toHaveBeenCalled();
  expect(test.store.current.settings.archiveDoneEnabled).toBe(false);
});

it("leaves both rules off after a real storage failure and retries only the confirmed rule", async () => {
  vi.useFakeTimers();
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-canceled", true);
  vi.spyOn(test.backing, "write").mockRejectedValueOnce(
    new Error("storage failed"),
  );
  await expect(
    (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).rejects.toThrow("storage failed");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: false,
    archiveCanceledEnabled: false,
  });
  expect(test.host.archive).not.toHaveBeenCalled();
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("canceled");
  expect(test.store.current.settings.archiveDoneEnabled).toBe(false);
});

it.each(["done", "canceled"] as const)(
  "confirms a shorter %s waiting period using its new due count and saves the proposed delay",
  async (kind) => {
    const test = await archiveSettingsFixture({
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
      archiveDoneAfterDays: 90,
      archiveCanceledAfterDays: 90,
    });
    const settings = test.store.current.settings;
    await test.days(kind, "30");
    expect(test.mutate).not.toHaveBeenCalled();
    expect(test.confirmation().props.description).toBe(
      t.enableAutoArchiveConfirm
        .replace("{count}", "1")
        .replace("{done}", kind === "done" ? "1" : "0")
        .replace("{canceled}", kind === "canceled" ? "1" : "0"),
    );
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
    const key =
      kind === "done" ? "archiveDoneAfterDays" : "archiveCanceledAfterDays";
    expect(test.store.current.settings).toEqual({ ...settings, [key]: 30 });
    await test.board.refresh();
    expect(test.host.archive).toHaveBeenCalledExactlyOnceWith(kind);
  },
);

it("saves enabling rules with no overdue tasks without confirmation", async () => {
  const test = await archiveSettingsFixture({}, "2026-09-22T00:00:00Z");
  await test.toggle("auto-archive-done", true);
  await test.toggle("auto-archive-canceled", true);
  await test.board.refresh();
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: true,
    archiveCanceledEnabled: true,
  });
  expect(() => test.confirmation()).toThrow("not found");
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("saves disabling both rules without confirmation even when tasks are overdue", async () => {
  const test = await archiveSettingsFixture();
  test.host.safety = async () => "git-dirty";
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: {
      ...initial.settings,
      archiveDoneEnabled: true,
      archiveCanceledEnabled: true,
    },
  });
  test.refreshView();
  await test.toggle("auto-archive-done", false);
  await test.toggle("auto-archive-canceled", false);
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: false,
    archiveCanceledEnabled: false,
  });
  expect(() => test.confirmation()).toThrow("not found");
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("invalidates confirmation when another client changes settings and requires a fresh preview", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: {
      ...initial.settings,
      archiveDoneAfterDays: 1,
      exclusiveStatusLabels: true,
    },
  });
  test.refreshView();
  expect(() => test.confirmation()).toThrow("not found");
  expect(test.mutate).not.toHaveBeenCalled();
  await test.toggle("auto-archive-done", true);
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  expect(test.store.current.settings).toMatchObject({
    archiveDoneAfterDays: 1,
    exclusiveStatusLabels: true,
    archiveDoneEnabled: true,
  });
});

it("retains expectedSettings when a concurrent change has not reached the client", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: { ...initial.settings, pinInProgressWorkspaces: false },
  });
  await expect(
    (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).rejects.toThrow("Settings changed");
  expect(test.store.current.settings).toMatchObject({
    pinInProgressWorkspaces: false,
    archiveDoneEnabled: false,
  });
  await test.board.refresh();
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("blocks repeated archive saves while pending and keeps the proposed settings after failure", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  let finish!: (value: undefined) => void;
  test.mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const confirm = test.confirmation().props.onConfirm as () => Promise<boolean>;
  const pending = confirm();
  expect(await confirm()).toBe(false);
  expect(test.mutate).toHaveBeenCalledTimes(1);
  finish(undefined);
  expect(await pending).toBe(false);
  expect(test.store.current.settings.archiveDoneEnabled).toBe(false);
  expect(test.host.archive).not.toHaveBeenCalled();
  expect(
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).toBe(true);
  await test.board.refresh();
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("done");
});

it("unlocks archive confirmation after an exception without saving the proposed rule", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-canceled", true);
  test.mutate.mockRejectedValueOnce(new Error("write failed"));
  await expect(
    (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).rejects.toThrow("write failed");
  expect(test.store.current.settings.archiveCanceledEnabled).toBe(false);
  expect(test.host.archive).not.toHaveBeenCalled();
  expect(
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).toBe(true);
  await test.board.refresh();
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("canceled");
});

it("blocks repeated immediate archive saves before a rerender", async () => {
  const test = await archiveSettingsFixture({}, "2026-09-22T00:00:00Z");
  let finish!: () => void;
  const released = new Promise<void>((resolve) => {
    finish = resolve;
  });
  test.mutate.mockImplementationOnce(async (input) => {
    await released;
    return test.board.mutate(input);
  });
  const toggle = findByTestId(test.render(), "workboard-auto-archive-done")
    .props.onValueChange as (value: boolean) => Promise<void>;
  const pending = toggle(true);
  for (const control of ["auto-archive-done", "auto-archive-canceled"]) {
    expect(
      findByTestId(test.render(), `workboard-${control}`).props.disabled,
    ).toBe(true);
  }
  expect(
    findByTestId(test.render(), "workboard-pin-in-progress").props.disabled,
  ).toBe(false);
  await toggle(true);
  expect(test.mutate).toHaveBeenCalledTimes(1);
  finish();
  await pending;
  expect(test.store.current.settings.archiveDoneEnabled).toBe(true);
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("shows a disabled rule's delay and saves a longer active delay without confirmation", async () => {
  const test = await archiveSettingsFixture({
    archiveCanceledEnabled: true,
    archiveCanceledAfterDays: 90,
  });
  expect(
    findByTestId(test.render(), "workboard-archive-done-days").props.editable,
  ).toBe(true);
  await test.days("canceled", "120");
  expect(test.store.current.settings).toMatchObject({
    archiveDoneEnabled: false,
    archiveDoneAfterDays: null,
    archiveCanceledAfterDays: 120,
  });
  expect(() => test.confirmation()).toThrow("not found");
  await test.board.refresh();
  expect(test.host.archive).not.toHaveBeenCalled();
});

it("keeps a valid confirmation across board refreshes with unchanged settings", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  await test.board.refresh();
  test.refreshView();
  expect(
    await (test.confirmation().props.onConfirm as () => Promise<boolean>)(),
  ).toBe(true);
  await test.board.refresh();
  expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("done");
});

it("clears a confirmed delay edit so an external reset cannot revive the old draft", async () => {
  const test = await archiveSettingsFixture({
    archiveDoneEnabled: true,
    archiveDoneAfterDays: 90,
  });
  test.host.safety = async () => "git-dirty";
  await test.days("done", "30");
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  const saved = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: saved.revision,
    expectedSettings: saved.settings,
    settings: { ...saved.settings, archiveDoneAfterDays: 90 },
  });
  test.refreshView();
  expect(
    findByTestId(test.render(), "workboard-archive-done-days").props.value,
  ).toBe("90");
  expect(
    findByTestId(test.render(), "workboard-save-archive-done-days").props
      .disabled,
  ).toBe(true);
});

function elementText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join(" ");
  if (node && typeof node === "object" && "props" in node)
    return elementText(
      (node as ReactElement<{ children?: ReactNode }>).props.children,
    );
  return "";
}

it("lists only the proposed rule's due workspaces with their state and proposed deadline", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  const list = findByTestId(
    test.confirmation(),
    "workboard-archive-candidates",
  );
  const rows = list.props.children as ReactElement[];
  expect(rows).toHaveLength(1);
  expect(elementText(rows[0])).toContain("done");
  expect(elementText(rows[0])).toContain(t.stages.done);
  expect(elementText(rows[0])).not.toContain("canceled");
  expect(elementText(rows[0])).toContain("30");
  expect(elementText(rows[0])).toContain(
    new Intl.DateTimeFormat(t.locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2026-08-31T00:00:00Z")),
  );
  expect(rows[0].props).toMatchObject({ role: "listitem" });
  expect(list.props).toMatchObject({
    role: "list",
    accessibilityLabel: t.archiveCandidates,
  });
  expect(test.mutate).not.toHaveBeenCalled();
});

it("lists both states without truncation in a bounded scroll area", async () => {
  const test = await archiveSettingsFixture();
  test.host.safety = async () => "git-dirty";
  await test.toggle("auto-archive-canceled", true);
  await (test.confirmation().props.onConfirm as () => Promise<boolean>)();
  for (let index = 0; index < 40; index++) {
    const kind = index % 2 ? "done" : "canceled";
    const id = `many-${index}`;
    test.inventory.workspaces.push(
      workspace(id, `Synthetic task ${index}`, [`task:${kind}`]),
    );
    test.inventory.agents.push({
      id: `a-${id}`,
      workspaceId: id,
      title: null,
      activity: "idle",
      updatedAt: "2026-08-01T00:00:00Z",
      lastUserMessageAt: "2026-08-01T00:00:00Z",
    });
  }
  await test.board.refresh();
  test.refreshView();
  await test.toggle("auto-archive-done", true);
  const confirmation = test.confirmation();
  expect(confirmation.props.description).toContain("42");
  expect(confirmation.props.scrollable).toBe(false);
  const list = findByTestId(confirmation, "workboard-archive-candidates");
  const rows = list.props.children as ReactElement[];
  expect(rows).toHaveLength(42);
  for (let index = 0; index < 40; index++)
    expect(elementText(rows[index + 2])).toContain(`Synthetic task ${index}`);
  expect(elementText(list)).toContain(t.stages.done);
  expect(elementText(list)).toContain(t.stages.canceled);
  expect(list.props.style).toMatchObject({ maxHeight: expect.any(Number) });
});

it("refreshes the list to empty when conversation evidence changes while confirmation is open", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  expect(
    findByTestId(test.confirmation(), "workboard-archive-candidates").props
      .children,
  ).toHaveLength(1);
  test.host.conversation = agentEvidence("2026-09-22T00:00:00Z");
  await test.board.refresh();
  test.refreshView();
  expect(elementText(test.confirmation())).toContain(t.archiveCandidatesEmpty);
  expect(() =>
    findByTestId(test.confirmation(), "workboard-archive-candidates"),
  ).toThrow("not found");
  expect(test.mutate).not.toHaveBeenCalled();
});

it("does not retain a candidate list after concurrent settings invalidate its confirmation", async () => {
  const test = await archiveSettingsFixture();
  await test.toggle("auto-archive-done", true);
  expect(elementText(test.confirmation())).toContain("done");
  const initial = test.board.snapshot();
  await test.board.mutate({
    action: "settings",
    revision: initial.revision,
    expectedSettings: initial.settings,
    settings: { ...initial.settings, archiveDoneAfterDays: 90 },
  });
  test.refreshView();
  expect(() =>
    findByTestId(test.render(), "workboard-archive-candidates"),
  ).toThrow("not found");
  await test.toggle("auto-archive-canceled", true);
  const rows = findByTestId(test.confirmation(), "workboard-archive-candidates")
    .props.children as ReactElement[];
  expect(rows).toHaveLength(1);
  expect(elementText(rows[0])).toContain("canceled");
  expect(elementText(rows[0])).not.toContain("done");
});

it.each(["zh", "en"] as const)(
  "labels conservative conversation evidence accurately in %s",
  async (language) => {
    const test = await archiveSettingsFixture();
    const at = "2026-08-01T00:00:00Z";
    test.host.conversation = async () => observed(at, { gate: "upper-bound" });
    await test.board.refresh();
    test.refreshView();
    await test.toggle("auto-archive-done", true);
    const localized = strings(language);
    const tree = renderSettings(test.board.snapshot(), test.mutate, localized);
    const list = findByTestId(tree, "workboard-archive-candidates");
    const date = new Intl.DateTimeFormat(localized.locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
    expect(elementText(list)).toContain(
      localized.archiveCandidateUpperBound.replace("{date}", date),
    );
    expect(elementText(list)).not.toContain(
      localized.archiveCandidateExact.replace("{date}", date),
    );
    expect(elementText(list)).toContain(localized.stages.done);
  },
);

it.each(["zh", "en"] as const)(
  "groups two independent archive rules without a master or setup step in %s",
  (language) => {
    const localized = strings(language);
    const tree = renderSettings(
      board(
        settingsSchema.parse({
          archiveDoneEnabled: true,
          archiveCanceledEnabled: true,
        }),
      ),
      vi.fn(),
      localized,
    );
    const section = findByTestId(tree, "workboard-auto-archive-section");
    expect(section.props.title).toBe(localized.autoArchive);
    expect(() =>
      findByTestId(section, "workboard-auto-archive-master"),
    ).toThrow("not found");
    expect(() =>
      findByTestId(section, "workboard-preview-archive-setup"),
    ).toThrow("not found");
    const rules = findByTestId(section, "workboard-auto-archive-rules");
    expect(() => findByTestId(rules, "workboard-auto-archive")).toThrow(
      "not found",
    );
    for (const kind of ["done", "canceled"] as const) {
      const rule = findByTestId(rules, `workboard-archive-rule-${kind}`);
      expect(
        findByTestId(rule, `workboard-auto-archive-${kind}`).props.disabled,
      ).toBe(false);
      expect(
        findByTestId(rule, `workboard-archive-${kind}-days`).props.editable,
      ).toBe(true);
    }
    expect(() => findByTestId(section, "workboard-default-draft")).toThrow(
      "not found",
    );
  },
);

it.each(["done", "canceled"] as const)(
  "%s rule keeps its input and Save visible and retains values across repeated toggles",
  async (kind) => {
    const test = await archiveSettingsFixture(
      {
        archiveDoneAfterDays: 7,
        archiveCanceledAfterDays: 14,
      },
      "2026-09-22T00:00:00Z",
    );
    const inputId = `workboard-archive-${kind}-days`;
    const controlsVisible = () => {
      for (const rule of ["done", "canceled"]) {
        expect(
          findByTestId(test.render(), `workboard-archive-${rule}-days`).props
            .editable,
        ).toBe(true);
        expect(
          findByTestId(test.render(), `workboard-save-archive-${rule}-days`)
            .props.accessibilityRole,
        ).toBe("button");
      }
    };
    controlsVisible();
    await test.toggle(`auto-archive-${kind}`, true);
    controlsVisible();
    const input = findByTestId(test.render(), inputId);
    expect(input.props.value).toBe(kind === "done" ? "7" : "14");
    (input.props.onChangeText as (text: string) => void)("31");
    await test.toggle(`auto-archive-${kind}`, false);
    controlsVisible();
    expect(findByTestId(test.render(), inputId).props.value).toBe("31");
    await test.toggle(`auto-archive-${kind}`, true);
    controlsVisible();
    expect(findByTestId(test.render(), inputId).props.value).toBe("31");
    const other = kind === "done" ? "canceled" : "done";
    expect(
      findByTestId(test.render(), `workboard-archive-${other}-days`).props
        .value,
    ).toBe(kind === "done" ? "14" : "7");
    await (
      findByTestId(test.render(), `workboard-save-archive-${kind}-days`).props
        .onPress as () => Promise<void>
    )();
    expect(
      test.store.current.settings[
        kind === "done" ? "archiveDoneAfterDays" : "archiveCanceledAfterDays"
      ],
    ).toBe(31);
    expect(test.host.archive).not.toHaveBeenCalled();
  },
);

it.each(["zh", "en"] as const)(
  "shows each delay label once with its Save immediately right of the input in %s",
  (language) => {
    const localized = strings(language);
    const tree = renderSettings(
      board(
        settingsSchema.parse({
          archiveDoneEnabled: true,
          archiveCanceledEnabled: true,
        }),
      ),
      vi.fn(),
      localized,
    );
    const section = findByTestId(tree, "workboard-auto-archive-section");
    const rules = findByTestId(section, "workboard-auto-archive-rules");
    expect(rules.props.style).not.toHaveProperty("borderLeftWidth");
    const labels = (node: ReactNode): unknown[] => {
      if (Array.isArray(node)) return node.flatMap(labels);
      if (!node || typeof node !== "object" || !("props" in node)) return [];
      const props = (
        node as ReactElement<{ label?: string; children?: ReactNode }>
      ).props;
      return [...(props.label ? [props.label] : []), ...labels(props.children)];
    };
    for (const kind of ["done", "canceled"] as const) {
      const label =
        kind === "done"
          ? localized.archiveDoneAfterDays
          : localized.archiveCanceledAfterDays;
      expect(labels(section).filter((value) => value === label)).toHaveLength(
        1,
      );
      const row = findByTestId(section, `workboard-archive-${kind}-delay-row`);
      const controls = row.props.children as ReactElement<{
        style: object;
        children: ReactElement<Record<string, unknown>>[];
      }>;
      expect(controls.props.style).toMatchObject({
        flexDirection: "row",
        maxWidth: "100%",
      });
      expect(
        controls.props.children.map((child) => child.props.testID),
      ).toEqual([
        `workboard-archive-${kind}-days`,
        `workboard-save-archive-${kind}-days`,
      ]);
      expect(controls.props.children[1].props.accessibilityLabel).toBe(
        `${localized.save}: ${label}`,
      );
      expect(elementText(controls.props.children[1])).toBe(localized.save);
    }
  },
);

it.each(["zh", "en"] as const)(
  "labels an idle recheck candidate as scheduled, not as a conversation bound, in %s",
  async (language) => {
    const localized = strings(language);
    const settings = settingsSchema.parse({ archiveDoneEnabled: false });
    const at = "2026-01-01T00:00:00.000Z";
    const scheduled = {
      ...newTask("task", "Idle task", at, "done"),
      workspaceId: "workspace",
      lastConversationAt: at,
      conversationStatus: "known" as const,
      conversationDisplayEvidence: "upper-bound" as const,
      conversationGateEvidence: "unknown" as const,
      conversationGateAt: null,
      conversationReason: "child-enumeration-unavailable" as const,
      stage: "done" as const,
      labels: ["task:done"],
      managedLabels: ["task:done"],
      changeRequest: null,
      changeRequestUnavailable: false,
      activity: "idle" as const,
      pinState: "none" as const,
      dueAt: null,
      recheckAt: at,
      agents: [],
    };
    const initial = board(settings, [scheduled]);
    const mutate = vi.fn();
    const toggle = findByTestId(
      renderSettings(initial, mutate, localized),
      "workboard-auto-archive-done",
    );
    await (
      toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
    ).onValueChange(true);
    const list = findByTestId(
      renderSettings(initial, mutate, localized),
      "workboard-archive-candidates",
    );
    const date = new Intl.DateTimeFormat(localized.locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
    expect(elementText(list)).toContain(localized.archiveCandidateScheduled);
    expect(elementText(list)).not.toContain(
      localized.archiveCandidateUpperBound.replace("{date}", date),
    );
    expect(elementText(list)).not.toContain(
      localized.archiveCandidateExact.replace("{date}", date),
    );
    expect(mutate).not.toHaveBeenCalled();
  },
);

it.each(["zh", "en"] as const)(
  "describes a due empty workspace with a source-neutral upper bound in %s",
  async (language) => {
    const { Workboard } = await import("../server/workboard");
    const test = fixture({
      settings: settingsSchema.parse({
        archiveDoneEnabled: false,
        archiveDoneAfterDays: 1,
      }),
    });
    test.inventory.workspaces.push(workspace("empty", "Empty", ["task:done"]));
    let now = test.now();
    const instance = new Workboard(test.host, test.store, () => now);
    try {
      await instance.start();
      now += 2 * 86400000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      await instance.refresh();
      const snapshot = instance.snapshot();
      expect(snapshot.cards[0].conversationGateEvidence).toBe("upper-bound");
      expect(snapshot.cards[0].agents).toEqual([]);
      const mutate = vi.fn();
      const localized = strings(language);
      const toggle = findByTestId(
        renderSettings(snapshot, mutate, localized),
        "workboard-auto-archive-done",
      );
      await (toggle.props.onValueChange as (value: boolean) => Promise<void>)(
        true,
      );
      const list = findByTestId(
        renderSettings(snapshot, mutate, localized),
        "workboard-archive-candidates",
      );
      expect(elementText(list)).toContain(
        language === "en" ? "conservative upper bound" : "保守上界",
      );
      expect(elementText(list)).not.toContain(
        language === "en" ? "recorded-activity" : "已记录活动时间",
      );
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      instance.dispose();
    }
  },
);
