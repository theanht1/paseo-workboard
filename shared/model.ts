import { z } from "zod";

export const STAGES = [
  "inbox",
  "todo",
  "in-progress",
  "review",
  "done",
  "canceled",
] as const;
export const stageKindSchema = z.enum(STAGES);
export type StageKind = z.infer<typeof stageKindSchema>;
export const stageSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(100)
  .refine((id) => id !== "conflict");
export type Stage = z.infer<typeof stageSchema>;
export type BoardStage = Stage | "conflict";
export const DEFAULT_LABELS: Record<StageKind, string> = {
  inbox: "task:inbox",
  todo: "task:todo",
  "in-progress": "task:in-progress",
  review: "task:review",
  done: "task:done",
  canceled: "task:canceled",
};
export const STAGE_COLORS = {
  inbox: "indigo",
  todo: "sky",
  "in-progress": "blue",
  review: "orange",
  done: "emerald",
  canceled: "red",
} as const;
export const labelKey = (name: string) =>
  name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const labelName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((name) => name.replace(/\s+/g, " "));
export const GROUP_COLORS = [
  "gray",
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "violet",
  "pink",
  "red",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];
export const groupSchema = z.object({
  id: stageSchema,
  name: z.string().trim().min(1).max(80).nullable().default(null),
  kind: stageKindSchema,
  label: labelName,
  color: z.enum(GROUP_COLORS).optional(),
});
export type Group = z.infer<typeof groupSchema>;
// Keep the native named-color contract; visual aliases share its stage mapping.
const LABEL_GROUP_COLORS: Record<(typeof STAGE_COLORS)[StageKind], GroupColor> =
  {
    indigo: "violet",
    sky: "cyan",
    blue: "blue",
    orange: "orange",
    emerald: "green",
    red: "red",
  };
export const groupColorKey = (group: Group): GroupColor =>
  group.color ?? LABEL_GROUP_COLORS[STAGE_COLORS[group.kind]];
export function nextGroupColor(groups: readonly Group[]): GroupColor {
  const counts = new Map<GroupColor, number>(
    GROUP_COLORS.map((color) => [color, 0]),
  );
  for (const group of groups) {
    const color = groupColorKey(group);
    counts.set(color, counts.get(color)! + 1);
  }
  return GROUP_COLORS.reduce((least, color) =>
    counts.get(color)! < counts.get(least)! ? color : least,
  );
}
export const DEFAULT_GROUPS: Group[] = STAGES.map((kind) => ({
  id: kind,
  kind,
  name: null,
  label: DEFAULT_LABELS[kind],
}));
export const groupsSchema = z
  .array(groupSchema)
  .min(1)
  .superRefine((groups, context) => {
    if (new Set(groups.map((group) => group.id)).size !== groups.length)
      context.addIssue({
        code: "custom",
        message: "Group identities must be unique",
      });
    if (
      new Set(groups.map((group) => labelKey(group.label))).size !==
      groups.length
    )
      context.addIssue({
        code: "custom",
        message: "Each group needs a different label",
      });
    if (!groups.some((group) => group.kind === "todo"))
      context.addIssue({
        code: "custom",
        message: "Keep at least one To do group for drafts",
      });
    if (!groups.some((group) => group.kind === "inbox"))
      context.addIssue({
        code: "custom",
        message: "Keep at least one Inbox group for unlabeled workspaces",
      });
    if (!groups.some((group) => group.kind === "canceled"))
      context.addIssue({
        code: "custom",
        message: "Keep at least one Canceled group for draft archiving",
      });
  });
export const groupOrderSchema = z
  .array(stageSchema)
  .superRefine((order, context) => {
    if (new Set(order).size !== order.length)
      context.addIssue({
        code: "custom",
        message: "Group order cannot contain duplicates",
      });
  });
const preferences = {
  autoArchive: z.boolean().default(false),
  archiveMappingNeedsReview: z.boolean().default(false),
  // A mirror made more labels count as Done/Canceled; archive waits for this host's review.
  archivePausedByGroupSync: z.boolean().default(false),
  archiveAfterDays: z.number().int().min(1).max(365).default(30),
  defaultDraftGroup: stageSchema.nullable().default(null),
  defaultStartGroup: stageSchema.nullable().default(null),
  defaultStartWorkGroup: stageSchema.nullable().default(null),
  pinInProgressWorkspaces: z.boolean().default(true),
  pinReviewWorkspaces: z.boolean().default(false),
  exclusiveStatusLabels: z.boolean().default(false),
  // The serverId whose groups this host mirrors; its own serverId marks the master.
  groupSyncMaster: z.string().min(1).nullable().default(null),
};
export const settingsSchema = z.object({
  ...preferences,
  groups: groupsSchema.default(DEFAULT_GROUPS),
  groupOrder: groupOrderSchema.default([]),
});
export type Settings = z.infer<typeof settingsSchema>;
export function orderedGroups(
  settings: Pick<Settings, "groups" | "groupOrder">,
): Group[] {
  const remaining = new Map(settings.groups.map((group) => [group.id, group]));
  const ordered: Group[] = [];
  for (const id of settings.groupOrder) {
    const group = remaining.get(id);
    if (group) {
      ordered.push(group);
      remaining.delete(id);
    }
  }
  for (const group of settings.groups)
    if (remaining.has(group.id)) ordered.push(group);
  return ordered;
}
export type GroupSyncRole = "master" | "follower" | "independent";
export const groupSyncRole = (
  settings: Pick<Settings, "groupSyncMaster">,
  serverId: string,
): GroupSyncRole =>
  settings.groupSyncMaster === null
    ? "independent"
    : settings.groupSyncMaster === serverId
      ? "master"
      : "follower";
/** Group identity, definition and display order: everything a follower mirrors. */
export const sameGroupLayout = (
  left: Pick<Settings, "groups" | "groupOrder">,
  right: Pick<Settings, "groups" | "groupOrder">,
): boolean =>
  JSON.stringify([left.groups, left.groupOrder]) ===
  JSON.stringify([right.groups, right.groupOrder]);
export const defaultGroup = (
  groups: readonly Group[],
  configured: Stage | null = null,
): Stage =>
  (groups.find((group) => group.id === configured && group.kind === "todo") ??
    groups.find((group) => group.kind === "todo"))!.id;
export const defaultWorkspaceGroup = (
  groups: readonly Group[],
  configured: Stage | null = null,
): Stage =>
  (groups.find(
    (group) => group.id === configured && !isTerminalGroup(group.id, groups),
  ) ?? groups.find((group) => group.kind === "inbox"))!.id;
export const defaultStartWorkGroup = (
  groups: readonly Group[],
  configured: Stage | null = null,
): Stage | undefined =>
  (
    groups.find(
      (group) => group.id === configured && group.kind === "in-progress",
    ) ?? groups.find((group) => group.kind === "in-progress")
  )?.id;
export const groupKind = (
  stage: Stage,
  groups: readonly Group[],
): StageKind | undefined => groups.find((group) => group.id === stage)?.kind;
export const isDraftGroup = (
  stage: Stage,
  groups: readonly Group[],
): boolean => {
  const kind = groupKind(stage, groups);
  return kind === "inbox" || kind === "todo" || kind === "canceled";
};
export const isTerminalGroup = (
  stage: Stage,
  groups: readonly Group[],
): boolean => {
  const kind = groupKind(stage, groups);
  return kind === "done" || kind === "canceled";
};
const DAY_MS = 24 * 60 * 60 * 1000;
export function statusLabels(
  labels: readonly string[],
  groups: readonly Group[],
): string[] {
  const managed = new Set(groups.map((group) => labelKey(group.label)));
  return [
    ...new Set(labels.filter((label) => managed.has(labelKey(label)))),
  ].sort();
}
export function resolveStage(
  labels: readonly string[],
  groups: readonly Group[],
  configured: Stage | null = null,
): BoardStage {
  const present = new Set(labels.map(labelKey));
  const found = groups.filter((group) => present.has(labelKey(group.label)));
  return found.length > 1
    ? "conflict"
    : (found[0]?.id ?? defaultWorkspaceGroup(groups, configured));
}
/**
 * The one status label an exclusive conflict can attribute to the most recent external
 * change: every managed label except the task's previous stage's label. Any other shape
 * (the previous label already gone, two newcomers, an unknown previous stage) stays a
 * manual conflict, because the newest label cannot be told apart from the rest.
 */
export function newestConflictStage(
  previous: Stage,
  labels: readonly string[],
  groups: readonly Group[],
): Stage | undefined {
  const prior = groups.find((group) => group.id === previous);
  if (!prior) return undefined;
  const newcomer = statusLabels(labels, groups).filter(
    (label) => labelKey(label) !== labelKey(prior.label),
  );
  if (newcomer.length !== 1) return undefined;
  return groups.find((group) => labelKey(group.label) === labelKey(newcomer[0]))
    ?.id;
}
export function archiveDueAt(
  conversation: string | null,
  days = 30,
): string | null {
  const time = conversation === null ? NaN : Date.parse(conversation);
  return Number.isFinite(time)
    ? new Date(time + days * DAY_MS).toISOString()
    : null;
}
export function isArchiveDue(
  stage: string | undefined,
  conversation: string | null,
  now: number,
  days = 30,
): boolean {
  const due = archiveDueAt(conversation, days);
  return (
    (stage === "done" || stage === "canceled") &&
    due !== null &&
    now > Date.parse(due)
  );
}

/** Only an exact or upper-bound time may gate archiving; a lower bound never may. */
export function archiveGate(
  task: Pick<Task, "conversationGateAt" | "conversationGateEvidence">,
): string | null {
  return task.conversationGateEvidence === "exact" ||
    task.conversationGateEvidence === "upper-bound"
    ? task.conversationGateAt
    : null;
}
/** The card summary of what the display evidence supports. */
export function conversationStatusFor(
  display: ConversationDisplay,
): "known" | "none" | "unknown" {
  if (display === "none") return "none";
  return display === "unknown" ? "unknown" : "known";
}
/**
 * The stored settings version. The plugin registers this same value, because the host only
 * migrates stored settings when the registered version differs from what it finds.
 */
export const DATA_SCHEMA_VERSION = 8;

export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("directory"),
    path: z.string().trim().min(1),
    projectId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("worktree"),
    projectId: z.string().min(1),
    worktreeSlug: z.string().trim().min(1).optional(),
  }),
]);
export const startSchema = z.object({
  taskId: z.string(),
  stage: stageSchema.optional(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), workspaceId: z.string() }),
    z.object({ kind: z.literal("new"), source: sourceSchema }),
  ]),
});
export type StartInput = z.infer<typeof startSchema>;
const archiveSchema = z.object({
  operationId: z.string(),
  status: z.enum(["pending", "archived", "uncertain", "external"]),
  kind: z.enum(["automatic", "external", "draft"]),
  stage: z.string(),
  group: groupSchema.nullable().default(null),
  startedAt: z.string(),
  archivedAt: z.string().nullable(),
  lastConversationAt: z.string().nullable(),
  detail: z.string(),
});
/**
 * Display evidence and gate evidence stay separate: a lower bound may be shown to the user
 * but must never trigger automatic archiving, and an upper bound may gate archiving but is
 * not a conversation time when Paseo polluted it with an archive or hydration timestamp.
 */
export const conversationDisplaySchema = z.enum([
  "exact",
  "lower-bound",
  "upper-bound",
  "none",
  "unknown",
]);
export const conversationGateSchema = z.enum([
  "exact",
  "upper-bound",
  "unknown",
]);
export const CONVERSATION_REASONS = [
  "replay-timestamp",
  "truncated-window",
  "timeline-unreadable",
  "child-enumeration-unavailable",
  "child-timeline-unreadable",
] as const;
export const conversationReasonSchema = z.enum(CONVERSATION_REASONS);
export const conversationAgentSchema = z.object({
  id: z.string(),
  lastObservedAt: z.string().nullable().default(null),
  seenWhileLive: z.boolean().default(false),
});
export type ConversationDisplay = z.infer<typeof conversationDisplaySchema>;
export type ConversationGate = z.infer<typeof conversationGateSchema>;
export type ConversationReason = z.infer<typeof conversationReasonSchema>;
export type ConversationAgent = z.infer<typeof conversationAgentSchema>;
export const taskSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string().min(1),
  description: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  draftStage: stageSchema,
  lastStage: z.union([stageSchema, z.literal("conflict")]),
  /**
   * The most recent non-conflict stage the plugin observed. Newest-wins attribution reads
   * this instead of lastStage, because lastStage is persisted as "conflict" and would
   * otherwise make every conflict unattributable forever after one failed or pre-setting
   * sync.
   */
  resolvedStage: stageSchema.nullable().default(null),
  lastConversationAt: z.string().nullable(),
  conversationStatus: z.enum(["known", "none", "unknown"]),
  conversationDisplayEvidence: conversationDisplaySchema.default("unknown"),
  // Paseo's recorded activity: never later than the real last message, but polluted for
  // archived agents, whose updatedAt lands on the archive time instead.
  conversationGateAt: z.string().nullable().default(null),
  conversationGateEvidence: conversationGateSchema.default("unknown"),
  conversationReason: conversationReasonSchema.nullable().default(null),
  conversationAgents: z.array(conversationAgentSchema).default([]),
  mergedDrafts: z
    .array(
      z.object({
        draftId: z.string(),
        title: z.string().min(1),
        description: z.string(),
        mergedAt: z.string(),
        appendedText: z.string().min(1),
      }),
    )
    .default([]),
  issue: z.string().nullable(),
  archived: archiveSchema.nullable(),
  binding: z
    .object({
      operationId: z.string(),
      target: startSchema.shape.target,
      workspaceId: z.string().nullable(),
      stage: stageSchema,
    })
    .nullable(),
});
export type Task = z.infer<typeof taskSchema>;
export const cardOrderByStageSchema = z
  .record(z.string(), z.array(z.string()))
  .default({});
export type CardOrderByStage = z.infer<typeof cardOrderByStageSchema>;
export const dataSchema = z
  .object({
    schemaVersion: z.literal(DATA_SCHEMA_VERSION).default(DATA_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().default(0),
    serverId: z.string().nullable().default(null),
    settings: settingsSchema.default(() => settingsSchema.parse({})),
    // Timestamp owns a native pin; null respects manual intervention for this stage.
    autoPins: z.record(z.string(), z.string().nullable()).default({}),
    tasks: z.array(taskSchema).default([]),
    cardOrderByStage: cardOrderByStageSchema,
  })
  .superRefine((data, context) => {
    const ids = new Set<string>();
    const workspaces = new Set<string>();
    for (const task of data.tasks) {
      if (
        ids.has(task.id) ||
        (task.workspaceId !== null && workspaces.has(task.workspaceId))
      )
        context.addIssue({
          code: "custom",
          message: "Duplicate task or workspace identity",
        });
      ids.add(task.id);
      if (task.workspaceId) workspaces.add(task.workspaceId);
      if (
        task.binding?.workspaceId &&
        task.binding.workspaceId !== task.workspaceId
      )
        context.addIssue({
          code: "custom",
          message: "Binding workspace identity mismatch",
        });
    }
  });
export type Data = z.infer<typeof dataSchema>;
export const activitySchema = z.enum([
  "idle",
  "running",
  "waiting",
  "attention",
  "error",
]);
export const pinStateSchema = z
  .enum(["none", "automatic", "manual"])
  .default("none");
export const cardSchema = taskSchema.extend({
  stage: z.union([stageSchema, z.literal("conflict")]),
  labels: z.array(z.string()),
  managedLabels: z.array(z.string()),
  changeRequest: z
    .object({
      forge: z.string(),
      number: z.number().nullable(),
      url: z.string(),
      title: z.string(),
      state: z.enum(["open", "draft", "merged", "closed", "unknown"]),
      checksStatus: z
        .enum(["none", "pending", "success", "failure"])
        .nullable(),
      reviewDecision: z
        .enum(["approved", "changes_requested", "pending"])
        .nullable(),
    })
    .nullable(),
  changeRequestUnavailable: z.boolean(),
  activity: activitySchema,
  pinState: pinStateSchema,
  dueAt: z.string().nullable(),
  agents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      activity: activitySchema,
      archived: z.boolean(),
    }),
  ),
});
export type Card = z.infer<typeof cardSchema>;
export const boardSchema = z.object({
  revision: z.number(),
  serverId: z.string(),
  version: z.string(),
  connected: z.boolean(),
  error: z.string().nullable(),
  refreshedAt: z.string().nullable(),
  settings: settingsSchema,
  cards: z.array(cardSchema),
  cardOrderByStage: cardOrderByStageSchema,
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      directory: z.string(),
      isGit: z.boolean(),
    }),
  ),
});
export type Board = z.infer<typeof boardSchema>;

export function newTask(
  id: string,
  title: string,
  now: string,
  stage = "todo",
): Task {
  return {
    id,
    title,
    description: "",
    workspaceId: null,
    projectId: null,
    projectName: "",
    createdAt: now,
    updatedAt: now,
    draftStage: stage,
    lastStage: stage,
    resolvedStage: null,
    lastConversationAt: null,
    conversationStatus: "none",
    conversationDisplayEvidence: "none",
    conversationGateAt: null,
    conversationGateEvidence: "unknown",
    conversationReason: null,
    conversationAgents: [],
    mergedDrafts: [],
    issue: null,
    archived: null,
    binding: null,
  };
}

/** A saved column order leads; newly discovered cards retain their activity order at the tail. */
export function cardsForStage(
  cards: readonly Card[],
  stage: Stage,
  orders: CardOrderByStage = {},
): Card[] {
  const saved = Object.hasOwn(orders, stage) ? orders[stage] : [];
  const ranks = new Map(saved.map((id, index) => [id, index]));
  const activityTime = (card: Card) => {
    const value =
      card.workspaceId === null ? card.updatedAt : card.lastConversationAt;
    return value === null ? -Infinity : Date.parse(value);
  };
  return cards
    .filter(
      (card) =>
        card.stage === stage &&
        card.archived?.status !== "archived" &&
        card.archived?.status !== "external",
    )
    .sort(
      (left, right) =>
        (ranks.get(left.id) ?? Infinity) - (ranks.get(right.id) ?? Infinity) ||
        activityTime(right) - activityTime(left) ||
        left.id.localeCompare(right.id),
    );
}
