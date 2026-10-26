import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  archiveDueAt,
  archiveGate,
  cardsForStage,
  conversationStatusFor,
  defaultGroup,
  defaultWorkspaceGroup,
  defaultStartWorkGroup,
  groupKind,
  groupSyncRole,
  isArchiveDue,
  isDraftGroup,
  isTerminalGroup,
  labelKey,
  newTask,
  newestConflictStage,
  orderedGroups,
  resolveStage,
  sameGroupLayout,
  settingsSchema,
  statusLabels,
  STAGE_COLORS,
  type Board,
  type Card,
  type Data,
  type ConversationAgent,
  type Group,
  type ConversationDisplay,
  type ConversationGate,
  type ConversationReason,
  type Settings,
  type Stage,
  type Task,
} from "../shared/model";
import { CANCEL_BINDING_BUSY_ERROR_CODE, type Mutation } from "../shared/rpc";
import type {
  Agent,
  ConversationEvidence,
  Host,
  Inventory,
  Workspace,
} from "./host";
import type { Store } from "./store";

/** One workspace's combined conversation evidence. */
interface WorkspaceConversation {
  displayAt: string | null;
  display: ConversationDisplay;
  gateAt: string | null;
  gate: ConversationGate;
  reason: ConversationReason | null;
  agents: ConversationAgent[];
}
/** Most severe first, so one reason is stored per task. */
const REASON_ORDER: ConversationReason[] = [
  "timeline-unreadable",
  "child-enumeration-unavailable",
  "child-timeline-unreadable",
  "replay-timestamp",
  "truncated-window",
];

const labelsEqual = (a: string[], b: string[]) =>
  JSON.stringify(a.map(labelKey).sort()) ===
  JSON.stringify(b.map(labelKey).sort());
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const sameOrder = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);
const hidden = (task: Task) =>
  task.archived?.status === "archived" || task.archived?.status === "external";

function projectChangeRequest(workspace?: Workspace): Card["changeRequest"] {
  const runtime = workspace?.githubRuntime;
  const request = runtime?.pullRequest;
  if (!request) return null;
  const nativeState = request.state.toLowerCase();
  const state =
    request.isMerged || nativeState === "merged"
      ? "merged"
      : nativeState === "closed"
        ? "closed"
        : nativeState === "open" || nativeState === "opened"
          ? request.isDraft
            ? "draft"
            : "open"
          : "unknown";
  return {
    forge: workspace?.forge ?? "github",
    number: request.number ?? null,
    url: request.url,
    title: request.title,
    state,
    checksStatus: request.checksStatus ?? null,
    reviewDecision: request.reviewDecision ?? null,
  };
}

/** One writer per plugin process. UI windows never own timers or archive operations. */
export class Workboard {
  private inventory: Inventory = { workspaces: [], agents: [], projects: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  // null means a full refresh; undefined means no work is waiting.
  private pendingRefresh: Set<string> | null | undefined;
  private stopped = false;
  private pendingMutations = 0;
  private connectionGeneration = 0;
  private epoch = 0;
  private workspaceEpochs = new Map<string, number>();
  private bindingInFlight = new Set<string>();
  private queuedStarts = new Map<string, number>();
  private archiveDeferrals = new Map<
    string,
    {
      reason: string;
      attempts: number;
      deferredUntil: number;
      fingerprint: string;
    }
  >();
  private connected = false;
  private error: string | null = "Workboard is starting";
  private refreshedAt: string | null = null;
  constructor(
    private host: Host,
    private store: Store,
    private now: () => number = Date.now,
    private interval = 60000,
  ) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const work = this.queue.then(() => {
      if (this.stopped) throw new Error("Workboard stopped");
      return run();
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  private stamp(previous?: string): string {
    return new Date(
      Math.max(this.now(), previous ? Date.parse(previous) + 1 : 0),
    ).toISOString();
  }
  private task(id: string): Task {
    const task = this.store.current.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task no longer exists");
    return task;
  }
  async start(): Promise<void> {
    await this.serial(async () => {
      await this.load();
      await this.store.update((data) => {
        for (const task of data.tasks)
          if (task.archived?.status === "pending") {
            task.archived.status = "uncertain";
            task.archived.detail =
              "Native archive outcome unknown after restart";
            task.issue = "native-archive-unknown";
          }
      });
      const bindings = this.store.current.tasks.filter((t) => t.binding);
      for (const task of bindings)
        this.bindingInFlight.add(task.binding!.operationId);
      for (const task of bindings) {
        try {
          await this.bind(task.id);
        } catch {
          await this.issue(task.id, "label-sync-incomplete");
        }
      }
      for (const task of bindings)
        this.bindingInFlight.delete(task.binding!.operationId);
      await this.reconcile();
      await this.scan();
    });
    if (!this.stopped)
      this.timer = setInterval(() => {
        void this.refresh().catch(() => undefined);
      }, this.interval);
  }
  private async load() {
    await this.store.load();
    const serverId = this.store.current.serverId;
    if (serverId && serverId !== this.host.identity.serverId)
      throw new Error("Workboard storage belongs to another Paseo host");
    if (!serverId)
      await this.store.update((data) => {
        data.serverId = this.host.identity.serverId;
      });
  }
  refresh(): Promise<void> {
    this.pendingRefresh = null;
    return this.flushRefresh();
  }
  private flushRefresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.serial(async () => {
      const scope = this.pendingRefresh ?? undefined;
      this.pendingRefresh = undefined;
      try {
        if (!this.connected) await this.load();
        await this.reconcile(scope);
        await this.scan(scope);
      } catch (error) {
        this.connected = false;
        this.error = message(error);
        throw error;
      }
    }).finally(() => {
      this.refreshing = undefined;
      if (this.pendingRefresh !== undefined) this.scheduleRefresh();
    });
    return this.refreshing;
  }
  private observation(id: string): string {
    return `${this.epoch}:${this.workspaceEpochs.get(id) ?? 0}`;
  }
  agentChanged(id: string): void {
    this.changed(this.inventory.agents.find((a) => a.id === id)?.workspaceId);
  }
  changed(workspaceId?: string): void {
    if (workspaceId)
      this.workspaceEpochs.set(
        workspaceId,
        (this.workspaceEpochs.get(workspaceId) ?? 0) + 1,
      );
    else this.epoch++;
    if (!workspaceId) this.pendingRefresh = null;
    else if (this.pendingRefresh !== null) {
      this.pendingRefresh ??= new Set();
      this.pendingRefresh.add(workspaceId);
    }
    this.scheduleRefresh();
  }
  private scheduleRefresh(): void {
    if (this.stopped || this.debounce || this.refreshing) return;
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      if (this.pendingRefresh !== undefined)
        void this.flushRefresh().catch(() => undefined);
    }, 300);
  }
  disconnected(reason = "Paseo disconnected"): void {
    this.epoch++;
    this.connectionGeneration++;
    this.connected = false;
    this.error = reason;
  }
  snapshot(data: Data = this.store.current): Board {
    return {
      revision: data.revision,
      ...this.host.identity,
      connected: this.connected,
      error: this.error,
      refreshedAt: this.refreshedAt,
      settings: data.settings,
      cardOrderByStage: data.cardOrderByStage,
      projects: this.inventory.projects,
      cards: data.tasks.map((task) => {
        const workspace = this.inventory.workspaces.find(
          (w) => w.id === task.workspaceId,
        );
        const agents = this.inventory.agents.filter(
          (a) => a.workspaceId === task.workspaceId,
        );
        const activities = agents
          .filter((a) => !a.archivedAt)
          .map((a) => a.activity);
        const activity: Card["activity"] =
          (["waiting", "error", "attention", "running"] as const).find((a) =>
            activities.includes(a),
          ) ?? "idle";
        const stage = task.workspaceId
          ? workspace
            ? resolveStage(
                workspace.labels,
                data.settings.groups,
                data.settings.defaultStartGroup,
              )
            : task.lastStage
          : task.draftStage;
        return {
          ...task,
          stage,
          labels: workspace?.labels ?? [],
          managedLabels: statusLabels(
            workspace?.labels ?? [],
            data.settings.groups,
          ),
          activity,
          changeRequest: projectChangeRequest(workspace),
          changeRequestUnavailable: !!workspace?.githubRuntime?.error,
          pinState:
            workspace?.pinnedAt == null
              ? "none"
              : data.autoPins[workspace.id] === workspace.pinnedAt
                ? "automatic"
                : "manual",
          dueAt:
            task.workspaceId && isTerminalGroup(stage, data.settings.groups)
              ? archiveDueAt(archiveGate(task), data.settings.archiveAfterDays)
              : null,
          agents: agents.map((a) => ({
            id: a.id,
            title: a.title ?? a.id,
            activity: a.activity,
            archived: !!a.archivedAt,
          })),
        };
      }),
    };
  }
  private async reconcile(scope?: ReadonlySet<string>): Promise<void> {
    const connection = this.connectionGeneration;
    const inventory = await this.host.inventory();
    await this.syncPins(inventory, connection);
    const prior = this.store.current;
    const observations = new Map<string, WorkspaceConversation>();
    for (const workspace of inventory.workspaces) {
      const agents = inventory.agents.filter(
        (agent) => agent.workspaceId === workspace.id,
      );
      const previous = prior.tasks.find(
        (task) => task.workspaceId === workspace.id,
      );
      if (scope && !scope.has(workspace.id) && previous) continue;
      if (previous && this.archiveDeferred(previous, workspace, agents))
        continue;
      const evidence = await this.observe(agents, previous, this.now());
      if (previous && this.archiveDeferrals.has(previous.id)) {
        if (evidence.gate === "unknown")
          await this.deferArchive(
            previous,
            "conversation-unknown",
            workspace,
            agents,
          );
        else if (
          !isArchiveDue(
            groupKind(
              resolveStage(
                workspace.labels,
                prior.settings.groups,
                prior.settings.defaultStartGroup,
              ),
              prior.settings.groups,
            ),
            evidence.gateAt,
            this.now(),
            prior.settings.archiveAfterDays,
          )
        )
          this.archiveDeferrals.delete(previous.id);
      }
      observations.set(workspace.id, evidence);
    }
    if (this.stopped) throw new Error("Workboard stopped");
    this.inventory = inventory;
    const resolutions: Array<{
      taskId: string;
      workspaceId: string;
      stage: Stage;
      labels: string[];
    }> = [];
    await this.store.update((data) => {
      for (const workspace of inventory.workspaces) {
        let task = data.tasks.find((t) => t.workspaceId === workspace.id);
        const imported = !task;
        if (!task) {
          task = {
            ...newTask(
              randomUUID(),
              workspace.name,
              this.stamp(),
              defaultWorkspaceGroup(
                data.settings.groups,
                data.settings.defaultStartGroup,
              ),
            ),
            workspaceId: workspace.id,
          };
          data.tasks.push(task);
        }
        if (task.archived?.status === "external") task.archived = null;
        task.title = workspace.name;
        task.projectId = workspace.projectId;
        task.projectName = workspace.projectDisplayName;
        const priorStage = imported ? null : task.lastStage;
        const stage = resolveStage(
          workspace.labels,
          data.settings.groups,
          data.settings.defaultStartGroup,
        );
        task.lastStage = stage;
        // A clean observation refreshes the newest-wins attribution baseline; a conflict
        // must not, or one failed sync would make every later conflict unattributable.
        if (stage !== "conflict") task.resolvedStage = stage;
        // Newest-wins exclusivity: an external edit that added one status label on top of
        // the baseline stage's label is resolvable; any other conflict shape stays manual.
        const baseline =
          task.resolvedStage ??
          (priorStage !== null && priorStage !== "conflict"
            ? priorStage
            : null);
        if (
          stage === "conflict" &&
          baseline !== null &&
          data.settings.exclusiveStatusLabels &&
          task.workspaceId &&
          !task.binding
        ) {
          const newcomer = newestConflictStage(
            baseline,
            workspace.labels,
            data.settings.groups,
          );
          if (newcomer)
            resolutions.push({
              taskId: task.id,
              workspaceId: task.workspaceId,
              stage: newcomer,
              labels: statusLabels(workspace.labels, data.settings.groups),
            });
        }
        const observation = observations.get(workspace.id);
        if (observation) {
          task.lastConversationAt = observation.displayAt;
          task.conversationDisplayEvidence = observation.display;
          task.conversationStatus = conversationStatusFor(observation.display);
          task.conversationGateAt = observation.gateAt;
          task.conversationGateEvidence = observation.gate;
          task.conversationReason = observation.reason;
          task.conversationAgents = observation.agents;
        }
        task.issue =
          task.archived?.status === "uncertain"
            ? "native-archive-unknown"
            : task.binding
              ? "label-sync-incomplete"
              : task.lastStage === "conflict"
                ? "labels-conflict"
                : task.conversationStatus === "unknown"
                  ? "conversation-unknown"
                  : task.conversationStatus === "none"
                    ? "no-conversation"
                    : (this.archiveDeferrals.get(task.id)?.reason ?? null);
      }
      for (const task of data.tasks) {
        if (
          task.workspaceId &&
          !inventory.workspaces.some((w) => w.id === task.workspaceId) &&
          !task.archived &&
          !task.binding &&
          task.issue !== "archive-restored-workspace-unavailable"
        ) {
          task.archived = {
            operationId: randomUUID(),
            kind: "external",
            status: "external",
            stage: task.lastStage,
            group:
              data.settings.groups.find(
                (group) => group.id === task.lastStage,
              ) ?? null,
            startedAt: this.stamp(),
            archivedAt: null,
            lastConversationAt: task.lastConversationAt,
            detail:
              "No longer in Paseo active workspaces; native archive time and cleanup unknown",
          };
        }
      }
    });
    if (connection !== this.connectionGeneration)
      throw new Error(this.error ?? "Paseo disconnected during refresh");
    this.connected = true;
    this.error = null;
    this.refreshedAt = this.stamp();
    if (resolutions.length) await this.resolveExclusivityConflicts(resolutions);
  }
  /**
   * Newest-wins resolution of an exclusively conflicting status label: re-run the same
   * verified label sync a stage change uses, then record the fixed stage. A stale or
   * failing sync keeps the conflict issue for manual resolution.
   */
  private async resolveExclusivityConflicts(
    resolutions: ReadonlyArray<{
      taskId: string;
      workspaceId: string;
      stage: Stage;
      labels: string[];
    }>,
  ): Promise<void> {
    for (const resolution of resolutions) {
      if (this.stopped) return;
      try {
        const workspace = await this.transition(
          resolution.workspaceId,
          resolution.stage,
          resolution.labels,
        );
        this.inventory.workspaces = this.inventory.workspaces.map((w) =>
          w.id === workspace.id ? workspace : w,
        );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === resolution.taskId);
          if (!task) return;
          task.lastStage = resolution.stage;
          task.resolvedStage = resolution.stage;
          if (task.issue === "labels-conflict") task.issue = null;
        });
        this.changed(resolution.workspaceId);
      } catch {
        // The conflict banner stays until the labels are fixed by hand.
      }
    }
  }
  /**
   * Combine every agent's evidence into one display time and one archive gate. Only a full
   * exact read of every agent and every provider child can claim an exact time; anything
   * else keeps the newest observed bound so a task never loses its card time, while the gate
   * stays an upper bound that can only delay archiving.
   */
  private async observe(
    agents: readonly Agent[],
    previous: Task | undefined,
    now: number,
    options: { archivedTimeline?: boolean } = {},
  ): Promise<WorkspaceConversation> {
    const readings: Array<{
      agent: Agent;
      conversation: ConversationEvidence;
    }> = [];
    for (const agent of agents) {
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      let conversation: ConversationEvidence;
      try {
        conversation = await this.host.conversation(agent, now, options);
      } catch {
        // One unreadable agent degrades its own evidence instead of the whole workspace.
        const bound = isChild ? null : (agent.updatedAt ?? null);
        conversation = {
          displayAt: bound,
          display: bound === null ? "unknown" : "upper-bound",
          gateAt: bound,
          gate: bound === null ? "unknown" : "upper-bound",
          reason: isChild ? "child-timeline-unreadable" : "timeline-unreadable",
        };
      }
      readings.push({ agent, conversation });
    }
    const reasons = new Set<ConversationReason>();
    let lower: number | null = null;
    let upper: number | null = null;
    for (const { agent, conversation } of readings) {
      if (conversation.reason) reasons.add(conversation.reason);
      if (
        agent.childEnumeration === "refused" ||
        agent.childEnumeration === "unavailable"
      )
        reasons.add("child-enumeration-unavailable");
      const time = conversation.displayAt
        ? Date.parse(conversation.displayAt)
        : null;
      if (time !== null) {
        // An upper-bound display value never counts as a lower bound of the conversation.
        if (conversation.display === "upper-bound")
          upper = Math.max(upper ?? time, time);
        else lower = Math.max(lower ?? time, time);
      }
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      const activity = isChild ? null : Date.parse(agent.updatedAt);
      if (activity !== null && Number.isFinite(activity))
        upper = Math.max(upper ?? activity, activity);
    }
    const recorded = previous?.conversationAgents ?? [];
    const live = new Set(
      readings
        .filter(({ agent }) => agent.childEnumeration === "complete")
        .map(({ agent }) => agent.id),
    );
    const agentsEvidence: ConversationAgent[] = readings
      .filter(({ agent }) => Boolean(agent.parentAgentId && agent.subagentId))
      .map(({ agent, conversation }) => ({
        id: agent.id,
        lastObservedAt: conversation.displayAt,
        seenWhileLive: live.has(agent.parentAgentId!),
      }));
    const current = new Set(readings.map(({ agent }) => agent.id));
    let blocked = false;
    for (const entry of recorded) {
      if (current.has(entry.id)) continue;
      agentsEvidence.push(entry);
      // A vanished child cannot be re-read, so this workspace can no longer claim an exact
      // time. Its recorded observation still participates in both bounds; without one nothing
      // bounds its conversation any more.
      reasons.add("child-enumeration-unavailable");
      const time = entry.lastObservedAt
        ? Date.parse(entry.lastObservedAt)
        : null;
      if (time === null || !Number.isFinite(time)) {
        blocked = true;
        continue;
      }
      lower = Math.max(lower ?? time, time);
      upper = Math.max(upper ?? time, time);
    }
    if (lower !== null) upper = Math.max(upper ?? lower, lower);
    // Derived after the vanished children folded in: their reasons and their time decide whether
    // this workspace can claim an exact time or the absence of any conversation at all.
    const exact =
      readings.length > 0 &&
      reasons.size === 0 &&
      readings.every(({ conversation }) => conversation.gate === "exact");
    const noConversation =
      readings.length > 0 &&
      reasons.size === 0 &&
      readings.every(({ conversation }) => conversation.display === "none");
    const reason =
      REASON_ORDER.find((candidate) => reasons.has(candidate)) ?? null;
    const bounded =
      lower === null
        ? upper === null
          ? ({ display: "unknown", gate: "unknown" } as const)
          : ({ display: "upper-bound", gate: "upper-bound" } as const)
        : ({
            display: "lower-bound",
            gate: upper === null ? "unknown" : "upper-bound",
          } as const);
    const boundAt = lower ?? upper;
    const display: ConversationDisplay = exact
      ? "exact"
      : noConversation
        ? "none"
        : bounded.display;
    const gate: ConversationGate = exact
      ? "exact"
      : blocked || noConversation || upper === null
        ? "unknown"
        : "upper-bound";
    const gateAt =
      gate === "exact" ? boundAt : blocked || noConversation ? null : upper;
    return {
      displayAt:
        noConversation || boundAt === null
          ? null
          : new Date(boundAt).toISOString(),
      display,
      gateAt: gateAt === null ? null : new Date(gateAt).toISOString(),
      gate,
      reason: exact || noConversation ? null : reason,
      agents: agentsEvidence,
    };
  }
  /**
   * Re-read one candidate's conversation before archiving it. Returns the gate that the
   * archive decision may use, or null when no bound can be proven right now.
   */
  private async verifyConversation(
    candidate: Task,
    agents: readonly Agent[],
  ): Promise<string | null> {
    let gate: number | null = null;
    try {
      // The archive candidate is the one place that pays for an archived agent's timeline,
      // and a vanished child without a recorded time already forces an unknown gate.
      const evidence = await this.observe(agents, candidate, this.now(), {
        archivedTimeline: true,
      });
      const at = archiveGate({
        conversationGateAt: evidence.gateAt,
        conversationGateEvidence: evidence.gate,
      });
      if (at === null) return null;
      gate = Date.parse(at);
    } catch {
      return null;
    }
    return gate === null || !Number.isFinite(gate)
      ? null
      : new Date(gate).toISOString();
  }
  private async syncPins(
    inventory: Inventory,
    connection: number,
  ): Promise<void> {
    const connected = () =>
      !this.stopped && connection === this.connectionGeneration;
    const wantsPin = (workspace: Workspace) => {
      const settings = this.store.current.settings;
      if (workspace.archivingAt) return false;
      const kind = groupKind(
        resolveStage(
          workspace.labels,
          settings.groups,
          settings.defaultStartGroup,
        ),
        settings.groups,
      );
      return (
        (kind === "in-progress" && settings.pinInProgressWorkspaces) ||
        (kind === "review" && settings.pinReviewWorkspaces)
      );
    };
    for (const listed of inventory.workspaces) {
      if (!connected()) return;
      const id = listed.id;
      const owned = this.store.current.autoPins[id];
      if (owned === undefined && !wantsPin(listed)) continue;
      const observation = this.observation(id);
      const current = () => connected() && observation === this.observation(id);
      const workspace = await this.host.workspace(id);
      if (!workspace || !current()) continue;
      if (!wantsPin(workspace)) {
        if (owned && workspace.pinnedAt === owned)
          await this.host.setPinned(id, false);
        if (owned !== undefined)
          await this.store.update((data) => {
            delete data.autoPins[id];
          });
      } else if (owned === undefined) {
        // Persist before the native write. A lost receipt must not claim a manual pin.
        await this.store.update((data) => {
          data.autoPins[id] = null;
        });
        if (workspace.pinnedAt) continue;
        if (!current()) {
          await this.store.update((data) => {
            delete data.autoPins[id];
          });
          continue;
        }
        const pinnedAt = await this.host.setPinned(id, true);
        await this.store.update((data) => {
          data.autoPins[id] = pinnedAt;
        });
      } else if (owned !== null && workspace.pinnedAt !== owned) {
        await this.store.update((data) => {
          data.autoPins[id] = null;
        });
      }
    }
    if (!connected()) return;
    const active = new Set(
      inventory.workspaces.map((workspace) => workspace.id),
    );
    await this.store.update((data) => {
      for (const id of Object.keys(data.autoPins))
        if (!active.has(id)) delete data.autoPins[id];
    });
  }
  private following(settings: Settings = this.store.current.settings) {
    return groupSyncRole(settings, this.host.identity.serverId) === "follower";
  }
  /**
   * A follower mirrors its master's groups and display order exactly. Defaults that would no
   * longer resolve fall back to the first group of their type instead of blocking the mirror.
   */
  private async syncGroups(
    input: Extract<Mutation, { action: "sync-groups" }>,
  ): Promise<boolean> {
    const previous = this.store.current.settings;
    if (!this.following(previous) || previous.groupSyncMaster !== input.master)
      throw new Error("group-sync-not-following");
    if (sameGroupLayout(previous, input)) return false;
    const groups = input.groups;
    const terminalLabels = (list: readonly Group[]) =>
      new Set(
        list
          .filter((group) => isTerminalGroup(group.id, list))
          .map((group) => labelKey(group.label)),
      );
    const before = terminalLabels(previous.groups);
    // A local edit previews newly due workspaces; a mirror cannot, so it pauses archive.
    const pause =
      previous.autoArchive &&
      [...terminalLabels(groups)].some((label) => !before.has(label));
    const kept = (id: Stage | null, valid: (id: Stage) => boolean) =>
      id !== null && groups.some((group) => group.id === id) && valid(id)
        ? id
        : null;
    await this.saveSettings(
      {
        ...previous,
        groups,
        groupOrder: input.groupOrder,
        autoArchive: previous.autoArchive && !pause,
        archivePausedByGroupSync: previous.archivePausedByGroupSync || pause,
        defaultDraftGroup: kept(
          previous.defaultDraftGroup,
          (id) => groupKind(id, groups) === "todo",
        ),
        defaultStartGroup: kept(
          previous.defaultStartGroup,
          (id) => !isTerminalGroup(id, groups),
        ),
        defaultStartWorkGroup: kept(
          previous.defaultStartWorkGroup,
          (id) => groupKind(id, groups) === "in-progress",
        ),
      },
      this.store.current.revision,
      previous,
      true,
    );
    return true;
  }
  /**
   * Persists settings and reports whether groups changed. Group edits re-derive every task's
   * stage and label mapping, so the caller must reconcile; a preference-only save (a toggle)
   * is fully reflected by the response board and the debounced refresh that follows.
   */
  private async saveSettings(
    settings: Settings,
    revision: number,
    expectedSettings?: Settings,
    mirror = false,
  ): Promise<boolean> {
    const previous = this.store.current;
    const unchanged = (data: typeof previous) =>
      expectedSettings
        ? isDeepStrictEqual(data.settings, expectedSettings)
        : data.revision === revision;
    if (!unchanged(previous))
      throw new Error("Settings changed; refresh before saving");
    const next = settingsSchema.parse(settings);
    // Only the group-sync action designates a master.
    next.groupSyncMaster = previous.settings.groupSyncMaster;
    if (
      !mirror &&
      this.following(previous.settings) &&
      !sameGroupLayout(next, previous.settings)
    )
      throw new Error("group-sync-follower");
    if (
      next.defaultStartGroup &&
      isTerminalGroup(next.defaultStartGroup, next.groups)
    )
      throw new Error("group-default-terminal");
    if (next.autoArchive) {
      next.archiveMappingNeedsReview = false;
      next.archivePausedByGroupSync = false;
    }
    if (!mirror) {
      const previousIds = previous.settings.groups.map((group) => group.id);
      const nextIds = next.groups.map((group) => group.id);
      const retained = nextIds.filter((id) => previousIds.includes(id));
      if (
        !sameOrder(
          retained,
          previousIds.filter((id) => nextIds.includes(id)),
        )
      )
        throw new Error("Groups cannot be reordered here");
      if (nextIds.slice(retained.length).some((id) => previousIds.includes(id)))
        throw new Error("Groups cannot be reordered here");
      if (!sameOrder(next.groupOrder, previous.settings.groupOrder))
        throw new Error("Group order changed; refresh before saving");
      next.groupOrder = previous.settings.groupOrder.length
        ? orderedGroups({
            groups: next.groups,
            groupOrder: previous.settings.groupOrder,
          }).map((group) => group.id)
        : [];
    }
    const removed = previous.settings.groups.filter(
      (group) => !next.groups.some((candidate) => candidate.id === group.id),
    );
    for (const task of previous.tasks.filter((task) => !hidden(task))) {
      if (task.binding) {
        const oldGroup = previous.settings.groups.find(
          (group) => group.id === task.binding!.stage,
        )!;
        const newGroup = next.groups.find(
          (group) => group.id === task.binding!.stage,
        );
        if (
          !newGroup ||
          newGroup.kind !== oldGroup.kind ||
          newGroup.label !== oldGroup.label
        )
          throw new Error(
            "A workspace binding still uses this group; finish binding first",
          );
      }
      if (!task.workspaceId && !isDraftGroup(task.draftStage, next.groups))
        throw new Error(
          removed.some((group) => group.id === task.draftStage)
            ? "group-tasks-in-use"
            : "Move the drafts out before deleting this group or changing its type",
        );
    }
    if (removed.length) {
      const epoch = this.epoch;
      const inventory = await this.host.inventory();
      if (epoch !== this.epoch || !this.connected)
        throw new Error("Workspaces changed; refresh before deleting a group");
      for (const group of removed) {
        const missingTasks = previous.tasks.some(
          (task) =>
            !hidden(task) &&
            task.workspaceId &&
            task.lastStage === group.id &&
            !inventory.workspaces.some(
              (workspace) => workspace.id === task.workspaceId,
            ),
        );
        if (
          missingTasks ||
          inventory.workspaces.some((workspace) =>
            workspace.labels.some(
              (label) => labelKey(label) === labelKey(group.label),
            ),
          )
        )
          throw new Error("group-tasks-in-use");
        if (
          !mirror &&
          (group.id ===
            defaultGroup(previous.settings.groups, next.defaultDraftGroup) ||
            group.id ===
              defaultWorkspaceGroup(
                previous.settings.groups,
                next.defaultStartGroup,
              ) ||
            group.id === next.defaultStartWorkGroup)
        )
          throw new Error("group-default-in-use");
      }
    }
    if (
      next.defaultStartWorkGroup &&
      groupKind(next.defaultStartWorkGroup, next.groups) !== "in-progress"
    ) {
      if (
        next.defaultStartWorkGroup ===
          previous.settings.defaultStartWorkGroup &&
        groupKind(next.defaultStartWorkGroup, previous.settings.groups) ===
          "in-progress"
      )
        throw new Error("group-default-in-use");
      throw new Error("group-default-start-work-invalid");
    }
    await this.store.update((data) => {
      if (!unchanged(data))
        throw new Error("Settings changed; refresh before saving");
      for (const group of removed) delete data.cardOrderByStage[group.id];
      data.settings = next;
    });
    return !isDeepStrictEqual(next.groups, previous.settings.groups);
  }
  private checkCardOrder(
    data: Data,
    input: Extract<Mutation, { action: "reorder-cards" | "reset-card-order" }>,
  ): void {
    if (!data.settings.groups.some((group) => group.id === input.stage))
      throw new Error("Group no longer exists");
    const current = cardsForStage(
      this.snapshot(data).cards,
      input.stage,
      data.cardOrderByStage,
    ).map((card) => card.id);
    if (!sameOrder(input.expectedOrder, current))
      throw new Error("card-order-changed");
    if (input.action === "reorder-cards") {
      const mover = data.tasks.find((task) => task.id === input.taskId);
      if (
        !mover ||
        !current.includes(input.taskId) ||
        mover.archived !== null ||
        mover.binding !== null
      )
        throw new Error("card-order-mover-unavailable");
      if (
        input.cardOrder.length !== current.length ||
        new Set(input.cardOrder).size !== current.length ||
        input.cardOrder.some((id) => !current.includes(id)) ||
        !sameOrder(
          input.cardOrder.filter((id) => id !== input.taskId),
          current.filter((id) => id !== input.taskId),
        )
      )
        throw new Error("card-order-invalid");
    }
  }
  private checkStageExpected(
    data: Data,
    input: Extract<Mutation, { action: "stage" }>,
  ): void {
    if (input.expectedGroup) {
      const group = data.settings.groups.find(
        (group) => group.id === input.stage,
      );
      const expected = input.expectedGroup;
      if (
        !group ||
        expected.id !== group.id ||
        expected.kind !== group.kind ||
        expected.label !== group.label
      )
        throw new Error("stage-group-changed");
    }
    if (
      input.expectedUpdatedAt !== undefined &&
      data.tasks.find((task) => task.id === input.taskId)?.updatedAt !==
        input.expectedUpdatedAt
    )
      throw new Error("stage-task-changed");
  }
  async mutate(input: Mutation): Promise<Board> {
    // Reject before queueing so an active or queued start cannot be canceled after it fails.
    if (
      input.action === "cancel-binding" &&
      (this.bindingInFlight.has(input.operationId) ||
        this.queuedStarts.has(input.taskId))
    )
      throw new Error(CANCEL_BINDING_BUSY_ERROR_CODE);
    if (input.action === "start")
      this.queuedStarts.set(
        input.taskId,
        (this.queuedStarts.get(input.taskId) ?? 0) + 1,
      );
    this.epoch++;
    this.pendingMutations++;
    return this.serial(async () => {
      if (!this.connected)
        throw new Error(this.error ?? "Paseo is disconnected");
      try {
        if (input.action === "create") {
          const stage =
            input.stage ??
            defaultGroup(
              this.store.current.settings.groups,
              this.store.current.settings.defaultDraftGroup,
            );
          if (groupKind(stage, this.store.current.settings.groups) !== "todo")
            throw new Error("Choose a To do group for a new draft");
          await this.store.update((data) => {
            const task = newTask(
              randomUUID(),
              input.title,
              this.stamp(),
              stage,
            );
            task.description = input.description;
            task.projectId = input.projectId;
            task.projectName =
              this.inventory.projects.find((p) => p.id === input.projectId)
                ?.name ?? "";
            data.tasks.push(task);
          });
        } else if (input.action === "group-sync") {
          await this.store.update((data) => {
            data.settings.groupSyncMaster = input.master;
          });
        } else if (input.action === "sync-groups") {
          if (await this.syncGroups(input)) {
            await this.reconcile();
            this.changed();
          }
        } else if (input.action === "settings") {
          const groupsChanged = await this.saveSettings(
            input.settings,
            input.revision,
            input.expectedSettings,
          );
          // A full reconcile re-reads every conversation; only group edits need one now.
          if (groupsChanged) await this.reconcile();
          this.changed();
        } else if (
          input.action === "reorder-cards" ||
          input.action === "reset-card-order"
        ) {
          this.checkCardOrder(this.store.current, input);
          await this.store.update((data) => {
            this.checkCardOrder(data, input);
            if (input.action === "reset-card-order")
              delete data.cardOrderByStage[input.stage];
            else data.cardOrderByStage[input.stage] = input.cardOrder;
          });
        } else if (input.action === "reorder-groups") {
          if (this.following()) throw new Error("group-sync-follower");
          const current = orderedGroups(this.store.current.settings).map(
            (group) => group.id,
          );
          const groups = this.store.current.settings.groups;
          if (!sameOrder(input.expectedGroupOrder, current))
            throw new Error("Group order changed; refresh before reordering");
          if (
            input.groupOrder.length !== groups.length ||
            input.groupOrder.some(
              (id) => !groups.some((group) => group.id === id),
            )
          )
            throw new Error("Group order is invalid");
          await this.store.update((data) => {
            const fresh = orderedGroups(data.settings).map((group) => group.id);
            if (!sameOrder(input.expectedGroupOrder, fresh))
              throw new Error("Group order changed; refresh before reordering");
            data.settings.groupOrder = input.groupOrder;
          });
        } else {
          const task = this.task(input.taskId);
          if (hidden(task) && input.action !== "resolve-archive")
            throw new Error(
              input.action === "detach-draft"
                ? "detach-draft-archived"
                : "Task is archived",
            );
          if (input.action === "edit") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("Task changed; refresh before saving");
              if (!current.workspaceId) {
                current.title = input.title;
                current.projectId = input.projectId;
                current.projectName =
                  this.inventory.projects.find((p) => p.id === input.projectId)
                    ?.name ?? "";
              }
              current.description = input.description;
              current.updatedAt = this.stamp(current.updatedAt);
            });
          } else if (input.action === "start") {
            if (!task.binding && task.workspaceId)
              throw new Error("Task already has a workspace");
            const stage =
              input.stage ??
              task.binding?.stage ??
              defaultStartWorkGroup(
                this.store.current.settings.groups,
                this.store.current.settings.defaultStartWorkGroup,
              );
            if (
              !stage ||
              !this.store.current.settings.groups.some(
                (group) => group.id === stage,
              )
            )
              throw new Error("Add an In progress group before starting work");
            if (isDraftGroup(stage, this.store.current.settings.groups))
              throw new Error(
                "Choose a working or completed group for the workspace",
              );
            if (
              task.binding &&
              (JSON.stringify(task.binding.target) !==
                JSON.stringify(input.target) ||
                task.binding.stage !== stage)
            )
              throw new Error(
                "A previous binding is pending; retry its original target",
              );
            if (!task.binding)
              await this.store.update((data) => {
                data.tasks.find((t) => t.id === task.id)!.binding = {
                  operationId: randomUUID(),
                  target: input.target,
                  workspaceId: null,
                  stage,
                };
              });
            await this.bind(task.id);
            await this.reconcile();
          } else if (input.action === "stage") {
            const check = () => {
              if (
                input.expectedUpdatedAt !== undefined ||
                input.expectedGroup !== undefined
              )
                this.checkStageExpected(this.store.current, input);
            };
            check();
            if (
              !this.store.current.settings.groups.some(
                (group) => group.id === input.stage,
              )
            )
              throw new Error("Group no longer exists");
            if (task.binding)
              throw new Error("Workspace binding is still pending");
            if (task.workspaceId) {
              const workspace = await this.transition(
                task.workspaceId,
                input.stage,
                input.expectedLabels,
                check,
              );
              this.inventory.workspaces = this.inventory.workspaces.map((w) =>
                w.id === workspace.id ? workspace : w,
              );
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                this.checkStageExpected(data, input);
                current.lastStage = input.stage;
                // The verified sync made this a clean observation: move the
                // newest-wins baseline with it, or an external label change
                // arriving before the next refresh would be attributed
                // against the stale stage and could delete the newer label.
                current.resolvedStage = input.stage;
                current.updatedAt = this.stamp(current.updatedAt);
                if (current.issue === "labels-conflict") current.issue = null;
              });
              this.changed(workspace.id);
            } else {
              if (
                !isDraftGroup(input.stage, this.store.current.settings.groups)
              )
                throw new Error("Start work and bind a workspace first");
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                this.checkStageExpected(data, input);
                current.draftStage = input.stage;
                current.lastStage = input.stage;
                current.resolvedStage = input.stage;
                current.updatedAt = this.stamp(current.updatedAt);
              });
            }
          } else if (input.action === "archive-draft") {
            if (
              task.workspaceId ||
              groupKind(task.draftStage, this.store.current.settings.groups) !==
                "canceled" ||
              task.binding
            )
              throw new Error(
                "Only canceled, unbound drafts can be archived here",
              );
            await this.store.update((data) => {
              data.tasks.find((t) => t.id === task.id)!.archived = {
                operationId: randomUUID(),
                kind: "draft",
                status: "archived",
                stage: task.draftStage,
                group:
                  data.settings.groups.find(
                    (group) => group.id === task.draftStage,
                  ) ?? null,
                startedAt: this.stamp(),
                archivedAt: this.stamp(),
                lastConversationAt: null,
                detail: "Draft archived; no native workspace",
              };
            });
          } else if (input.action === "detach-draft") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("detach-draft-stale");
              const source = current.mergedDrafts.find(
                (source) => source.draftId === input.draftId,
              );
              if (!source) throw new Error("detach-draft-missing");
              if (data.tasks.some((t) => t.id === source.draftId))
                throw new Error("detach-draft-id-in-use");
              const start = current.description.indexOf(source.appendedText);
              if (
                start < 0 ||
                current.description.indexOf(source.appendedText, start + 1) >= 0
              )
                throw new Error("detach-draft-text-changed");
              const draft = newTask(
                source.draftId,
                source.title,
                this.stamp(),
                defaultGroup(
                  data.settings.groups,
                  data.settings.defaultDraftGroup,
                ),
              );
              draft.description = source.description;
              current.description =
                current.description.slice(0, start) +
                current.description.slice(start + source.appendedText.length);
              current.mergedDrafts = current.mergedDrafts.filter(
                (entry) => entry !== source,
              );
              current.updatedAt = this.stamp(current.updatedAt);
              data.tasks.push(draft);
            });
          } else if (input.action === "cancel-binding") {
            if (!task.binding) throw new Error("cancel-binding-missing");
            if (task.binding.operationId !== input.operationId)
              throw new Error("cancel-binding-changed");
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              current.binding = null;
              current.issue = null;
              current.updatedAt = this.stamp(current.updatedAt);
            });
          } else if (input.action === "resolve-archive") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("archive-resolution-stale");
              const archive = current.archived;
              if (
                !archive ||
                (!["uncertain", "external"].includes(archive.status) &&
                  !(
                    archive.kind === "draft" &&
                    archive.status === "archived" &&
                    input.outcome === "restore"
                  ))
              )
                throw new Error("archive-resolution-unavailable");
              if (archive.operationId !== input.operationId)
                throw new Error("archive-resolution-stale");
              if (input.outcome === "confirm") {
                current.archived = {
                  ...archive,
                  status: "archived",
                  detail: "archive-confirmed-by-user",
                };
                current.issue = null;
              } else {
                if (
                  !data.settings.groups.some(
                    (group) => group.id === archive.stage,
                  )
                )
                  throw new Error("archive-group-unavailable");
                if (
                  archive.kind === "draft" &&
                  !isDraftGroup(archive.stage, data.settings.groups)
                )
                  throw new Error("archive-draft-group-unavailable");
                current.archived = null;
                if (archive.kind === "draft")
                  current.draftStage = archive.stage;
                current.lastStage = archive.stage;
                // Restoring establishes the stage, so the attribution
                // baseline moves with it.
                current.resolvedStage = archive.stage;
                // Keep the manual restore until reconciliation confirms native membership.
                current.issue = current.workspaceId
                  ? "archive-restored-workspace-unavailable"
                  : null;
              }
              current.updatedAt = this.stamp(current.updatedAt);
            });
            this.archiveDeferrals.delete(task.id);
          }
        }
        return this.snapshot();
      } catch (error) {
        try {
          await this.load();
        } catch (storageError) {
          this.disconnected(message(storageError));
        }
        throw error;
      }
    }).finally(() => {
      this.pendingMutations--;
      if (input.action === "start") {
        const remaining = this.queuedStarts.get(input.taskId)! - 1;
        if (remaining) this.queuedStarts.set(input.taskId, remaining);
        else this.queuedStarts.delete(input.taskId);
      }
    });
  }
  private async bind(id: string): Promise<void> {
    const draft = this.task(id);
    const binding = draft.binding;
    if (!binding) return;
    this.bindingInFlight.add(binding.operationId);
    try {
      const workspaceId =
        binding.workspaceId ??
        (binding.target.kind === "existing"
          ? binding.target.workspaceId
          : await this.host.create(
              binding.target.source,
              draft.title,
              `workboard:${binding.operationId}`,
            ));
      const workspace = await this.host.workspace(workspaceId);
      if (!workspace) throw new Error("Binding workspace is unavailable");
      let survivorId = id;
      await this.store.update((data) => {
        const current = data.tasks.find((t) => t.id === id)!;
        const imported = data.tasks.find(
          (t) => t.workspaceId === workspaceId && t.id !== id,
        );
        if (binding.target.kind === "existing" && imported) {
          const appendedText = `${imported.description ? "\n\n" : ""}[${current.title}]\n${current.description}`;
          imported.description += appendedText;
          imported.mergedDrafts.push({
            draftId: current.id,
            title: current.title,
            description: current.description,
            mergedAt: this.stamp(),
            appendedText,
          });
          imported.binding = { ...binding, workspaceId };
          imported.updatedAt = this.stamp(imported.updatedAt);
          survivorId = imported.id;
          data.tasks = data.tasks.filter((t) => t.id !== id);
        } else {
          if (imported) {
            current.description = [current.description, imported.description]
              .filter(Boolean)
              .join("\n\n");
            data.tasks = data.tasks.filter((t) => t.id !== imported.id);
          }
          if (binding.target.kind === "existing" && !binding.workspaceId)
            current.description = `[${current.title}]\n${current.description}`;
          current.workspaceId = workspaceId;
          current.binding = { ...binding, workspaceId };
          current.updatedAt = this.stamp(current.updatedAt);
        }
      });
      try {
        await this.transition(
          workspaceId,
          binding.stage,
          statusLabels(workspace.labels, this.store.current.settings.groups),
        );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === survivorId)!;
          task.binding = null;
          // The verified sync made binding.stage a clean observation: move
          // both stage fields with it, or an external label change arriving
          // before the next reconciliation would be attributed against the
          // survivor's stale stage and could delete the newer label.
          task.lastStage = binding.stage;
          task.resolvedStage = binding.stage;
          task.issue = null;
        });
      } catch (error) {
        await this.issue(survivorId, "label-sync-incomplete");
        throw error;
      }
    } finally {
      this.bindingInFlight.delete(binding.operationId);
    }
  }
  private async transition(
    id: string,
    stage: Stage,
    expected: string[],
    check: () => void = () => {},
  ): Promise<Workspace> {
    const mapping = this.store.current.settings.groups;
    const group = mapping.find((group) => group.id === stage);
    if (!group) throw new Error("Group no longer exists");
    let workspace = await this.host.workspace(id);
    check();
    if (!workspace || workspace.archivingAt)
      throw new Error("Workspace is unavailable or archiving");
    if (!labelsEqual(statusLabels(workspace.labels, mapping), expected))
      throw new Error(
        "Workspace labels changed; refresh before changing stage",
      );
    const target = group.label;
    let observed = workspace.labels;
    const operations: Array<{ name: string; assigned: boolean }> = [];
    if (!observed.some((name) => labelKey(name) === labelKey(target)))
      operations.push({ name: target, assigned: true });
    for (const name of statusLabels(observed, mapping))
      if (labelKey(name) !== labelKey(target))
        operations.push({ name, assigned: false });
    for (const operation of operations) {
      workspace = await this.host.workspace(id);
      check();
      if (
        !workspace ||
        !labelsEqual(
          statusLabels(workspace.labels, mapping),
          statusLabels(observed, mapping),
        )
      )
        throw new Error("Workspace labels changed during synchronization");
      const intended = operation.assigned
        ? [...observed, operation.name]
        : observed.filter(
            (name) => labelKey(name) !== labelKey(operation.name),
          );
      observed = await this.host.setLabel(
        id,
        operation.name,
        STAGE_COLORS[group.kind],
        operation.assigned,
      );
      check();
      if (
        !labelsEqual(
          statusLabels(observed, mapping),
          statusLabels(intended, mapping),
        )
      )
        throw new Error("Workspace labels changed during synchronization");
    }
    workspace = await this.host.workspace(id);
    check();
    if (
      !workspace ||
      resolveStage(
        workspace.labels,
        mapping,
        this.store.current.settings.defaultStartGroup,
      ) !== stage
    )
      throw new Error("Label synchronization could not be verified");
    return workspace;
  }
  private issue(id: string, issue: string | null): Promise<void> {
    return this.store.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (task) task.issue = issue;
    });
  }
  private archiveFingerprint(
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): string {
    return JSON.stringify([
      workspace && [
        workspace.id,
        [...workspace.labels].sort(),
        workspace.archivingAt,
        workspace.status,
        workspace.scripts,
        workspace.workspaceDirectory,
        workspace.gitRuntime?.isPaseoOwnedWorktree,
      ],
      [...agents]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((agent) => [
          agent.id,
          agent.updatedAt,
          agent.lastUserMessageAt,
          agent.activity,
          agent.archivedAt,
          agent.childEnumeration,
          agent.parentAgentId,
          agent.subagentId,
        ]),
    ]);
  }
  private archiveDeferred(
    task: Task,
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): boolean {
    const deferred = this.archiveDeferrals.get(task.id);
    if (!deferred) return false;
    if (deferred.fingerprint !== this.archiveFingerprint(workspace, agents)) {
      this.archiveDeferrals.delete(task.id);
      return false;
    }
    return deferred.deferredUntil > this.now();
  }
  private async deferArchive(
    task: Task,
    reason: string,
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): Promise<void> {
    const prior = this.archiveDeferrals.get(task.id);
    const attempts =
      prior?.reason === reason ? Math.min(prior.attempts + 1, 7) : 1;
    this.archiveDeferrals.set(task.id, {
      reason,
      attempts,
      deferredUntil:
        this.now() + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000),
      fingerprint: this.archiveFingerprint(workspace, agents),
    });
    await this.issue(task.id, reason);
  }
  private async scan(scope?: ReadonlySet<string>): Promise<void> {
    if (!this.connected || !this.store.current.settings.autoArchive) return;
    const tasks = this.store.current.tasks;
    for (const id of this.archiveDeferrals.keys())
      if (
        !tasks.some((task) => task.id === id && !task.archived && !task.binding)
      )
        this.archiveDeferrals.delete(id);
    const candidates = tasks.filter((task) => {
      const id = task.workspaceId;
      return (
        id &&
        (!scope || scope.has(id)) &&
        !task.archived &&
        !task.binding &&
        task.issue !== "archive-restored-workspace-unavailable" &&
        archiveGate(task) !== null &&
        isArchiveDue(
          groupKind(task.lastStage, this.store.current.settings.groups),
          archiveGate(task),
          this.now(),
          this.store.current.settings.archiveAfterDays,
        ) &&
        !this.archiveDeferred(
          task,
          this.inventory.workspaces.find((w) => w.id === id),
          this.inventory.agents.filter((a) => a.workspaceId === id),
        )
      );
    });
    if (!candidates.length || this.stopped || this.pendingMutations > 0) return;
    const epochs = new Map(
      candidates.map((task) => [task.id, this.observation(task.workspaceId!)]),
    );
    const inventory = await this.host.inventory();
    for (const candidate of candidates) {
      if (this.stopped || this.pendingMutations > 0) return;
      const id = candidate.workspaceId!;
      const epoch = epochs.get(candidate.id)!;
      const workspace = inventory.workspaces.find((w) => w.id === id);
      if (!workspace || workspace.archivingAt) {
        await this.deferArchive(
          candidate,
          "workspace-unavailable",
          workspace,
          inventory.agents.filter((a) => a.workspaceId === id),
        );
        continue;
      }
      const stage = resolveStage(
        workspace.labels,
        this.store.current.settings.groups,
        this.store.current.settings.defaultStartGroup,
      );
      const agents = inventory.agents.filter(
        (agent) => agent.workspaceId === id,
      );
      if (
        agents.some(
          (a) =>
            !a.archivedAt &&
            (a.activity === "running" || a.activity === "waiting"),
        ) ||
        workspace.status === "running" ||
        workspace.status === "needs_input"
      ) {
        await this.deferArchive(candidate, "agent-busy", workspace, agents);
        continue;
      }
      const gate = await this.verifyConversation(candidate, agents);
      if (gate === null) {
        await this.deferArchive(
          candidate,
          "conversation-unknown",
          workspace,
          agents,
        );
        continue;
      }
      if (
        !isArchiveDue(
          groupKind(stage, this.store.current.settings.groups),
          gate,
          this.now(),
          this.store.current.settings.archiveAfterDays,
        )
      ) {
        this.archiveDeferrals.delete(candidate.id);
        continue;
      }
      const safety = await this.host.safety(workspace);
      if (safety) {
        await this.deferArchive(candidate, safety, workspace, agents);
        continue;
      }
      if (this.stopped || epoch !== this.observation(id)) {
        if (!this.stopped)
          await this.deferArchive(
            candidate,
            "changed-during-check",
            workspace,
            agents,
          );
        continue;
      }
      const operationId = randomUUID();
      await this.store.update((data) => {
        data.tasks.find((t) => t.id === candidate.id)!.archived = {
          operationId,
          kind: "automatic",
          status: "pending",
          stage,
          group:
            data.settings.groups.find((group) => group.id === stage) ?? null,
          startedAt: this.stamp(),
          archivedAt: null,
          lastConversationAt: candidate.lastConversationAt,
          detail: "Archive intent persisted; native result not yet known",
        };
      });
      // Storage and safety checks can take time. Re-read membership, labels and Agent state before sending.
      let finalIssue: string | null = null;
      try {
        const fresh = await this.host.inventory();
        const current = fresh.workspaces.find((w) => w.id === id);
        const currentAgents = fresh.agents.filter((a) => a.workspaceId === id);
        const fingerprint = (items: typeof agents) =>
          JSON.stringify(
            items
              .map((a) => [
                a.id,
                a.updatedAt,
                a.lastUserMessageAt,
                a.activity,
                a.archivedAt,
                a.childEnumeration,
              ])
              .sort(),
          );
        if (
          !current ||
          current.archivingAt ||
          current.status === "running" ||
          current.status === "needs_input" ||
          // A refused child listing for an archived parent keeps the gate on its recorded
          // bounds, so it must not defer the archive forever as a state change would.
          resolveStage(
            current.labels,
            this.store.current.settings.groups,
            this.store.current.settings.defaultStartGroup,
          ) !== stage ||
          !labelsEqual(current.labels, workspace.labels) ||
          fingerprint(currentAgents) !== fingerprint(agents)
        )
          finalIssue = "changed-during-check";
        else finalIssue = await this.host.safety(current);
      } catch {
        finalIssue = "changed-during-check";
      }
      if (this.stopped) return; // Keep the persisted intent uncertain on the next startup.
      if (epoch !== this.observation(id)) finalIssue = "changed-during-check";
      if (finalIssue) {
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = null;
          task.issue = finalIssue;
        });
        await this.deferArchive(candidate, finalIssue, workspace, agents);
        continue;
      }
      this.archiveDeferrals.delete(candidate.id);
      try {
        const result = await this.host.archive(id);
        if (result.error || !result.archivedAt)
          throw new Error(
            result.error ?? "Native archive returned no timestamp",
          );
        const active = await this.host.inventory();
        this.inventory = active;
        if (active.workspaces.some((w) => w.id === id))
          throw new Error(
            "Native workspace still active after archive response",
          );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = {
            ...task.archived!,
            status: "archived",
            archivedAt: result.archivedAt,
            detail:
              "Native archive confirmed; worktree cleanup is not independently verified",
          };
          task.issue = null;
        });
      } catch (error) {
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = {
            ...task.archived!,
            status: "uncertain",
            detail: message(error),
          };
          task.issue = "native-archive-unknown";
        });
      }
    }
  }
  dispose(): void {
    this.stopped = true;
    this.epoch++;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.host.dispose();
  }
}
