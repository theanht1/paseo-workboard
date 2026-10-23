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
  loadColumnWidths: () => ({}),
  saveColumnWidths: () => true,
}));
vi.mock("../client/column-preferences", () => ({
  loadCollapsedColumns: () => [],
  saveCollapsedColumns: () => true,
}));

import {
  WorkboardScreen,
  TaskCard,
  ArchivePage,
} from "../client/WorkboardScreen";
import { BoardView } from "../client/BoardView";
import { ListView } from "../client/ListView";
import { QuickCreate } from "../client/QuickCreate";
import { useDragHandle } from "../client/drag-handle";
import { ConfirmationModal } from "../client/ConfirmationModal";
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

it.each(["directory", "existing", "worktree", "target"])(
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
      strings(language as "zh" | "en").loadError,
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
  expect(byID(page.render(), "workboard-auto-archive").props.disabled).toBe(
    false,
  );
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
    const second = byID(tree, "workboard-auto-archive").props.onValueChange(
      true,
    );
    await Promise.all([first, second]);
    expect(runtime.mutation).toHaveBeenCalledTimes(2);
    expect(test.store.current.settings).toMatchObject({
      pinInProgressWorkspaces: false,
      autoArchive: false,
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
it("U03 card actions wrap in narrow columns with a two-pixel gap", () => {
  const tree = taskComponent(card("one", "review", "w")).render();
  const actions = find(
    tree,
    (e) =>
      Array.isArray(e.props.children) &&
      e.props.children.some(
        (c: any) => c?.props?.accessibilityLabel === t.notes,
      ),
  );
  expect(flattenStyle(actions.props.style)).toMatchObject({
    gap: 2,
    flexWrap: "wrap",
    maxWidth: "100%",
  });
});
it.each(["hover", "focus"])(
  "U03 card actions show a background on %s and clear on exit",
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
it("U05 card warnings use the metadata font size", () => {
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
      fontSize: 12,
      lineHeight: 16,
    });
  }
});
it.each(["archived", "pending", "uncertain", "external"])(
  "U06 operation ID visibility for %s",
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
    expect(text(page.render()).includes("archive-op")).toBe(
      status === "uncertain" || status === "external",
    );
  },
);
it.each([false, true])(
  "U07 BoardView passes actual handle visibility compact=%s",
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
    const title = find(
      task.render(),
      (e) =>
        e.props.style &&
        flattenStyle(e.props.style).gap === 6 &&
        flattenStyle(e.props.style).alignItems === "flex-start",
    );
    expect(flattenStyle(title.props.style).paddingRight ?? 0).toBe(
      compact ? 0 : 30,
    );
  },
);
it("U08 compact active-filter count is a badge distinct from archive count", () => {
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
    first.props.onEnd(710, 50);
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
        (e) => e.props.horizontal === true,
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
it("F08 list menu resets with the complete column CAS", async () => {
  const test = orderScene();
  const column = find(
    test.view.render(),
    (e) =>
      typeof e.type === "function" &&
      e.type.name === "BoardColumn" &&
      e.props.group.id === "todo",
  );
  column.props.onMenu();
  const action = find(
    test.view.render(),
    (e) => e.props.label === (t as any).resetCardOrder,
  );
  await action.props.onPress();
  expect(test.props.onResetCardOrder).toHaveBeenCalledWith("todo", [
    "a",
    "b",
    "c",
    "d",
  ]);
});

it.each([
  ["working-two", "working-two"],
  [null, "in-progress"],
  ["deleted", "in-progress"],
  ["done", "in-progress"],
] as const)(
  "F05-R01 StartModal submits the configured/fallback working destination %s",
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
  "F05-R01 StartModal preserves %s destination behavior",
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
    if (source !== "binding")
      find(
        modal.render(),
        (e) => e.props.placeholder === t.directory,
      ).props.onChangeText("/fixture/new");
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
it("F05-R01 submits the second working group from StartModal to the real Workboard mutation", async () => {
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
  expect(byLabel(blocked, t.status).props.disabled).toBe(true);
  expect(byLabel(blocked, t.retry)).toBeDefined();
});

it("L06 compact row keeps request warnings singular and activity metadata on one truncatable line", () => {
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
  } as Card;
  const row = taskComponent(value, { presentation: "row", compact: true });
  let tree = row.render();
  const warningCount = () =>
    elements(tree).filter(
      (element) =>
        element.type === Text && text(element) === t.changeRequestUnavailable,
    ).length;
  expect(warningCount()).toBe(1);

  const activity = find(tree, (element) => {
    const style = flattenStyle(element.props.style);
    return (
      style.flexDirection === "row" &&
      style.gap === 4 &&
      elements(element).some((child) => child.props.name === "MessageCircle")
    );
  });
  expect(flattenStyle(activity.props.style).flexWrap).toBe("nowrap");
  const time = find(
    activity,
    (element) =>
      element.type === Text && text(element) === t.unknownConversation,
  );
  expect(flattenStyle(time.props.style)).toMatchObject({
    flexShrink: 1,
    minWidth: 0,
  });

  byLabel(tree, t.details).props.onPress();
  tree = row.render();
  expect(byLabel(tree, t.checks.failure)).toBeDefined();
  expect(byLabel(tree, t.reviews.changes_requested)).toBeDefined();
  expect(warningCount()).toBe(1);
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
