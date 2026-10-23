import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  boardSchema,
  DEFAULT_GROUPS,
  type Board,
  type Group,
} from "../shared/model";
import type { Mutation } from "../shared/rpc";
import {
  hostRegistry,
  requestGroupSync,
  startHostRuntime,
  type HostRpc,
} from "../client/host-runtimes";

const blocked: Group = {
  id: "blocked",
  kind: "in-progress",
  name: null,
  label: "task:blocked",
};
function fakeHost(serverId: string, settings: Partial<Board["settings"]> = {}) {
  let board = boardSchema.parse({
    revision: 1,
    serverId,
    version: "test",
    connected: true,
    error: null,
    refreshedAt: null,
    settings,
    cards: [],
    projects: [],
  });
  const mutations: Mutation[] = [];
  const failures: string[] = [];
  const rpc = (async (contract: { name: string }, input: unknown) => {
    if (contract.name === "workboard.snapshot") return structuredClone(board);
    const mutation = input as Mutation;
    mutations.push(mutation);
    if (failures.length) throw new Error(failures.shift());
    if (mutation.action === "sync-groups")
      board = {
        ...board,
        revision: board.revision + 1,
        settings: {
          ...board.settings,
          groups: mutation.groups,
          groupOrder: mutation.groupOrder,
        },
      };
    return structuredClone(board);
  }) as HostRpc;
  return {
    rpc,
    mutations,
    failures,
    get board() {
      return board;
    },
    set settings(patch: Partial<Board["settings"]>) {
      board = { ...board, settings: { ...board.settings, ...patch } };
    },
  };
}
const scope = () => ({}) as Record<symbol, unknown>;
const stops: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});
const start = (rpc: HostRpc, registry: ReturnType<typeof hostRegistry>) => {
  const stop = startHostRuntime(rpc, { registry, interval: 1000, retry: 500 });
  stops.push(stop);
  return stop;
};
const entry = (registry: ReturnType<typeof hostRegistry>, serverId: string) =>
  registry.runtimes.find((runtime) => runtime.serverId === serverId);

it("publishes each host evaluation in a shared registry and removes it on cleanup", async () => {
  const shared = scope();
  const registry = hostRegistry(shared);
  expect(hostRegistry(shared)).toBe(registry);
  const listener = vi.fn();
  registry.listeners.add(listener);
  const stop = start(fakeHost("a").rpc, registry);
  expect(registry.runtimes).toHaveLength(1);
  expect(registry.runtimes[0].serverId).toBeNull();
  await vi.advanceTimersByTimeAsync(0);
  expect(entry(registry, "a")?.sync.state).toBe("independent");
  expect(listener).toHaveBeenCalled();
  stop();
  expect(registry.runtimes).toHaveLength(0);
});

it("mirrors a confirmed master's groups onto its own host only", async () => {
  const registry = hostRegistry(scope());
  const master = fakeHost("a", {
    groups: [...DEFAULT_GROUPS, blocked],
    groupOrder: ["blocked"],
    groupSyncMaster: "a",
  });
  const follower = fakeHost("b", { groupSyncMaster: "a" });
  start(master.rpc, registry);
  start(follower.rpc, registry);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(master.mutations).toEqual([]);
  expect(follower.mutations).toEqual([
    {
      action: "sync-groups",
      master: "a",
      groups: [...DEFAULT_GROUPS, blocked],
      groupOrder: ["blocked"],
    },
  ]);
  expect(entry(registry, "b")?.sync.state).toBe("synced");
  expect(entry(registry, "a")?.sync.state).toBe("master");
  // In sync: later checks read but do not write.
  await vi.advanceTimersByTimeAsync(1000);
  expect(follower.mutations).toHaveLength(1);
  // A master edit is mirrored as soon as a sync is requested.
  master.settings = { groups: DEFAULT_GROUPS, groupOrder: [] };
  requestGroupSync(registry);
  await vi.advanceTimersByTimeAsync(300);
  expect(follower.mutations).toHaveLength(2);
  expect(follower.board.settings.groups).toEqual(DEFAULT_GROUPS);
});

it("waits for an offline master and syncs once it registers", async () => {
  const registry = hostRegistry(scope());
  const follower = fakeHost("b", { groupSyncMaster: "a" });
  start(follower.rpc, registry);
  await vi.advanceTimersByTimeAsync(0);
  expect(entry(registry, "b")?.sync.state).toBe("waiting");
  const master = fakeHost("a", {
    groups: [...DEFAULT_GROUPS, blocked],
    groupSyncMaster: "a",
  });
  start(master.rpc, registry);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(follower.board.settings.groups).toContainEqual(blocked);
  expect(entry(registry, "b")?.sync.state).toBe("synced");
});

it("does not follow a host that no longer claims to be master", async () => {
  const registry = hostRegistry(scope());
  const formerMaster = fakeHost("a", {
    groups: [...DEFAULT_GROUPS, blocked],
    groupSyncMaster: null,
  });
  const follower = fakeHost("b", { groupSyncMaster: "a" });
  start(formerMaster.rpc, registry);
  start(follower.rpc, registry);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(follower.mutations).toEqual([]);
  expect(entry(registry, "b")?.sync).toMatchObject({
    state: "error",
    error: "group-sync-master-revoked",
  });
});

it("reports a refused mirror and retries it later", async () => {
  const registry = hostRegistry(scope());
  const master = fakeHost("a", { groupSyncMaster: "a" });
  const follower = fakeHost("b", {
    groups: [...DEFAULT_GROUPS, blocked],
    groupSyncMaster: "a",
  });
  follower.failures.push("group-tasks-in-use");
  start(master.rpc, registry);
  start(follower.rpc, registry);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(entry(registry, "b")?.sync).toMatchObject({
    state: "error",
    error: "group-tasks-in-use",
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(follower.mutations).toHaveLength(2);
  expect(entry(registry, "b")?.sync.state).toBe("synced");
});
