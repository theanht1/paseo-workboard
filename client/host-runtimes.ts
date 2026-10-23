import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";
import { groupSyncRole, sameGroupLayout } from "../shared/model";
import { mutateRpc, snapshotRpc } from "../shared/rpc";

/**
 * Paseo evaluates this client bundle once per connected host that has Workboard installed,
 * and each evaluation's `rpc` reaches only its own daemon. Every evaluation publishes itself
 * in a registry on the shared global object so one surface can reach all hosts.
 *
 * Hosts may run different Workboard releases, so the registry is plain data under a
 * versioned key: entries are replaced rather than mutated, and every change notifies.
 */
export type HostRpc = PluginCommandCapabilities["rpc"];
export type GroupSyncState = {
  /** waiting: the master is offline or does not run this Workboard release. */
  state: "pending" | "independent" | "master" | "synced" | "waiting" | "error";
  /** The server error code of the last failed mirror, or the master that disowned the role. */
  error: string | null;
  checkedAt: number | null;
};
export interface HostRuntime {
  readonly id: string;
  /** Learned from the host's first snapshot. */
  readonly serverId: string | null;
  readonly rpc: HostRpc;
  readonly sync: GroupSyncState;
  requestSync(): void;
}
type Registry = {
  runtimes: readonly HostRuntime[];
  listeners: Set<() => void>;
};
const KEY = Symbol.for("paseo-workboard.host-runtimes.v1");

export function hostRegistry(
  scope: Record<symbol, unknown> = globalThis as never,
): Registry {
  return (scope[KEY] ??= { runtimes: [], listeners: new Set() }) as Registry;
}
function replace(registry: Registry, runtimes: readonly HostRuntime[]) {
  registry.runtimes = runtimes;
  for (const listener of [...registry.listeners]) listener();
}
export function subscribeHostRuntimes(
  listener: () => void,
  registry = hostRegistry(),
): () => void {
  registry.listeners.add(listener);
  return () => {
    registry.listeners.delete(listener);
  };
}
/** Ask every follower to compare with its master now, e.g. after the master's groups change. */
export function requestGroupSync(registry = hostRegistry()): void {
  for (const runtime of registry.runtimes) runtime.requestSync();
}

/**
 * Publish this evaluation's host and keep it mirroring its master's groups while the app
 * runs. Only a follower writes, and only to its own host, so concurrent clients converge.
 */
export function startHostRuntime(
  rpc: HostRpc,
  {
    registry = hostRegistry(),
    interval = 30_000,
    retry = 10_000,
  }: { registry?: Registry; interval?: number; retry?: number } = {},
): () => void {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => registry.runtimes.find((runtime) => runtime.id === id);
  const update = (patch: Partial<HostRuntime>) => {
    const runtime = current();
    if (!runtime || stopped) return;
    replace(
      registry,
      registry.runtimes.map((entry) =>
        entry.id === id ? { ...runtime, ...patch } : entry,
      ),
    );
  };
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void run(), delay);
  };
  const settle = (sync: Omit<GroupSyncState, "checkedAt">) =>
    update({ sync: { ...sync, checkedAt: Date.now() } });
  const run = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    let delay = interval;
    try {
      const own = await rpc(snapshotRpc, {});
      if (current()?.serverId !== own.serverId)
        update({ serverId: own.serverId });
      const master = own.settings.groupSyncMaster;
      const role = groupSyncRole(own.settings, own.serverId);
      if (role !== "follower") {
        settle({ state: role, error: null });
        return;
      }
      const source = registry.runtimes.find(
        (runtime) => runtime.serverId === master,
      );
      if (!source) {
        settle({ state: "waiting", error: null });
        return;
      }
      const leader = await source.rpc(snapshotRpc, {});
      if (leader.settings.groupSyncMaster !== master) {
        settle({ state: "error", error: "group-sync-master-revoked" });
        return;
      }
      if (!sameGroupLayout(own.settings, leader.settings))
        await rpc(mutateRpc, {
          action: "sync-groups",
          master: master!,
          groups: leader.settings.groups,
          groupOrder: leader.settings.groupOrder,
        });
      settle({ state: "synced", error: null });
    } catch (error) {
      settle({
        state: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      delay = retry;
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule(0);
      } else schedule(delay);
    }
  };
  const requestSync = () => schedule(250);
  // A master that just came online lets a waiting follower mirror immediately.
  let known = new Set<string | null>();
  const stopListening = subscribeHostRuntimes(() => {
    const servers = new Set(
      registry.runtimes.map((runtime) => runtime.serverId),
    );
    const arrived = [...servers].some((server) => !known.has(server));
    known = servers;
    if (arrived && current()?.sync.state === "waiting") requestSync();
  }, registry);
  replace(registry, [
    ...registry.runtimes,
    {
      id,
      serverId: null,
      rpc,
      sync: { state: "pending", error: null, checkedAt: null },
      requestSync,
    },
  ]);
  schedule(0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopListening();
    replace(
      registry,
      registry.runtimes.filter((runtime) => runtime.id !== id),
    );
  };
}
