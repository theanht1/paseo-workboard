import { useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import * as pluginClient from "@getpaseo/plugin/client";
import type { Board } from "../shared/model";
import { snapshotRpc } from "../shared/rpc";
import {
  hostRegistry,
  subscribeHostRuntimes,
  type HostRuntime,
} from "./host-runtimes";

export type HostSummary = {
  serverId: string;
  label: string;
  status: "idle" | "connecting" | "online" | "offline" | "error";
};
export type RemoteBoard = {
  runtime: HostRuntime & { serverId: string };
  label: string;
  board: Board | undefined;
  failed: boolean;
  refetch(): void;
};
const NO_HOSTS: readonly HostSummary[] = [];
const getRuntimes = () => hostRegistry().runtimes;
const subscribe = (listener: () => void) => subscribeHostRuntimes(listener);

export function useHostRuntimes(): readonly HostRuntime[] {
  return useSyncExternalStore(subscribe, getRuntimes, getRuntimes);
}

/** Configured app hosts; empty on Paseo releases without the host list. */
export function useHostSummaries(): readonly HostSummary[] {
  // Read through the namespace: older hosts omit the export, and the check never changes.
  const useHosts = (pluginClient as Partial<typeof pluginClient>).useHosts;
  return typeof useHosts === "function" ? useHosts() : NO_HOSTS;
}

export const hostLabel = (
  hosts: readonly HostSummary[],
  serverId: string,
): string =>
  hosts.find((host) => host.serverId === serverId)?.label ?? serverId;

/** Poll every other host's Workboard while this surface is open. */
export function useRemoteBoards(
  localServerId: string | undefined,
  runtimes: readonly HostRuntime[],
  hosts: readonly HostSummary[],
): RemoteBoard[] {
  const remotes = runtimes.filter(
    (runtime): runtime is HostRuntime & { serverId: string } =>
      !!localServerId &&
      runtime.serverId !== null &&
      runtime.serverId !== localServerId,
  );
  const queries = useQueries({
    queries: remotes.map((runtime) => ({
      queryKey: ["workboard", runtime.serverId],
      queryFn: () => runtime.rpc(snapshotRpc, {}),
      refetchInterval: 3_000,
    })),
  });
  return remotes.map((runtime, index) => ({
    runtime,
    label: hostLabel(hosts, runtime.serverId),
    board: queries[index].data,
    failed: queries[index].isError,
    refetch: () => void queries[index].refetch(),
  }));
}
