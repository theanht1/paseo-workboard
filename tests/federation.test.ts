import { describe, expect, it } from "vitest";
import {
  boardSchema,
  cardsForStage,
  newTask,
  type Board,
  type Card,
} from "../shared/model";
import { mutationSchema } from "../shared/rpc";
import {
  mergeBoards,
  mergeColumn,
  projectMembers,
  routeMutation,
  type HostBoard,
} from "../client/federation";
import { visibleCards } from "../client/board-utils";

function card(
  id: string,
  stage = "todo",
  at = "2026-09-01T00:00:00Z",
  workspaceId: string | null = null,
): Card {
  return {
    ...newTask(id, id, at),
    stage,
    workspaceId,
    lastConversationAt: workspaceId ? at : null,
    labels: [],
    managedLabels: [],
    activity: "idle",
    agents: [],
    pinState: "none",
    dueAt: null,
    changeRequest: null,
    changeRequestUnavailable: false,
  } as Card;
}
function host(
  serverId: string,
  cards: Card[],
  extra: Partial<Board> = {},
): HostBoard {
  return {
    serverId,
    label: serverId.toUpperCase(),
    board: {
      ...boardSchema.parse({
        revision: 1,
        serverId,
        version: "test",
        connected: true,
        error: null,
        refreshedAt: null,
        settings: {},
        cards,
        projects: [
          { id: `${serverId}-p`, name: "Repo", directory: "/r", isGit: true },
        ],
      }),
      ...extra,
    },
  };
}
const ids = (cards: Card[]) => cards.map((item) => item.id);

describe("mergeColumn", () => {
  it("never reorders a host's own cards and interleaves by recent activity", () => {
    const a = [
      card("a1", "todo", "2026-09-01T00:00:00Z"),
      card("a2", "todo", "2026-09-05T00:00:00Z"),
    ];
    const b = [card("b1", "todo", "2026-09-03T00:00:00Z")];
    expect(mergeColumn([a, b])).toEqual(["b1", "a1", "a2"]);
  });

  it("follows the last cross-host arrangement where host orders allow it", () => {
    const a = [card("a1"), card("a2")];
    const b = [card("b1"), card("b2")];
    expect(mergeColumn([a, b], ["a1", "b1", "a2", "b2"])).toEqual([
      "a1",
      "b1",
      "a2",
      "b2",
    ]);
    // An impossible preference cannot break a host order.
    expect(mergeColumn([a, b], ["a2", "a1", "b2", "b1"])).toEqual([
      "a1",
      "a2",
      "b1",
      "b2",
    ]);
  });
});

describe("mergeBoards", () => {
  it("returns the local board untouched without remote hosts", () => {
    const local = host("a", [card("a1")]);
    const merged = mergeBoards(local, []);
    expect(merged.board).toBe(local.board);
    expect(merged.owners.get("a1")).toBe("a");
  });

  it("adds remote cards, owners and projects under the local groups", () => {
    const local = host("a", [card("a1"), card("a2", "review")]);
    const remote = host("b", [
      card("b1", "review"),
      card("b2", "conflict"),
      card("b3", "custom-group"),
      {
        ...card("b4", "custom-group"),
        archived: {
          operationId: "op",
          status: "archived",
          kind: "draft",
          stage: "custom-group",
          group: null,
          startedAt: "2026-09-02T00:00:00Z",
          archivedAt: "2026-09-02T00:00:00Z",
          lastConversationAt: null,
          detail: "",
        },
      } as Card,
    ]);
    const merged = mergeBoards(local, [remote]);
    expect(ids(merged.board.cards)).toEqual(["a1", "a2", "b1", "b2", "b4"]);
    expect(merged.owners.get("b1")).toBe("b");
    expect(merged.owners.get("a2")).toBe("a");
    expect(merged.hidden).toEqual([{ serverId: "b", label: "B", count: 1 }]);
    expect(merged.board.projects.map((project) => project.id)).toEqual(["a-p"]);
    expect(merged.projectOwners.get("b-p")).toBe("b");
    expect(merged.board.settings).toBe(local.board.settings);
    expect(merged.board.serverId).toBe("a");
  });

  it("merges same-named projects across hosts into one filter", () => {
    const project = (id: string, name: string) => ({
      id,
      name,
      directory: `/${id}`,
      isGit: true,
    });
    const local = host("a", [{ ...card("a1"), projectId: "a-p" }], {
      projects: [project("a-p", "Repo"), project("a-q", "Docs")],
    });
    const b = host(
      "b",
      [
        { ...card("b1"), projectId: "b-p" },
        { ...card("b2"), projectId: "b-x" },
      ],
      {
        projects: [
          project("b-p", "Repo"),
          project("b-x", "Tools"),
          project("b-y", "Tools"),
        ],
      },
    );
    const c = host("c", [{ ...card("c1"), projectId: "c-x" }], {
      projects: [project("c-x", "Tools"), project("c-z", "Site")],
    });
    const merged = mergeBoards(local, [b, c]);
    // A host's own duplicates stay apart; a project only one remote has names its host.
    expect(merged.board.projects.map((item) => [item.id, item.name])).toEqual([
      ["a-p", "Repo"],
      ["a-q", "Docs"],
      ["b-x", "Tools"],
      ["b-y", "Tools · B"],
      ["c-z", "Site · C"],
    ]);
    expect(merged.projectAliases.get("b-p")).toBe("a-p");
    expect(merged.projectAliases.get("c-x")).toBe("b-x");
    expect(merged.projectOwners.get("b-x")).toBe("b");
    // Any host's ID selects the whole merged project.
    expect(projectMembers(merged.projectAliases, "b-p")).toEqual([
      "a-p",
      "b-p",
    ]);
    expect(projectMembers(merged.projectAliases, "c-x")).toEqual([
      "b-x",
      "c-x",
    ]);
    expect(projectMembers(merged.projectAliases, "gone")).toEqual(["gone"]);
    expect(
      ids(
        visibleCards(
          merged.board,
          projectMembers(merged.projectAliases, "a-p"),
          "",
          false,
        ),
      ),
    ).toEqual(["a1", "b1"]);
    expect(
      ids(
        visibleCards(
          merged.board,
          projectMembers(merged.projectAliases, "b-x"),
          "",
          false,
        ),
      ),
    ).toEqual(["b2", "c1"]);
  });

  it("preserves every host's saved column order in the merged order", () => {
    const local = host("a", [card("a1"), card("a2")], {
      cardOrderByStage: { todo: ["a2", "a1"] },
    });
    const remote = host("b", [card("b1"), card("b2")], {
      cardOrderByStage: { todo: ["b2", "b1"] },
    });
    const merged = mergeBoards(local, [remote], {
      todo: ["b2", "a2", "b1", "a1"],
    });
    const column = ids(
      cardsForStage(merged.board.cards, "todo", merged.board.cardOrderByStage),
    );
    expect(column).toEqual(["b2", "a2", "b1", "a1"]);
  });

  it("keeps the first owner when the same task ID appears twice", () => {
    const merged = mergeBoards(host("a", [card("x")]), [
      host("b", [card("x")]),
    ]);
    expect(ids(merged.board.cards)).toEqual(["x"]);
    expect(merged.owners.get("x")).toBe("a");
  });
});

describe("routeMutation", () => {
  const owners = new Map([
    ["a1", "a"],
    ["a2", "a"],
    ["b1", "b"],
    ["b2", "b"],
  ]);

  it("sends task mutations to their owner and board-level ones to the local host", () => {
    const stage = mutationSchema.parse({
      action: "stage",
      taskId: "b1",
      stage: "review",
      expectedLabels: [],
    });
    expect(routeMutation(stage, owners, "a")).toEqual([
      { serverId: "b", mutation: stage },
    ]);
    const create = mutationSchema.parse({ action: "create", title: "New" });
    expect(routeMutation(create, owners, "a")[0].serverId).toBe("a");
    const unknown = { ...stage, taskId: "gone" };
    expect(routeMutation(unknown, owners, "a")[0].serverId).toBe("a");
  });

  it("splits a merged column reorder into the owner's own order", () => {
    const routed = routeMutation(
      mutationSchema.parse({
        action: "reorder-cards",
        taskId: "b2",
        stage: "todo",
        expectedOrder: ["a1", "b1", "a2", "b2"],
        cardOrder: ["b2", "a1", "b1", "a2"],
      }),
      owners,
      "a",
    );
    expect(routed).toHaveLength(1);
    expect(routed[0].serverId).toBe("b");
    expect(routed[0].mutation).toMatchObject({
      expectedOrder: ["b1", "b2"],
      cardOrder: ["b2", "b1"],
    });
  });

  it("resets a merged column on every host that has cards in it", () => {
    const routed = routeMutation(
      mutationSchema.parse({
        action: "reset-card-order",
        stage: "todo",
        expectedOrder: ["b1", "a1"],
      }),
      owners,
      "a",
    );
    expect(routed).toEqual([
      {
        serverId: "b",
        mutation: {
          action: "reset-card-order",
          stage: "todo",
          expectedOrder: ["b1"],
        },
      },
      {
        serverId: "a",
        mutation: {
          action: "reset-card-order",
          stage: "todo",
          expectedOrder: ["a1"],
        },
      },
    ]);
    expect(
      routeMutation(
        mutationSchema.parse({
          action: "reset-card-order",
          stage: "todo",
          expectedOrder: [],
        }),
        owners,
        "a",
      ).map((route) => route.serverId),
    ).toEqual(["a"]);
  });
});
