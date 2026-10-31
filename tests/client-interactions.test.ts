import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import {
  boardSchema,
  newTask,
  settingsSchema,
  type Board,
  type Card,
} from "../shared/model";
import { DEFAULT_FILTERS } from "../client/filters";
import { strings } from "../client/strings";

// Exercise the real component handlers with persistent hooks and controlled effects.
// SDK primitives remain element boundaries; no browser or daemon is involved.
const runtime = vi.hoisted(() => ({
  current: { cursor: 0, slots: [] as any[], effects: [] as (() => void)[] },
  query: {} as any,
  mutation: vi.fn(),
  toast: { error: vi.fn(), show: vi.fn() },
  cache: { cancelQueries: vi.fn(), setQueryData: vi.fn() },
  saveFilters: vi.fn(() => true),
  filters: {} as any,
  language: "zh",
  context: null as any,
  remotes: [] as any[],
  hosts: [] as any[],
  requestGroupSync: vi.fn(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const changed = (a?: unknown[], b?: unknown[]) =>
    !a || !b || a.length !== b.length || a.some((value, i) => value !== b[i]);
  return {
    ...react,
    useContext: (context: any) => runtime.context ?? context._currentValue,
    useState: (initial: any) => {
      const frame = runtime.current;
      const index = frame.cursor++;
      if (!(index in frame.slots))
        frame.slots[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        frame.slots[index],
        (next: any) => {
          frame.slots[index] =
            typeof next === "function" ? next(frame.slots[index]) : next;
        },
      ];
    },
    useRef: (initial: any) => {
      const frame = runtime.current;
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = { current: initial };
      return frame.slots[index];
    },
    useCallback: (fn: any, deps?: unknown[]) => {
      const frame = runtime.current;
      const index = frame.cursor++;
      if (changed(frame.slots[index]?.deps, deps))
        frame.slots[index] = { deps, value: fn };
      return frame.slots[index].value;
    },
    useMemo: (fn: any, deps?: unknown[]) => {
      const frame = runtime.current;
      const index = frame.cursor++;
      if (changed(frame.slots[index]?.deps, deps))
        frame.slots[index] = { deps, value: fn() };
      return frame.slots[index].value;
    },
    useEffect: (fn: any, deps?: unknown[]) => {
      const frame = runtime.current;
      const index = frame.cursor++;
      const previous = frame.slots[index];
      if (changed(previous?.deps, deps)) {
        frame.effects.push(() => {
          previous?.cleanup?.();
          frame.slots[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => runtime.query,
  useQueryClient: () => runtime.cache,
}));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => runtime.mutation }));
vi.mock("../client/federation-hooks", async (original) => ({
  ...(await original<object>()),
  useHostRuntimes: () => runtime.remotes.map((remote: any) => remote.runtime),
  useHostSummaries: () => runtime.hosts,
  useRemoteBoards: () => runtime.remotes,
}));
vi.mock("../client/federation", async (original) => {
  const actual = await original<typeof import("../client/federation")>();
  return { ...actual, mergeBoards: vi.fn(actual.mergeBoards) };
});
vi.mock("../client/host-runtimes", async (original) => ({
  ...(await original<object>()),
  requestGroupSync: () => runtime.requestGroupSync(),
}));
vi.mock("../client/paseo-language", () => ({
  usePaseoLanguage: () => runtime.language,
}));
vi.mock("@getpaseo/plugin/client/react-native", () => {
  const component = () => null;
  component.Content = () => null;
  return {
    Icon: component,
    Modal: component,
    ScrollView: component,
    TextInput: component,
    useToast: () => runtime.toast,
  };
});
vi.mock("@getpaseo/plugin/client/ui", () => {
  const component = () => null;
  return Object.fromEntries(
    [
      "ExternalLink",
      "SettingsCard",
      "SettingsInput",
      "SettingsAction",
      "SettingsSelect",
      "SettingsSection",
      "SettingsSwitch",
      "SettingsRow",
    ].map((name) => [name, component]),
  );
});
vi.mock("react-native", async (original) => ({
  ...(await original<object>()),
  Animated: {
    ValueXY: class {
      setValue() {}
      getTranslateTransform() {
        return [];
      }
    },
  },
  PanResponder: { create: (handlers: any) => ({ panHandlers: handlers }) },
  Platform: { OS: "web" },
}));
vi.mock("../client/web", async (original) => ({
  ...(await original<object>()),
  loadBoardFilters: () => runtime.filters,
  saveBoardFilters: (...args: any[]) => runtime.saveFilters(...(args as [])),
  duringDrag: () => () => {},
}));

import {
  WorkboardScreen,
  TaskCard,
  ArchivePage,
} from "../client/WorkboardScreen";
import { BoardView, displayCardsForStage } from "../client/BoardView";
import { ProjectBoardView } from "../client/ProjectBoardView";
import { ToolbarSelect } from "../client/ToolbarSelect";
import { ListView } from "../client/ListView";
import { QuickCreate } from "../client/QuickCreate";
import { useDragHandle } from "../client/drag-handle";
import { ConfirmationModal } from "../client/ConfirmationModal";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { Text } from "react-native";
import { HintProvider, HintButton } from "../client/Hint";
import { mergeBoards } from "../client/federation";

const theme = {
  colors: {
    accent: "accent",
    accentForeground: "accent-fg",
    foreground: "fg",
    foregroundMuted: "muted",
    border: "border",
    surface0: "s0",
    surface1: "s1",
    surface2: "s2",
    statusWarning: "warning",
    statusDanger: "danger",
    statusSuccess: "success",
  },
} as any;
const t = strings("zh");
const frames: Array<typeof runtime.current> = [];
function mount(component: any, props: any) {
  const frame = {
    cursor: 0,
    slots: [] as any[],
    effects: [] as (() => void)[],
  };
  frames.push(frame);
  return {
    props,
    render() {
      runtime.current = frame;
      frame.cursor = 0;
      const result = component(this.props);
      for (const effect of frame.effects.splice(0)) effect();
      return result as ReactNode;
    },
  };
}
function elements(node: ReactNode): Array<ReactElement<any>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
function find(
  node: ReactNode,
  matches: (element: ReactElement<any>) => boolean,
) {
  const found = elements(node).find(matches);
  if (!found) throw new Error("Element not found");
  return found;
}
const named = (node: ReactNode, name: string) =>
  find(node, (e) => typeof e.type === "function" && e.type.name === name);
const byID = (node: ReactNode, id: string) =>
  find(node, (e) => e.props.testID === id);
const byLabel = (node: ReactNode, label: string) =>
  find(node, (e) => e.props.accessibilityLabel === label);
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node
    ? text((node as ReactElement<any>).props.children)
    : "";
}
function card(
  id: string,
  stage = "todo",
  workspaceId: string | null = null,
): Card {
  return {
    ...newTask(id, id, "2026-09-01T00:00:00Z"),
    stage,
    workspaceId,
    dueAt: null,
    labels: workspaceId ? [`task:${stage}`] : [],
    managedLabels: workspaceId ? [`task:${stage}`] : [],
    activity: "idle",
    agents: [],
    pinState: "none",
    changeRequest: null,
    changeRequestUnavailable: false,
  } as Card;
}
function board(cards: Card[] = []): Board {
  return boardSchema.parse({
    revision: 1,
    serverId: "host",
    version: "test",
    connected: true,
    error: null,
    refreshedAt: null,
    settings: {},
    cards,
    projects: [],
  });
}
function host(initialPage = "board", navigation?: any) {
  const props = {
    host: { id: "host" },
    theme,
    layout: { compact: false },
    initialPage,
    navigation,
  } as any;
  const element = WorkboardScreen(props).props.children;
  return mount(element.type, element.props);
}
function hostFor(id: string) {
  const element = WorkboardScreen({
    host: { id },
    theme,
    layout: { compact: false },
  } as any).props.children;
  return mount(element.type, element.props);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
  vi.resetAllMocks();
  runtime.saveFilters.mockReturnValue(true);
  runtime.filters = { ...DEFAULT_FILTERS };
  runtime.language = "zh";
  runtime.context = null;
  runtime.query = {
    data: board([card("one"), card("two")]),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  runtime.remotes = [];
  runtime.hosts = [];
  runtime.cache.setQueryData.mockImplementation((key, update) => {
    const remote = runtime.remotes.find(
      (item) => item.runtime.serverId === key[1],
    );
    if (remote) {
      remote.board =
        typeof update === "function" ? update(remote.board) : update;
      return;
    }
    runtime.query.data =
      typeof update === "function" ? update(runtime.query.data) : update;
  });
});
afterEach(() => {
  for (const frame of frames.splice(0))
    for (const slot of frame.slots) slot?.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("uses the measured surface width for List rows without changing Board layout", () => {
  const screen = host();
  byID(screen.render(), "workboard-view-list").props.onPress();
  for (const [width, compact] of [
    [1099, true],
    [1100, false],
    [700, true],
  ] as const) {
    find(screen.render(), (e) => !!e.props.onLayout).props.onLayout({
      nativeEvent: { layout: { width } },
    });
    const list = named(screen.render(), "ListView");
    expect(list.props.compact).toBe(compact);
    expect(list.props.renderCard(list.props.cards[0]).props.compact).toBe(
      compact,
    );
  }
  byID(screen.render(), "workboard-view-board").props.onPress();
  const view = named(screen.render(), "BoardView");
  expect(view.props.compact).toBe(false);
  expect(view.props.renderCard(view.props.cards[0]).props.compact).toBe(false);
});

it("X-01 keeps unrelated cards, columns and quick-create active while one control writes, and suppresses duplicate submissions", async () => {
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValue(pending.promise);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  const one = view.props.cards[0];
  const write = view.props.onStage(one, "canceled");
  const during = named(screen.render(), "BoardView");
  expect(during.props.disabled).toBe(false);
  expect(during.props.renderCard(during.props.cards[1]).props.disabled).toBe(
    false,
  );
  expect(
    during.props.renderQuickCreate(
      runtime.query.data.settings.groups.find((g: any) => g.id === "todo"),
    ).props.disabled,
  ).toBe(false);
  await during.props.onStage(one, "canceled");
  expect(runtime.mutation).toHaveBeenCalledTimes(1);
  expect(runtime.toast.error).toHaveBeenCalled();
  pending.resolve({ ...runtime.query.data, revision: 2 });
  await write;
});

it("X-01 allows distinct concurrent controls and never replaces newer cache data with an older response", async () => {
  const first = deferred<Board>();
  const second = deferred<Board>();
  runtime.mutation
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  const a = view.props.onStage(view.props.cards[0], "canceled");
  const b = view.props.onStage(view.props.cards[1], "canceled");
  expect(runtime.mutation).toHaveBeenCalledTimes(2);
  second.resolve({ ...runtime.query.data, revision: 3 });
  await b;
  first.resolve({ ...runtime.query.data, revision: 2 });
  await a;
  expect(runtime.query.data.revision).toBe(3);
});

it.each([false, "throw"])(
  "X-02 shows a localized failure inside confirmation when result is %s, and permits retry",
  async (result) => {
    const close = vi.fn();
    const confirm = vi.fn(async () => {
      if (result === "throw") throw new Error("private detail");
      return false;
    });
    const modal = mount(ConfirmationModal, {
      title: "Delete",
      description: "Delete group?",
      confirmLabel: "Delete",
      disabled: false,
      t,
      theme,
      onClose: close,
      onConfirm: confirm,
    });
    const button = () =>
      find(modal.render(), (e) => e.props.onPress && text(e) === "Delete");
    await button().props.onPress();
    await Promise.resolve();
    const alert = find(
      modal.render(),
      (e) => e.props.accessibilityRole === "alert",
    );
    expect(text(alert)).toBe(strings("zh").confirmationFailed);
    expect(close).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await button().props.onPress();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  },
);

it("X-04 omits the back-to-board entry in the native settings surface", () => {
  const screen = host("settings");
  const settings = named(screen.render(), "SettingsPage");
  const page = mount(settings.type, settings.props);
  const header = named(page.render(), "PageHeader");
  const rendered = mount(header.type, header.props).render();
  expect(text(rendered)).not.toContain(t.back);
});

it("F-07 filters conflicts and counts them separately from column tasks", () => {
  runtime.query.data = board([
    card("a"),
    { ...card("conflict-a", "conflict"), projectId: "A" },
    { ...card("conflict-b", "conflict"), projectId: "B" },
  ]);
  runtime.filters = { ...DEFAULT_FILTERS, projectId: "A" };
  runtime.query.data.projects = [
    { id: "A", name: "A", directory: "/example/a", isGit: true },
    { id: "B", name: "B", directory: "/example/b", isGit: true },
  ];
  const screen = host();
  const tree = screen.render();
  expect(
    named(tree, "ConflictNotice").props.cards.map((c: Card) => c.id),
  ).toEqual(["conflict-a"]);
  expect(text(tree)).toContain("0 / 1");
});

it("X-10 keeps search immediate, merges same-tick filter updates, debounces storage and clears only search", () => {
  runtime.filters = { ...DEFAULT_FILTERS, projectId: "A", activity: "running" };
  runtime.query.data.projects = [{ id: "A", name: "A" }];
  const screen = host();
  let tree = screen.render();
  const input = byLabel(tree, t.search);
  input.props.onChangeText("a");
  input.props.onChangeText("abc");
  tree = screen.render();
  expect(byLabel(tree, t.search).props.value).toBe("abc");
  expect(runtime.saveFilters).not.toHaveBeenCalled();
  vi.advanceTimersByTime(299);
  expect(runtime.saveFilters).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(runtime.saveFilters).toHaveBeenCalledExactlyOnceWith("host", {
    ...runtime.filters,
    search: "abc",
  });
  byLabel(tree, (strings("zh") as any).clearSearch).props.onPress();
  tree = screen.render();
  expect(byLabel(tree, t.search).props.value).toBe("");
  expect(named(tree, "ProjectPicker").props.value).toBe("A");
  const filtersToggle = byLabel(tree, t.filters);
  filtersToggle.props.onPress();
  expect(named(screen.render(), "FilterPanel").props.filters.activity).toBe(
    "running",
  );
});

it("X-11 retries snapshot on a runtime disconnect", () => {
  runtime.query.isError = true;
  const screen = host();
  const retry = byID(screen.render(), "workboard-reconnect");
  retry.props.onPress();
  expect(runtime.query.refetch).toHaveBeenCalledOnce();
});

it("X-12 reports unavailable navigation instead of silently ignoring a workspace title", () => {
  runtime.query.data = board([card("one", "review", "w")]);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  view.props.renderCard(view.props.cards[0]).props.onOpen();
  expect(runtime.toast.error).toHaveBeenCalledWith(
    (strings("zh") as any).navigationUnavailable,
  );
});

it.each([false, true])(
  "X-12 exposes title behavior and hover underline for draft=%s",
  (draft) => {
    const props = {
      card: card("one", draft ? "todo" : "review", draft ? null : "w"),
      board: runtime.query.data,
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
      onDetachDraft: vi.fn(),
    };
    const component = mount(TaskCard, props);
    const tree = component.render();
    const title = find(
      tree,
      (e) => e.props.onPress === (draft ? props.onEdit : props.onOpen),
    );
    expect(title.props.hint).toBe(draft ? t.edit : t.openWorkspace);
    title.props.onHoverIn();
    expect(
      find(component.render(), (e) => e.props.onPress === title.props.onPress)
        .props.children.props.style,
    ).toContainEqual(
      expect.objectContaining({ textDecorationLine: "underline" }),
    );
  },
);

it("X-13 distinguishes selected from pressed filter buttons and uses Icon Check for selected projects", () => {
  runtime.filters = { ...DEFAULT_FILTERS, attentionOnly: true };
  const screen = host();
  const tree = screen.render();
  const selected = byLabel(tree, t.attention).props.style({ pressed: false });
  runtime.filters.attentionOnly = false;
  const otherScreen = host();
  const pressed = byLabel(otherScreen.render(), t.attention).props.style({
    pressed: true,
  });
  expect(selected).not.toEqual(pressed);
  const pickerElement = named(tree, "ProjectPicker");
  const picker = mount(pickerElement.type, pickerElement.props);
  find(picker.render(), (e) => !!e.props.onPress).props.onPress();
  const choices = picker.render();
  expect(elements(choices).some((e) => e.props.name === "Check")).toBe(true);
  expect(text(choices)).not.toContain("✓");
});

function columns() {
  const props = {
    hostId: "host",
    cards: [card("one")],
    fullCards: [card("one")],
    cardOrderByStage: {},
    filterKey: "initial",
    orderPending: new Set<string>(),
    onReorderCards: vi.fn(async () => true),
    onResetCardOrder: vi.fn(async () => true),
    groups: runtime.query.data.settings.groups,
    compact: false,
    stage: "todo",
    setStage: vi.fn(),
    disabled: false,
    t,
    theme,
    onStage: vi.fn(async () => true),
    onReorder: vi.fn(async () => true),
    onEdit: vi.fn(),
    onAdd: vi.fn(),
    onDelete: vi.fn(),
    deleteReason: () => null,
    hasActiveFilter: false,
    renderCard: () => null,
    groupColor: () => "color",
  } as any;
  const view = mount(BoardView, props);
  const column = named(view.render(), "BoardColumn");
  return { view, column: mount(column.type, column.props), props };
}
it("X-03 requires Alt or Meta arrows before a column header commits a reorder", () => {
  const test = columns();
  const header = byID(test.column.render(), "workboard-column-drag-inbox");
  const event = (mods: any = {}) => ({
    key: "ArrowRight",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...mods,
  });
  header.props.onKeyDown(event());
  expect(test.props.onReorder).not.toHaveBeenCalled();
  header.props.onKeyDown(event({ altKey: true }));
  header.props.onKeyDown(event({ metaKey: true }));
  expect(test.props.onReorder).toHaveBeenCalledTimes(2);
  expect(header.props.accessibilityHint).toContain("Alt");
});
it("X-07 announces group options while describing dragging separately", () => {
  const test = columns();
  const header = byID(test.column.render(), "workboard-column-drag-inbox");
  expect(header.props.accessibilityLabel).toBe(
    `${t.groupOptions}: ${t.stages.inbox}`,
  );
  expect(header.props.accessibilityHint).toContain(t.dragGroup);
});
it("X-06 exposes resize focus and hover with a wider accent indicator", () => {
  const test = columns();
  const handle = () => byID(test.column.render(), "workboard-resize-inbox");
  const line = () => find(handle(), (e) => e.props.style?.height === 22);
  handle().props.onFocus();
  expect(line().props.style).toMatchObject({
    width: 4,
    backgroundColor: theme.colors.accent,
  });
  handle().props.onBlur();
  expect(line().props.style).toMatchObject({
    width: 2,
    backgroundColor: theme.colors.border,
  });
  handle().props.onPointerEnter();
  expect(line().props.style.backgroundColor).toBe(theme.colors.accent);
  handle().props.onPointerLeave();
});

it("X-05 automatically hides touch-opened hints with a controlled timer", () => {
  const provider = mount(HintProvider, { theme, children: null });
  const tree = provider.render() as ReactElement<any>;
  const root = tree.props.children;
  root.props.ref.current = { measureInWindow: (fn: any) => fn(0, 0, 500, 500) };
  tree.props.value.show(
    "Information",
    {
      measureInWindow: (fn: any) => fn(20, 20, 30, 30),
    },
    true,
  );
  expect(text(provider.render())).toContain("Information");
  vi.advanceTimersByTime(4000);
  expect(text(provider.render())).not.toContain("Information");
});

it.each(["project", "directory", "existing", "worktree", "target"])(
  "X-08 explains the missing %s prerequisite above Start",
  (missing) => {
    if (missing === "worktree") {
      runtime.query.data.projects = [
        {
          id: "p",
          name: "Project",
          directory: "/example/project",
          isGit: true,
        },
      ];
      runtime.query.data.cards[0].projectId = "p";
    }
    const screen = host();
    const view = named(screen.render(), "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onStart();
    const modalElement = named(screen.render(), "StartModal");
    const modalProps = { ...modalElement.props };
    if (missing === "target")
      modalProps.board = {
        ...runtime.query.data,
        settings: {
          ...runtime.query.data.settings,
          groups: runtime.query.data.settings.groups.filter(
            (g: any) => g.kind !== "in-progress",
          ),
        },
      };
    const modal = mount(modalElement.type, modalProps);
    modal.render();
    let tree = modal.render();
    if (missing === "directory")
      find(
        tree,
        (e) => !!e.props.onPress && text(e) === t.customDirectory,
      ).props.onPress();
    if (missing === "existing")
      find(
        tree,
        (e) => !!e.props.onPress && text(e) === t.existingWorkspace,
      ).props.onPress();
    if (missing === "worktree") {
      const button = find(
        tree,
        (e) => !!e.props.onPress && text(e) === t.worktree,
      );
      expect(button.props.disabled).toBe(false);
      button.props.onPress();
      modal.props = {
        ...modal.props,
        board: {
          ...modal.props.board,
          projects: [{ ...modal.props.board.projects[0], isGit: false }],
        },
      };
    }
    tree = modal.render();
    if (missing === "target") {
      expect(text(tree)).toContain(t.noStartGroup);
      return;
    }
    const reason = byID(tree, "workboard-start-missing");
    expect(text(reason).length).toBeGreaterThan(0);
  },
);

it.each(["zh", "en"])(
  "F-10 localizes service errors and hides unknown details in %s",
  async (language) => {
    runtime.language = language;
    const screen = host();
    const view = named(screen.render(), "BoardView");
    runtime.mutation.mockRejectedValueOnce(
      new Error("Workspace labels changed; refresh before changing stage"),
    );
    await view.props.onStage(view.props.cards[0], "canceled");
    const known = runtime.toast.error.mock.calls[0][0];
    expect(known).not.toBe(
      "Workspace labels changed; refresh before changing stage",
    );
    runtime.mutation.mockRejectedValueOnce(
      new Error("unexpected sensitive detail"),
    );
    await view.props.onStage(view.props.cards[0], "canceled");
    expect(runtime.toast.error).toHaveBeenLastCalledWith(
      strings(language as "zh" | "en").confirmationFailed,
    );
  },
);

it("X-09 offers inline reverse-stage undo for eight seconds with the successful labels as expectations", async () => {
  runtime.query.data = board([card("one", "review", "w")]);
  const screen = host();
  const before = runtime.query.data;
  const moved = {
    ...before,
    revision: 2,
    cards: [
      {
        ...before.cards[0],
        stage: "in-progress",
        updatedAt: "2026-10-08T00:00:00Z",
        labels: ["task:in-progress"],
        managedLabels: ["task:in-progress"],
      },
    ],
  };
  runtime.mutation
    .mockResolvedValueOnce(moved)
    .mockResolvedValueOnce({ ...before, revision: 3 });
  const view = named(screen.render(), "BoardView");
  await view.props.onStage(view.props.cards[0], "in-progress");
  const after = named(screen.render(), "BoardView");
  const task = after.props.renderCard(after.props.cards[0]);
  expect(task.props.onUndo).toBeTypeOf("function");
  const rendered = mount(task.type, task.props).render();
  expect(byID(rendered, "workboard-undo-one").props.accessibilityLabel).toBe(
    (t as any).undoMove,
  );
  vi.advanceTimersByTime(7999);
  expect(
    named(screen.render(), "BoardView").props.renderCard(moved.cards[0]).props
      .onUndo,
  ).toBeTypeOf("function");
  await task.props.onUndo();
  expect(runtime.mutation).toHaveBeenLastCalledWith({
    action: "stage",
    taskId: "one",
    stage: "review",
    expectedLabels: ["task:in-progress"],
    expectedUpdatedAt: moved.cards[0].updatedAt,
    expectedGroup: { id: "review", kind: "review", label: "task:review" },
  });
  expect(
    named(screen.render(), "BoardView").props.renderCard(before.cards[0]).props
      .onUndo,
  ).toBeUndefined();
});

it.each(["expired", "refreshed"])(
  "X-09 removes undo on %s and reports a stale click without writing",
  async (reason) => {
    runtime.query.data = board([card("one", "review", "w")]);
    const screen = host();
    const original = runtime.query.data.cards[0];
    runtime.mutation.mockResolvedValueOnce({
      ...runtime.query.data,
      revision: 2,
      cards: [
        {
          ...original,
          stage: "in-progress",
          managedLabels: ["task:in-progress"],
          labels: ["task:in-progress"],
        },
      ],
    });
    const view = named(screen.render(), "BoardView");
    await view.props.onStage(original, "in-progress");
    const after = named(screen.render(), "BoardView");
    const stale = after.props.renderCard(after.props.cards[0]).props.onUndo;
    expect(stale).toBeTypeOf("function");
    if (reason === "expired") vi.advanceTimersByTime(8000);
    else
      runtime.query.data = {
        ...runtime.query.data,
        revision: 3,
        cards: [
          { ...runtime.query.data.cards[0], description: "Edited elsewhere" },
        ],
      };
    screen.render();
    expect(
      named(screen.render(), "BoardView").props.renderCard(
        runtime.query.data.cards[0],
      ).props.onUndo,
    ).toBeUndefined();
    await stale();
    expect(runtime.mutation).toHaveBeenCalledTimes(1);
    expect(runtime.toast.error).toHaveBeenCalledWith(
      (t as any).undoMoveExpired,
    );
  },
);

it("X-01 disables only the pending settings switch and rejects its repeated callback with feedback", async () => {
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValue(pending.promise);
  const screen = host("settings");
  let settings = named(screen.render(), "SettingsPage");
  const page = mount(settings.type, settings.props);
  const first = byID(page.render(), "workboard-pin-in-progress");
  const write = first.props.onValueChange(false);
  settings = named(screen.render(), "SettingsPage");
  page.props = settings.props;
  expect(byID(page.render(), "workboard-pin-in-progress").props.disabled).toBe(
    true,
  );
  expect(
    byID(page.render(), "workboard-auto-archive-canceled").props.disabled,
  ).toBe(false);
  await first.props.onValueChange(false);
  expect(runtime.mutation).toHaveBeenCalledOnce();
  expect(runtime.toast.error).toHaveBeenCalledWith(t.mutationPending);
  pending.resolve({
    ...runtime.query.data,
    revision: 2,
    settings: {
      ...runtime.query.data.settings,
      pinInProgressWorkspaces: false,
    },
  });
  await write;
});

it("X-02 uses the supplied failure slot and blocks double confirmation before React renders", async () => {
  const pending = deferred<boolean>();
  const confirm = vi.fn(() => pending.promise);
  const modal = mount(ConfirmationModal, {
    title: "Delete",
    description: "Delete?",
    confirmLabel: "Delete",
    failureText: "Try again",
    disabled: false,
    t,
    theme,
    onClose: vi.fn(),
    onConfirm: confirm,
  });
  const button = find(
    modal.render(),
    (e) => e.props.onPress && text(e) === "Delete",
  );
  const write = button.props.onPress();
  await button.props.onPress();
  expect(confirm).toHaveBeenCalledOnce();
  pending.resolve(false);
  await write;
  expect(
    text(find(modal.render(), (e) => e.props.accessibilityRole === "alert")),
  ).toBe("Try again");
});

it("X-09 refuses reverse labels changed at the real server boundary and removes undo without losing unrelated labels", async () => {
  const { fixture, workspace } = await import("./fixtures");
  const test = fixture();
  test.inventory.workspaces.push(
    workspace("w", "Workspace", ["task:review", "ordinary"]),
  );
  await test.board.start();
  runtime.query.data = test.board.snapshot();
  runtime.mutation.mockImplementation((input) => test.board.mutate(input));
  const screen = host();
  try {
    const view = named(screen.render(), "BoardView");
    await view.props.onStage(view.props.cards[0], "in-progress");
    const after = named(screen.render(), "BoardView");
    const undo = after.props.renderCard(after.props.cards[0]).props.onUndo;
    expect(undo).toBeTypeOf("function");
    test.inventory.workspaces[0].labels = ["task:done", "ordinary"];
    await undo();
    expect(runtime.toast.error).toHaveBeenLastCalledWith(
      t.mutationErrors[
        "Workspace labels changed; refresh before changing stage"
      ],
    );
    expect(test.inventory.workspaces[0].labels).toEqual([
      "task:done",
      "ordinary",
    ]);
    expect(
      named(screen.render(), "BoardView").props.renderCard(
        runtime.query.data.cards[0],
      ).props.onUndo,
    ).toBeUndefined();
    expect(test.host.archive).not.toHaveBeenCalled();
  } finally {
    test.board.dispose();
  }
});

it("X-10 preserves a simultaneous non-search filter update and flushes the latest value on unmount", () => {
  const screen = host();
  const tree = screen.render();
  byLabel(tree, t.filters).props.onPress();
  const panel = named(screen.render(), "FilterPanel");
  const input = byLabel(screen.render(), t.search);
  input.props.onChangeText("query");
  panel.props.onChange({ activity: "running" });
  expect(byLabel(screen.render(), t.search).props.value).toBe("query");
  expect(named(screen.render(), "FilterPanel").props.filters.activity).toBe(
    "running",
  );
  const frame = frames[0];
  for (const slot of frame.slots) slot?.cleanup?.();
  expect(runtime.saveFilters).toHaveBeenLastCalledWith("host", {
    ...DEFAULT_FILTERS,
    search: "query",
    activity: "running",
  });
});

it("X-13 uses the same selected accent and Check icon in project and stage choices", () => {
  const screen = host();
  const view = named(screen.render(), "BoardView");
  view.props.renderCard(view.props.cards[0]).props.onStatus();
  const stageElement = named(screen.render(), "StageModal");
  const stage = mount(stageElement.type, stageElement.props);
  const selectedStage = find(stage.render(), (e) => e.key === "todo");
  expect(
    typeof selectedStage.props.style === "function"
      ? selectedStage.props.style({ pressed: false })
      : [selectedStage.props.style],
  ).toContainEqual(
    expect.objectContaining({ backgroundColor: theme.colors.accent }),
  );
  expect(elements(selectedStage).some((e) => e.props.name === "Check")).toBe(
    true,
  );
  const projectElement = named(screen.render(), "ProjectPicker");
  const picker = mount(projectElement.type, projectElement.props);
  find(picker.render(), (e) => !!e.props.onPress).props.onPress();
  const selectedProject = find(picker.render(), (e) => e.key === "all");
  expect(
    typeof selectedProject.props.style === "function"
      ? selectedProject.props.style({ pressed: false })
      : [selectedProject.props.style],
  ).toContainEqual(
    expect.objectContaining({ backgroundColor: theme.colors.accent }),
  );
  expect(elements(selectedProject).some((e) => e.props.name === "Check")).toBe(
    true,
  );
});

it("X-01 sends concurrent settings controls to the actual server and reports its optimistic conflict", async () => {
  const { fixture } = await import("./fixtures");
  const test = fixture();
  await test.board.start();
  runtime.query.data = test.board.snapshot();
  runtime.mutation.mockImplementation((input) => test.board.mutate(input));
  const screen = host("settings");
  try {
    const element = named(screen.render(), "SettingsPage");
    const settings = mount(element.type, element.props);
    const tree = settings.render();
    const first = byID(tree, "workboard-pin-in-progress").props.onValueChange(
      false,
    );
    const second = byID(
      tree,
      "workboard-auto-archive-canceled",
    ).props.onValueChange(true);
    await Promise.all([first, second]);
    expect(runtime.mutation).toHaveBeenCalledTimes(2);
    expect(test.store.current.settings).toMatchObject({
      pinInProgressWorkspaces: false,
      archiveCanceledEnabled: false,
    });
    expect(runtime.toast.error).toHaveBeenCalledWith(
      t.mutationErrors["Settings changed; refresh before saving"],
    );
  } finally {
    test.board.dispose();
  }
});

it("X-01 locks the submitting draft form while unrelated board controls stay active", async () => {
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValue(pending.promise);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  view.props.renderCard(view.props.cards[0]).props.onEdit();
  const modal = named(screen.render(), "TaskModal");
  modal.props.onSave({
    task: runtime.query.data.cards[0],
    title: "one",
    description: "Submitted",
    projectId: null,
  });
  const during = screen.render();
  expect(named(during, "TaskModal").props.disabled).toBe(true);
  expect(named(during, "BoardView").props.disabled).toBe(false);
  pending.resolve({ ...runtime.query.data, revision: 2 });
  await Promise.resolve();
  await Promise.resolve();
});

function openTaskModal(task?: Card) {
  runtime.query.data = board(task ? [task] : []);
  runtime.query.data.projects = [
    { id: "alpha", name: "Alpha", directory: "/example/alpha", isGit: true },
    { id: "beta", name: "Beta", directory: "/example/beta", isGit: true },
  ];
  const screen = host();
  const tree = screen.render();
  if (task) {
    const view = named(tree, "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onEdit();
  } else {
    find(tree, (e) => e.props.onPress && text(e) === t.addTask).props.onPress();
  }
  const element = named(screen.render(), "TaskModal");
  const modal = mount(element.type, element.props);
  modal.render();
  return modal;
}

function taskProjectChoices(tree: ReactNode) {
  return find(tree, (e) => e.props.horizontal === true);
}

it("TaskModal project choices show only the bound task's current project and disable changes", () => {
  const modal = openTaskModal({
    ...card("bound", "todo", "workspace"),
    projectId: "alpha",
    projectName: "Old Alpha name",
  });
  const choices = taskProjectChoices(modal.render());
  expect(
    elements(choices)
      .filter((e) => e.type === Text)
      .map(text),
  ).toEqual(["Alpha"]);
  const buttons = elements(choices).filter(
    (e) => e.props.accessibilityRole === "button",
  );
  expect(buttons).toHaveLength(1);
  expect(buttons[0].props.disabled).toBe(true);
  expect(buttons[0].props["aria-pressed"]).toBe(true);
});

it.each([true, false])(
  "starts in the selected project without a manual directory (Git: %s)",
  (isGit) => {
    runtime.query.data.projects = [
      { id: "p", name: "Project", directory: "/fixture/project", isGit },
    ];
    const screen = host();
    const view = named(screen.render(), "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onStart();
    const element = named(screen.render(), "StartModal");
    const submit = vi.fn();
    const modal = mount(element.type, { ...element.props, onStart: submit });
    modal.render();
    expect(
      elements(modal.render()).some(
        (e) => e.props.accessibilityLabel === t.directory,
      ),
    ).toBe(false);
    byID(modal.render(), "workboard-start-project").props.onValueChange("p");
    const start = find(
      modal.render(),
      (e) => !!e.props.onPress && text(e) === t.start,
    );
    expect(start.props.disabled).toBe(false);
    start.props.onPress();
    expect(submit).toHaveBeenCalledWith(
      {
        kind: "new",
        source: isGit
          ? { kind: "worktree", projectId: "p", worktreeSlug: undefined }
          : { kind: "directory", path: "/fixture/project", projectId: "p" },
      },
      "in-progress",
    );
  },
);

it("defaults preselected Git projects to worktrees and updates the default when switching projects", () => {
  runtime.query.data.projects = [
    { id: "git", name: "Git project", directory: "/fixture/git", isGit: true },
    {
      id: "plain",
      name: "Plain project",
      directory: "/fixture/plain",
      isGit: false,
    },
  ];
  runtime.query.data.cards[0].projectId = "git";
  const screen = host();
  const view = named(screen.render(), "BoardView");
  view.props.renderCard(view.props.cards[0]).props.onStart();
  const element = named(screen.render(), "StartModal");
  const submit = vi.fn();
  const modal = mount(element.type, { ...element.props, onStart: submit });
  modal.render();
  find(
    modal.render(),
    (e) => !!e.props.onPress && text(e) === t.start,
  ).props.onPress();
  expect(submit).toHaveBeenLastCalledWith(
    {
      kind: "new",
      source: { kind: "worktree", projectId: "git", worktreeSlug: undefined },
    },
    "in-progress",
  );
  byID(modal.render(), "workboard-start-project").props.onValueChange("plain");
  expect(
    elements(modal.render()).some(
      (e) => e.props.accessibilityLabel === t.directory,
    ),
  ).toBe(false);
  find(
    modal.render(),
    (e) => !!e.props.onPress && text(e) === t.start,
  ).props.onPress();
  expect(submit).toHaveBeenLastCalledWith(
    {
      kind: "new",
      source: { kind: "directory", path: "/fixture/plain", projectId: "plain" },
    },
    "in-progress",
  );
  byID(modal.render(), "workboard-start-project").props.onValueChange("git");
  find(
    modal.render(),
    (e) => !!e.props.onPress && text(e) === t.start,
  ).props.onPress();
  expect(submit).toHaveBeenLastCalledWith(
    {
      kind: "new",
      source: { kind: "worktree", projectId: "git", worktreeSlug: undefined },
    },
    "in-progress",
  );
  find(
    modal.render(),
    (e) => !!e.props.onPress && text(e) === t.projectDirectory,
  ).props.onPress();
  modal.props = {
    ...modal.props,
    board: { ...modal.props.board },
    card: { ...modal.props.card },
  };
  find(
    modal.render(),
    (e) => !!e.props.onPress && text(e) === t.start,
  ).props.onPress();
  expect(submit).toHaveBeenLastCalledWith(
    {
      kind: "new",
      source: { kind: "directory", path: "/fixture/git", projectId: "git" },
    },
    "in-progress",
  );
});

it.each([
  {
    scenario: "a missing project with a stored name",
    projectId: "missing",
    projectName: "Stored project",
    label: "Stored project",
  },
  {
    scenario: "a missing project without a stored name",
    projectId: "missing",
    projectName: "",
    label: t.unassigned,
  },
  {
    scenario: "no project assignment",
    projectId: null,
    projectName: "",
    label: t.unassigned,
  },
])(
  "TaskModal project choices show a read-only fallback for $scenario",
  ({ projectId, projectName, label }) => {
    const modal = openTaskModal({
      ...card("bound", "todo", "workspace"),
      projectId,
      projectName,
    });
    const choices = taskProjectChoices(modal.render());
    expect(
      elements(choices)
        .filter((e) => e.type === Text)
        .map(text),
    ).toEqual([label]);
    expect(
      elements(choices).filter((e) => e.props.accessibilityRole === "button"),
    ).toHaveLength(0);
  },
);

it.each(["new", "existing"])(
  "TaskModal project choices let %s unbound drafts select and clear their project",
  (kind) => {
    const modal = openTaskModal(
      kind === "existing"
        ? { ...card("draft"), projectId: "beta", projectName: "Beta" }
        : undefined,
    );
    const saved = vi.fn();
    modal.props = { ...modal.props, onSave: saved };
    const choices = () =>
      elements(taskProjectChoices(modal.render())).filter(
        (e) => e.props.accessibilityRole === "button",
      );
    const selected = () =>
      choices()
        .filter((e) => e.props["aria-pressed"])
        .map(text);
    const save = () =>
      find(
        modal.render(),
        (e) =>
          e.props.onPress && text(e) === (kind === "new" ? t.create : t.update),
      );
    expect(choices().map(text)).toEqual([t.unassigned, "Alpha", "Beta"]);
    expect(choices().every((e) => e.props.disabled === false)).toBe(true);
    expect(selected()).toEqual([kind === "new" ? t.unassigned : "Beta"]);
    byLabel(modal.render(), t.titleField).props.onChangeText("Draft title");

    choices()
      .find((e) => text(e) === "Alpha")!
      .props.onPress();
    expect(selected()).toEqual(["Alpha"]);
    expect(save().props.disabled).toBe(false);
    save().props.onPress();
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Draft title", projectId: "alpha" }),
    );

    choices()
      .find((e) => text(e) === t.unassigned)!
      .props.onPress();
    expect(selected()).toEqual([t.unassigned]);
    save().props.onPress();
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Draft title", projectId: null }),
    );
    expect(saved).toHaveBeenCalledTimes(2);

    modal.props = { ...modal.props, disabled: true };
    expect(choices().every((e) => e.props.disabled === true)).toBe(true);
  },
);

function flattenStyle(style: any): any {
  return Array.isArray(style)
    ? Object.assign({}, ...style.map(flattenStyle))
    : style || {};
}
function taskComponent(value: Card, extra: any = {}) {
  return mount(TaskCard, {
    card: value,
    board: board([value]),
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
    onDetachDraft: vi.fn(),
    ...extra,
  });
}
it("direct status and workspace actions can wrap in narrow columns", () => {
  const tree = taskComponent(card("one", "review", "w")).render();
  const actions = find(
    tree,
    (e) =>
      Array.isArray(e.props.children) &&
      e.props.children.some(
        (c: any) => c?.props?.testID === "workboard-status-one",
      ),
  );
  expect(flattenStyle(actions.props.style)).toMatchObject({
    gap: 4,
    flexWrap: "wrap",
  });
});
it.each(["hover", "focus"])(
  "card actions show a background on %s and clear on exit",
  (mode) => {
    const tree = taskComponent(card("one", "review", "w")).render();
    const action = byLabel(tree, t.notes);
    const control = mount(action.type, action.props);
    const enter = mode === "hover" ? "onHoverIn" : "onFocus";
    const leave = mode === "hover" ? "onHoverOut" : "onBlur";
    const before = control.render() as ReactElement<any>;
    expect(typeof before.props[enter]).toBe("function");
    before.props[enter]({});
    const active = control.render() as ReactElement<any>;
    expect(
      flattenStyle(active.props.style({ pressed: false })).backgroundColor,
    ).toBe(theme.colors.surface2);
    active.props[leave]({});
    const idle = control.render() as ReactElement<any>;
    expect(
      flattenStyle(idle.props.style({ pressed: false })).backgroundColor,
    ).not.toBe(theme.colors.surface2);
  },
);
it("card warnings use the metadata font size", () => {
  const value = {
    ...card("one", "done", "w"),
    issue: "git-dirty",
    changeRequestUnavailable: true,
    dueAt: "2026-01-01T00:00:00Z",
  };
  const tree = taskComponent(value).render();
  for (const label of [
    t.issues["git-dirty"],
    t.changeRequestUnavailable,
    t.overdue,
  ]) {
    const warning = find(tree, (e) => e.type === Text && text(e) === label);
    expect(flattenStyle(warning.props.style)).toMatchObject({
      fontSize: 13,
      lineHeight: 18,
    });
  }
});
it.each(["archived", "pending", "uncertain"])(
  "defaults to completed automatic archives and keeps %s outcomes accessible",
  (status) => {
    const value = {
      ...card("one"),
      archived: {
        operationId: "archive-op",
        status,
        kind: "automatic",
        stage: "done",
        group: null,
        startedAt: "2026-01-01T00:00:00Z",
        archivedAt: null,
        lastConversationAt: null,
        detail: "detail",
      },
    } as Card;
    const page = mount(ArchivePage, {
      board: board(),
      cards: [value],
      t,
      theme,
      onBack: vi.fn(),
      disabled: false,
      mutate: vi.fn(),
    });
    expect(text(page.render()).includes(value.title)).toBe(
      status === "archived",
    );
    expect(text(page.render())).toContain(t.archiveRules);
    byLabel(
      page.render(),
      `${t.archiveNeedsReview} (${status === "archived" ? 0 : 1})`,
    ).props.onPress();
    expect(text(page.render()).includes(value.title)).toBe(
      status !== "archived",
    );
  },
);
it("excludes external archives and manual drafts from the archive page and count", () => {
  const values = ["automatic", "external", "draft"].map((kind) => ({
    ...card(kind),
    archived: {
      operationId: kind,
      status: "archived",
      kind,
      stage: "done",
      group: null,
      startedAt: "2026-01-01T00:00:00Z",
      archivedAt: "2026-01-01T00:00:00Z",
      lastConversationAt: null,
      detail: "detail",
    },
  })) as Card[];
  runtime.query.data = board(values);
  const screen = host();
  byLabel(screen.render(), `${t.archive} (1)`).props.onPress();
  const archive = named(screen.render(), "ArchivePage");
  expect(archive.props.cards.map((value: Card) => value.id)).toEqual([
    "automatic",
  ]);
  const page = mount(ArchivePage, archive.props);
  expect(text(page.render())).toContain("automatic");
  expect(text(page.render())).not.toContain("external");
  expect(text(page.render())).not.toContain("draft");
});
it.each([false, true])(
  "BoardView passes actual handle visibility compact=%s",
  (compact) => {
    const test = columns();
    test.props.compact = compact;
    const render = vi.fn(() => null);
    test.props.renderCard = render;
    test.view.render();
    expect(render).toHaveBeenCalledWith(test.props.cards[0], !compact);
    const screen = host();
    const view = named(screen.render(), "BoardView");
    const value = view.props.renderCard(view.props.cards[0], !compact);
    const task = mount(value.type, value.props);
    const tree = task.render();
    const title = byLabel(tree, `${t.edit}: ${value.props.card.title}`);
    const titleRow = find(tree, (e) =>
      [e.props.children].flat().includes(title),
    );
    expect(flattenStyle(titleRow.props.style).paddingRight ?? 0).toBe(
      compact ? 0 : 36,
    );
  },
);
it("compact active-filter count is a badge distinct from archive count", () => {
  runtime.filters = { ...DEFAULT_FILTERS, search: "one" };
  const screen = host();
  screen.props = { ...screen.props, layout: { compact: true } };
  const filter = byLabel(screen.render(), t.filters);
  const badge = byID(filter, "workboard-filter-count");
  expect(text(badge)).toBe("1");
  expect(flattenStyle(badge.props.style)).toMatchObject({
    borderRadius: 9,
    minWidth: 18,
  });
  expect(
    elements(byLabel(screen.render(), `${t.archive} (0)`)).some(
      (e) => e.props.testID === "workboard-filter-count",
    ),
  ).toBe(false);
});

function hintEntry() {
  const provider = mount(HintProvider, { theme, children: null });
  const element = provider.render() as ReactElement<any>;
  element.props.children.props.ref.current = {
    measureInWindow: (fn: any) => fn(0, 0, 500, 500),
  };
  runtime.context = element.props.value;
  const control = mount(HintButton, { hint: "Information", children: null });
  const button = control.render() as ReactElement<any>;
  button.props.ref.current = {
    measureInWindow: (fn: any) => fn(20, 20, 30, 30),
  };
  return { provider, control };
}
it.each(["onHoverIn", "onFocus"])(
  "R03 keeps hints from actual %s entry visible beyond four seconds",
  (entry) => {
    const { provider, control } = hintEntry();
    (control.render() as ReactElement<any>).props[entry]({ nativeEvent: {} });
    expect(text(provider.render())).toContain("Information");
    vi.advanceTimersByTime(5000);
    expect(text(provider.render())).toContain("Information");
    (control.render() as ReactElement<any>).props[
      entry === "onFocus" ? "onBlur" : "onHoverOut"
    ]({});
    expect(text(provider.render())).not.toContain("Information");
  },
);
it.each(["onHoverIn", "onFocus"])(
  "R03 keeps an actual %s hint persistent after a mouse long-press",
  (entry) => {
    const { provider, control } = hintEntry();
    (control.render() as ReactElement<any>).props[entry]({ nativeEvent: {} });
    (control.render() as ReactElement<any>).props.onLongPress({
      nativeEvent: { pointerType: "mouse", touches: [] },
    });
    expect(text(provider.render())).toContain("Information");
    vi.advanceTimersByTime(5000);
    expect(text(provider.render())).toContain("Information");
    (control.render() as ReactElement<any>).props[
      entry === "onFocus" ? "onBlur" : "onHoverOut"
    ]({});
    expect(text(provider.render())).not.toContain("Information");
  },
);
it.each(["onPress", "onLongPress"])(
  "R03 dismisses touch hints through actual %s entry",
  (entry) => {
    const { provider, control } = hintEntry();
    (control.render() as ReactElement<any>).props[entry]({
      nativeEvent: { pointerType: "touch", touches: [{}] },
    });
    expect(text(provider.render())).toContain("Information");
    vi.advanceTimersByTime(4000);
    expect(text(provider.render())).not.toContain("Information");
  },
);
it("R01 invalidates undo when the original group definition changes but the card does not", async () => {
  runtime.query.data = board([card("one", "review", "w")]);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  runtime.mutation.mockResolvedValueOnce({
    ...runtime.query.data,
    revision: 2,
    cards: [
      {
        ...runtime.query.data.cards[0],
        stage: "in-progress",
        managedLabels: ["task:in-progress"],
      },
    ],
  });
  await view.props.onStage(view.props.cards[0], "in-progress");
  const after = named(screen.render(), "BoardView");
  const stale = after.props.renderCard(after.props.cards[0]).props.onUndo;
  expect(stale).toBeTypeOf("function");
  runtime.query.data = {
    ...runtime.query.data,
    settings: {
      ...runtime.query.data.settings,
      groups: runtime.query.data.settings.groups.map((g: any) =>
        g.id === "review" ? { ...g, kind: "done" } : g,
      ),
    },
  };
  screen.render();
  expect(
    named(screen.render(), "BoardView").props.renderCard(
      runtime.query.data.cards[0],
    ).props.onUndo,
  ).toBeUndefined();
  await stale();
  expect(runtime.mutation).toHaveBeenCalledTimes(1);
  expect(runtime.toast.error).toHaveBeenLastCalledWith(t.undoMoveExpired);
});

it("F08 submits complete column order, locks only that column and rolls back/refetches on failure", async () => {
  runtime.query.data = board([card("a"), card("b"), card("c")]);
  runtime.filters = { ...DEFAULT_FILTERS, search: "a" };
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValueOnce(pending.promise);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  expect(view.props.onReorderCards).toBeTypeOf("function");
  const write = view.props.onReorderCards(
    view.props.cards[0],
    ["a", "b", "c"],
    ["b", "c", "a"],
  );
  const during = named(screen.render(), "BoardView");
  expect(during.props.orderPending.has("todo")).toBe(true);
  expect(during.props.orderPending.has("review")).toBe(false);
  expect(during.props.cardOrderByStage.todo).toEqual(["b", "c", "a"]);
  pending.reject(new Error("card-order-changed"));
  await write;
  expect(named(screen.render(), "BoardView").props.cardOrderByStage).toEqual(
    {},
  );
  expect(runtime.query.refetch).toHaveBeenCalledOnce();
  expect(runtime.toast.error).toHaveBeenCalledWith(
    (t.mutationErrors as any)["card-order-changed"],
  );
  expect(runtime.mutation).toHaveBeenCalledWith({
    action: "reorder-cards",
    taskId: "a",
    stage: "todo",
    expectedOrder: ["a", "b", "c"],
    cardOrder: ["b", "c", "a"],
  });
});
function orderScene(compact = false) {
  const test = columns();
  test.props.groups = test.props.groups.filter((group: any) =>
    ["todo", "review"].includes(group.id),
  );
  test.props.compact = compact;
  test.props.stage = "todo";
  test.props.cards = [card("a"), card("c")];
  test.props.fullCards = [card("a"), card("b"), card("c"), card("d")];
  test.props.cardOrderByStage = { todo: ["a", "b", "c", "d"] };
  test.props.filterKey = "initial";
  test.props.orderPending = new Set();
  test.props.onReorderCards = vi.fn(async () => true);
  test.props.onResetCardOrder = vi.fn(async () => true);
  const tree = test.view.render();
  const viewport = find(
    tree,
    (e) =>
      !!e.props.ref &&
      !!e.props.onLayout &&
      flattenStyle(e.props.style).overflow === "hidden",
  );
  viewport.props.ref.current = {
    measureInWindow: (fn: any) => fn(0, 0, 500, 300),
  };
  if (!compact) {
    const column = find(
      tree,
      (e) =>
        typeof e.type === "function" &&
        e.type.name === "BoardColumn" &&
        e.props.group.id === "todo",
    );
    column.props.onListLayout?.({ top: 20, height: 260 });
    const shells = elements(column).filter(
      (e) => typeof e.type === "function" && e.type.name === "TaskDragShell",
    );
    for (const [i, shell] of shells.entries()) {
      const native = mount(
        shell.type,
        shell.props,
      ).render() as ReactElement<any>;
      native.props.onLayout?.({
        nativeEvent: { layout: { y: i * 100, height: 80 } },
      });
    }
  }
  return test;
}

function dragScene(custom: boolean, viewportWidth = 900) {
  const test = columns();
  test.props.groups = [
    runtime.query.data.settings.groups.find((g: any) => g.id === "inbox"),
    runtime.query.data.settings.groups.find((g: any) => g.id === "todo"),
    custom
      ? {
          id: "custom-review",
          name: "Custom",
          kind: "review",
          label: "task:custom",
        }
      : runtime.query.data.settings.groups.find((g: any) => g.id === "review"),
  ];
  test.props.cards = [card("moving", "inbox", "workspace")];
  test.props.fullCards = test.props.cards;
  const tree = test.view.render();
  const viewport = find(
    tree,
    (e) =>
      !!e.props.ref &&
      !!e.props.onLayout &&
      flattenStyle(e.props.style).overflow === "hidden",
  );
  viewport.props.ref.current = {
    measureInWindow: (fn: any) => fn(0, 0, viewportWidth, 300),
  };
  const column = (id: string) =>
    find(
      test.view.render(),
      (e) =>
        typeof e.type === "function" &&
        e.type.name === "BoardColumn" &&
        e.props.group.id === id,
    );
  const layout = (id: string, x: number, width: number) => {
    const element = column(id);
    const native = mount(
      element.type,
      element.props,
    ).render() as ReactElement<any>;
    native.props.onLayout?.({ nativeEvent: { layout: { x, width } } });
  };
  test.props.groups.forEach((group: any, index: number) => {
    layout(group.id, 12 + index * 256, 246);
  });
  test.props.onReorder.mockImplementation(async (order: string[]) => {
    test.props.groups = order.map((id) =>
      test.props.groups.find((group: any) => group.id === id),
    );
    // Web onLayout observes size changes, so an equal-width reorder need not emit it.
    test.view.render();
    return true;
  });
  return { ...test, column, layout };
}

it.each([false, true])(
  "drag swaps adjacent groups after a prior reorder (custom=%s)",
  (custom) => {
    const test = dragScene(custom);
    const third = test.props.groups[2].id;
    const first = test.column("inbox");
    first.props.onGroupBegin(
      { left: 12, top: 0, width: 246, height: 300 },
      100,
      50,
    );
    first.props.onEnd(810, 50);
    expect(test.props.onReorder).toHaveBeenLastCalledWith(
      ["todo", third, "inbox"],
      ["inbox", "todo", third],
    );
    test.props.onReorder.mockClear();
    const adjacent = test.column("todo");
    adjacent.props.onGroupBegin(
      { left: 12, top: 0, width: 246, height: 300 },
      100,
      50,
    );
    adjacent.props.onMove(450, 50);
    vi.advanceTimersByTime(16);
    adjacent.props.onEnd(450, 50);
    expect(test.props.onReorder).toHaveBeenCalledExactlyOnceWith(
      [third, "todo", "inbox"],
      ["todo", third, "inbox"],
    );
  },
);

it.each([false, true])(
  "drag reaches every destination after groups reorder (custom=%s)",
  (custom) => {
    const test = dragScene(custom);
    const third = test.props.groups[2].id;
    const last = test.column(third);
    last.props.onGroupBegin(
      { left: 524, top: 0, width: 246, height: 300 },
      600,
      50,
    );
    last.props.onEnd(300, 50);
    expect(test.props.onReorder).toHaveBeenLastCalledWith(
      ["inbox", third, "todo"],
      ["inbox", "todo", third],
    );
    for (const [destination, x] of [
      [third, 380],
      ["todo", 640],
    ] as const) {
      test.props.onStage.mockClear();
      const shell = named(test.view.render(), "TaskDragShell");
      shell.props.onBegin(
        { left: 22, top: 80, width: 226, height: 80 },
        200,
        100,
      );
      shell.props.onMove(x, 100);
      vi.advanceTimersByTime(16);
      expect(test.column(destination).props.active).toBe(true);
      shell.props.onEnd(x, 100);
      expect(test.props.onStage).toHaveBeenCalledExactlyOnceWith(
        test.props.cards[0],
        destination,
      );
    }
  },
);

it.each(["collapse", "resize", "scroll"])(
  "drag targets follow %s without sibling layout events",
  (change) => {
    const test = dragScene(true, change === "scroll" ? 500 : 900);
    test.props.cards = [card("moving", "custom-review", "workspace")];
    test.props.fullCards = test.props.cards;
    let targetX: number;
    let sourceLeft: number;
    if (change === "collapse") {
      test.column("inbox").props.onToggleCollapsed();
      test.layout("inbox", 12, 92);
      targetX = 150;
      sourceLeft = 380;
    } else if (change === "resize") {
      const first = test.column("inbox");
      first.props.onResizeBegin(
        { left: 12, top: 0, width: 246, height: 300 },
        258,
        100,
      );
      first.props.onEnd(492, 100);
      test.layout("inbox", 12, 480);
      targetX = 600;
      sourceLeft = 768;
    } else {
      const scroll = find(
        test.view.render(),
        (e) => e.props.testID === "workboard-columns",
      );
      scroll.props.onContentSizeChange(922);
      scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 256 } } });
      targetX = 120;
      sourceLeft = 278;
    }
    const shell = named(test.view.render(), "TaskDragShell");
    shell.props.onBegin(
      { left: sourceLeft, top: 80, width: 226, height: 80 },
      sourceLeft + 100,
      100,
    );
    shell.props.onMove(targetX, 100);
    vi.advanceTimersByTime(16);
    expect(test.column("todo").props.active).toBe(true);
    shell.props.onEnd(targetX, 100);
    expect(test.props.onStage).toHaveBeenCalledExactlyOnceWith(
      test.props.cards[0],
      "todo",
    );
  },
);

it("F08 desktop same-column drag uses vertical midpoints and preserves hidden neighbors with the captured CAS", () => {
  const test = orderScene();
  let tree = test.view.render();
  const shell = find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "TaskDragShell" &&
      e.props.card.id === "a",
  );
  shell.props.onBegin({ left: 0, top: 20, width: 246, height: 80 }, 100, 50);
  shell.props.onMove(100, 220);
  vi.advanceTimersByTime(16);
  tree = test.view.render();
  const marked = find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "TaskDragShell" &&
      e.props.insertion === "after",
  );
  expect(
    byID(
      mount(marked.type, marked.props).render(),
      "workboard-card-insertion-todo",
    ),
  ).toBeDefined();
  test.props.fullCards = [...test.props.fullCards, card("new")];
  shell.props.onEnd(100, 220);
  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
  expect(test.props.onStage).not.toHaveBeenCalled();
});
it("F08 desktop drag remains active when its preview disables the rendered source handle", () => {
  const test = orderScene();
  let shellElement = find(
    test.view.render(),
    (element) =>
      typeof element.type === "function" &&
      element.type.name === "TaskDragShell" &&
      element.props.card.id === "a",
  );
  const shell = mount(shellElement.type, shellElement.props);
  let rendered = shell.render();
  byID(rendered, "workboard-card-a").props.ref.current = {
    measureInWindow: (callback: any) => callback(0, 20, 246, 80),
  };
  let handle = byID(rendered, "workboard-drag-a");
  handle.props.onStartShouldSetPanResponderCapture({
    nativeEvent: { pageX: 100, pageY: 50 },
  });
  handle.props.onPanResponderGrant({}, { moveX: 100, moveY: 50, dx: 0, dy: 0 });
  handle.props.onPanResponderMove(
    {},
    { moveX: 100, moveY: 220, dx: 0, dy: 170 },
  );

  shellElement = find(
    test.view.render(),
    (element) =>
      typeof element.type === "function" &&
      element.type.name === "TaskDragShell" &&
      element.props.card.id === "a",
  );
  expect(shellElement.props.disabled).toBe(true);
  shell.props = shellElement.props;
  rendered = shell.render();
  handle = byID(rendered, "workboard-drag-a");
  handle.props.onPanResponderMove(
    {},
    { moveX: 100, moveY: 220, dx: 0, dy: 170 },
  );
  handle.props.onPanResponderRelease(
    {},
    { moveX: 100, moveY: 220, dx: 0, dy: 170 },
  );

  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
});
it("F08 cancels a same-column gesture when filters change", () => {
  const test = orderScene();
  const shell = find(
    test.view.render(),
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "TaskDragShell" &&
      e.props.card.id === "a",
  );
  shell.props.onBegin({ left: 0, top: 20, width: 246, height: 80 }, 100, 50);
  test.props.filterKey = "changed";
  test.view.render();
  shell.props.onEnd(100, 220);
  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  expect(test.props.onStage).not.toHaveBeenCalled();
});
it("F08 stale cross-column drag refuses an archived mover instead of touching stage", () => {
  const test = orderScene();
  const tree = test.view.render();
  const shell = find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "TaskDragShell" &&
      e.props.card.id === "a",
  );
  shell.props.onBegin({ left: 0, top: 20, width: 246, height: 80 }, 100, 50);
  const archive = {
    operationId: "archived",
    kind: "draft",
    status: "archived",
    stage: "todo",
    group: null,
    startedAt: "2026-09-01T00:00:00Z",
    archivedAt: null,
    lastConversationAt: null,
    detail: "archived",
  };
  test.props.fullCards = test.props.fullCards.map((c: Card) =>
    c.id === "a" ? { ...c, archived: archive } : c,
  );
  test.props.cards = test.props.cards.map((c: Card) =>
    c.id === "a" ? { ...c, archived: archive } : c,
  );
  shell.props.onEnd(300, 100);
  expect(test.props.onStage).not.toHaveBeenCalled();
  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  expect(runtime.toast.show).toHaveBeenCalledWith(t.dragChanged, {
    variant: "warning",
  });
});
it("F08 compact buttons and Alt+arrows move one card around visible anchors in the full column", async () => {
  const test = orderScene(true);
  const tree = test.view.render();
  const down = byLabel(tree, `${(t as any).moveCardDown}: a`);
  await down.props.onPress();
  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
  test.props.onReorderCards.mockClear();
  const key = find(tree, (e) => e.props.testID === "workboard-order-a").props
    .onKeyDown;
  const event = {
    key: "ArrowDown",
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  key(event);
  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  key({ ...event, altKey: true });
  expect(test.props.onReorderCards).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
});
it("F08 order changes preserve the cross-column undo card and group expectations", async () => {
  runtime.query.data = board([
    card("one", "review", "w"),
    card("two", "in-progress", "w2"),
  ]);
  const screen = host();
  const first = named(screen.render(), "BoardView");
  runtime.mutation.mockResolvedValueOnce({
    ...runtime.query.data,
    revision: 2,
    cards: [
      {
        ...runtime.query.data.cards[0],
        stage: "in-progress",
        managedLabels: ["task:in-progress"],
      },
      runtime.query.data.cards[1],
    ],
  });
  await first.props.onStage(first.props.cards[0], "in-progress");
  const after = named(screen.render(), "BoardView");
  expect(after.props.renderCard(after.props.cards[0]).props.onUndo).toBeTypeOf(
    "function",
  );
  runtime.query.data = {
    ...runtime.query.data,
    revision: 3,
    cardOrderByStage: { "in-progress": ["two", "one"] },
  };
  screen.render();
  const reordered = named(screen.render(), "BoardView");
  expect(
    reordered.props.renderCard(reordered.props.cards[0]).props.onUndo,
  ).toBeTypeOf("function");
});

it("F08 uses the real column list geometry and scroll callbacks for vertical edge scrolling", () => {
  const test = orderScene();
  const tree = test.view.render();
  const column = find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "BoardColumn" &&
      e.props.group.id === "todo",
  );
  const rendered = mount(column.type, column.props).render();
  const list = find(rendered, (e) => !!e.props.onContentSizeChange);
  const scrollTo = vi.fn();
  list.props.ref({
    scrollTo,
    getNativeScrollRef: () => ({
      measureInWindow: (fn: any) => fn(0, 20, 246, 260),
    }),
  });
  list.props.onContentSizeChange(246, 1000);
  list.props.onLayout({});
  list.props.onScroll({ nativeEvent: { contentOffset: { y: 50 } } });
  const shell = find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "TaskDragShell" &&
      e.props.card.id === "a",
  );
  shell.props.onBegin({ left: 0, top: 20, width: 246, height: 80 }, 100, 50);
  shell.props.onMove(100, 275);
  vi.advanceTimersByTime(16);
  expect(scrollTo).toHaveBeenCalledWith({
    y: expect.any(Number),
    animated: false,
  });
  expect(scrollTo.mock.calls[0][0].y).toBeGreaterThan(50);
  shell.props.onEnd(100, 275);
});
it.each(["Board", "List"])(
  "%s group menu freezes reset during priority sorting and permits it with sorting off",
  async (mode) => {
    const test = mode === "Board" ? orderScene() : listScene();
    test.props.priorityFirst = true;
    const group = find(
      test.view.render(),
      (e) =>
        typeof e.type === "function" &&
        e.type.name === (mode === "Board" ? "BoardColumn" : "ListGroup") &&
        e.props.group.id === "todo",
    );
    group.props.onMenu();
    const resetButton = () => {
      const action = find(
        test.view.render(),
        (e) => e.props.label === t.resetCardOrder,
      );
      return mount(
        action.type as any,
        action.props,
      ).render() as ReactElement<any>;
    };
    expect(resetButton().props.disabled).toBe(true);
    expect(test.props.onResetCardOrder).not.toHaveBeenCalled();
    test.props.priorityFirst = false;
    const enabled = resetButton();
    expect(enabled.props.disabled).toBe(false);
    await enabled.props.onPress();
    expect(test.props.onResetCardOrder).toHaveBeenCalledExactlyOnceWith(
      "todo",
      ["a", "b", "c", "d"],
    );
  },
);

it.each([
  ["working-two", "working-two"],
  [null, "in-progress"],
  ["deleted", "in-progress"],
  ["done", "in-progress"],
] as const)(
  "StartModal submits the configured/fallback working destination %s",
  (configured, expected) => {
    runtime.query.data.settings = settingsSchema.parse({
      defaultStartWorkGroup: configured,
      groups: [
        ...runtime.query.data.settings.groups,
        {
          id: "working-two",
          kind: "in-progress",
          name: "Second",
          label: "task:working-two",
        },
      ],
    });
    const screen = host();
    const view = named(screen.render(), "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onStart();
    const element = named(screen.render(), "StartModal");
    const submit = vi.fn();
    const modal = mount(element.type, { ...element.props, onStart: submit });
    modal.render();
    find(
      modal.render(),
      (e) => !!e.props.onPress && text(e) === t.customDirectory,
    ).props.onPress();
    const input = find(
      modal.render(),
      (e) => e.props.placeholder === t.directory,
    );
    input.props.onChangeText("/fixture/new");
    const button = find(
      modal.render(),
      (e) => !!e.props.onPress && text(e) === t.start,
    );
    expect(button.props.disabled).toBe(false);
    button.props.onPress();
    expect(submit).toHaveBeenCalledWith(
      {
        kind: "new",
        source: {
          kind: "directory",
          path: "/fixture/new",
          projectId: undefined,
        },
      },
      expected,
    );
  },
);

it.each(["explicit", "binding", "no-group"])(
  "StartModal preserves %s destination behavior",
  (source) => {
    runtime.query.data.settings = settingsSchema.parse({
      defaultStartWorkGroup: "in-progress",
    });
    const screen = host();
    const view = named(screen.render(), "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onStart();
    const element = named(screen.render(), "StartModal");
    const props = { ...element.props, onStart: vi.fn() };
    if (source === "explicit") props.stage = "review";
    if (source === "binding")
      props.card = {
        ...props.card,
        binding: {
          operationId: "pending",
          workspaceId: null,
          stage: "review",
          target: {
            kind: "new",
            source: { kind: "directory", path: "/fixture/retry" },
          },
        },
      };
    if (source === "no-group")
      props.board = {
        ...props.board,
        settings: {
          ...props.board.settings,
          groups: props.board.settings.groups.filter(
            (g: any) => g.kind !== "in-progress",
          ),
        },
      };
    const modal = mount(element.type, props);
    modal.render();
    if (source !== "binding") {
      find(
        modal.render(),
        (e) => !!e.props.onPress && text(e) === t.customDirectory,
      ).props.onPress();
      find(
        modal.render(),
        (e) => e.props.placeholder === t.directory,
      ).props.onChangeText("/fixture/new");
    }
    const button = find(
      modal.render(),
      (e) =>
        !!e.props.onPress &&
        text(e) === (source === "binding" ? t.retry : t.start),
    );
    expect(button.props.disabled).toBe(source === "no-group");
    if (source === "no-group") {
      button.props.onPress();
      expect(props.onStart).not.toHaveBeenCalled();
    } else {
      button.props.onPress();
      expect(props.onStart).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "new" }),
        "review",
      );
    }
  },
);
it("submits the second working group from StartModal to the real Workboard mutation", async () => {
  const { fixture } = await import("./fixtures");
  const test = fixture({
    settings: settingsSchema.parse({
      defaultStartWorkGroup: "working-two",
      groups: [
        ...runtime.query.data.settings.groups,
        {
          id: "working-two",
          kind: "in-progress",
          name: "Second",
          label: "task:working-two",
        },
      ],
    }),
    tasks: [newTask("one", "Draft", "2026-09-01T00:00:00Z")],
  });
  await test.board.start();
  try {
    runtime.query.data = test.board.snapshot();
    let completed: Promise<Board> | undefined;
    runtime.mutation.mockImplementation(
      (input) => (completed = test.board.mutate(input)),
    );
    const screen = host();
    const view = named(screen.render(), "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onStart();
    const element = named(screen.render(), "StartModal");
    const modal = mount(element.type, element.props);
    modal.render();
    find(
      modal.render(),
      (e) => !!e.props.onPress && text(e) === t.customDirectory,
    ).props.onPress();
    find(
      modal.render(),
      (e) => e.props.placeholder === t.directory,
    ).props.onChangeText("/fixture/new");
    find(
      modal.render(),
      (e) => !!e.props.onPress && text(e) === t.start,
    ).props.onPress();
    expect(runtime.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: "start", stage: "working-two" }),
    );
    expect((await completed!).cards[0].stage).toBe("working-two");
    expect(test.host.setLabel).toHaveBeenCalledWith(
      expect.any(String),
      "task:working-two",
      "blue",
      true,
    );
  } finally {
    test.board.dispose();
  }
});

function viewStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  return values;
}

it("L01 switches layout without changing filtered cards or saved order, and isolates the host preference", () => {
  const storage = viewStorage();
  runtime.query.data = {
    ...board([card("one"), card("two")]),
    cardOrderByStage: { todo: ["two", "one"] },
  };
  runtime.filters = { ...DEFAULT_FILTERS, search: "one" };
  const screen = hostFor("alpha");
  const boardView = named(screen.render(), "BoardView");
  expect(boardView.props.cards.map((item: Card) => item.id)).toEqual(["one"]);
  byID(screen.render(), "workboard-view-list").props.onPress();
  const listView = named(screen.render(), "ListView");
  expect(listView.props.cards.map((item: Card) => item.id)).toEqual(["one"]);
  expect(listView.props.cardOrderByStage).toEqual({ todo: ["two", "one"] });
  expect(
    listView.props.renderCard(listView.props.cards[0], false).props
      .presentation,
  ).toBe("row");
  listView.props.onCollapsedChange(["todo"]);
  expect(named(screen.render(), "ListView").props.collapsed.has("todo")).toBe(
    true,
  );
  byID(screen.render(), "workboard-view-board").props.onPress();
  expect(
    named(screen.render(), "BoardView").props.cards.map(
      (item: Card) => item.id,
    ),
  ).toEqual(["one"]);
  byID(screen.render(), "workboard-view-list").props.onPress();
  expect(named(screen.render(), "ListView").props.collapsed.has("todo")).toBe(
    true,
  );
  expect(JSON.parse(storage.get("paseo-workboard:view:alpha")!)).toEqual({
    mode: "list",
    collapsedListGroups: ["todo"],
    priorityFirst: true,
  });
  expect(named(hostFor("beta").render(), "BoardView")).toBeDefined();
  expect(named(hostFor("alpha").render(), "ListView")).toBeDefined();
});

it("L02 keeps quick-create text and failure across view and collapse, clears only after success, and blocks duplicate submit", async () => {
  viewStorage();
  const screen = host();
  const group = runtime.query.data.settings.groups.find(
    (item: any) => item.id === "todo",
  );
  const quick = () =>
    named(screen.render(), "BoardView").props.renderQuickCreate(group);
  quick().props.onChangeTitle("draft title");
  byID(screen.render(), "workboard-view-list").props.onPress();
  let list = named(screen.render(), "ListView");
  expect(list.props.renderQuickCreate(group).props.title).toBe("draft title");
  list.props.onCollapsedChange(["todo"]);
  expect(
    named(screen.render(), "ListView").props.renderQuickCreate(group).props
      .title,
  ).toBe("draft title");
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValueOnce(pending.promise);
  const control = mount(QuickCreate, list.props.renderQuickCreate(group).props);
  const button = byLabel(control.render(), `${t.create}: ${t.stages.todo}`);
  button.props.onPress();
  button.props.onPress();
  expect(runtime.mutation).toHaveBeenCalledTimes(1);
  expect(
    named(screen.render(), "ListView").props.renderQuickCreate(group).props
      .saving,
  ).toBe(true);
  pending.reject(new Error("write failed"));
  await vi.waitFor(() =>
    expect(
      named(screen.render(), "ListView").props.renderQuickCreate(group).props
        .error,
    ).toBe(true),
  );
  expect(
    named(screen.render(), "ListView").props.renderQuickCreate(group).props
      .title,
  ).toBe("draft title");
  expect(
    named(screen.render(), "ListView").props.quickCreateErrors.has("todo"),
  ).toBe(true);
  const saved = {
    ...runtime.query.data,
    revision: 2,
    cards: [...runtime.query.data.cards, card("new")],
  };
  runtime.mutation.mockResolvedValueOnce(saved);
  await named(screen.render(), "ListView")
    .props.renderQuickCreate(group)
    .props.onCreate("draft title");
  expect(
    named(screen.render(), "ListView").props.renderQuickCreate(group).props
      .title,
  ).toBe("");
  expect(
    named(screen.render(), "ListView").props.quickCreateErrors.has("todo"),
  ).toBe(false);
});

function listScene(overrides: Record<string, unknown> = {}) {
  const props = {
    ...columns().props,
    cards: [card("a"), card("c")],
    fullCards: [card("a"), card("b"), card("c"), card("d")],
    cardOrderByStage: { todo: ["a", "b", "c", "d"] },
    collapsed: new Set<string>(),
    onCollapsedChange: vi.fn(),
    renderCard: () => null,
    ...overrides,
  } as any;
  const view = mount(ListView, props);
  const tree = view.render();
  const viewport = find(
    tree,
    (e) =>
      !!e.props.ref &&
      !!e.props.onLayout &&
      flattenStyle(e.props.style).overflow === "hidden",
  );
  viewport.props.ref.current = {
    measureInWindow: (fn: any) => fn(0, 0, 500, props.groups.length * 240),
  };
  viewport.props.onLayout({});
  const scroll = find(tree, (e) => !!e.props.onContentSizeChange);
  scroll.props.ref.current = { scrollTo: vi.fn() };
  scroll.props.onContentSizeChange(500, props.groups.length * 220);
  props.groups.forEach((group: any, index: number) => {
    const component = find(
      tree,
      (e) =>
        typeof e.type === "function" &&
        e.type.name === "ListGroup" &&
        e.props.group.id === group.id,
    );
    component.props.onLayout(index * 220, 200);
    component.props.onBodyLayout(46);
    elements(component)
      .filter((e) => typeof e.type === "function" && e.type.name === "ListTask")
      .forEach((task, row) => task.props.onLayout(row * 60, 50));
  });
  return { props, view, tree, scroll, viewport };
}

function listTask(tree: ReactNode, id: string) {
  return find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "ListTask" &&
      e.props.card.id === id,
  );
}
function listGroup(tree: ReactNode, id: string) {
  return find(
    tree,
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "ListGroup" &&
      e.props.group.id === id,
  );
}

it("L03 list task drag preserves hidden neighbors with full-order CAS, while cross-group drop only changes stage", () => {
  const test = listScene();
  const todoIndex = test.props.groups.findIndex(
    (group: any) => group.id === "todo",
  );
  const sourceY = todoIndex * 220 + 70;
  const source = listTask(test.tree, "a");
  source.props.onBegin(
    { left: 0, top: sourceY - 25, width: 500, height: 50 },
    100,
    sourceY,
  );
  source.props.onMove(100, todoIndex * 220 + 46 + 120);
  vi.advanceTimersByTime(16);
  source.props.onEnd(100, todoIndex * 220 + 46 + 120);
  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
  expect(test.props.onStage).not.toHaveBeenCalled();

  const reviewIndex = test.props.groups.findIndex(
    (group: any) => group.id === "review",
  );
  source.props.onBegin(
    { left: 0, top: sourceY - 25, width: 500, height: 50 },
    100,
    sourceY,
  );
  source.props.onEnd(100, reviewIndex * 220 + 20);
  expect(test.props.onStage).toHaveBeenCalledWith(
    test.props.cards[0],
    "review",
  );
  expect(test.props.onReorderCards).toHaveBeenCalledTimes(1);
});

it("L04 list accepts a collapsed or empty target, reorders groups, and exposes keyboard and button alternatives", () => {
  const test = listScene();
  const groups = test.props.groups.map((group: any) => group.id);
  const source = listTask(test.tree, "a");
  const emptyIndex = groups.findIndex((id: string) => id === "review");
  test.props.collapsed = new Set(["review"]);
  test.view.render();
  source.props.onBegin({ left: 0, top: 0, width: 500, height: 50 }, 100, 100);
  source.props.onEnd(100, emptyIndex * 220 + 20);
  expect(test.props.onStage).toHaveBeenCalledWith(
    test.props.cards[0],
    "review",
  );

  const first = listGroup(test.tree, groups[0]);
  first.props.onBegin({ left: 0, top: 0, width: 500, height: 46 }, 100, 20);
  first.props.onEnd(100, (groups.length - 1) * 220 + 180);
  expect(test.props.onReorder).toHaveBeenCalledWith(
    [...groups.slice(1), groups[0]],
    groups,
  );

  const rendered = mount(source.type, source.props).render();
  const handle = byID(rendered, "workboard-list-task-drag-a");
  const event = {
    key: "ArrowDown",
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  handle.props.onKeyDown(event);
  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  handle.props.onKeyDown({ ...event, altKey: true });
  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
  test.props.onReorderCards.mockClear();
  byLabel(rendered, `${t.moveCardDown}: a`).props.onPress();
  expect(test.props.onReorderCards).toHaveBeenCalledOnce();

  test.props.onReorder.mockClear();
  const renderedGroup = mount(first.type, first.props).render();
  const groupHandle = byID(
    renderedGroup,
    `workboard-list-group-drag-${groups[0]}`,
  );
  groupHandle.props.onKeyDown({
    key: "ArrowDown",
    altKey: true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
  expect(test.props.onReorder).toHaveBeenCalledWith(
    [groups[1], groups[0], ...groups.slice(2)],
    groups,
  );
  const all = find(
    test.view.render(),
    (e) => !!e.props.onPress && text(e) === t.collapseAll,
  );
  all.props.onPress();
  expect(test.props.onCollapsedChange).toHaveBeenCalledWith(groups);
});

it("L04 rebuilds group positions after collapse moves siblings without position-only layout events", () => {
  const inboxCard = card("a", "inbox");
  const test = listScene({
    cards: [inboxCard],
    fullCards: [inboxCard],
    cardOrderByStage: { inbox: ["a"] },
  });
  const ids = test.props.groups.map((group: any) => group.id);

  test.props.collapsed = new Set(ids);
  let tree = test.view.render();
  ids.forEach((id: string, index: number) =>
    listGroup(tree, id).props.onLayout(index * 60, 50),
  );

  test.props.collapsed = new Set(ids.filter((id: string) => id !== "inbox"));
  tree = test.view.render();
  listGroup(tree, "inbox").props.onLayout(0, 200);

  const source = listTask(tree, "a");
  source.props.onBegin({ left: 0, top: 46, width: 500, height: 50 }, 100, 70);
  source.props.onEnd(100, 350);

  expect(test.props.onStage).toHaveBeenCalledWith(inboxCard, "review");
});

it("L04 rebuilds row positions after reorder moves siblings without position-only layout events", () => {
  const a = card("a"),
    c = card("c"),
    e = card("e");
  const test = listScene({
    cards: [a, c, e],
    fullCards: [a, c, e],
    cardOrderByStage: { todo: ["a", "c", "e"] },
  });
  const todoTop =
    test.props.groups.findIndex((group: any) => group.id === "todo") * 220;

  test.props.cards = [e, a, c];
  test.props.cardOrderByStage = { todo: ["e", "a", "c"] };
  const tree = test.view.render();
  const source = listTask(tree, "e");
  source.props.onBegin(
    { left: 0, top: todoTop + 46, width: 500, height: 50 },
    100,
    todoTop + 70,
  );
  source.props.onEnd(100, todoTop + 46 + 100);

  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    e,
    ["e", "a", "c"],
    ["a", "e", "c"],
  );
});

it("L05 list uses scroll-content coordinates, auto-scrolls at the edge, and cancels after filter or pending changes", () => {
  const test = listScene();
  const index = test.props.groups.findIndex(
    (group: any) => group.id === "todo",
  );
  const source = listTask(test.tree, "a");
  test.scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
  source.props.onBegin(
    { left: 0, top: index * 220 - 100 + 46, width: 500, height: 50 },
    100,
    index * 220 - 100 + 70,
  );
  source.props.onEnd(100, index * 220 - 100 + 46 + 120);
  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
  test.props.onReorderCards.mockClear();

  test.viewport.props.ref.current = {
    measureInWindow: (fn: any) => fn(0, 0, 500, 300),
  };
  test.viewport.props.onLayout({});
  test.scroll.props.onContentSizeChange(500, 5000);
  source.props.onBegin({ left: 0, top: 50, width: 500, height: 50 }, 100, 70);
  source.props.onMove(100, 290);
  vi.advanceTimersByTime(16);
  expect(test.scroll.props.ref.current.scrollTo).toHaveBeenCalledWith({
    y: expect.any(Number),
    animated: false,
  });
  test.props.filterKey = "changed";
  test.view.render();
  source.props.onEnd(100, 290);
  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  expect(test.props.onStage).not.toHaveBeenCalled();

  test.props.filterKey = "initial";
  test.view.render();
  source.props.onBegin({ left: 0, top: 50, width: 500, height: 50 }, 100, 70);
  test.props.pendingStages = new Set(["a"]);
  test.view.render();
  source.props.onEnd(100, 190);
  expect(test.props.onStage).not.toHaveBeenCalled();
});

it("L05 list invalidates a pending drag measurement when compact layout changes", () => {
  const test = listScene();
  const groupIndex = test.props.groups.findIndex(
    (group: any) => group.id === "todo",
  );
  const sourceY = groupIndex * 220 + 70;
  let measured:
    | ((left: number, top: number, width: number, height: number) => void)
    | undefined;
  let taskElement = listTask(test.view.render(), "a");
  const task = mount(taskElement.type, taskElement.props);
  let rendered = task.render();
  byID(rendered, "workboard-list-task-a").props.ref.current = {
    measureInWindow: (callback: typeof measured) => {
      measured = callback;
    },
  };
  let handle = byID(rendered, "workboard-list-task-drag-a");
  handle.props.onStartShouldSetPanResponderCapture({
    nativeEvent: { pageX: 100, pageY: sourceY },
  });
  handle.props.onPanResponderGrant(
    {},
    { moveX: 100, moveY: sourceY, dx: 0, dy: 0 },
  );
  handle.props.onPanResponderMove(
    {},
    { moveX: 100, moveY: sourceY + 120, dx: 0, dy: 120 },
  );
  expect(measured).toBeTypeOf("function");

  test.props.compact = true;
  taskElement = listTask(test.view.render(), "a");
  task.props = taskElement.props;
  rendered = task.render();
  measured!(0, sourceY - 25, 500, 50);
  handle = byID(rendered, "workboard-list-task-drag-a");
  handle.props.onPanResponderRelease(
    {},
    { moveX: 100, moveY: sourceY + 120, dx: 0, dy: 120 },
  );

  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  expect(test.props.onStage).not.toHaveBeenCalled();
});

it("L05 list drag remains active when its preview disables the rendered source handle", () => {
  const test = listScene();
  const groupIndex = test.props.groups.findIndex(
    (group: any) => group.id === "todo",
  );
  const sourceY = groupIndex * 220 + 70;
  const targetY = groupIndex * 220 + 46 + 120;
  let taskElement = listTask(test.view.render(), "a");
  const task = mount(taskElement.type, taskElement.props);
  let rendered = task.render();
  byID(rendered, "workboard-list-task-a").props.ref.current = {
    measureInWindow: (callback: any) => callback(0, sourceY - 25, 500, 50),
  };
  let handle = byID(rendered, "workboard-list-task-drag-a");
  handle.props.onStartShouldSetPanResponderCapture({
    nativeEvent: { pageX: 100, pageY: sourceY },
  });
  handle.props.onPanResponderGrant(
    {},
    { moveX: 100, moveY: sourceY, dx: 0, dy: 0 },
  );
  handle.props.onPanResponderMove(
    {},
    { moveX: 100, moveY: targetY, dx: 0, dy: targetY - sourceY },
  );

  taskElement = listTask(test.view.render(), "a");
  expect(taskElement.props.disabled).toBe(true);
  task.props = taskElement.props;
  rendered = task.render();
  handle = byID(rendered, "workboard-list-task-drag-a");
  handle.props.onPanResponderMove(
    {},
    { moveX: 100, moveY: targetY, dx: 0, dy: targetY - sourceY },
  );
  handle.props.onPanResponderRelease(
    {},
    { moveX: 100, moveY: targetY, dx: 0, dy: targetY - sourceY },
  );

  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
  expect(test.props.onStage).not.toHaveBeenCalled();
});

it("L06 row keeps details and actions independent while surfacing critical status with details closed", () => {
  const request = {
    forge: "gitlab",
    number: 42,
    url: "https://example.com/mr/42",
    title: "Fix sync",
    state: "open",
    checksStatus: "failure",
    reviewDecision: "changes_requested",
  };
  const value = {
    ...card("one", "done", "w"),
    description: "Description visible after expansion",
    issue: "git-dirty",
    changeRequest: request,
    changeRequestUnavailable: true,
    dueAt: "2026-01-01T00:00:00Z",
  } as Card;
  const onOpen = vi.fn(),
    onEdit = vi.fn(),
    onStatus = vi.fn();
  const row = taskComponent(value, {
    presentation: "row",
    onOpen,
    onEdit,
    onStatus,
  });
  let tree = row.render();
  expect(byLabel(tree, `${t.openWorkspace}: one`).props.onPress).toBe(onOpen);
  expect(byLabel(tree, t.checks.failure)).toBeDefined();
  expect(byLabel(tree, t.reviews.changes_requested)).toBeDefined();
  expect(text(tree)).toContain(t.changeRequestUnavailable);
  expect(text(tree)).toContain(t.overdue);
  expect(text(tree)).toContain(t.issues["git-dirty"]);
  expect(text(tree)).not.toContain("Description visible after expansion");
  expect(
    find(
      tree,
      (e) => e.props.title === t.moreActions && e.props.open === false,
    ),
  ).toBeDefined();
  byLabel(tree, t.moreActions).props.onPress();
  tree = row.render();
  expect(
    find(tree, (e) => e.props.title === t.moreActions && e.props.open === true),
  ).toBeDefined();
  byLabel(tree, t.notes).props.onPress();
  expect(onEdit).toHaveBeenCalledOnce();
  expect(
    byLabel(row.render(), t.details).props.accessibilityState.expanded,
  ).toBe(false);
  byLabel(row.render(), t.details).props.onPress();
  expect(
    byLabel(row.render(), t.hideDetails).props.accessibilityState.expanded,
  ).toBe(true);
  expect(text(row.render())).toContain("Description visible after expansion");
  expect(onStatus).not.toHaveBeenCalled();

  const blocked = taskComponent(
    {
      ...value,
      binding: {
        operationId: "pending",
        workspaceId: null,
        stage: "done",
        target: {
          kind: "new",
          source: { kind: "directory", path: "/fixture/retry" },
        },
      },
    } as Card,
    { presentation: "row", pending: true },
  ).render();
  expect(byID(blocked, `workboard-status-${value.id}`).props.disabled).toBe(
    true,
  );
  expect(byLabel(blocked, t.retry)).toBeDefined();
});

it("L06 compact row keeps request warnings singular and activity metadata readable by wrapping", () => {
  const value = {
    ...card("one", "review", "w"),
    changeRequest: {
      forge: "gitlab",
      number: 42,
      url: "https://example.com/mr/42",
      title: "Fix sync",
      state: "open",
      checksStatus: "failure",
      reviewDecision: "changes_requested",
    },
    changeRequestUnavailable: true,
    conversationDisplayEvidence: "unknown",
    agents: [{ id: "a1", title: "Run", activity: "idle", archived: true }],
  } as Card;
  const row = taskComponent(value, { presentation: "row", compact: true });
  let tree = row.render();
  const warningCount = () =>
    elements(tree).filter(
      (element) =>
        element.type === Text && text(element) === t.changeRequestUnavailable,
    ).length;
  expect(warningCount()).toBe(1);
  expect(text(tree)).not.toContain(t.checks.failure);
  expect(byLabel(tree, t.checks.failure).props.hint).toBe(t.checks.failure);
  expect(text(tree)).toContain(t.reviews.changes_requested);

  const activity = find(tree, (element) => {
    const style = flattenStyle(element.props.style);
    return (
      style.flexDirection === "row" &&
      style.gap === 4 &&
      elements(element).some((child) => child.props.name === "MessageCircle")
    );
  });
  expect(flattenStyle(activity.props.style).flexWrap).toBe("wrap");
  const time = find(
    activity,
    (element) =>
      element.type === Text && text(element) === t.unknownConversation,
  );
  expect(flattenStyle(time.props.style)).toMatchObject({ flexShrink: 0 });

  byLabel(tree, t.details).props.onPress();
  tree = row.render();
  expect(byLabel(tree, t.checks.failure)).toBeDefined();
  expect(byLabel(tree, t.reviews.changes_requested)).toBeDefined();
  expect(warningCount()).toBe(1);
});

it.each([
  ["card", false, "zh", "approved", "评审通过"],
  ["row", false, "en", "changes_requested", "Changes requested"],
  ["row", true, "zh", "pending", "待评审"],
] as const)(
  "shows icon-only CI counts and review text in %s (compact %s, %s), including with details open",
  (presentation, compact, locale, reviewDecision, reviewText) => {
    const checksText =
      locale === "zh"
        ? "CI 1成功 2失败 1进行中 1跳过 1已取消"
        : "CI 1 passed 2 failed 1 pending 1 skipped 1 cancelled";
    const value: Card = {
      ...card("one", "review", "w"),
      changeRequest: {
        forge: "github",
        number: 42,
        url: "https://example.com/pr/42",
        title: "Fix sync",
        state: "open",
        checksStatus: "failure",
        checkCounts: {
          success: 1,
          failure: 2,
          pending: 1,
          skipped: 1,
          cancelled: 1,
        },
        reviewDecision,
      },
    };
    const task = taskComponent(value, {
      presentation,
      compact,
      t: strings(locale),
    });
    const assertSummary = (tree: ReactNode) => {
      const control = byLabel(tree, checksText);
      expect(control.props.hint).toBe(checksText);
      expect(flattenStyle(control.props.style)).toMatchObject({
        minWidth: 36,
        minHeight: 36,
      });
      expect(
        elements(control)
          .filter((e) => e.type === Text)
          .map((e) => text(e)),
      ).toEqual(["1", "2", "1", "1", "1"]);
      expect(
        elements(control)
          .filter((e) => e.props.size === 14)
          .map((e) => e.props.name),
      ).toEqual(["CircleCheck", "CircleX", "CircleDot", "CircleMinus", "Ban"]);
      expect(text(tree)).not.toContain(checksText);
      expect(text(tree).split(reviewText)).toHaveLength(2);
      expect(byLabel(tree, reviewText).props.hint).toBe(reviewText);
      expect(text(tree)).not.toContain(strings(locale).checks.failure);
    };
    assertSummary(task.render());
    byLabel(task.render(), strings(locale).details).props.onPress();
    assertSummary(task.render());
    expect(text(task.render())).toContain("Fix sync");
  },
);

it.each([
  ["card", false, "en"],
  ["row", false, "zh"],
  ["row", true, "en"],
] as const)(
  "shows aggregate CI and review warnings once in %s (compact %s, %s), preserving other warnings",
  (presentation, compact, locale) => {
    const localized = strings(locale);
    const value: Card = {
      ...card("one", "done", "w"),
      activity: "waiting",
      issue: "git-dirty",
      dueAt: "2026-01-01T00:00:00Z",
      changeRequest: {
        forge: "github",
        number: 42,
        url: "https://example.com/pr/42",
        title: "Fix sync",
        state: "open",
        checksStatus: "failure",
        reviewDecision: "changes_requested",
      },
    };
    const task = taskComponent(value, { presentation, compact, t: localized });
    for (const expanded of [false, true]) {
      if (expanded) byLabel(task.render(), localized.details).props.onPress();
      const visibleText = text(task.render());
      expect(visibleText).not.toContain(localized.checks.failure);
      expect(byLabel(task.render(), localized.checks.failure).props.hint).toBe(
        localized.checks.failure,
      );
      expect(
        visibleText.split(localized.reviews.changes_requested),
      ).toHaveLength(2);
      expect(visibleText).toContain(localized.issues["git-dirty"]);
      expect(visibleText).toContain(localized.overdue);
      if (presentation === "row" || expanded)
        expect(visibleText).toContain(localized.attentionActivity.waiting);
    }
  },
);

it("omits zero CI categories, falls back to an aggregate icon and hides absent CI and review data", () => {
  const value = card("one", "review", "w");
  value.changeRequest = {
    forge: "github",
    number: 42,
    url: "https://example.com/pr/42",
    title: "Fix sync",
    state: "open",
    checksStatus: "none",
    reviewDecision: null,
    checkCounts: {
      success: 1,
      failure: 0,
      pending: 0,
      skipped: 0,
      cancelled: 0,
    },
  };
  const countControl = byLabel(taskComponent(value).render(), "CI 1成功");
  expect(text(countControl)).toBe("1");
  expect(
    elements(countControl)
      .filter((e) => e.props.size === 14)
      .map((e) => e.props.name),
  ).toEqual(["CircleCheck"]);
  expect(text(taskComponent(value).render())).not.toMatch(
    /0成功|0失败|0进行中|0跳过|0已取消/,
  );
  value.changeRequest.checkCounts = null;
  for (const status of ["success", "failure", "pending"] as const) {
    value.changeRequest.checksStatus = status;
    const tree = taskComponent(value).render();
    expect(byLabel(tree, t.checks[status]).props.hint).toBe(t.checks[status]);
    expect(text(tree)).not.toContain(t.checks[status]);
  }
  for (const status of ["none", null] as const) {
    value.changeRequest.checksStatus = status;
    expect(text(taskComponent(value).render())).not.toMatch(/CI|评审|修改/);
  }
});

it("shows No Agents instead of unverified time for agentless bound workspaces", () => {
  const value = {
    ...card("one", "review", "w"),
    conversationDisplayEvidence: "unknown",
  } as Card;
  for (const presentation of ["card", "row"] as const) {
    const tree = taskComponent(value, { presentation }).render();
    const texts = elements(tree)
      .filter((element) => element.type === Text)
      .map((element) => text(element));
    expect(texts.filter((value) => value === t.noAgents)).toHaveLength(1);
    expect(texts).not.toContain(t.unknownConversation);
    expect(texts).not.toContain(t.activity.idle);
  }
});

it("L07 latest move feedback survives filtering and collapse, then undoes the newest move without reviving an older one", async () => {
  viewStorage();
  runtime.query.data = board([
    card("one", "review", "w1"),
    card("two", "review", "w2"),
  ]);
  const screen = host();
  const first = named(screen.render(), "BoardView");
  const moveResult = (id: string) => ({
    ...runtime.query.data,
    revision: runtime.query.data.revision + 1,
    cards: runtime.query.data.cards.map((item: Card) =>
      item.id === id
        ? {
            ...item,
            stage: "in-progress",
            labels: ["task:in-progress"],
            managedLabels: ["task:in-progress"],
            updatedAt: new Date().toISOString(),
          }
        : item,
    ),
  });
  runtime.mutation.mockImplementationOnce(() =>
    Promise.resolve(moveResult("one")),
  );
  await first.props.onStage(first.props.cards[0], "in-progress");
  vi.advanceTimersByTime(4000);
  const second = named(screen.render(), "BoardView");
  runtime.mutation.mockImplementationOnce(() =>
    Promise.resolve(moveResult("two")),
  );
  await second.props.onStage(
    second.props.cards.find((item: Card) => item.id === "two"),
    "in-progress",
  );
  byID(screen.render(), "workboard-view-list").props.onPress();
  const list = named(screen.render(), "ListView");
  list.props.onCollapsedChange(["in-progress"]);
  runtime.filters = { ...DEFAULT_FILTERS, search: "one" };
  // The screen's search handler changes the same state as a user typing in the toolbar.
  find(
    screen.render(),
    (e) => e.props.placeholder === t.search,
  ).props.onChangeText("one");
  expect(text(byID(screen.render(), "workboard-move-feedback"))).toContain(
    "two",
  );
  runtime.mutation.mockResolvedValueOnce({
    ...runtime.query.data,
    revision: runtime.query.data.revision + 1,
  });
  byID(screen.render(), "workboard-move-feedback-undo").props.onPress();
  await vi.waitFor(() =>
    expect(() => byID(screen.render(), "workboard-move-feedback")).toThrow(),
  );
  expect(runtime.mutation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: "stage",
      taskId: "two",
      stage: "review",
    }),
  );
});

it("L08 move feedback disappears at eight seconds even when its task is hidden", async () => {
  viewStorage();
  runtime.query.data = board([card("one", "review", "w")]);
  const screen = host();
  const view = named(screen.render(), "BoardView");
  runtime.mutation.mockResolvedValueOnce({
    ...runtime.query.data,
    revision: 2,
    cards: [
      {
        ...runtime.query.data.cards[0],
        stage: "in-progress",
        labels: ["task:in-progress"],
        managedLabels: ["task:in-progress"],
      },
    ],
  });
  await view.props.onStage(view.props.cards[0], "in-progress");
  byID(screen.render(), "workboard-view-list").props.onPress();
  named(screen.render(), "ListView").props.onCollapsedChange(["in-progress"]);
  find(
    screen.render(),
    (e) => e.props.placeholder === t.search,
  ).props.onChangeText("missing");
  vi.advanceTimersByTime(7999);
  expect(byID(screen.render(), "workboard-move-feedback-undo")).toBeDefined();
  vi.advanceTimersByTime(1);
  expect(() => byID(screen.render(), "workboard-move-feedback")).toThrow();
});

it("L09 a list reorder is immediately reflected by the board view through the shared mutation", async () => {
  viewStorage();
  runtime.query.data = board([card("a"), card("b"), card("c")]);
  const screen = host();
  byID(screen.render(), "workboard-view-list").props.onPress();
  const list = named(screen.render(), "ListView");
  runtime.mutation.mockResolvedValueOnce({
    ...runtime.query.data,
    revision: 2,
    cardOrderByStage: { todo: ["b", "c", "a"] },
  });
  await list.props.onReorderCards(
    list.props.cards[0],
    ["a", "b", "c"],
    ["b", "c", "a"],
  );
  byID(screen.render(), "workboard-view-board").props.onPress();
  expect(
    named(screen.render(), "BoardView").props.cardOrderByStage.todo,
  ).toEqual(["b", "c", "a"]);
  expect(runtime.mutation).toHaveBeenCalledWith({
    action: "reorder-cards",
    taskId: "a",
    stage: "todo",
    expectedOrder: ["a", "b", "c"],
    cardOrder: ["b", "c", "a"],
  });
});

it("L10 filtered list always shows matching and total counts, including zero, and exposes collapsed create failure", () => {
  const test = listScene();
  test.props.hasActiveFilter = true;
  test.props.quickCreateErrors = new Set(["todo"]);
  test.props.collapsed = new Set(["todo"]);
  const tree = test.view.render();
  const todo = listGroup(tree, "todo");
  const rendered = mount(todo.type, todo.props).render();
  expect(text(rendered)).toContain("2 / 4");
  expect(byLabel(rendered, t.quickCreateFailed)).toBeDefined();
  const empty = listGroup(tree, "review");
  expect(text(mount(empty.type, empty.props).render())).toContain("0 / 0");
});

it("L11 list disables edge move buttons and announces only confirmed task reorders", async () => {
  const test = listScene();
  const first = mount(
    listTask(test.tree, "a").type,
    listTask(test.tree, "a").props,
  ).render();
  const last = mount(
    listTask(test.tree, "c").type,
    listTask(test.tree, "c").props,
  ).render();
  expect(byLabel(first, `${t.moveCardUp}: a`).props.disabled).toBe(true);
  expect(byLabel(first, `${t.moveCardDown}: a`).props.disabled).toBe(false);
  expect(byLabel(last, `${t.moveCardDown}: c`).props.disabled).toBe(true);

  const pending = deferred<boolean>();
  test.props.onReorderCards
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(true);
  test.view.render();
  byLabel(first, `${t.moveCardDown}: a`).props.onPress();
  const announcement = () =>
    find(
      test.view.render(),
      (e) => e.props.accessibilityLiveRegion === "polite",
    );
  expect(text(announcement())).toBe("");
  pending.resolve(false);
  await vi.waitFor(() =>
    expect(test.props.onReorderCards).toHaveBeenCalledTimes(1),
  );
  expect(text(announcement())).toBe("");
  byLabel(first, `${t.moveCardDown}: a`).props.onPress();
  await vi.waitFor(() => expect(text(announcement())).toContain("a"));
  expect(text(announcement())).toBe(t.taskOrderSaved.replace("{task}", "a"));
});

it("L12 a pending stage mutation completes after switching views without losing its state", async () => {
  viewStorage();
  runtime.query.data = board([card("one", "review", "w")]);
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValueOnce(pending.promise);
  const screen = host();
  const boardView = named(screen.render(), "BoardView");
  const writing = boardView.props.onStage(
    boardView.props.cards[0],
    "in-progress",
  );
  byID(screen.render(), "workboard-view-list").props.onPress();
  const list = named(screen.render(), "ListView");
  expect(list.props.pendingStages.has("one")).toBe(true);
  pending.resolve({
    ...runtime.query.data,
    revision: 2,
    cards: [
      {
        ...runtime.query.data.cards[0],
        stage: "in-progress",
        labels: ["task:in-progress"],
        managedLabels: ["task:in-progress"],
      },
    ],
  });
  await writing;
  expect(named(screen.render(), "ListView").props.cards[0].stage).toBe(
    "in-progress",
  );
  byID(screen.render(), "workboard-view-board").props.onPress();
  expect(named(screen.render(), "BoardView").props.cards[0].stage).toBe(
    "in-progress",
  );
  expect(runtime.mutation).toHaveBeenCalledTimes(1);
});

it("L13 an async drag measurement cannot start a gesture after its handle unmounts", () => {
  let measured:
    | ((left: number, top: number, width: number, height: number) => void)
    | undefined;
  const onBegin = vi.fn(),
    onMove = vi.fn();
  const Probe = () =>
    useDragHandle({
      measure: {
        current: {
          measureInWindow: (callback: typeof measured) => {
            measured = callback;
          },
        },
      } as any,
      disabled: false,
      captureStart: true,
      onBegin,
      onMove,
      onEnd: vi.fn(),
      onCancel: vi.fn(),
    });
  const probe = mount(Probe, {});
  const handlers = probe.render() as any;
  handlers.onStartShouldSetPanResponderCapture({
    nativeEvent: { pageX: 20, pageY: 30 },
  });
  handlers.onPanResponderGrant({}, { moveX: 20, moveY: 30, dx: 0, dy: 0 });
  handlers.onPanResponderMove({}, { moveX: 30, moveY: 30, dx: 10, dy: 0 });
  expect(measured).toBeTypeOf("function");
  for (const slot of frames.at(-1)!.slots) slot?.cleanup?.();
  measured!(0, 0, 200, 50);
  expect(onBegin).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
});

it("L13 an async drag measurement cannot start after the handle becomes disabled", () => {
  let measured:
    | ((left: number, top: number, width: number, height: number) => void)
    | undefined;
  const onBegin = vi.fn(),
    onMove = vi.fn();
  const Probe = (props: { disabled: boolean }) =>
    useDragHandle({
      measure: {
        current: {
          measureInWindow: (callback: typeof measured) => {
            measured = callback;
          },
        },
      } as any,
      disabled: props.disabled,
      captureStart: true,
      onBegin,
      onMove,
      onEnd: vi.fn(),
      onCancel: vi.fn(),
    });
  const probe = mount(Probe, { disabled: false });
  const handlers = probe.render() as any;
  handlers.onStartShouldSetPanResponderCapture({
    nativeEvent: { pageX: 20, pageY: 30 },
  });
  handlers.onPanResponderGrant({}, { moveX: 20, moveY: 30, dx: 0, dy: 0 });
  handlers.onPanResponderMove({}, { moveX: 30, moveY: 30, dx: 10, dy: 0 });
  expect(measured).toBeTypeOf("function");

  probe.props = { disabled: true };
  probe.render();
  measured!(0, 0, 200, 50);
  expect(onBegin).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
});

it("L14 feedback expires from the newest move's own eight-second window without falling back", async () => {
  viewStorage();
  runtime.query.data = board([
    card("one", "review", "w1"),
    card("two", "review", "w2"),
  ]);
  const screen = host();
  const move = async (id: string) => {
    const view = named(screen.render(), "BoardView");
    runtime.mutation.mockImplementationOnce(() =>
      Promise.resolve({
        ...runtime.query.data,
        revision: runtime.query.data.revision + 1,
        cards: runtime.query.data.cards.map((item: Card) =>
          item.id === id
            ? {
                ...item,
                stage: "in-progress",
                labels: ["task:in-progress"],
                managedLabels: ["task:in-progress"],
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }),
    );
    await view.props.onStage(
      view.props.cards.find((item: Card) => item.id === id),
      "in-progress",
    );
  };
  await move("one");
  vi.advanceTimersByTime(4000);
  await move("two");
  expect(text(byID(screen.render(), "workboard-move-feedback"))).toContain(
    "two",
  );
  vi.advanceTimersByTime(7999);
  expect(text(byID(screen.render(), "workboard-move-feedback"))).toContain(
    "two",
  );
  vi.advanceTimersByTime(1);
  expect(() => byID(screen.render(), "workboard-move-feedback")).toThrow();
});

it("renders confirmation details between its summary and actions without changing cancellation", () => {
  const close = vi.fn();
  const confirm = vi.fn();
  const modal = mount(ConfirmationModal, {
    title: "Archive settings",
    description: "2 tasks due",
    children: "Candidate workspace details",
    scrollable: false,
    confirmLabel: "Save",
    disabled: false,
    t,
    theme,
    onClose: close,
    onConfirm: confirm,
  });
  const content = text(modal.render());
  expect(
    find(modal.render(), (element) => element.type === Modal.Content).props
      .scrollable,
  ).toBe(false);
  expect(content.indexOf("Candidate workspace details")).toBeGreaterThan(
    content.indexOf("2 tasks due"),
  );
  expect(content.indexOf("Candidate workspace details")).toBeLessThan(
    content.indexOf(t.cancel),
  );
  find(
    modal.render(),
    (element) => element.props.onPress && text(element) === t.cancel,
  ).props.onPress();
  expect(close).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

it("routes project grouping to the board and leaves the list in its original status layout", () => {
  const screen = host();
  find(
    screen.render(),
    (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
  ).props.onSelect("project");
  expect(named(screen.render(), "ProjectBoardView")).toBeDefined();
  byID(screen.render(), "workboard-view-list").props.onPress();
  expect(named(screen.render(), "ListView")).toBeDefined();
  expect(
    elements(screen.render()).some(
      (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
    ),
  ).toBe(false);
  byID(screen.render(), "workboard-view-board").props.onPress();
  expect(named(screen.render(), "ProjectBoardView")).toBeDefined();
});

it("project lanes retain full native order for mutations while scoping displayed cards", () => {
  runtime.query.data = board([
    {
      ...card("one", "todo", "w1"),
      projectId: "p1",
      projectName: "Project one",
    },
    {
      ...card("two", "review", "w2"),
      projectId: "p2",
      projectName: "Project two",
    },
  ]);
  const screen = host();
  find(
    screen.render(),
    (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
  ).props.onSelect("project");
  const routed = named(screen.render(), "ProjectBoardView");
  const lane = mount(ProjectBoardView, routed.props);
  const tree = lane.render();
  const boards = elements(tree).filter((e) => e.type === BoardView);
  expect(boards.map((e) => e.props.cards.map((c: Card) => c.id))).toEqual([
    ["one"],
    ["two"],
  ]);
  expect(boards.every((e) => e.props.fullCards.length === 2)).toBe(true);
  boards[0].props.onCreateTask();
  expect(named(screen.render(), "TaskModal").props.form.projectId).toBe("p1");

  expect(boards.every((e) => e.props.onStage === routed.props.onStage)).toBe(
    true,
  );
  byLabel(tree, "折叠分组: Project one").props.onPress();
  const next = mount(
    ProjectBoardView,
    named(screen.render(), "ProjectBoardView").props,
  );
  expect(
    elements(next.render()).filter((e) => e.type === BoardView),
  ).toHaveLength(1);
});

it("bulk project folds persist and leave filtered-out projects unchanged", () => {
  viewStorage();
  runtime.query.data = board([
    { ...card("one"), projectId: "p1", projectName: "One" },
    { ...card("two"), projectId: "p2", projectName: "Two" },
  ]);
  const screen = host();
  find(
    screen.render(),
    (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
  ).props.onSelect("project");
  const renderLanes = () =>
    mount(
      ProjectBoardView,
      named(screen.render(), "ProjectBoardView").props,
    ).render();
  find(
    renderLanes(),
    (e) => !!e.props.onPress && text(e) === t.collapseAll,
  ).props.onPress();
  expect(
    elements(renderLanes()).filter((e) => e.type === BoardView),
  ).toHaveLength(0);
  const reloaded = host();
  expect([
    ...named(reloaded.render(), "ProjectBoardView").props.collapsed,
  ]).toEqual(["project:id:p1", "project:id:p2"]);
  const props = named(screen.render(), "ProjectBoardView").props;
  const filtered = mount(ProjectBoardView, {
    ...props,
    cards: [props.cards[0]],
  });
  find(
    filtered.render(),
    (e) => !!e.props.onPress && text(e) === t.expandAll,
  ).props.onPress();
  expect([
    ...named(screen.render(), "ProjectBoardView").props.collapsed,
  ]).toEqual(["project:id:p2"]);
  find(
    renderLanes(),
    (e) => !!e.props.onPress && text(e) === t.expandAll,
  ).props.onPress();
  expect(
    elements(renderLanes()).filter((e) => e.type === BoardView),
  ).toHaveLength(2);
  expect(runtime.mutation).not.toHaveBeenCalled();
});

it("priority sorting stays inside status columns and never overwrites manual order", () => {
  const cards = [
    card("normal"),
    { ...card("high"), priority: "p1" as const },
    { ...card("other", "review"), priority: "p1" as const },
  ];
  const props = {
    cards,
    cardOrderByStage: { todo: ["normal", "high"] },
    priorityFirst: true,
  };
  expect(displayCardsForStage(props, "todo").map((c) => c.id)).toEqual([
    "high",
    "normal",
  ]);
  expect(
    displayCardsForStage({ ...props, priorityFirst: false }, "todo").map(
      (c) => c.id,
    ),
  ).toEqual(["normal", "high"]);
  expect(props.cardOrderByStage.todo).toEqual(["normal", "high"]);
});

it("toolbar dropdown selects and dismisses choices without changing saved card order", () => {
  const onSelect = vi.fn();
  const control = mount(ToolbarSelect, {
    id: "sort",
    title: "排序方式",
    label: "默认排序",
    value: "default",
    options: [
      { value: "default", label: "默认排序" },
      { value: "priority", label: "优先级排序" },
    ],
    onSelect,
    theme,
  });
  const trigger = byID(control.render(), "sort");
  const focus = vi.fn();
  trigger.props.ref.current = {
    measureInWindow: (cb: any) => cb(1300, 30, 90, 36),
    focus,
  };
  trigger.props.onPress();
  const open = control.render();
  const menu = byID(open, "sort-options");
  expect(menu.props.style.left + menu.props.style.width).toBeLessThanOrEqual(
    1432,
  );
  expect(
    byID(open, "sort-option-default").props.accessibilityState.checked,
  ).toBe(true);
  byID(open, "sort-option-priority").props.onPress();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("priority");
  expect(() => byID(control.render(), "sort-options")).toThrow();
  expect(focus).toHaveBeenCalled();
  byID(control.render(), "sort").props.onPress();
  byID(control.render(), "sort-backdrop").props.onPress();
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(() => byID(control.render(), "sort-options")).toThrow();
  control.props.value = "";
  byID(control.render(), "sort").props.onPress();
  const unselected = control.render();
  const optionFocus = vi.fn();
  byID(unselected, "sort-option-default").props.ref.current = {
    focus: optionFocus,
  };
  find(unselected, (e) => !!e.props.onShow).props.onShow();
  expect(optionFocus).toHaveBeenCalledOnce();
  expect(
    byID(unselected, "sort-option-default").props.accessibilityState.checked,
  ).toBe(false);
});

it("settings sorting shares the host preference across Board, project lanes and List", () => {
  const screen = host();
  const menu = () =>
    find(
      screen.render(),
      (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
    );
  menu().props.onSelect("project");
  const before = structuredClone(runtime.query.data.cardOrderByStage);
  expect(named(screen.render(), "ProjectBoardView").props.priorityFirst).toBe(
    true,
  );
  expect(() => byID(screen.render(), "workboard-sort-menu")).toThrow();
  byLabel(screen.render(), strings("zh").settings).props.onPress();
  let settings = named(screen.render(), "SettingsPage");
  expect(settings.props.priorityFirst).toBe(true);
  settings.props.onPriorityFirstChange(false);
  settings = named(screen.render(), "SettingsPage");
  expect(settings.props.priorityFirst).toBe(false);
  settings.props.onBack();
  expect(menu().props.label).toBe("项目分组");
  expect(named(screen.render(), "ProjectBoardView").props.priorityFirst).toBe(
    false,
  );
  byID(screen.render(), "workboard-view-list").props.onPress();
  expect(named(screen.render(), "ListView").props.priorityFirst).toBe(false);
  byLabel(screen.render(), strings("zh").settings).props.onPress();
  settings = named(screen.render(), "SettingsPage");
  settings.props.onPriorityFirstChange(true);
  named(screen.render(), "SettingsPage").props.onBack();
  expect(named(screen.render(), "ListView").props.priorityFirst).toBe(true);
  expect(runtime.query.data.cardOrderByStage).toEqual(before);
  expect(runtime.mutation).not.toHaveBeenCalled();
});

it("priority editor previews, validates, saves and resets a level without changing the other levels", async () => {
  const { PriorityEditor } = await import("../client/PrioritySettings");
  const { DEFAULT_PRIORITY_STYLES } = await import("../shared/model");
  const onChange = vi.fn().mockResolvedValue(false);
  const onClose = vi.fn();
  const editor = mount(PriorityEditor, {
    priority: "p2",
    value: DEFAULT_PRIORITY_STYLES,
    onChange,
    onClose,
    disabled: false,
    theme,
    t: strings("zh"),
  });
  byID(editor.render(), "workboard-priority-name").props.onChangeText(" ");
  expect(byID(editor.render(), "workboard-save-priority").props.disabled).toBe(
    true,
  );
  byID(editor.render(), "workboard-priority-name").props.onChangeText("计划中");
  byLabel(editor.render(), "颜色: 紫色").props.onPress();
  await byID(editor.render(), "workboard-save-priority").props.onPress();
  expect(onChange).toHaveBeenLastCalledWith({
    ...DEFAULT_PRIORITY_STYLES,
    p2: { name: "计划中", color: "violet" },
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(
    elements(editor.render()).some(
      (e) => e.props.accessibilityRole === "alert",
    ),
  ).toBe(true);
  onChange.mockResolvedValue(true);
  byID(editor.render(), "workboard-reset-priority").props.onPress();
  expect(
    byID(editor.render(), "workboard-priority-name").props.initialValue,
  ).toBe("P2");
  byID(editor.render(), "workboard-priority-name").props.onChangeText(
    "普通任务",
  );
  expect(
    byID(editor.render(), "workboard-priority-name").props.initialValue,
  ).toBe("普通任务");
  byID(editor.render(), "workboard-reset-priority").props.onPress();
  await byID(editor.render(), "workboard-save-priority").props.onPress();
  expect(onChange).toHaveBeenLastCalledWith(DEFAULT_PRIORITY_STYLES);
  expect(onClose).toHaveBeenCalledOnce();
});

it("priority settings keep the original save context when settings update during an edit", async () => {
  const { PrioritySettings } = await import("../client/PrioritySettings");
  const original = vi.fn(),
    newer = vi.fn();
  const panel = mount(PrioritySettings, {
    onChange: original,
    disabled: false,
    theme,
    t: strings("zh"),
  });
  byID(panel.render(), "workboard-edit-priority-p1").props.onPress();
  panel.props.onChange = newer;
  expect(named(panel.render(), "PriorityEditor").props.onChange).toBe(original);
});

it("priority badges use four distinct theme-aware tones and custom labels in picker actions", async () => {
  const { PriorityBadge, PriorityPicker } = await import(
    "../client/PriorityPicker"
  );
  const { DEFAULT_PRIORITY_STYLES, PRIORITIES } = await import(
    "../shared/model"
  );
  for (const surface0 of ["#ffffff", "#121212"]) {
    const tones = PRIORITIES.map(
      (value) =>
        PriorityBadge({
          value,
          theme: { ...theme, colors: { ...theme.colors, surface0 } },
          t: strings("en"),
        }).props.style.borderColor,
    );
    expect(new Set(tones).size).toBe(4);
  }
  const onChange = vi.fn().mockResolvedValue(true);
  const picker = mount(PriorityPicker, {
    title: "Task",
    value: "p2",
    priorityStyles: {
      ...DEFAULT_PRIORITY_STYLES,
      p1: { name: "急件", color: "orange" },
    },
    onChange,
    disabled: false,
    theme,
    t: strings("zh"),
  });
  await byLabel(picker.render(), "P1 · 急件").props.onPress();
  expect(onChange).toHaveBeenCalledExactlyOnceWith("p1");
});

it("captures a column resize on press, keeps taps for reset and never treats a drag as a tap", () => {
  const test = columns();
  const begin = vi.fn();
  const end = vi.fn();
  const reset = vi.fn();
  test.column.props = {
    ...test.column.props,
    onResizeBegin: begin,
    onEnd: end,
    onWidthKey: reset,
  };
  const tree = test.column.render();
  byID(tree, "workboard-column-inbox").props.ref.current = {
    measureInWindow: (callback: any) => callback(0, 0, 340, 800),
  };
  const handle = byID(tree, "workboard-resize-inbox").props;
  const press = () => {
    expect(
      handle.onStartShouldSetPanResponderCapture({
        nativeEvent: { pageX: 320, pageY: 100 },
      }),
    ).toBe(true);
    handle.onPanResponderGrant({}, { moveX: 320, moveY: 100, dx: 0, dy: 0 });
  };
  const release = () =>
    handle.onPanResponderRelease({}, { moveX: 320, moveY: 100, dx: 0, dy: 0 });
  press();
  release();
  expect(reset).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  press();
  release();
  expect(reset).toHaveBeenCalledExactlyOnceWith(0);
  reset.mockClear();
  press();
  expect(begin).not.toHaveBeenCalled();
  handle.onPanResponderMove({}, { moveX: 400, moveY: 100, dx: 80, dy: 0 });
  release();
  expect(begin).toHaveBeenCalledOnce();
  expect(end).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
  test.column.props = { ...test.column.props, disabled: true };
  const disabled = byID(test.column.render(), "workboard-resize-inbox").props;
  expect(
    disabled.onStartShouldSetPanResponderCapture({
      nativeEvent: { pageX: 320, pageY: 100 },
    }),
  ).toBe(false);
});

it("refreshes project column coordinates before and during a drag without onLayout", () => {
  const test = orderScene();
  let top = 120;
  const column = find(
    test.view.render(),
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "BoardColumn" &&
      e.props.group.id === "todo",
  );
  column.props.onListLayout({ top: 120, height: 260 });
  column.props.onListRef({
    getNativeScrollRef: () => ({
      measureInWindow: (cb: any) => cb(0, top, 246, 260),
    }),
  });
  const shell = find(
    test.view.render(),
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "TaskDragShell" &&
      e.props.card.id === "a",
  );
  shell.props.onBegin({ left: 0, top: 120, width: 246, height: 80 }, 100, 150);
  shell.props.onMove(100, 240);
  vi.advanceTimersByTime(16);
  top = 40;
  // A release after an ancestor scroll must use current coordinates, even without another pointer move.
  shell.props.onEnd(100, 180);
  expect(test.props.onReorderCards).toHaveBeenCalledWith(
    test.props.cards[0],
    ["a", "b", "c", "d"],
    ["b", "c", "a", "d"],
  );
});

it("persists project folds and widths independently across interleaved lane edits and remounts", () => {
  viewStorage();
  vi.stubGlobal("window", { localStorage });
  const a = columns(),
    b = columns();
  a.props.layoutScope = "project:id:a";
  b.props.layoutScope = "project:id:b";
  // Remount to load each project's own layout key.
  const first = mount(BoardView, a.props),
    second = mount(BoardView, b.props);
  const col = (view: any, id: string) =>
    find(
      view.render(),
      (e) =>
        typeof e.type === "function" &&
        e.type.name === "BoardColumn" &&
        e.props.group.id === id,
    );
  col(first, "todo").props.onToggleCollapsed();
  col(first, "todo").props.onWidthKey(1);
  col(second, "review").props.onToggleCollapsed();
  col(second, "review").props.onWidthKey(-1);
  const reloadedA = mount(BoardView, a.props),
    reloadedB = mount(BoardView, b.props);
  expect(col(reloadedA, "todo").props.collapsed).toBe(true);
  expect(col(reloadedA, "review").props.collapsed).toBe(false);
  expect(col(reloadedB, "review").props.collapsed).toBe(true);
  col(reloadedA, "todo").props.onToggleCollapsed();
  col(reloadedB, "review").props.onToggleCollapsed();
  expect(col(reloadedA, "todo").props.width).toBe(300);
  expect(col(reloadedB, "review").props.width).toBe(260);
});

it("keeps a priority picker open after a rejected pending RPC, allows unrelated tasks and retries", async () => {
  const { PriorityPicker } = await import("../client/PriorityPicker");
  const pending = deferred<Board>();
  runtime.mutation.mockReturnValueOnce(pending.promise);
  const screen = host();
  const task = (id: string) => {
    const view = named(screen.render(), "BoardView");
    return view.props.renderCard(
      view.props.cards.find((c: Card) => c.id === id),
    );
  };
  const one = runtime.query.data.cards[0].id,
    two = runtime.query.data.cards[1].id;
  const item = mount(task(one).type, task(one).props);
  const pickerElement = () => {
    item.props = task(one).props;
    return named(item.render(), "PriorityPicker");
  };
  const picker = mount(PriorityPicker, pickerElement().props);
  byLabel(
    picker.render(),
    `${t.priority}: ${task(one).props.card.title} · ${t.priorities.p2}`,
  ).props.onPress();
  const write = byLabel(picker.render(), t.priorities.p1).props.onPress();
  expect(task(one).props.pending).toBe(true);
  expect(task(two).props.pending).toBe(false);
  picker.props = pickerElement().props;
  expect(byLabel(picker.render(), t.priorities.p1).props.disabled).toBe(true);
  expect(task(two).props.onPriorityChange).toBeTypeOf("function");
  pending.reject(new Error("Task changed; refresh before saving"));
  await write;
  picker.props = pickerElement().props;
  expect(find(picker.render(), (e) => e.type === Modal).props.open).toBe(true);
  expect(
    byLabel(picker.render(), t.priorities.p2).props.accessibilityState.selected,
  ).toBe(true);
  expect(byLabel(picker.render(), t.priorities.p1).props.disabled).toBe(false);
  expect(runtime.toast.error).toHaveBeenCalled();
  runtime.mutation.mockResolvedValueOnce({
    ...runtime.query.data,
    revision: 2,
    cards: runtime.query.data.cards.map((c: Card) =>
      c.id === one ? { ...c, priority: "p1" } : c,
    ),
  });
  await byLabel(picker.render(), t.priorities.p1).props.onPress();
  expect(find(picker.render(), (e) => e.type === Modal).props.open).toBe(false);
  expect(
    runtime.query.data.cards.find((c: Card) => c.id === one).priority,
  ).toBe("p1");
});

it("can resolve native priority conflicts by selecting the currently displayed rank without hiding other issues", async () => {
  const { PriorityPicker } = await import("../client/PriorityPicker");
  const c = {
    ...card("conflict"),
    priority: "p1" as const,
    labels: ["P1", "P3"],
    issue: "native-archive-unknown",
  };
  const item = taskComponent(c);
  const control = named(item.render(), "PriorityPicker");
  expect(text(item.render())).not.toContain("P1");
  expect(text(item.render())).toContain(t.issues["native-archive-unknown"]);
  expect(text(item.render())).toContain(t.issues["priority-labels-conflict"]);
  const change = vi.fn().mockResolvedValue(true);
  const picker = mount(PriorityPicker, { ...control.props, onChange: change });
  await byLabel(picker.render(), t.priorities.p1).props.onPress();
  expect(change).toHaveBeenCalledExactlyOnceWith("p1");
});

it("explicit same-P2 picker selection materializes the native label through the real mutation", async () => {
  const { PriorityPicker } = await import("../client/PriorityPicker");
  const { fixture, workspace } = await import("./fixtures");
  const f = fixture();
  f.inventory.workspaces.push(
    workspace("same-p2", "Example", ["task:todo", "keep"]),
  );
  await f.board.start();
  try {
    runtime.query.data = f.board.snapshot();
    runtime.mutation.mockImplementation((input: any) => f.board.mutate(input));
    const screen = host();
    const taskView = named(screen.render(), "BoardView");
    const taskElement = taskView.props.renderCard(
      runtime.query.data.cards[0],
      false,
    );
    const item = mount(taskElement.type, taskElement.props);
    const pickerElement = named(item.render(), "PriorityPicker");
    const picker = mount(PriorityPicker, pickerElement.props);
    await byLabel(picker.render(), "P2").props.onPress();
    expect(f.inventory.workspaces[0].labels).toEqual([
      "task:todo",
      "keep",
      "P2",
    ]);
    expect(runtime.query.data.cards[0].priority).toBe("p2");
  } finally {
    f.board.dispose();
  }
});

it("List priority sorting is stable and blocks same-stage moves while retaining cross-stage and group moves", () => {
  const a = { ...card("a"), priority: "p2" as const };
  const c = { ...card("c"), priority: "p0" as const };
  const d = { ...card("d"), priority: "p2" as const };
  const test = listScene({
    cards: [a, c, d],
    fullCards: [a, c, d],
    cardOrderByStage: { todo: ["d", "a", "c"] },
    priorityFirst: true,
  });
  const ids = elements(test.tree)
    .filter((e) => typeof e.type === "function" && e.type.name === "ListTask")
    .map((e) => e.props.card.id);
  expect(ids).toEqual(["c", "d", "a"]);
  const source = listTask(test.tree, "a");
  expect(source.props.canMoveUp).toBe(false);
  expect(source.props.canMoveDown).toBe(false);
  source.props.onReorderKey(-1);
  const todoY = test.props.groups.findIndex((g: any) => g.id === "todo") * 220;
  source.props.onBegin(
    { left: 0, top: todoY + 170, width: 500, height: 50 },
    100,
    todoY + 170,
  );
  source.props.onEnd(100, todoY + 60);
  expect(test.props.onReorderCards).not.toHaveBeenCalled();
  source.props.onBegin(
    { left: 0, top: todoY + 170, width: 500, height: 50 },
    100,
    todoY + 170,
  );
  source.props.onEnd(
    100,
    test.props.groups.findIndex((g: any) => g.id === "review") * 220 + 20,
  );
  expect(test.props.onStage).toHaveBeenCalledWith(a, "review");
  const group = listGroup(test.view.render(), test.props.groups[0].id);
  group.props.onReorderKey(1);
  expect(test.props.onReorder).toHaveBeenCalledOnce();
  test.props.priorityFirst = false;
  const manual = test.view.render();
  expect(
    elements(manual)
      .filter((e) => typeof e.type === "function" && e.type.name === "ListTask")
      .map((e) => e.props.card.id),
  ).toEqual(["d", "a", "c"]);
});

it.each(["Board", "List"])(
  "%s cancels active gestures when priority or sorting changes",
  (mode) => {
    const test = mode === "Board" ? orderScene() : listScene();
    const tree = test.view.render();
    const source =
      mode === "Board" ? named(tree, "TaskDragShell") : listTask(tree, "a");
    source.props.onBegin(
      { left: 0, top: 100, width: 300, height: 50 },
      100,
      100,
    );
    test.view.render();
    test.props.fullCards = test.props.fullCards.map((c: Card) => ({
      ...c,
      priority: "p0",
    }));
    test.view.render();
    source.props.onEnd(700, 250);
    expect(test.props.onStage).not.toHaveBeenCalled();
    expect(test.props.onReorderCards).not.toHaveBeenCalled();
    source.props.onBegin(
      { left: 0, top: 100, width: 300, height: 50 },
      100,
      100,
    );
    test.view.render();
    test.props.priorityFirst = !test.props.priorityFirst;
    test.view.render();
    source.props.onEnd(700, 250);
    expect(test.props.onStage).not.toHaveBeenCalled();
    expect(test.props.onReorderCards).not.toHaveBeenCalled();
  },
);

it("uses the actual narrow host surface for Board while retaining the same tasks", () => {
  const screen = host();
  find(screen.render(), (e) => !!e.props.onLayout).props.onLayout({
    nativeEvent: { layout: { width: 480 } },
  });
  const view = named(screen.render(), "BoardView");
  expect(view.props.compact).toBe(true);
  expect(view.props.cards.map((item: Card) => item.id)).toEqual(["one", "two"]);
});

it("changes sorting from the toolbar without a native mutation or losing filters", () => {
  const screen = host();
  const sort = () => {
    const tree = screen.render();
    const view = elements(tree).find(
      (e) => typeof e.type === "function" && e.type.name === "BoardView",
    );
    return (
      view?.props.navigationActions ??
      find(
        tree,
        (e) => e.type === ToolbarSelect && e.props.id === "workboard-sort-menu",
      )
    );
  };
  sort().props.onSelect("default");
  expect(named(screen.render(), "BoardView").props.priorityFirst).toBe(false);
  byID(screen.render(), "workboard-view-list").props.onPress();
  sort().props.onSelect("priority");
  expect(named(screen.render(), "ListView").props.priorityFirst).toBe(true);
  expect(runtime.mutation).not.toHaveBeenCalled();
});

it("shows active filter values after the filter editor closes and clears only that condition", () => {
  runtime.filters = {
    ...DEFAULT_FILTERS,
    activity: "running",
    dateRange: "today",
  };
  const screen = host();
  expect(text(screen.render())).toContain(
    `${t.agentFilter}: ${t.activity.running}`,
  );
  byLabel(
    screen.render(),
    `${t.clearFilters}: ${t.agentFilter}: ${t.activity.running}`,
  ).props.onPress();
  expect(text(screen.render())).not.toContain(
    `${t.agentFilter}: ${t.activity.running}`,
  );
  expect(text(screen.render())).toContain(
    `${t.dateFilter}: ${t.dateRanges.today}`,
  );
});

it.each(["card", "row"] as const)(
  "exposes status directly in %s and retains binding guards",
  (presentation) => {
    const onStatus = vi.fn();
    const value = card("one", "review", "w");
    const item = taskComponent(value, { presentation, onStatus });
    const status = byID(item.render(), "workboard-status-one");
    expect(status.props.accessibilityLabel).toBe(
      `${t.status}: ${t.stages.review} · one`,
    );
    status.props.onPress();
    expect(onStatus).toHaveBeenCalledOnce();
    for (const patch of [{ pending: true }, { disabled: true }]) {
      expect(
        byID(
          taskComponent(value, { presentation, ...patch }).render(),
          "workboard-status-one",
        ).props.disabled,
      ).toBe(true);
    }
  },
);

it("keeps a failed start open with its localized error and current binding intent", async () => {
  runtime.mutation.mockRejectedValue(
    new Error("Workspace binding is still pending"),
  );
  const screen = host();
  const view = named(screen.render(), "BoardView");
  view.props.renderCard(view.props.cards[0]).props.onStart();
  let start = named(screen.render(), "StartModal");
  start.props.onStart(
    { kind: "new", source: { kind: "directory", path: "/fixture" } },
    "in-progress",
  );
  // Routing to the owning host settles every route before reporting the error.
  await vi.advanceTimersByTimeAsync(0);
  start = named(screen.render(), "StartModal");
  expect(start.props.error).toBe(
    t.mutationErrors["Workspace binding is still pending"],
  );
  expect(start.props.card.id).toBe("one");
  const dialog = mount(start.type, start.props);
  expect(
    elements(dialog.render())
      .filter((e) => e.props.accessibilityRole === "alert")
      .map(text),
  ).toContain(start.props.error);
  find(
    dialog.render(),
    (e) => !!e.props.onPress && text(e) === t.customDirectory,
  ).props.onPress();
  byLabel(dialog.render(), t.directory).props.onChangeText("/edited-target");
  dialog.props = {
    ...dialog.props,
    card: { ...start.props.card, title: "Refreshed title" },
  };
  dialog.render();
  expect(byLabel(dialog.render(), t.directory).props.value).toBe(
    "/edited-target",
  );
  const binding = {
    operationId: "fixture",
    stage: "in-progress",
    workspaceId: null,
    target: { kind: "new", source: { kind: "directory", path: "/fixture" } },
  };
  runtime.query.data = board([
    { ...card("one"), binding } as Card,
    card("two"),
  ]);
  expect(named(screen.render(), "StartModal").props.card.binding).toEqual(
    binding,
  );
});

it("restores filters and all column widths without changing task data or other hosts", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  runtime.filters = {
    ...DEFAULT_FILTERS,
    projectId: "none",
    attentionOnly: true,
    activity: "running",
    changeRequest: "open",
    dateRange: "today",
  };
  const screen = host();
  const selectWidth = (value: string) =>
    find(
      screen.render(),
      (e) => e.props.id === "workboard-width-menu",
    ).props.onSelect(value);
  selectWidth("360");
  let view = named(screen.render(), "BoardView");
  expect(view.props.columnLayout).toEqual({ width: 360, overrides: {} });
  view.props.onColumnWidthsChange("host", { todo: 410 });
  view = named(screen.render(), "BoardView");
  expect(view.props.columnLayout.overrides.host.todo).toBe(410);
  expect(
    named(host().render(), "BoardView").props.columnLayout.overrides.host.todo,
  ).toBe(410);
  expect(
    named(hostFor("other").render(), "BoardView").props.columnLayout,
  ).toBeUndefined();
  find(
    screen.render(),
    (e) => !!e.props.onChangeText && e.props.placeholder === t.search,
  ).props.onChangeText("unmatched");
  byID(screen.render(), "workboard-reset-defaults").props.onPress();
  expect(named(screen.render(), "BoardView").props.cards).toHaveLength(2);
  expect(named(screen.render(), "BoardView").props.columnLayout).toEqual({
    width: 280,
    overrides: {},
  });
  expect(runtime.saveFilters).toHaveBeenLastCalledWith("host", DEFAULT_FILTERS);
  vi.advanceTimersByTime(350);
  expect(runtime.saveFilters).toHaveBeenLastCalledWith("host", DEFAULT_FILTERS);
  expect(runtime.mutation).not.toHaveBeenCalled();
});

it("applies a width preset to mounted and later opened lanes, retaining single-column resizing", () => {
  const test = columns();
  test.props.columnLayout = { width: 360, overrides: {} };
  test.props.onColumnWidthsChange = vi.fn();
  test.view.render();
  let column = named(test.view.render(), "BoardColumn");
  expect(column.props.width).toBe(360);
  test.props.columnLayout = { width: 220, overrides: {} };
  test.view.render();
  column = named(test.view.render(), "BoardColumn");
  expect(column.props.width).toBe(220);
  const lane = mount(BoardView, {
    ...test.props,
    layoutScope: "project:id:hidden",
  });
  expect(named(lane.render(), "BoardColumn").props.width).toBe(220);
  column.props.onWidthKey(1);
  expect(test.props.onColumnWidthsChange).toHaveBeenCalledWith(
    "host",
    expect.objectContaining({ inbox: 240 }),
  );
});

it.each(["same group", "other group", "none"])(
  "settings group editor preserves its opening baseline with %s concurrent changes",
  async (change) => {
    const { SettingsPage } = await import("../client/WorkboardScreen");
    const { GroupSettings, GroupEditor } = await import(
      "../client/GroupSettings"
    );
    const { fixture } = await import("./fixtures");
    const test = fixture();
    await test.board.start();
    try {
      const mutate = vi.fn(async (input) => {
        try {
          return await test.board.mutate(input);
        } catch {
          return undefined;
        }
      });
      const page = mount(SettingsPage, {
        board: test.board.snapshot(),
        mutate,
        disabled: false,
        saving: false,
        t,
        theme,
      });
      const panel = mount(
        GroupSettings,
        named(page.render(), "GroupSettings").props,
      );
      const original = test.board
        .snapshot()
        .settings.groups.find((g) => g.id === "todo")!;
      byLabel(
        panel.render(),
        `${t.editGroup}: ${original.name ?? t.stages[original.kind]}`,
      ).props.onPress();
      let editorElement = named(panel.render(), "GroupEditor");
      const editor = mount(GroupEditor, editorElement.props);
      const formElement = named(editor.render(), "GroupForm");
      const form = mount(formElement.type, formElement.props);
      find(
        form.render(),
        (e) => e.props.label === t.groupName,
      ).props.onChangeText("Renamed");
      if (change !== "none") {
        const b = test.board.snapshot();
        await test.board.mutate({
          action: "settings",
          revision: b.revision,
          expectedSettings: b.settings,
          settings: {
            ...b.settings,
            groups: b.settings.groups.map((g) =>
              g.id === (change === "same group" ? "todo" : "review")
                ? { ...g, label: "task:changed-by-b" }
                : g,
            ),
          },
        });
      }
      page.props.board = test.board.snapshot();
      panel.props = named(page.render(), "GroupSettings").props;
      editorElement = named(panel.render(), "GroupEditor");
      editor.props = editorElement.props;
      form.props = named(editor.render(), "GroupForm").props;
      await find(
        form.render(),
        (e) =>
          e.props.accessibilityRole === "button" &&
          text(e.props.children) === t.save,
      ).props.onPress();
      const groups = test.board.snapshot().settings.groups;
      if (change === "none") {
        expect(groups.find((g) => g.id === "todo")?.name).toBe("Renamed");
        expect(groups.find((g) => g.id === "review")).toEqual(
          page.props.board.settings.groups.find((g: any) => g.id === "review"),
        );
      } else {
        expect(groups.find((g) => g.id === "todo")?.name).toBe(original.name);
        expect(
          groups.find(
            (g) => g.id === (change === "same group" ? "todo" : "review"),
          )?.label,
        ).toBe("task:changed-by-b");
        expect(text(form.render())).toContain(t.groupSaveFailed);
      }
    } finally {
      test.board.dispose();
    }
  },
);

it.each(
  [false, true].flatMap((refreshed) =>
    [
      "name",
      "kind",
      "label",
      "deleted",
      "unrelated setting",
      "task",
      "none",
    ].map((change) => ({ refreshed, change })),
  ),
)(
  "status selection retains its opening group after $change (refreshed: $refreshed)",
  async ({ change, refreshed }) => {
    const { fixture, workspace } = await import("./fixtures");
    const test = fixture();
    test.inventory.workspaces.push(workspace("w", "Task", ["task:todo"]));
    await test.board.start();
    try {
      runtime.query.data = test.board.snapshot();
      runtime.mutation.mockImplementation((input) => test.board.mutate(input));
      const screen = host();
      const view = named(screen.render(), "BoardView");
      view.props.renderCard(view.props.cards[0]).props.onStatus();
      const modal = named(screen.render(), "StageModal");
      const menu = mount(modal.type, modal.props);
      let choose = find(menu.render(), (e) => e.key === "review").props.onPress;
      const before = test.board.snapshot();
      if (change === "task") {
        await test.board.mutate({
          action: "create",
          title: "Other task",
          description: "",
          projectId: null,
        });
      } else if (change !== "none") {
        await test.board.mutate({
          action: "settings",
          revision: before.revision,
          expectedSettings: before.settings,
          settings: {
            ...before.settings,
            pinInProgressWorkspaces:
              change === "unrelated setting"
                ? !before.settings.pinInProgressWorkspaces
                : before.settings.pinInProgressWorkspaces,
            groups: before.settings.groups.flatMap((group) =>
              group.id !== "review"
                ? [group]
                : change === "deleted"
                  ? []
                  : [
                      {
                        ...group,
                        ...(change === "name" ? { name: "Renamed" } : {}),
                        ...(change === "kind"
                          ? { kind: "canceled" as const }
                          : {}),
                        ...(change === "label"
                          ? { label: "task:changed" }
                          : {}),
                      },
                    ],
            ),
          },
        });
      }
      if (refreshed) {
        runtime.query.data = test.board.snapshot();
        menu.props = named(screen.render(), "StageModal").props;
        expect(
          menu.props.groups.find((group: any) => group.id === "review"),
        ).toEqual(
          before.settings.groups.find((group) => group.id === "review"),
        );
        choose = find(menu.render(), (e) => e.key === "review").props.onPress;
      }
      choose();
      await vi.waitFor(() =>
        expect(runtime.mutation).toHaveBeenCalledTimes(
          refreshed && ["kind", "label", "deleted"].includes(change) ? 0 : 1,
        ),
      );
      await vi.waitFor(() => {
        if (["kind", "label", "deleted"].includes(change)) {
          expect(runtime.toast.error).toHaveBeenCalledWith(
            t.mutationErrors["stage-group-changed"],
          );
          expect(test.inventory.workspaces[0].labels).toEqual(["task:todo"]);
        } else {
          expect(test.inventory.workspaces[0].labels).toEqual(["task:review"]);
          expect(runtime.toast.error).not.toHaveBeenCalled();
        }
      });
      if (refreshed && ["kind", "label", "deleted"].includes(change)) {
        named(screen.render(), "StageModal").props.onClose();
        const latest = named(screen.render(), "BoardView");
        latest.props.renderCard(latest.props.cards[0]).props.onStatus();
        const reopened = named(screen.render(), "StageModal");
        const target = test.board
          .snapshot()
          .settings.groups.find((group) => group.id === "review");
        expect(
          reopened.props.groups.find((group: any) => group.id === "review"),
        ).toEqual(target);
        if (target) {
          runtime.toast.error.mockClear();
          find(
            mount(reopened.type, reopened.props).render(),
            (e) => e.key === "review",
          ).props.onPress();
          await vi.waitFor(() =>
            expect(test.inventory.workspaces[0].labels).toEqual([target.label]),
          );
          expect(runtime.toast.error).not.toHaveBeenCalled();
        }
      }
      expect(test.host.archive).not.toHaveBeenCalled();
    } finally {
      test.board.dispose();
    }
  },
);

it("rejects a changed draft group before opening Start work from a frozen status menu", async () => {
  const { fixture } = await import("./fixtures");
  const test = fixture();
  await test.board.start();
  try {
    await test.board.mutate({
      action: "create",
      title: "Draft",
      description: "",
      projectId: null,
    });
    runtime.query.data = test.board.snapshot();
    runtime.mutation.mockImplementation((input) => test.board.mutate(input));
    const screen = host();
    const view = named(screen.render(), "BoardView");
    view.props.renderCard(view.props.cards[0]).props.onStatus();
    const before = test.board.snapshot();
    await test.board.mutate({
      action: "settings",
      revision: before.revision,
      settings: {
        ...before.settings,
        defaultDraftGroup: null,
        groups: before.settings.groups
          .map((group) =>
            group.id === "inbox"
              ? { ...group, kind: "review" as const }
              : group,
          )
          .concat({
            id: "other-inbox",
            name: null,
            kind: "inbox",
            label: "task:other-inbox",
          }),
      },
    });
    runtime.query.data = test.board.snapshot();
    const modal = named(screen.render(), "StageModal");
    const menu = mount(modal.type, modal.props);
    find(menu.render(), (e) => e.key === "inbox").props.onPress();
    await vi.waitFor(() =>
      expect(runtime.toast.error).toHaveBeenCalledWith(
        t.mutationErrors["stage-group-changed"],
      ),
    );
    expect(named(screen.render(), "StartModal").props.card).toBeNull();
    expect(test.host.create).not.toHaveBeenCalled();
  } finally {
    test.board.dispose();
  }
});

it.each(["kind", "label", "deleted", "none"])(
  "Start work preserves the selected status-menu definition after %s",
  async (change) => {
    const { fixture } = await import("./fixtures");
    const { mutationSchema } = await import("../shared/rpc");
    const test = fixture();
    await test.board.start();
    try {
      await test.board.mutate({
        action: "create",
        title: "Draft",
        description: "",
        projectId: null,
      });
      runtime.query.data = test.board.snapshot();
      runtime.mutation.mockImplementation((input) =>
        test.board.mutate(mutationSchema.parse(input)),
      );
      const screen = host();
      const view = named(screen.render(), "BoardView");
      view.props.renderCard(view.props.cards[0]).props.onStatus();
      const modal = named(screen.render(), "StageModal");
      find(
        mount(modal.type, modal.props).render(),
        (e) => e.key === "review",
      ).props.onPress();
      const before = test.board.snapshot();
      if (change !== "none")
        await test.board.mutate({
          action: "settings",
          revision: before.revision,
          settings: {
            ...before.settings,
            groups: before.settings.groups.flatMap((group) =>
              group.id !== "review"
                ? [group]
                : change === "deleted"
                  ? []
                  : [
                      {
                        ...group,
                        ...(change === "kind"
                          ? { kind: "canceled" as const }
                          : { label: "task:changed" }),
                      },
                    ],
            ),
          },
        });
      runtime.query.data = test.board.snapshot();
      named(screen.render(), "StartModal").props.onStart(
        { kind: "new", source: { kind: "directory", path: "/fixture" } },
        "review",
      );
      await vi.waitFor(() => {
        if (change === "none")
          expect(test.board.snapshot().cards[0].workspaceId).toBe("w1");
        else
          expect(runtime.toast.error).toHaveBeenCalledWith(
            t.mutationErrors["stage-group-changed"],
          );
      });
      if (change !== "none") {
        expect(test.host.create).not.toHaveBeenCalled();
        expect(test.host.setLabel).not.toHaveBeenCalled();
        expect(test.board.snapshot().cards[0].binding).toBeNull();
      }
    } finally {
      test.board.dispose();
    }
  },
);

it("group deletion rejects settings changed after confirmation opened", async () => {
  const { SettingsPage } = await import("../client/WorkboardScreen");
  const { GroupSettings } = await import("../client/GroupSettings");
  const { fixture } = await import("./fixtures");
  const test = fixture();
  await test.board.start();
  try {
    const mutate = vi.fn(async (input) => {
      try {
        return await test.board.mutate(input);
      } catch {
        return undefined;
      }
    });
    const page = mount(SettingsPage, {
      board: test.board.snapshot(),
      mutate,
      disabled: false,
      saving: false,
      t,
      theme,
    });
    const panel = mount(
      GroupSettings,
      named(page.render(), "GroupSettings").props,
    );
    const group = test.board
      .snapshot()
      .settings.groups.find((g) => g.id === "review")!;
    byLabel(
      panel.render(),
      `${t.deleteGroup}: ${group.name ?? t.stages[group.kind]}`,
    ).props.onPress();
    const b = test.board.snapshot();
    await test.board.mutate({
      action: "settings",
      revision: b.revision,
      expectedSettings: b.settings,
      settings: {
        ...b.settings,
        groups: b.settings.groups.map((g) =>
          g.id === "review" ? { ...g, label: "task:changed-by-b" } : g,
        ),
      },
    });
    page.props.board = test.board.snapshot();
    panel.props = named(page.render(), "GroupSettings").props;
    expect(
      await named(panel.render(), "ConfirmationModal").props.onConfirm(),
    ).toBe(false);
    expect(
      test.board.snapshot().settings.groups.find((g) => g.id === "review")
        ?.label,
    ).toBe("task:changed-by-b");
  } finally {
    test.board.dispose();
  }
});

it.each(["Board", "List"])(
  "%s deletion confirmation preserves its settings baseline",
  async (mode) => {
    const { fixture } = await import("./fixtures");
    for (const change of [
      "name",
      "label",
      "none",
      "cancel",
      "deleted",
      "other group",
      "unrelated setting",
      "task change",
    ]) {
      const test = fixture();
      await test.board.start();
      try {
        runtime.query.data = test.board.snapshot();
        runtime.mutation.mockImplementation((input) =>
          test.board.mutate(input),
        );
        const screen = host();
        if (mode === "List")
          byID(screen.render(), "workboard-view-list").props.onPress();
        const component = mode === "Board" ? BoardView : ListView;
        const view = mount(
          component,
          named(screen.render(), `${mode}View`).props,
        );
        const group = find(
          view.render(),
          (e) =>
            typeof e.type === "function" &&
            e.type.name === (mode === "Board" ? "BoardColumn" : "ListGroup") &&
            e.props.group.id === "review",
        );
        group.props.onMenu();
        find(
          view.render(),
          (e) => e.props.label === t.deleteGroup,
        ).props.onPress();
        const modal = () => named(view.render(), "ConfirmationModal");
        const initial = test.board.snapshot().settings;
        expect(modal().props.description).toContain(
          initial.groups.find((g) => g.id === "review")?.name ??
            t.stages.review,
        );
        if (change === "cancel") {
          const confirmation = mount(ConfirmationModal, modal().props);
          find(
            confirmation.render(),
            (e) => e.props.onPress && text(e) === t.cancel,
          ).props.onPress();
          expect(
            elements(view.render()).some((e) => e.type === ConfirmationModal),
          ).toBe(false);
          expect(
            test.board
              .snapshot()
              .settings.groups.some((g) => g.id === "review"),
          ).toBe(true);
          continue;
        }
        if (change === "task change") {
          const before = test.board.snapshot();
          await test.board.mutate({
            action: "create",
            title: "Concurrent draft",
            description: "",
            projectId: null,
          });
          expect(test.board.snapshot().revision).toBeGreaterThan(
            before.revision,
          );
          expect(test.board.snapshot().settings).toEqual(before.settings);
          runtime.query.data = test.board.snapshot();
          view.props = named(screen.render(), `${mode}View`).props;
        } else if (change !== "none") {
          const b = test.board.snapshot();
          await test.board.mutate({
            action: "settings",
            revision: b.revision,
            expectedSettings: b.settings,
            settings: {
              ...b.settings,
              pinInProgressWorkspaces:
                change === "unrelated setting"
                  ? !b.settings.pinInProgressWorkspaces
                  : b.settings.pinInProgressWorkspaces,
              groups: b.settings.groups
                .filter((g) => change !== "deleted" || g.id !== "review")
                .map((g) =>
                  g.id === (change === "other group" ? "todo" : "review")
                    ? change === "name"
                      ? { ...g, name: "Changed by B" }
                      : change === "label" || change === "other group"
                        ? { ...g, label: "task:changed-by-b" }
                        : g
                    : g,
                ),
            },
          });
          runtime.query.data = test.board.snapshot();
          view.props = named(screen.render(), `${mode}View`).props;
        }
        runtime.toast.error.mockClear();
        const confirmation = mount(ConfirmationModal, modal().props);
        await find(
          confirmation.render(),
          (e) => e.props.onPress && text(e) === t.deleteGroup,
        ).props.onPress();
        const succeeded = change === "none" || change === "task change";
        expect(
          elements(view.render()).some((e) => e.type === ConfirmationModal),
        ).toBe(!succeeded);
        if (!succeeded)
          expect(
            text(
              find(
                confirmation.render(),
                (e) => e.props.accessibilityRole === "alert",
              ),
            ),
          ).toBe(t.confirmationFailed);
        if (!succeeded)
          expect(runtime.toast.error).toHaveBeenCalledWith(
            t.mutationErrors["Settings changed; refresh before saving"],
          );
        if (change === "task change")
          expect(
            test.board
              .snapshot()
              .cards.some((card) => card.title === "Concurrent draft"),
          ).toBe(true);
        const after = test.board.snapshot().settings;
        expect(after.groups.some((g) => g.id === "review")).toBe(
          !succeeded && change !== "deleted",
        );
        if (change === "name")
          expect(after.groups.find((g) => g.id === "review")?.name).toBe(
            "Changed by B",
          );
        if (change === "label")
          expect(after.groups.find((g) => g.id === "review")?.label).toBe(
            "task:changed-by-b",
          );
        if (change === "other group")
          expect(after.groups.find((g) => g.id === "todo")?.label).toBe(
            "task:changed-by-b",
          );
        if (change === "unrelated setting")
          expect(after.pinInProgressWorkspaces).toBe(
            !initial.pinInProgressWorkspaces,
          );
      } finally {
        test.board.dispose();
      }
    }
  },
);

function remoteHost(
  serverId: string,
  cards: Card[],
  settings: Record<string, unknown> = {},
) {
  const data = boardSchema.parse({
    revision: 1,
    serverId,
    version: "test",
    connected: true,
    error: null,
    refreshedAt: null,
    settings,
    cards,
    projects: [
      { id: `${serverId}-p`, name: "Repo", directory: "/r", isGit: true },
    ],
  });
  const rpc = vi.fn(async (contract: { name: string }, input: any) =>
    contract.name === "workboard.snapshot"
      ? data
      : {
          ...data,
          revision: 2,
          settings:
            input.action === "group-sync"
              ? { ...data.settings, groupSyncMaster: input.master }
              : data.settings,
        },
  );
  return {
    runtime: {
      id: serverId,
      serverId,
      rpc,
      sync: { state: "independent", error: null, checkedAt: null },
      requestSync: vi.fn(),
    },
    label: serverId.toUpperCase(),
    board: data as Board | undefined,
    failed: false,
    refetch: vi.fn(),
  };
}
function twoHosts(local: Card[], remote: Card[], settings = {}) {
  runtime.query.data = board(local);
  const other = remoteHost("remote", remote, settings);
  runtime.remotes = [other];
  runtime.hosts = [
    { serverId: "host", label: "Laptop", status: "online" },
    { serverId: "remote", label: "Server", status: "online" },
  ];
  return other;
}
const cardIds = (view: ReactElement<any>) =>
  view.props.cards.map((item: Card) => item.id);

it("M-01 combines hosts on one board and writes a remote card to its own host", async () => {
  const other = twoHosts(
    [card("one", "review", "w")],
    [card("far", "review", "rw")],
  );
  const screen = host();
  const view = named(screen.render(), "BoardView");
  expect(cardIds(view)).toEqual(["one", "far"]);
  const remoteCard = view.props.cards[1];
  expect(view.props.renderCard(remoteCard).props.host).toBe("Server");
  expect(view.props.renderCard(view.props.cards[0]).props.host).toBe("Laptop");
  await view.props.onStage(remoteCard, "done");
  expect(runtime.mutation).not.toHaveBeenCalled();
  expect(other.runtime.rpc).toHaveBeenCalledWith(
    expect.objectContaining({ name: "workboard.mutate" }),
    expect.objectContaining({ action: "stage", taskId: "far", stage: "done" }),
  );
  expect(runtime.cache.setQueryData).toHaveBeenCalledWith(
    ["workboard", "remote"],
    expect.any(Function),
  );
});

it("M-02 opens a remote workspace on the host that owns it", () => {
  twoHosts([], [card("far", "review", "rw")]);
  const navigation = { openWorkspace: vi.fn() };
  const view = named(host("board", navigation).render(), "BoardView");
  view.props.renderCard(view.props.cards[0]).props.onOpen();
  expect(navigation.openWorkspace).toHaveBeenCalledWith({
    workspaceId: "rw",
    serverId: "remote",
  });
});

it("M-03 switches between all hosts and this host only", () => {
  twoHosts([card("one")], [card("far")]);
  const screen = host();
  const toggle = byID(screen.render(), "workboard-all-hosts");
  expect(toggle.props["aria-pressed"]).toBe(true);
  toggle.props.onPress();
  const view = named(screen.render(), "BoardView");
  expect(cardIds(view)).toEqual(["one"]);
  expect(view.props.renderCard(view.props.cards[0]).props.host).toBeUndefined();
});

it("M-04 explains hidden remote tasks whose group this board lacks", () => {
  twoHosts([card("one")], [card("far", "custom-group")]);
  const tree = host().render();
  expect(text(byID(tree, "workboard-hidden-remote"))).toContain("Server");
  expect(cardIds(named(tree, "BoardView"))).toEqual(["one"]);
});

it("M-05 keeps a follower's groups locked on the board with an explanation", async () => {
  runtime.query.data = boardSchema.parse({
    ...board(),
    settings: settingsSchema.parse({ groupSyncMaster: "remote" }),
  });
  runtime.hosts = [{ serverId: "remote", label: "Server", status: "online" }];
  const view = named(host().render(), "BoardView");
  view.props.onEdit(view.props.groups[0]);
  expect(runtime.toast.show).toHaveBeenCalledWith(
    t.groupsFollowing.replace("{master}", "Server"),
    { variant: "warning" },
  );
  expect(await view.props.onReorder(["todo"], ["inbox"])).toBe(false);
  expect(await view.props.onDelete(view.props.groups[0])).toBe(false);
  expect(runtime.mutation).not.toHaveBeenCalled();
  const settings = named(host("settings").render(), "SettingsPage");
  expect(settings.props.groupsLockedBy).toBe("Server");
});

it("M-06 designates the group master on every reachable host", async () => {
  const other = twoHosts([], []);
  runtime.mutation.mockImplementation(async (input: any) => ({
    ...runtime.query.data,
    revision: 2,
    settings: { ...runtime.query.data.settings, groupSyncMaster: input.master },
  }));
  const settings = named(host("settings").render(), "SettingsPage");
  expect(settings.props.hosts.map((item: any) => item.serverId)).toEqual([
    "host",
    "remote",
  ]);
  expect(await settings.props.onSetGroupMaster("host")).toBe(true);
  expect(runtime.mutation).toHaveBeenCalledWith({
    action: "group-sync",
    master: "host",
  });
  expect(other.runtime.rpc).toHaveBeenCalledWith(
    expect.objectContaining({ name: "workboard.mutate" }),
    { action: "group-sync", master: "host" },
  );
  expect(runtime.requestGroupSync).toHaveBeenCalled();
});

it("M-07 creates a draft on the host chosen in the task form", async () => {
  const other = twoHosts([], []);
  const screen = host();
  const tree = screen.render();
  const modal = named(tree, "TaskModal");
  expect(modal.props.hosts.map((item: any) => item.serverId)).toEqual([
    "host",
    "remote",
  ]);
  modal.props.onSave({
    title: "Remote idea",
    description: "",
    projectId: "remote-p",
    serverId: "remote",
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.mutation).not.toHaveBeenCalled();
  expect(other.runtime.rpc).toHaveBeenCalledWith(
    expect.objectContaining({ name: "workboard.mutate" }),
    {
      action: "create",
      title: "Remote idea",
      description: "",
      projectId: "remote-p",
    },
  );
});

it("M-08 keeps a remote project filter and quick-creates on that project's host", async () => {
  const other = twoHosts([], []);
  runtime.filters = { ...DEFAULT_FILTERS, projectId: "remote-p" };
  const screen = host();
  screen.render();
  const tree = screen.render();
  expect(named(tree, "ProjectPicker").props.value).toBe("remote-p");
  const view = named(tree, "BoardView");
  const todo = view.props.groups.find((group: any) => group.kind === "todo");
  expect(await view.props.renderQuickCreate(todo).props.onCreate("Far")).toBe(
    true,
  );
  expect(runtime.mutation).not.toHaveBeenCalled();
  expect(other.runtime.rpc).toHaveBeenCalledWith(
    expect.objectContaining({ name: "workboard.mutate" }),
    expect.objectContaining({
      action: "create",
      title: "Far",
      projectId: "remote-p",
    }),
  );
});

it("M-09 waits for loading hosts before dropping a saved project filter", () => {
  const other = twoHosts([], []);
  const loaded = other.board;
  other.board = undefined;
  runtime.filters = { ...DEFAULT_FILTERS, projectId: "remote-p" };
  const screen = host();
  screen.render();
  expect(named(screen.render(), "ProjectPicker").props.value).toBe("remote-p");
  other.board = loaded;
  runtime.filters = { ...DEFAULT_FILTERS, projectId: "gone" };
  const fresh = host();
  fresh.render();
  expect(named(fresh.render(), "ProjectPicker").props.value).toBe("all");
});

it("M-10 merges hosts again only when a snapshot changes", () => {
  const other = twoHosts([card("one")], [card("far")]);
  const merge = vi.mocked(mergeBoards);
  const screen = host();
  screen.render();
  const calls = merge.mock.calls.length;
  screen.render();
  screen.render();
  expect(merge.mock.calls.length).toBe(calls);
  other.board = { ...other.board!, revision: 2 };
  expect(cardIds(named(screen.render(), "BoardView"))).toEqual(["one", "far"]);
  expect(merge.mock.calls.length).toBe(calls + 1);
});

it("M-11 merges same-named projects across hosts into one project filter", async () => {
  const other = twoHosts(
    [{ ...card("one"), projectId: "host-p" }, card("loose")],
    [{ ...card("far"), projectId: "remote-p" }],
  );
  runtime.query.data = {
    ...runtime.query.data,
    projects: [{ id: "host-p", name: "Repo", directory: "/r", isGit: true }],
  };
  runtime.mutation.mockResolvedValue({ ...runtime.query.data, revision: 2 });
  // A filter saved on the remote copy selects the merged project.
  runtime.filters = { ...DEFAULT_FILTERS, projectId: "remote-p" };
  const screen = host();
  screen.render();
  const tree = screen.render();
  const picker = named(tree, "ProjectPicker");
  expect(picker.props.value).toBe("host-p");
  expect(picker.props.board.projects.map((item: any) => item.name)).toEqual([
    "Repo",
  ]);
  const view = named(tree, "BoardView");
  expect(cardIds(view)).toEqual(["one", "far"]);
  const todo = view.props.groups.find((group: any) => group.kind === "todo");
  expect(await view.props.renderQuickCreate(todo).props.onCreate("Near")).toBe(
    true,
  );
  expect(runtime.mutation).toHaveBeenCalledWith(
    expect.objectContaining({ action: "create", projectId: "host-p" }),
  );
  expect(other.runtime.rpc).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: "workboard.mutate" }),
    expect.anything(),
  );

  // Choosing another host in the task form keeps the same-named project.
  const element = named(tree, "TaskModal");
  const onSave = vi.fn();
  const modal = mount(element.type, {
    ...element.props,
    form: {
      title: "Idea",
      description: "",
      projectId: "host-p",
      serverId: "host",
    },
    onSave,
  });
  modal.render();
  byLabel(modal.render(), `${t.hostField}: Server`).props.onPress();
  find(
    modal.render(),
    (e) => !!e.props.onPress && text(e) === t.create,
  ).props.onPress();
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ serverId: "remote", projectId: "remote-p" }),
  );
});

it("M-12 merges project lanes across hosts and drafts a lane task on the project's host", () => {
  twoHosts(
    [{ ...card("one"), projectId: "host-p" }],
    [{ ...card("far"), projectId: "remote-p" }],
  );
  runtime.query.data = {
    ...runtime.query.data,
    projects: [{ id: "host-p", name: "Repo", directory: "/r", isGit: true }],
  };
  const screen = host();
  find(
    screen.render(),
    (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
  ).props.onSelect("project");
  const routed = named(screen.render(), "ProjectBoardView");
  const lanes = elements(mount(ProjectBoardView, routed.props).render()).filter(
    (e) => e.type === BoardView,
  );
  expect(lanes.map((e) => e.props.cards.map((c: Card) => c.id))).toEqual([
    ["one", "far"],
  ]);
  // The lane may start with the remote copy; the draft uses the listed project's host.
  routed.props.onCreateInProject("remote-p");
  expect(named(screen.render(), "TaskModal").props.form).toEqual(
    expect.objectContaining({ projectId: "host-p", serverId: "host" }),
  );
});

it("M-13 drafts a lane task for a remote-only project on its own host", () => {
  twoHosts([], [{ ...card("far"), projectId: "remote-p" }]);
  const screen = host();
  find(
    screen.render(),
    (e) => e.type === ToolbarSelect && e.props.id === "workboard-group-menu",
  ).props.onSelect("project");
  named(screen.render(), "ProjectBoardView").props.onCreateInProject(
    "remote-p",
  );
  expect(named(screen.render(), "TaskModal").props.form).toEqual(
    expect.objectContaining({ projectId: "remote-p", serverId: "remote" }),
  );
});
