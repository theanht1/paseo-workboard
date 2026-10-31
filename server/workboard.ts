import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  archiveDelayFor,
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
  isActiveActivity,
  isDraftGroup,
  isTerminalGroup,
  labelKey,
  newTask,
  newestConflictStage,
  orderedGroups,
  resolveStage,
  resolvePriority,
  priorityLabels,
  PRIORITY_LABELS,
  type Priority,
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

const PRIORITY_LABEL_COLORS: Record<Priority, string> = {
  p0: "red",
  p1: "orange",
  p2: "blue",
  p3: "teal",
};

/** One workspace's combined conversation evidence. */
interface WorkspaceConversation {
  displayAt: string | null;
  display: ConversationDisplay;
  gateAt: string | null;
  gate: ConversationGate;
  reason: ConversationReason | null;
  agents: ConversationAgent[];
  /**
   * The recorded time at which this workspace would become due, set only when the single thing
   * keeping its gate unknown is an idle parent whose children were deliberately not listed.
   * It schedules an archive recheck and never authorizes an archive.
   */
  recheckAt: string | null;
}
/** Most severe first, so one reason is stored per task. */
const REASON_ORDER: ConversationReason[] = [
  "timeline-unreadable",
  "child-enumeration-unavailable",
  "child-timeline-unreadable",
  "replay-timestamp",
  "truncated-window",
];

/**
 * What makes two views of a workspace's agents the same for an archive check. An idle parent's
 * children come and go with a recheck's listing, so they and its listing state are left out;
 * a change among them reaches the check through the workspace's change epoch instead.
 */
function agentRows(agents: readonly Agent[]): string {
  const idle = new Set(
    agents
      .filter(
        (a) =>
          !a.parentAgentId && !a.archivedAt && !isActiveActivity(a.activity),
      )
      .map((a) => a.id),
  );
  return JSON.stringify(
    agents
      .filter((a) => !(a.parentAgentId && idle.has(a.parentAgentId)))
      .map((a) => [
        a.id,
        a.updatedAt,
        a.lastUserMessageAt,
        a.activity,
        a.archivedAt,
        idle.has(a.id) ? "idle" : a.childEnumeration,
        a.parentAgentId,
        a.subagentId,
      ])
      .sort(),
  );
}
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
/** Only a lastError-only idle Agent can be superseded by a newer user message. */
function workspaceActivity(agents: readonly Agent[]): Card["activity"] {
  const live = agents.filter(
    (agent) => !agent.archivedAt && !agent.delegatedBy,
  );
  const healthyTimes = live
    .filter((agent) => agent.activity !== "error")
    .map((agent) => Date.parse(agent.lastUserMessageAt ?? ""))
    .filter(Number.isFinite);
  const newestHealthy = healthyTimes.length ? Math.max(...healthyTimes) : null;
  const activities = live
    .filter((agent) => {
      if (
        agent.activity !== "error" ||
        agent.status !== "idle" ||
        !agent.lastError ||
        agent.attentionReason === "error" ||
        newestHealthy === null
      )
        return true;
      const updated = Date.parse(agent.updatedAt);
      return !Number.isFinite(updated) || updated >= newestHealthy;
    })
    .map((agent) => agent.activity);
  return (
    (["waiting", "error", "attention", "running"] as const).find((activity) =>
      activities.includes(activity),
    ) ?? "idle"
  );
}

function projectChangeRequest(workspace?: Workspace): Card["changeRequest"] {
  const runtime = workspace?.githubRuntime;
  const request = runtime?.pullRequest;
  if (!request) return null;
  const checks = request.checks ?? [];
  const checkCounts = checks.length
    ? { success: 0, failure: 0, pending: 0, skipped: 0, cancelled: 0 }
    : null;
  if (checkCounts) for (const check of checks) checkCounts[check.status]++;
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
    checkCounts,
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
  private undoInFlight = false;
  private archiveFailures = new Map<
    string,
    {
      workspaceId: string | null;
      operationId: string;
      undo: boolean;
      detail: string;
    }
  >();
  private connectionGeneration = 0;
  private epoch = 0;
  private workspaceEpochs = new Map<string, number>();
  private bindingInFlight = new Set<string>();
  private queuedStarts = new Map<string, number>();
  /**
   * Per workspace, when an idle parent's skipped children are the only thing keeping its gate
   * unknown: the recorded time it becomes due. Rebuilt by every reconcile, so a restart loses
   * nothing; it only schedules a recheck and never authorizes an archive.
   */
  private recheckHints = new Map<string, string>();
  /** First trustworthy empty inventory in this process, never a task edit timestamp. */
  private emptySince = new Map<string, string>();
  private emptyRevision = 0;
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
    /** Reported to clients so their due-date arithmetic uses this clock; 0 outside tests. */
    private clockOffsetMs: number | (() => number) = 0,
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
        for (const task of data.tasks) {
          if (task.archived?.undo === "pending")
            task.archived.undo = "uncertain";
          if (task.archived?.status === "pending") {
            task.archived.status = "uncertain";
            task.archived.detail =
              "Native archive outcome unknown after restart";
            task.issue = "native-archive-unknown";
          }
        }
      });
      const bindings = this.store.current.tasks.filter(
        (t) => t.binding && !t.priorityWrite,
      );
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
    const failures = new Map(this.archiveFailures);
    if (failures.size) {
      await this.store.update((data) => {
        for (const [id, failure] of failures) {
          const task = data.tasks.find((task) => task.id === id);
          const archive = task?.archived;
          if (
            !task ||
            !archive ||
            task.workspaceId !== failure.workspaceId ||
            archive.operationId !== failure.operationId
          )
            continue;
          if (failure.undo) {
            if (archive.undo !== "pending") continue;
            archive.undo = "uncertain";
          } else {
            if (archive.status !== "pending") continue;
            archive.status = "uncertain";
            task.issue = "native-archive-unknown";
          }
          archive.detail = failure.detail;
        }
      });
      for (const [id, failure] of failures)
        if (this.archiveFailures.get(id) === failure)
          this.archiveFailures.delete(id);
    }
  }
  private async recoverArchive(
    task: Task,
    operationId: string,
    error: unknown,
    undo = false,
  ): Promise<void> {
    // No more native work will be sent by this invocation; reload before classifying its intent.
    this.archiveFailures.set(task.id, {
      workspaceId: task.workspaceId,
      operationId,
      undo,
      detail: message(error),
    });
    try {
      await this.load();
    } catch (storageError) {
      this.disconnected(message(storageError));
      throw storageError;
    }
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
    this.agentsChanged(
      this.inventory.agents.find((a) => a.id === id)?.workspaceId,
    );
  }
  agentsChanged(workspaceId?: string): void {
    this.emptyRevision++;
    if (workspaceId) this.emptySince.delete(workspaceId);
    else this.emptySince.clear();
    this.changed(workspaceId);
  }
  private async readInventory(): Promise<Inventory> {
    const revision = this.emptyRevision;
    try {
      const inventory = await this.host.inventory();
      const occupied = new Set(
        inventory.agents.map((agent) => agent.workspaceId),
      );
      const active = new Set(
        inventory.workspaces.map((workspace) => workspace.id),
      );
      for (const id of this.emptySince.keys())
        if (occupied.has(id) || !active.has(id)) this.emptySince.delete(id);
      // Events during the read can describe Agents absent from its final rows.
      if (revision === this.emptyRevision)
        for (const workspace of inventory.workspaces)
          if (!occupied.has(workspace.id) && !this.emptySince.has(workspace.id))
            this.emptySince.set(
              workspace.id,
              new Date(this.now()).toISOString(),
            );
      return inventory;
    } catch (error) {
      this.emptyRevision++;
      this.emptySince.clear();
      throw error;
    }
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
    this.emptyRevision++;
    this.emptySince.clear();
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
      clockOffsetMs:
        typeof this.clockOffsetMs === "function"
          ? this.clockOffsetMs()
          : this.clockOffsetMs,
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
        const activity = workspaceActivity(agents);
        const stage = task.workspaceId
          ? workspace
            ? resolveStage(
                workspace.labels,
                data.settings.groups,
                data.settings.defaultStartGroup,
              )
            : task.lastStage
          : task.draftStage;
        const archiveDelay = archiveDelayFor(
          data.settings,
          groupKind(stage, data.settings.groups),
        );
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
            task.workspaceId && !task.autoArchivePaused && archiveDelay !== null
              ? archiveDueAt(archiveGate(task), archiveDelay)
              : null,
          recheckAt:
            task.workspaceId && !task.archived && !task.autoArchivePaused
              ? (this.recheckHints.get(task.workspaceId) ?? null)
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
    const inventory = await this.readInventory();
    await this.syncPins(inventory, connection);
    if (this.archiveDeferrals.size) {
      let cleared: string[] = [];
      await this.store.update((data) => {
        cleared = this.pruneArchiveDeferrals(data, inventory.workspaces);
      });
      for (const id of cleared) this.archiveDeferrals.delete(id);
    }
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
      if (
        previous &&
        this.archiveDeferred(previous, workspace, agents) &&
        !(
          agents.length === 0 &&
          this.emptySince.get(workspace.id) !== previous.conversationGateAt
        )
      )
        continue;
      const evidence = await this.observe(
        agents,
        previous,
        this.now(),
        workspace.id,
      );
      if (evidence.recheckAt)
        this.recheckHints.set(workspace.id, evidence.recheckAt);
      else this.recheckHints.delete(workspace.id);
      if (previous && this.archiveDeferrals.has(previous.id)) {
        const kind = groupKind(
          resolveStage(
            workspace.labels,
            prior.settings.groups,
            prior.settings.defaultStartGroup,
          ),
          prior.settings.groups,
        );
        // A scheduled recheck keeps its own backoff: its gate is unknown by design, and
        // deferring again here would push the retry further out on every refresh. Its
        // scheduled time still shows whether the deferral applies at all.
        const scheduled =
          evidence.gate === "unknown" ? evidence.recheckAt : null;
        if (scheduled !== null) {
          if (
            !isArchiveDue(
              kind,
              scheduled,
              this.now(),
              archiveDelayFor(prior.settings, kind),
            )
          )
            this.archiveDeferrals.delete(previous.id);
        } else if (evidence.gate === "unknown")
          await this.deferArchive(
            previous,
            "conversation-unknown",
            workspace,
            agents,
          );
        else if (
          !isArchiveDue(
            kind,
            evidence.gateAt,
            this.now(),
            archiveDelayFor(prior.settings, kind),
          )
        )
          this.archiveDeferrals.delete(previous.id);
      }
      observations.set(workspace.id, evidence);
    }
    if (this.stopped) throw new Error("Workboard stopped");
    this.inventory = inventory;
    const priorityResolutions: Array<{
      taskId: string;
      workspaceId: string;
      priority: Priority;
      label: string;
      labels: string[];
    }> = [];
    const resolutions: Array<{
      taskId: string;
      workspaceId: string;
      stage: Stage;
      labels: string[];
    }> = [];
    await this.store.update((data) => {
      const decideExclusivity = data.exclusiveStatusLabelsPending;
      let hasStatusConflict = false;
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
        const restored =
          !workspace.archivingAt &&
          task.archived?.kind === "automatic" &&
          task.archived.status === "archived" &&
          !task.archived.undo;
        if (task.archived?.status === "external" || restored) {
          task.archived = null;
          task.updatedAt = this.stamp(task.updatedAt);
        }
        task.title = workspace.name;
        task.projectId = workspace.projectId;
        task.projectName = workspace.projectDisplayName;
        if (!(task.binding?.target.kind === "new")) {
          const priority = resolvePriority(
            workspace.labels,
            data.settings.groups.map((group) => group.label),
          );
          const labels = priorityLabels(
            workspace.labels,
            data.settings.groups.map((group) => group.label),
          );
          if (!task.priorityWrite) {
            if (labels.length <= 1) task.priorityLabelBaseline = labels;
            else if (
              !task.binding &&
              task.priorityLabelBaseline &&
              task.priorityLabelBaseline.every((label) =>
                labels.some((current) => labelKey(label) === labelKey(current)),
              )
            ) {
              const newcomers = labels.filter(
                (label) =>
                  !task.priorityLabelBaseline!.some(
                    (prior) => labelKey(prior) === labelKey(label),
                  ),
              );
              if (newcomers.length === 1)
                priorityResolutions.push({
                  taskId: task.id,
                  workspaceId: workspace.id,
                  priority: resolvePriority(newcomers),
                  label: newcomers[0],
                  labels,
                });
            }
          }
          if ((task.priority ?? "p2") !== priority) {
            task.priority = priority;
            task.updatedAt = this.stamp(task.updatedAt);
          }
        }
        const priorStage = imported ? null : task.lastStage;
        const stage = resolveStage(
          workspace.labels,
          data.settings.groups,
          data.settings.defaultStartGroup,
        );
        if (stage === "conflict") hasStatusConflict = true;
        if (
          !task.archived &&
          stage !== "conflict" &&
          (task.resolvedStage ?? priorStage) !== stage
        )
          delete task.autoArchivePaused;
        if (restored) task.autoArchivePaused = true;
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
          !decideExclusivity &&
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
        let observation = observations.get(workspace.id);
        if (
          observation?.gate === "upper-bound" &&
          !inventory.agents.some(
            (agent) => agent.workspaceId === workspace.id,
          ) &&
          this.emptySince.get(workspace.id) !== observation.gateAt
        )
          observation = {
            ...observation,
            displayAt: null,
            display: "unknown",
            gateAt: null,
            gate: "unknown",
          };
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
          this.observedIssue(task) ??
          this.archiveDeferrals.get(task.id)?.reason ??
          null;
      }
      if (decideExclusivity) {
        if (connection !== this.connectionGeneration)
          throw new Error(this.error ?? "Paseo disconnected during refresh");
        data.settings.exclusiveStatusLabels = !hasStatusConflict;
        data.exclusiveStatusLabelsPending = false;
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
    for (const resolution of priorityResolutions) {
      if (this.stopped) return;
      try {
        const workspace = await this.transitionPriority(
          resolution.workspaceId,
          resolution.priority,
          resolution.labels,
          () => {},
          resolution.label,
        );
        this.inventory.workspaces = this.inventory.workspaces.map((w) =>
          w.id === workspace.id ? workspace : w,
        );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === resolution.taskId)!;
          task.priority = resolution.priority;
          task.priorityLabelBaseline = [resolution.label];
          task.priorityWrite = null;
          task.updatedAt = this.stamp(task.updatedAt);
          task.issue =
            this.observedIssue(task) ??
            this.archiveDeferrals.get(task.id)?.reason ??
            null;
        });
        this.changed(resolution.workspaceId);
      } catch {
        // An uncertain native write is retained for explicit user resolution, never retried.
      }
    }
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
   * else keeps the newest observed bound for display. The archive gate needs a bound for
   * every agent and child; an incomplete inventory leaves it unknown.
   */
  private async observe(
    agents: readonly Agent[],
    previous: Task | undefined,
    now: number,
    workspaceId: string,
    options: { recheck?: boolean } = {},
  ): Promise<WorkspaceConversation> {
    // A single displayed reason can hide another failure, including child enumeration.
    const unresolvedReason =
      agents.length === 0 &&
      previous?.conversationReason &&
      (previous.conversationGateEvidence === "unknown" ||
        previous.conversationReason === "child-enumeration-unavailable")
        ? previous.conversationReason
        : null;
    if (
      agents.length === 0 &&
      !previous?.conversationAgents.length &&
      !unresolvedReason
    ) {
      const bound = this.emptySince.get(workspaceId);
      if (bound)
        return {
          displayAt: bound,
          display: "upper-bound",
          gateAt: bound,
          gate: "upper-bound",
          reason: null,
          agents: [],
          recheckAt: null,
        };
    }
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
    let blocked = false;
    // Whether anything besides a deliberately skipped idle parent keeps the gate unknown.
    let hardBlocked = false;
    if (unresolvedReason) {
      blocked = true;
      reasons.add(unresolvedReason);
    }
    let skipped = false;
    const recordedById = new Map(
      (previous?.conversationAgents ?? []).map((entry) => [entry.id, entry]),
    );
    for (const { agent, conversation } of readings) {
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      if (conversation.reason) reasons.add(conversation.reason);
      if (
        isChild &&
        conversation.gate === "unknown" &&
        (conversation.display !== "none" || conversation.reason !== null)
      ) {
        blocked = true;
        if (!agent.parentIdle || options.recheck) hardBlocked = true;
      }
      if (
        agent.childEnumeration === "refused" ||
        agent.childEnumeration === "unavailable"
      ) {
        reasons.add("child-enumeration-unavailable");
        // Parent activity does not bound a child that could not be listed.
        blocked = true;
        hardBlocked = true;
      }
      if (agent.childEnumeration === "skipped") {
        reasons.add("child-enumeration-unavailable");
        blocked = true;
        skipped = true;
        // A recheck lists every idle parent first, so a skipped one there is an error.
        if (options.recheck) hardBlocked = true;
      }
      const time = conversation.displayAt
        ? Date.parse(conversation.displayAt)
        : null;
      if (time !== null) {
        // An upper-bound display value never counts as a lower bound of the conversation.
        if (conversation.display === "upper-bound")
          upper = Math.max(upper ?? time, time);
        else lower = Math.max(lower ?? time, time);
      }
      const activity = isChild ? null : Date.parse(agent.updatedAt);
      if (activity !== null && Number.isFinite(activity))
        upper = Math.max(upper ?? activity, activity);
      if (conversation.gate !== "unknown" && conversation.gateAt !== null) {
        const bound = Date.parse(conversation.gateAt);
        upper = Math.max(upper ?? bound, bound);
      }
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
        // A child that was not read keeps the time it was last observed at.
        lastObservedAt:
          conversation.displayAt ??
          recordedById.get(agent.id)?.lastObservedAt ??
          null,
        seenWhileLive: live.has(agent.parentAgentId!),
      }));
    const current = new Set(readings.map(({ agent }) => agent.id));
    const skippedParents = new Set(
      readings
        .filter(({ agent }) => agent.childEnumeration === "skipped")
        .map(({ agent }) => agent.id),
    );
    // Recorded children that are absent from this inventory have not vanished while their
    // parent is idle: they are missing only because that parent was not listed.
    const unlisted = (entry: ConversationAgent) =>
      skippedParents.has(entry.id.split("/provider/")[0]);
    for (const entry of recorded) {
      if (current.has(entry.id)) continue;
      agentsEvidence.push(entry);
      if (!unlisted(entry)) {
        // Its last read cannot cover new messages between that read and removal.
        blocked = true;
        hardBlocked = true;
        reasons.add("child-enumeration-unavailable");
      }
      const time = entry.lastObservedAt
        ? Date.parse(entry.lastObservedAt)
        : null;
      if (time !== null && Number.isFinite(time))
        lower = Math.max(lower ?? time, time);
    }
    for (const { agent, conversation } of readings) {
      if (!agent.parentIdle || conversation.displayAt) continue;
      const kept = recordedById.get(agent.id)?.lastObservedAt;
      const time = kept ? Date.parse(kept) : NaN;
      if (Number.isFinite(time)) lower = Math.max(lower ?? time, time);
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
      recheckAt:
        skipped && !hardBlocked && upper !== null
          ? new Date(upper).toISOString()
          : null,
    };
  }
  /**
   * Re-read one candidate's conversation before archiving it. Returns the gate that the
   * archive decision may use, or null when no bound can be proven right now.
   */
  private async verifyConversation(
    candidate: Task,
    agents: readonly Agent[],
  ): Promise<{ gate: string | null; agents: readonly Agent[] }> {
    let checked = agents;
    try {
      // The recheck is the one place that loads an idle agent: it lists every idle parent's
      // children and reads the idle histories, and a failed or overtaken listing rejects.
      checked = await this.host.recheckAgents(agents);
      const evidence = await this.observe(
        checked,
        candidate,
        this.now(),
        candidate.workspaceId!,
        {
          recheck: true,
        },
      );
      // Keep what was learned as display evidence, so a refresh does not make the same
      // candidate read the same history again. It never moves backwards and never gates.
      await this.store.update((data) => {
        const task = data.tasks.find((t) => t.id === candidate.id);
        if (!task || task.workspaceId !== candidate.workspaceId) return;
        const before = new Map(task.conversationAgents.map((e) => [e.id, e]));
        const later = (a: string | null, b: string | null) =>
          a === null
            ? b
            : b === null
              ? a
              : Date.parse(a) >= Date.parse(b)
                ? a
                : b;
        task.conversationAgents = evidence.agents.map((entry) => ({
          ...entry,
          lastObservedAt: later(
            before.get(entry.id)?.lastObservedAt ?? null,
            entry.lastObservedAt,
          ),
        }));
        for (const [id, entry] of before)
          if (!task.conversationAgents.some((e) => e.id === id))
            task.conversationAgents.push(entry);
      });
      const at = archiveGate({
        conversationGateAt: evidence.gateAt,
        conversationGateEvidence: evidence.gate,
      });
      const gate = at === null ? NaN : Date.parse(at);
      return {
        gate: Number.isFinite(gate) ? new Date(gate).toISOString() : null,
        agents: checked,
      };
    } catch {
      return { gate: null, agents };
    }
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
    const labelsOf = (list: readonly Group[], kind: "done" | "canceled") =>
      new Set(
        list
          .filter((group) => groupKind(group.id, list) === kind)
          .map((group) => labelKey(group.label)),
      );
    // A local edit previews newly due workspaces; a mirror cannot, so it pauses that rule.
    const grows = (kind: "done" | "canceled") => {
      const before = labelsOf(previous.groups, kind);
      return [...labelsOf(groups, kind)].some((label) => !before.has(label));
    };
    const pauseDone = previous.archiveDoneEnabled && grows("done");
    const pauseCanceled = previous.archiveCanceledEnabled && grows("canceled");
    const kept = (id: Stage | null, valid: (id: Stage) => boolean) =>
      id !== null && groups.some((group) => group.id === id) && valid(id)
        ? id
        : null;
    await this.saveSettings(
      {
        ...previous,
        groups,
        groupOrder: input.groupOrder,
        archiveDoneEnabled: previous.archiveDoneEnabled && !pauseDone,
        archiveCanceledEnabled:
          previous.archiveCanceledEnabled && !pauseCanceled,
        archivePausedByGroupSync:
          previous.archivePausedByGroupSync || pauseDone || pauseCanceled,
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
      next.groups.some(
        (group) =>
          priorityLabels([group.label]).length > 0 &&
          !previous.settings.groups.some(
            (old) =>
              old.id === group.id &&
              labelKey(old.label) === labelKey(group.label),
          ),
      )
    )
      throw new Error(
        "Priority labels are reserved; choose a different status label",
      );
    if (
      next.defaultStartGroup &&
      isTerminalGroup(next.defaultStartGroup, next.groups)
    )
      throw new Error("group-default-terminal");
    if (next.archiveDoneEnabled || next.archiveCanceledEnabled)
      next.archiveMappingNeedsReview = false;
    // Turning a paused rule back on is the review a mirror was waiting for.
    if (
      (next.archiveDoneEnabled && !previous.settings.archiveDoneEnabled) ||
      (next.archiveCanceledEnabled && !previous.settings.archiveCanceledEnabled)
    )
      next.archivePausedByGroupSync = false;
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
      const inventory = await this.readInventory();
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
    let cleared: string[] = [];
    await this.store.update((data) => {
      if (!unchanged(data))
        throw new Error("Settings changed; refresh before saving");
      for (const group of removed) delete data.cardOrderByStage[group.id];
      data.settings = next;
      cleared = this.pruneArchiveDeferrals(data, this.inventory.workspaces);
    });
    for (const id of cleared) this.archiveDeferrals.delete(id);
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
    input: Pick<
      Extract<Mutation, { action: "stage" }>,
      "taskId" | "stage" | "expectedGroup" | "expectedUpdatedAt"
    >,
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
    if (
      this.undoInFlight ||
      this.store.current.tasks.some((task) => task.archived?.undo === "pending")
    )
      throw new Error("archive-undo-pending");
    let pendingReply: (board: Board) => void = () => {};
    const pending = new Promise<Board>((resolve) => {
      pendingReply = resolve;
    });
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
    if (input.action === "undo-archive") this.undoInFlight = true;
    this.epoch++;
    this.pendingMutations++;
    const work = this.serial(async () => {
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
          if (
            hidden(task) &&
            input.action !== "resolve-archive" &&
            input.action !== "undo-archive"
          )
            throw new Error(
              input.action === "detach-draft"
                ? "detach-draft-archived"
                : "Task is archived",
            );
          if (input.action === "priority") {
            const check = () => {
              if (this.task(task.id).updatedAt !== input.updatedAt)
                throw new Error("Task changed; refresh before saving");
              if (task.binding) throw new Error("Binding is pending");
            };
            check();
            if (task.workspaceId) {
              const workspace = await this.transitionPriority(
                task.workspaceId,
                input.priority,
                input.expectedLabels,
                check,
              );
              this.inventory.workspaces = this.inventory.workspaces.map((w) =>
                w.id === workspace.id ? workspace : w,
              );
            }
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("Task changed; refresh before saving");
              current.priority = input.priority;
              current.priorityWrite = null;
              if (current.workspaceId)
                current.priorityLabelBaseline = [
                  PRIORITY_LABELS[input.priority],
                ];
              current.issue =
                this.observedIssue(current) ??
                this.archiveDeferrals.get(current.id)?.reason ??
                null;
              current.updatedAt = this.stamp(current.updatedAt);
            });
          } else if (input.action === "edit") {
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
            if (input.target.kind === "new")
              this.checkPriorityTarget(task.priority ?? "p2");
            const stage =
              input.stage ??
              task.binding?.stage ??
              defaultStartWorkGroup(
                this.store.current.settings.groups,
                this.store.current.settings.defaultStartWorkGroup,
              );
            if (!stage)
              throw new Error("Add an In progress group before starting work");
            const check = () =>
              this.checkStageExpected(this.store.current, { ...input, stage });
            check();
            if (
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
                this.checkStageExpected(data, { ...input, stage });
                data.tasks.find((t) => t.id === task.id)!.binding = {
                  operationId: randomUUID(),
                  target: input.target,
                  workspaceId: null,
                  stage,
                };
              });
            await this.bind(task.id, check);
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
                if (current.lastStage !== input.stage)
                  delete current.autoArchivePaused;
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
              draft.priority = source.priority;
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
          } else if (input.action === "undo-archive") {
            await this.undoArchive(input, () => pendingReply(this.snapshot()));
          } else if (input.action === "resolve-archive") {
            if (task.archived?.undo) throw new Error("archive-undo-unknown");
            if (
              task.archived?.kind === "automatic" &&
              input.outcome === "restore"
            )
              throw new Error("archive-resolution-unavailable");
            if (
              task.archived?.kind === "automatic" &&
              input.outcome === "confirm"
            ) {
              if (
                task.updatedAt !== input.updatedAt ||
                task.archived.operationId !== input.operationId
              )
                throw new Error("archive-resolution-stale");
              if (!task.workspaceId)
                throw new Error("archive-resolution-unavailable");
              await this.host.checkRestore(task.workspaceId);
            }
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
      if (input.action === "undo-archive") this.undoInFlight = false;
      if (input.action === "start") {
        const remaining = this.queuedStarts.get(input.taskId)! - 1;
        if (remaining) this.queuedStarts.set(input.taskId, remaining);
        else this.queuedStarts.delete(input.taskId);
      }
    });
    // Native worktree recovery can outlast the host's plugin RPC deadline.
    return input.action === "undo-archive"
      ? Promise.race([work, pending])
      : work;
  }
  private async bind(id: string, check: () => void = () => {}): Promise<void> {
    const draft = this.task(id);
    const binding = draft.binding;
    if (!binding) return;
    this.bindingInFlight.add(binding.operationId);
    try {
      check();
      if (binding.target.kind === "new")
        this.checkPriorityTarget(draft.priority ?? "p2");
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
        check();
        const current = data.tasks.find((t) => t.id === id)!;
        const imported = data.tasks.find(
          (t) => t.workspaceId === workspaceId && t.id !== id,
        );
        if (binding.target.kind === "existing" && imported) {
          const appendedText = `${imported.description ? "\n\n" : ""}[${current.title}]\n${current.description}`;
          imported.description += appendedText;
          imported.mergedDrafts.push({
            draftId: current.id,
            priority: current.priority,
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
          check,
        );
        if (binding.target.kind === "new") {
          const fresh = await this.host.workspace(workspaceId);
          if (!fresh) throw new Error("Binding workspace is unavailable");
          await this.transitionPriority(
            workspaceId,
            this.task(survivorId).priority ?? "p2",
            priorityLabels(
              fresh.labels,
              this.store.current.settings.groups.map((group) => group.label),
            ),
          );
        }
        await this.store.update((data) => {
          check();
          const task = data.tasks.find((t) => t.id === survivorId)!;
          task.binding = null;
          if (binding.target.kind === "new") {
            task.priorityLabelBaseline = [
              PRIORITY_LABELS[task.priority ?? "p2"],
            ];
            task.priorityWrite = null;
          }
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
  private checkPriorityTarget(
    priority: Priority,
    target = PRIORITY_LABELS[priority],
  ): void {
    if (
      this.store.current.settings.groups.some(
        (group) => labelKey(group.label) === labelKey(target),
      )
    )
      throw new Error(
        "Priority label is used by a status group; rename its status label first",
      );
  }
  private async transitionPriority(
    id: string,
    priority: Priority,
    expected: string[],
    check: () => void = () => {},
    target = PRIORITY_LABELS[priority],
  ): Promise<Workspace> {
    this.checkPriorityTarget(priority, target);
    const statusNames = this.store.current.settings.groups.map(
      (group) => group.label,
    );
    let workspace = await this.host.workspace(id);
    check();
    if (!workspace || workspace.archivingAt)
      throw new Error("Workspace is unavailable or archiving");
    if (!labelsEqual(priorityLabels(workspace.labels, statusNames), expected))
      throw new Error(
        "Workspace priority labels changed; refresh before saving",
      );
    let observed = priorityLabels(workspace.labels, statusNames);
    const operations = observed
      .filter((name) => labelKey(name) !== labelKey(target))
      .map((name) => ({ name, assigned: false }));
    if (!observed.some((name) => labelKey(name) === labelKey(target)))
      operations.unshift({ name: target, assigned: true });
    if (operations.length) {
      await this.store.update((data) => {
        check();
        const task = data.tasks.find((task) => task.workspaceId === id)!;
        task.priorityWrite = { operationId: randomUUID(), priority };
        task.issue = "priority-sync-uncertain";
      });
    }
    for (const operation of operations) {
      workspace = await this.host.workspace(id);
      check();
      if (
        !workspace ||
        workspace.archivingAt ||
        !labelsEqual(priorityLabels(workspace.labels, statusNames), observed)
      )
        throw new Error(
          "Workspace priority labels changed; refresh before saving",
        );
      const intended = operation.assigned
        ? [...observed, operation.name]
        : observed.filter(
            (name) => labelKey(name) !== labelKey(operation.name),
          );
      const labels = await this.host.setLabel(
        id,
        operation.name,
        PRIORITY_LABEL_COLORS[priority],
        operation.assigned,
      );
      check();
      observed = priorityLabels(labels, statusNames);
      if (!labelsEqual(observed, intended))
        throw new Error("Priority synchronization could not be verified");
    }
    workspace = await this.host.workspace(id);
    check();
    if (
      !workspace ||
      !labelsEqual(priorityLabels(workspace.labels, statusNames), [target])
    )
      throw new Error("Priority synchronization could not be verified");
    return workspace;
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
      agentRows(agents),
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
  private observedIssue(task: Task): string | null {
    return task.archived?.status === "uncertain"
      ? "native-archive-unknown"
      : task.priorityWrite
        ? "priority-sync-uncertain"
        : task.binding
          ? "label-sync-incomplete"
          : task.lastStage === "conflict"
            ? "labels-conflict"
            : task.conversationStatus === "unknown"
              ? "conversation-unknown"
              : task.conversationStatus === "none"
                ? "no-conversation"
                : null;
  }
  /** Clear only this process's obsolete deferrals and their owned warning. */
  private pruneArchiveDeferrals(
    data: Data,
    workspaces: readonly Workspace[],
  ): string[] {
    const cleared: string[] = [];
    for (const [id, deferred] of this.archiveDeferrals) {
      const task = data.tasks.find((task) => task.id === id);
      if (!task || task.archived || task.binding || task.autoArchivePaused) {
        cleared.push(id);
        continue;
      }
      const workspace = workspaces.find(
        (workspace) => workspace.id === task.workspaceId,
      );
      const stage = workspace
        ? resolveStage(
            workspace.labels,
            data.settings.groups,
            data.settings.defaultStartGroup,
          )
        : task.lastStage;
      const kind = groupKind(stage, data.settings.groups);
      const delay = archiveDelayFor(data.settings, kind);
      // An idle task's scheduled recheck time stands in for the unknown stored gate when
      // judging applicability; it only ever clears a deferral, never authorizes an archive.
      const gate =
        archiveGate(task) ??
        (task.workspaceId
          ? (this.recheckHints.get(task.workspaceId) ?? null)
          : null);
      // Missing evidence is not proof that an enabled rule is no longer due.
      if (
        delay !== null &&
        (gate === null || isArchiveDue(kind, gate, this.now(), delay))
      )
        continue;
      cleared.push(id);
      if (task.issue === deferred.reason) task.issue = this.observedIssue(task);
    }
    // Callers delete from the in-memory map only after the storage write succeeds.
    return cleared;
  }
  private async undoArchive(
    input: Extract<Mutation, { action: "undo-archive" }>,
    reportPending: () => void,
  ): Promise<void> {
    const task = this.task(input.taskId);
    if (
      task.updatedAt !== input.updatedAt ||
      task.archived?.operationId !== input.operationId
    )
      throw new Error("archive-resolution-stale");
    const archive = task.archived;
    if (
      !task.workspaceId ||
      archive.kind !== "automatic" ||
      archive.status === "pending"
    )
      throw new Error("archive-resolution-unavailable");
    if (
      !this.store.current.settings.groups.some(
        (group) => group.id === archive.stage,
      )
    )
      throw new Error("archive-group-unavailable");
    if (archive.undo === "pending") throw new Error("archive-undo-pending");
    const activeInventory = !archive.undo
      ? await this.readInventory()
      : undefined;
    const activeWorkspace = activeInventory?.workspaces.find(
      (item) => item.id === task.workspaceId,
    );
    if (activeWorkspace?.archivingAt) throw new Error("archive-undo-unknown");
    if (!archive.undo && !activeWorkspace) {
      await this.host.checkRestore(task.workspaceId);
      try {
        await this.store.update((data) => {
          const current = data.tasks.find((item) => item.id === task.id)!;
          current.archived!.undo = "pending";
          current.autoArchivePaused = true;
          current.updatedAt = this.stamp(current.updatedAt);
        });
      } catch (error) {
        await this.recoverArchive(task, input.operationId, error, true);
        throw error;
      }
      reportPending();
      try {
        await this.host.restore(task.workspaceId);
      } catch (error) {
        await this.recoverArchive(task, input.operationId, error, true);
        throw error;
      }
    }
    let verifiedInventory: Inventory | undefined;
    try {
      const inventory = activeWorkspace
        ? activeInventory!
        : await this.readInventory();
      const workspace = inventory.workspaces.find(
        (item) => item.id === task.workspaceId,
      );
      if (!workspace || workspace.archivingAt)
        throw new Error("archive-undo-unknown");
      verifiedInventory = inventory;
      await this.store.update((data) => {
        const current = data.tasks.find((item) => item.id === task.id)!;
        if (
          activeWorkspace &&
          (current.updatedAt !== input.updatedAt ||
            current.archived?.operationId !== input.operationId ||
            current.archived.status !== archive.status)
        )
          throw new Error("archive-resolution-stale");
        current.archived = null;
        current.autoArchivePaused = true;
        current.lastStage = resolveStage(
          workspace.labels,
          data.settings.groups,
          data.settings.defaultStartGroup,
        );
        current.resolvedStage =
          current.lastStage === "conflict" ? null : current.lastStage;
        current.issue = null;
        current.updatedAt = this.stamp(current.updatedAt);
      });
      this.inventory = inventory;
      this.archiveDeferrals.delete(task.id);
      this.changed(task.workspaceId);
    } catch (error) {
      // A lost reply or interrupted verification never authorizes another native restore.
      await this.recoverArchive(task, input.operationId, error, true);
      const current = this.store.current.tasks.find(
        (item) => item.id === task.id,
      );
      if (
        verifiedInventory &&
        current?.workspaceId === task.workspaceId &&
        current.archived === null &&
        current.autoArchivePaused
      ) {
        this.inventory = verifiedInventory;
        this.archiveDeferrals.delete(task.id);
        this.changed(task.workspaceId);
        return;
      }
      throw error;
    }
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
    if (!this.connected) return;
    const tasks = this.store.current.tasks;
    for (const id of this.archiveDeferrals.keys())
      if (
        !tasks.some((task) => task.id === id && !task.archived && !task.binding)
      )
        this.archiveDeferrals.delete(id);
    const settings = this.store.current.settings;
    const candidates = tasks.filter((task) => {
      const id = task.workspaceId;
      const kind = groupKind(task.lastStage, settings.groups);
      return (
        id &&
        (!scope || scope.has(id)) &&
        !task.archived &&
        !task.autoArchivePaused &&
        !task.binding &&
        task.issue !== "archive-restored-workspace-unavailable" &&
        (archiveGate(task) ?? this.recheckHints.get(id) ?? null) !== null &&
        isArchiveDue(
          kind,
          archiveGate(task) ?? this.recheckHints.get(id) ?? null,
          this.now(),
          archiveDelayFor(settings, kind),
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
    const inventory = await this.readInventory();
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
      let agents: readonly Agent[] = inventory.agents.filter(
        (agent) => agent.workspaceId === id,
      );
      // A child of an idle parent is judged after the recheck lists it fresh: the cached
      // status may be a completion this host never saw.
      if (
        agents.some(
          (a) => !a.archivedAt && !a.parentIdle && isActiveActivity(a.activity),
        ) ||
        workspace.status === "running" ||
        workspace.status === "needs_input"
      ) {
        await this.deferArchive(candidate, "agent-busy", workspace, agents);
        continue;
      }
      const verified = await this.verifyConversation(candidate, agents);
      const gate = verified.gate;
      agents = verified.agents;
      if (agents.some((a) => !a.archivedAt && isActiveActivity(a.activity))) {
        await this.deferArchive(candidate, "agent-busy", workspace, agents);
        continue;
      }
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
          archiveDelayFor(
            this.store.current.settings,
            groupKind(stage, this.store.current.settings.groups),
          ),
        )
      ) {
        // Newer evidence moves the next check: the recorded time now includes it.
        if (gate) this.recheckHints.set(id, gate);
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
      try {
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
      } catch (error) {
        await this.recoverArchive(candidate, operationId, error);
        throw error;
      }
      // Storage and safety checks can take time. Re-read membership, labels and Agent state before sending.
      let finalIssue: string | null = null;
      try {
        const fresh = await this.readInventory();
        const current = fresh.workspaces.find((w) => w.id === id);
        const currentAgents = fresh.agents.filter((a) => a.workspaceId === id);
        const fingerprint = (items: readonly Agent[]) => agentRows(items);
        if (
          !current ||
          current.archivingAt ||
          current.status === "running" ||
          current.status === "needs_input" ||
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
        try {
          await this.store.update((data) => {
            const task = data.tasks.find((t) => t.id === candidate.id)!;
            task.archived = null;
            task.issue = finalIssue;
          });
        } catch (error) {
          await this.recoverArchive(candidate, operationId, error);
          throw error;
        }
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
        const active = await this.readInventory();
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
        await this.recoverArchive(candidate, operationId, error);
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
