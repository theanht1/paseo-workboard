import type { ReactElement, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  boardSchema,
  newTask,
  settingsSchema,
  type Board,
} from "../shared/model";
import { strings } from "../client/strings";
import { migrateData } from "../shared/migrations";
import { fixture, workspace, agentEvidence } from "./fixtures";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
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
) {
  hooks.cursor = 0;
  return SettingsPage({
    board,
    t,
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
  ["automatic archive", "workboard-auto-archive", "autoArchive", true],
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
    true,
  ],
] as const)(
  "persists %s when its switch changes and keeps it after reopening",
  async (_, testID, key, value) => {
    const settings = settingsSchema.parse({
      autoArchive: false,
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
      key === "autoArchive"
        ? "settings:archive"
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
  const initial = board(settingsSchema.parse({ autoArchive: false }));
  const mutate = vi.fn().mockResolvedValue(undefined);
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive",
  );

  await (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);

  expect(
    findByTestId(renderSettings(initial, mutate), "workboard-auto-archive")
      .props.value,
  ).toBe(false);
});

it("adopts a completed save after leaving and reopening while it is pending", async () => {
  const settings = settingsSchema.parse({ autoArchive: false });
  const initial = board(settings);
  const saved = {
    ...initial,
    revision: 8,
    settings: { ...settings, autoArchive: true },
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
    "workboard-auto-archive",
  );

  const pending = (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);
  hooks.values = [];
  expect(
    findByTestId(renderSettings(initial, mutate), "workboard-auto-archive")
      .props.value,
  ).toBe(false);

  finish(saved);
  await pending;
  expect(
    findByTestId(renderSettings(saved, mutate), "workboard-auto-archive").props
      .value,
  ).toBe(true);
});

it("requires confirmation before enabling automatic archive with due workspaces", async () => {
  const settings = settingsSchema.parse({ autoArchive: false });
  const timestamp = "2026-01-01T00:00:00.000Z";
  const due = {
    ...newTask("task", "Due task", timestamp, "done"),
    workspaceId: "workspace",
    lastConversationAt: timestamp,
    conversationStatus: "known" as const,
    conversationDisplayEvidence: "exact" as const,
    conversationGateEvidence: "exact" as const,
    conversationGateAt: timestamp,
    stage: "done" as const,
    labels: ["task:done"],
    managedLabels: ["task:done"],
    changeRequest: null,
    changeRequestUnavailable: false,
    activity: "idle" as const,
    pinState: "none" as const,
    dueAt: timestamp,
    agents: [],
  };
  const initial = board(settings, [due]);
  const saved = {
    ...initial,
    revision: 8,
    settings: { ...settings, autoArchive: true },
  };
  const mutate = vi.fn().mockResolvedValue(saved);
  const toggle = findByTestId(
    renderSettings(initial, mutate),
    "workboard-auto-archive",
  );

  await (
    toggle.props as { onValueChange(nextValue: boolean): Promise<void> }
  ).onValueChange(true);
  expect(mutate).not.toHaveBeenCalled();

  const confirmation = findElement(
    renderSettings(initial, mutate),
    (element) => element.props.title === t.enableAutoArchive,
    "automatic archive confirmation",
  );
  await (confirmation.props as { onConfirm(): Promise<boolean> }).onConfirm();

  expect(mutate).toHaveBeenCalledWith(
    {
      action: "settings",
      revision: 7,
      expectedSettings: settings,
      settings: { ...settings, autoArchive: true },
    },
    "settings:archive",
  );
});

it.each(["zh", "en"] as const)(
  "offers both archive resolutions with concurrency fields in %s",
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
    for (const outcome of ["confirm", "restore"] as const) {
      hooks.values = [];
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
          : localized.restoreTask;
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
        action: "resolve-archive",
        taskId: "task",
        operationId: "archive-op",
        updatedAt: test.cards[0].updatedAt,
        outcome,
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
  "saves archive days and both default destinations with localized configured hints in %s",
  async (language) => {
    const localized = strings(language);
    const settings = settingsSchema.parse({ archiveAfterDays: 14 });
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
    expect(findByTestId(render(), "workboard-auto-archive").props.hint).toBe(
      localized.autoArchiveHint.replace("{days}", "14"),
    );
    const input = findByTestId(render(), "workboard-archive-days");
    (input.props.onChangeText as (value: string) => void)("0");
    expect(
      findByTestId(render(), "workboard-save-archive-days").props.disabled,
    ).toBe(true);
    (input.props.onChangeText as (value: string) => void)("21");
    await (
      findByTestId(render(), "workboard-save-archive-days").props
        .onPress as () => Promise<void>
    )();
    expect(mutate).toHaveBeenLastCalledWith(
      {
        action: "settings",
        revision: 7,
        expectedSettings: settings,
        settings: { ...settings, archiveAfterDays: 21 },
      },
      "settings:days",
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
      expect(localized.groupTypeHints[kind]).toContain("{days}");
      expect(localized.groupTypeHints[kind]).not.toContain("30");
    }
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
      const toggle = findByTestId(render(), "workboard-auto-archive");
      expect(toggle.props.value).toBe(false);
      expect(toggle.props.hint).toContain(localized.autoArchiveMigrationPaused);
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
        localized.enableAutoArchiveConfirm.replace("{count}", "1"),
      );
      await (confirmation.props.onConfirm as () => Promise<boolean>)();
      await test.board.refresh();
      expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("w");
      expect(test.store.current.settings.archiveMappingNeedsReview).toBe(false);
      expect(
        findByTestId(render(), "workboard-auto-archive").props.hint,
      ).not.toContain(localized.autoArchiveMigrationPaused);
    } finally {
      time.mockRestore();
      test.board.dispose();
    }
  },
);

it.each(["zh", "en"] as const)(
  "F05-R01 settings expose only In progress choices and persist an independent default in %s",
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
it("F05-R01 displays a safe automatic choice for a persisted invalid start-work default", () => {
  const initial = board(
    settingsSchema.parse({ defaultStartWorkGroup: "done" }),
  );
  const select = findByTestId(
    renderSettings(initial, vi.fn()),
    "workboard-default-start-work",
  );
  expect(select.props.value).toBe("");
});
