import { describe, expect, it, vi } from "vitest";
import {
  boardSchema,
  newTask,
  settingsSchema,
  type Board,
  type Card,
} from "../shared/model";
import type { Mutation } from "../shared/rpc";
import {
  boardRows,
  boardSections,
  cardStatus,
  createMutation,
  edgeSelection,
  jumpSection,
  moveSelection,
  priorityMutation,
  resolveSelection,
  stageMove,
  windowStart,
} from "../tui/board-model";
import { createBoardStore, type Timers } from "../tui/board-store";
import { errorText, handleKey } from "../tui/controller";
import { boardCommand, editLine, type Key } from "../tui/keys";
import { terminalLanguage, tuiStrings } from "../tui/strings";

const t = tuiStrings("en");
const card = (id: string, overrides: Partial<Card> = {}): Card => ({
  ...newTask(id, `Task ${id}`, "2026-01-01T00:00:00Z"),
  workspaceId: `ws-${id}`,
  projectId: "p1",
  projectName: "Demo",
  stage: "in-progress",
  labels: [],
  managedLabels: ["task:in-progress"],
  changeRequest: null,
  changeRequestUnavailable: false,
  pinState: "none",
  activity: "idle",
  dueAt: null,
  agents: [],
  ...overrides,
});
const draft = (id: string, overrides: Partial<Card> = {}) =>
  card(id, {
    workspaceId: null,
    stage: "todo",
    managedLabels: [],
    ...overrides,
  });
const makeBoard = (cards: Card[], patch: Partial<Board> = {}): Board =>
  boardSchema.parse({
    revision: 1,
    serverId: "srv-demo",
    version: "0.4.0",
    connected: true,
    error: null,
    refreshedAt: null,
    settings: settingsSchema.parse({}),
    cards,
    cardOrderByStage: {},
    projects: [],
    ...patch,
  });
const key = (sequence: string, overrides: Partial<Key> = {}): Key => ({
  name: sequence.toLowerCase(),
  sequence,
  ctrl: false,
  meta: false,
  shift: sequence !== sequence.toLowerCase(),
  ...overrides,
});
const named = (name: string, overrides: Partial<Key> = {}): Key =>
  key("", { name, ...overrides });

/** Timers that run only when the test says so. */
function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const timers: Timers = {
    set(run, ms) {
      pending.set(++next, { run, ms });
      return next;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  const fire = () => {
    const [[handle, entry]] = pending;
    pending.delete(handle);
    entry.run();
  };
  return { timers, pending, fire };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TUI board sections", () => {
  it("lists every group in display order, a leading conflict section, and hides archived cards", () => {
    const board = makeBoard(
      [
        card("a"),
        draft("b"),
        card("c", { stage: "conflict" }),
        draft("d", {
          archived: {
            operationId: "op",
            status: "archived",
            kind: "draft",
            stage: "todo",
            group: null,
            startedAt: "2026-01-02T00:00:00Z",
            archivedAt: "2026-01-02T00:00:00Z",
            lastConversationAt: null,
            detail: "",
          },
        }),
      ],
      {
        settings: settingsSchema.parse({
          groupOrder: ["review", "in-progress"],
        }),
      },
    );
    const sections = boardSections(board, false);
    expect(sections.map((section) => section.id)).toEqual([
      "conflict",
      "review",
      "in-progress",
      "inbox",
      "todo",
      "done",
      "canceled",
    ]);
    expect(
      sections.flatMap((section) => section.cards.map(({ id }) => id)),
    ).toEqual(["c", "a", "b"]);
    expect(
      boardRows(sections).filter((row) => row.kind === "card"),
    ).toHaveLength(3);
  });

  it("keeps only cards that need attention when filtered", () => {
    const board = makeBoard([card("a"), card("b", { activity: "waiting" })]);
    const ids = boardSections(board, true).flatMap((section) =>
      section.cards.map(({ id }) => id),
    );
    expect(ids).toEqual(["b"]);
  });
});

describe("TUI selection", () => {
  const sections = boardSections(
    makeBoard([
      card("a", { stage: "inbox" }),
      card("b"),
      card("c", { stage: "done" }),
    ]),
    false,
  );

  it("follows the selected card and falls back to its index when it vanishes", () => {
    expect(resolveSelection(sections, { id: "b", index: 0 })).toEqual({
      id: "b",
      index: 1,
    });
    expect(resolveSelection(sections, { id: "gone", index: 2 })).toEqual({
      id: "c",
      index: 2,
    });
    expect(resolveSelection(sections, { id: "gone", index: 9 })).toEqual({
      id: "c",
      index: 2,
    });
    expect(resolveSelection([], { id: "a", index: 0 })).toEqual({
      id: null,
      index: 0,
    });
  });

  it("moves, jumps to the edges, and skips empty groups between sections", () => {
    const first = edgeSelection(sections, "first");
    expect(first.id).toBe("a");
    expect(moveSelection(sections, first, -1).id).toBe("a");
    expect(moveSelection(sections, first, 1).id).toBe("b");
    expect(edgeSelection(sections, "last").id).toBe("c");
    // Review sits empty between In progress and Done.
    expect(jumpSection(sections, { id: "b", index: 1 }, 1).id).toBe("c");
    expect(jumpSection(sections, { id: "c", index: 2 }, 1).id).toBe("c");
    expect(jumpSection(sections, { id: "c", index: 2 }, -1).id).toBe("b");
  });

  it("scrolls only as far as needed to keep the selected row visible", () => {
    expect(windowStart(5, 4, 10, 0)).toBe(0);
    expect(windowStart(30, 12, 10, 0)).toBe(3);
    expect(windowStart(30, 5, 10, 3)).toBe(3);
    expect(windowStart(30, 1, 10, 3)).toBe(1);
    expect(windowStart(30, 29, 10, 0)).toBe(20);
  });
});

describe("TUI mutations", () => {
  it("moves a workspace task with the expected labels and target group", () => {
    const board = makeBoard([card("a")]);
    expect(stageMove(board, board.cards[0], 1)).toEqual({
      kind: "mutation",
      group: expect.objectContaining({ id: "review" }),
      mutation: {
        action: "stage",
        taskId: "a",
        stage: "review",
        expectedLabels: ["task:in-progress"],
        expectedGroup: { id: "review", kind: "review", label: "task:review" },
      },
    });
  });

  it("refuses moves the Paseo app would not send directly", () => {
    const board = makeBoard([
      draft("todo"),
      draft("inbox", { stage: "inbox" }),
      card("conflict", { stage: "conflict" }),
      card("binding", {
        binding: {
          operationId: "op",
          target: { kind: "existing", workspaceId: "ws" },
          workspaceId: null,
          stage: "in-progress",
        },
      }),
      card("canceled", { stage: "canceled" }),
    ]);
    const [todo, inbox, conflict, binding, canceled] = board.cards;
    expect(stageMove(board, todo, 1)).toEqual({
      kind: "blocked",
      reason: "needs-start",
    });
    expect(stageMove(board, todo, -1)).toMatchObject({
      kind: "mutation",
      mutation: { stage: "inbox" },
    });
    expect(stageMove(board, inbox, -1)).toEqual({
      kind: "blocked",
      reason: "edge",
    });
    expect(stageMove(board, conflict, 1)).toEqual({
      kind: "blocked",
      reason: "conflict",
    });
    expect(stageMove(board, binding, 1)).toEqual({
      kind: "blocked",
      reason: "binding",
    });
    expect(stageMove(board, canceled, 1)).toEqual({
      kind: "blocked",
      reason: "edge",
    });
  });

  it("creates a draft in the selected To do group, else the host default", () => {
    const settings = settingsSchema.parse({});
    const board = makeBoard(
      [draft("a"), draft("b", { stage: "later" }), card("c")],
      {
        settings: {
          ...settings,
          groups: [
            ...settings.groups,
            { id: "later", name: "Later", kind: "todo", label: "task:later" },
          ],
        },
      },
    );
    const [todo, later, workspace] = board.cards;
    expect(createMutation(board, later, "Write docs")).toEqual({
      action: "create",
      title: "Write docs",
      description: "",
      projectId: null,
      stage: "later",
    });
    expect(createMutation(board, todo, "x")).toMatchObject({ stage: "todo" });
    expect(createMutation(board, workspace, "x")).not.toHaveProperty("stage");
    expect(createMutation(board, null, "x")).not.toHaveProperty("stage");
  });

  it("sets a priority against the card's current priority labels only", () => {
    const task = card("a", { labels: ["P1", "bug", "task:in-progress"] });
    expect(priorityMutation(task, "p0")).toEqual({
      action: "priority",
      taskId: "a",
      updatedAt: task.updatedAt,
      priority: "p0",
      expectedLabels: ["P1"],
    });
  });

  it("describes drafts and change requests in the status text", () => {
    expect(cardStatus(draft("a"), t)).toBe("Demo · Draft");
    const request = card("b", {
      agents: [
        { id: "agent", title: "Agent", activity: "running", archived: false },
      ],
      activity: "running",
      changeRequest: {
        forge: "github",
        number: 12,
        url: "https://example.com/pr/12",
        title: "Fix",
        state: "open",
        checksStatus: "failure",
        reviewDecision: null,
      },
    });
    expect(cardStatus(request, t)).toBe(
      "Demo · Running · #12 Open · CI failed",
    );
  });
});

describe("TUI keys", () => {
  it("maps board keys and ignores modified ones", () => {
    expect(boardCommand(key("j"))).toEqual({ kind: "move", delta: 1 });
    expect(boardCommand(named("down"))).toEqual({ kind: "move", delta: 1 });
    expect(boardCommand(key("J"))).toEqual({ kind: "stage", delta: 1 });
    expect(boardCommand(key("2"))).toEqual({
      kind: "priority",
      priority: "p2",
    });
    expect(boardCommand(named("return", { sequence: "\r" }))).toEqual({
      kind: "open",
    });
    expect(boardCommand(key("j", { ctrl: true }))).toBeNull();
    expect(boardCommand(key("x"))).toBeNull();
  });

  it("edits one line of text, including wide characters", () => {
    expect(editLine("", key("修"))).toEqual({ kind: "edit", value: "修" });
    expect(editLine("a😀", named("backspace"))).toEqual({
      kind: "edit",
      value: "a",
    });
    expect(editLine("abc", key("u", { ctrl: true }))).toEqual({
      kind: "edit",
      value: "",
    });
    expect(editLine("  Fix  ", named("return"))).toEqual({
      kind: "submit",
      value: "Fix",
    });
    expect(editLine("  ", named("return"))).toEqual({
      kind: "edit",
      value: "  ",
    });
    expect(editLine("abc", named("escape"))).toEqual({ kind: "cancel" });
    expect(editLine("abc", named("tab", { sequence: "\t" }))).toEqual({
      kind: "edit",
      value: "abc",
    });
  });

  it("follows the terminal locale for its language", () => {
    expect(terminalLanguage({ LANG: "zh_CN.UTF-8" })).toBe("zh");
    expect(
      terminalLanguage({ LC_ALL: "en_US.UTF-8", LANG: "zh_CN.UTF-8" }),
    ).toBe("en");
    expect(terminalLanguage({})).toBe("en");
    expect(Object.keys(tuiStrings("zh").tui)).toEqual(Object.keys(t.tui));
  });
});

describe("TUI board store", () => {
  it("validates snapshots and keeps the newer board", async () => {
    const replies: unknown[] = [
      makeBoard([card("a")], { revision: 3 }),
      makeBoard([], { revision: 2 }),
      { revision: "broken" },
    ];
    const rpc = vi.fn(async () => replies.shift());
    const store = createBoardStore({ rpc, timers: manualTimers().timers });
    await store.refresh();
    await store.refresh();
    expect(store.getState().board?.cards.map(({ id }) => id)).toEqual(["a"]);
    await store.refresh();
    expect(store.getState().error).toBeInstanceOf(Error);
    expect(store.getState().board?.revision).toBe(3);
    expect(rpc).toHaveBeenCalledWith("workboard.snapshot", {});
  });

  it("polls only while a view is mounted, faster while it has the keyboard", async () => {
    const { timers, pending, fire } = manualTimers();
    const rpc = vi.fn(async () => makeBoard([]));
    const store = createBoardStore({ rpc, timers });
    const delays = () => [...pending.values()].map(({ ms }) => ms);
    await store.refresh();
    expect(delays()).toEqual([]);
    const hideIdle = store.show(false);
    await settle();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(delays()).toEqual([15_000]);
    const hideFocused = store.show(true);
    await settle();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(delays()).toEqual([2_000]);
    fire();
    await settle();
    expect(rpc).toHaveBeenCalledTimes(4);
    hideFocused();
    expect(delays()).toEqual([15_000]);
    hideIdle();
    expect(delays()).toEqual([]);
    store.show(true);
    await settle();
    store.dispose();
    expect(pending.size).toBe(0);
  });

  it("refuses a second write and writes while the board is stale", async () => {
    let release = () => {};
    const rpc = vi.fn(async (method: string) =>
      method === "workboard.mutate"
        ? new Promise((resolve) => {
            release = () => resolve(makeBoard([], { revision: 2 }));
          })
        : makeBoard([card("a")]),
    );
    const store = createBoardStore({ rpc, timers: manualTimers().timers });
    await store.refresh();
    const mutation: Mutation = { action: "archive-draft", taskId: "a" };
    const first = store.mutate(mutation);
    await expect(store.mutate(mutation)).rejects.toMatchObject({
      reason: "pending",
    });
    release();
    await first;
    expect(store.getState().board?.revision).toBe(2);

    const stale = createBoardStore({
      rpc: async () => makeBoard([], { connected: false }),
      timers: manualTimers().timers,
    });
    await stale.refresh();
    await expect(stale.mutate(mutation)).rejects.toMatchObject({
      reason: "disconnected",
    });
  });

  it("rejects an invalid mutation before sending it", async () => {
    const rpc = vi.fn(async () => makeBoard([]));
    const store = createBoardStore({ rpc, timers: manualTimers().timers });
    await store.refresh();
    await expect(
      store.mutate({
        action: "create",
        title: " ",
        description: "",
        projectId: null,
      }),
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("TUI controller", () => {
  async function setup(cards: Card[], mutate?: (input: unknown) => unknown) {
    const sent: unknown[] = [];
    const rpc = vi.fn(async (method: string, input?: unknown) => {
      if (method === "workboard.snapshot") return makeBoard(cards);
      sent.push(input);
      return mutate ? mutate(input) : makeBoard(cards, { revision: 2 });
    });
    const store = createBoardStore({ rpc, timers: manualTimers().timers });
    const host = { focusWorkspace: vi.fn(), notify: vi.fn() };
    await store.refresh();
    const press = async (...keys: Key[]) => {
      for (const item of keys) handleKey(store, host, t, item);
      await settle();
    };
    return { store, host, sent, press };
  }

  it("moves the selected task and reports where it went", async () => {
    const { host, sent, press } = await setup([card("a")]);
    await press(key("J"));
    expect(sent).toEqual([
      expect.objectContaining({ action: "stage", stage: "review" }),
    ]);
    expect(host.notify).toHaveBeenCalledWith("Moved to Review.");
  });

  it("explains a refused draft move without sending it", async () => {
    const { host, sent, press } = await setup([draft("a")]);
    await press(key("J"));
    expect(sent).toEqual([]);
    expect(host.notify).toHaveBeenCalledWith(t.tui.needsStart, "error");
  });

  it("opens a task's workspace and explains drafts", async () => {
    const workspace = await setup([card("a")]);
    await workspace.press(named("return"));
    expect(workspace.host.focusWorkspace).toHaveBeenCalledWith("ws-a");
    const drafts = await setup([draft("a")]);
    await drafts.press(named("return"));
    expect(drafts.host.notify).toHaveBeenCalledWith(t.tui.noWorkspaceToOpen);
  });

  it("creates a draft from typed text and closes the editor", async () => {
    const { store, host, sent, press } = await setup([draft("a")]);
    await press(key("n"), key("F"), key("i"), key("x"), named("return"));
    expect(sent).toEqual([
      {
        action: "create",
        title: "Fix",
        description: "",
        projectId: null,
        stage: "todo",
      },
    ]);
    expect(store.getState().editor).toBeNull();
    expect(host.notify).toHaveBeenCalledWith(t.taskCreated);
  });

  it("keeps the editor and shows the server's reason when a write fails", async () => {
    const { store, host, press } = await setup([draft("a")], () => {
      throw new Error(
        "Request failed: card-order-changed requestType=plugin.rpc.invoke.request code=handler_error",
      );
    });
    await press(key("n"), key("X"), named("return"));
    expect(store.getState().editor).toBe("X");
    expect(host.notify).toHaveBeenCalledWith(
      t.mutationErrors["card-order-changed"],
      "error",
    );
    expect(errorText(new Error("private detail"), t)).toBe(
      t.confirmationFailed,
    );
  });
});
