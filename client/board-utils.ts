import {
  archiveDelayFor,
  archiveDueAt,
  archiveGate,
  isArchiveDue,
  defaultGroup,
  defaultWorkspaceGroup,
  groupKind,
  labelKey,
  priorityLabels,
  type Group,
  resolveStage,
  type Board,
  type Card,
  type Settings,
  type Stage,
} from "../shared/model";
import {
  DEFAULT_FILTERS,
  matchesDateRange,
  matchesRequest,
  type BoardFilters,
} from "./filters";

const attentionIssues = new Set([
  "labels-conflict",
  "label-sync-incomplete",
  "priority-sync-uncertain",
  "native-archive-unknown",
  "conversation-unknown",
  "terminal-open",
  "git-dirty",
  "git-no-upstream",
  "git-unpushed",
  "git-detached",
  "git-unknown",
  "directory-unavailable",
]);

/** The time the server judges due dates by: the real clock, plus its test-only offset. */
export function boardNow(board: Pick<Board, "clockOffsetMs">): number {
  return Date.now() + (board.clockOffsetMs ?? 0);
}

export function hasNoAgents(card: Card): boolean {
  return card.workspaceId !== null && card.agents.length === 0;
}

/**
 * Whether the card's provider children are unlisted only because an idle parent was left alone
 * on purpose. The server decides that from the conversation evidence (a schedule exists only
 * when nothing else keeps the gate unknown); the client does not infer it from agent activity.
 */
export function childrenSkippedForIdle(card: Card): boolean {
  return (
    card.conversationReason === "child-enumeration-unavailable" &&
    card.recheckAt != null
  );
}

export function attentionReasons(card: Card): string[] {
  const reasons: string[] = [];
  if (["waiting", "error", "attention"].includes(card.activity))
    reasons.push(card.activity);
  if (card.priorityWrite) reasons.push("priority-sync-uncertain");
  if (card.stage === "conflict") reasons.push("labels-conflict");
  if (priorityLabels(card.labels, card.managedLabels).length > 1)
    reasons.push("priority-labels-conflict");
  if (
    card.issue &&
    attentionIssues.has(card.issue) &&
    !(card.issue === "conversation-unknown" && hasNoAgents(card)) &&
    !reasons.includes(card.issue)
  )
    reasons.push(card.issue);
  const request = card.changeRequest;
  if (
    !card.changeRequestUnavailable &&
    request &&
    (request.state === "open" || request.state === "draft")
  ) {
    if (request.checksStatus === "failure") reasons.push("checks-failure");
    if (request.reviewDecision === "changes_requested")
      reasons.push("changes-requested");
  }
  return reasons;
}

/** `projectId` is "all", "none", or a project; a merged project passes all its host IDs. */
export function visibleCards(
  board: Board,
  projectId: string | readonly string[],
  search: string,
  attentionOnly: boolean,
  filters: Pick<
    BoardFilters,
    "activity" | "changeRequest" | "dateRange"
  > = DEFAULT_FILTERS,
  now: number = Date.now(),
): Card[] {
  const needle = search.trim().toLocaleLowerCase();
  return board.cards.filter(
    (card) =>
      card.archived?.status !== "archived" &&
      card.archived?.status !== "external" &&
      (projectId === "all" ||
        (projectId === "none"
          ? card.projectId === null
          : typeof projectId === "string"
            ? card.projectId === projectId
            : card.projectId !== null && projectId.includes(card.projectId))) &&
      (!attentionOnly || attentionReasons(card).length > 0) &&
      (filters.activity === "all" || card.activity === filters.activity) &&
      matchesRequest(card, filters.changeRequest) &&
      matchesDateRange(card, filters.dateRange, now) &&
      (!needle ||
        `${card.title} ${card.projectName} ${card.description}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
}

export { cardsForStage } from "../shared/model";

/**
 * Keep a requested move visible while the daemon verifies the label mutation.
 * The server response remains authoritative; this only changes the local board
 * projection and deliberately leaves label data untouched.
 */
export function withOptimisticStages(
  board: Board,
  stages: ReadonlyMap<string, Stage>,
): Board {
  if (stages.size === 0) return board;
  return {
    ...board,
    cards: board.cards.map((card) => {
      const stage = stages.get(card.id);
      return stage === undefined || stage === card.stage
        ? card
        : { ...card, stage };
    }),
  };
}

export function shortDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function stageAtX(
  x: number,
  columns: Partial<Record<Stage, { left: number; right: number }>>,
  stages: readonly Stage[],
): Stage | null {
  const measured = stages.filter((stage) => columns[stage]);
  if (
    !measured.length ||
    x < columns[measured[0]]!.left ||
    x > columns[measured.at(-1)!]!.right
  )
    return null;
  return (
    measured.find((stage, index) => {
      const next = columns[measured[index + 1]];
      return !next || x <= (columns[stage]!.right + next.left) / 2;
    }) ?? null
  );
}

export const DEFAULT_COLUMN_WIDTH = 280;
export const MIN_COLUMN_WIDTH = 220;
export const MAX_COLUMN_WIDTH = 480;
export const columnWidth = (value = DEFAULT_COLUMN_WIDTH) =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value)));

export function groupOrderAtX(
  order: readonly string[],
  moving: string,
  x: number,
  columns: Record<string, { left: number; right: number }>,
): string[] {
  const next = order.filter((id) => id !== moving);
  const before = next.findIndex((id) => {
    const bounds = columns[id];
    return bounds && x < (bounds.left + bounds.right) / 2;
  });
  next.splice(before < 0 ? next.length : before, 0, moving);
  return next;
}

export function edgeScrollSpeed(x: number, width: number): number {
  const edge = Math.min(64, width / 4);
  if (x < 0 || x > width) return 0;
  if (x < edge) return -720 * (1 - x / edge);
  if (x > width - edge) return 720 * (1 - (width - x) / edge);
  return 0;
}

type ArchiveCandidate = {
  card: Card;
  kind: Extract<Group["kind"], "done" | "canceled">;
  days: number;
  conversationAt: string;
  dueAt: string;
  /** The time is only a scheduled recheck, not a bound on the conversation. */
  scheduled: boolean;
};

export function mappingPreview(
  cards: readonly Card[],
  settings: Settings,
  now: number,
) {
  let affected = 0;
  const candidates: ArchiveCandidate[] = [];
  for (const card of cards) {
    if (
      card.workspaceId === null ||
      card.archived?.status === "archived" ||
      card.archived?.status === "external"
    )
      continue;
    const stage = resolveStage(
      card.labels,
      settings.groups,
      settings.defaultStartGroup,
    );
    if (stage !== card.stage) affected += 1;
    const kind = groupKind(stage, settings.groups);
    // A scheduled idle recheck may archive right after the rule is enabled, so it belongs in
    // the confirmation; the hint itself never authorizes anything.
    const gate = archiveGate(card);
    const conversationAt = gate ?? card.recheckAt ?? null;
    const days = archiveDelayFor(settings, kind);
    const dueAt = archiveDueAt(conversationAt, days);
    if (
      (kind === "done" || kind === "canceled") &&
      conversationAt !== null &&
      days !== null &&
      dueAt !== null &&
      !card.archived &&
      !card.autoArchivePaused &&
      !card.binding &&
      isArchiveDue(kind, conversationAt, now, days)
    )
      candidates.push({
        card,
        kind,
        days,
        conversationAt,
        dueAt,
        scheduled: gate === null,
      });
  }
  return {
    affected,
    due: candidates.length,
    dueDone: candidates.filter((candidate) => candidate.kind === "done").length,
    dueCanceled: candidates.filter((candidate) => candidate.kind === "canceled")
      .length,
    candidates,
  };
}

export function groupTasks(cards: readonly Card[], group: Group): Card[] {
  return cards.filter(
    (card) =>
      card.archived?.status !== "archived" &&
      card.archived?.status !== "external" &&
      (card.stage === group.id ||
        card.binding?.stage === group.id ||
        card.labels.some((label) => labelKey(label) === labelKey(group.label))),
  );
}

export function groupDeleteReason(
  cards: readonly Card[],
  groups: readonly Group[],
  group: Group,
  defaults?: Partial<
    Pick<
      Settings,
      "defaultDraftGroup" | "defaultStartGroup" | "defaultStartWorkGroup"
    >
  >,
):
  | "groupDeleteNotEmpty"
  | "groupDefaultInUse"
  | "groupNeedsTodo"
  | "groupNeedsInbox"
  | "groupNeedsCanceled"
  | null {
  const workspaceDefault = defaultWorkspaceGroup(
    groups,
    defaults?.defaultStartGroup,
  );
  if (
    groupTasks(cards, group).some(
      (card) =>
        !card.workspaceId ||
        card.stage !== workspaceDefault ||
        card.labels.some(
          (label) => labelKey(label) === labelKey(group.label),
        ) ||
        card.binding?.stage === group.id ||
        card.issue === "archive-restored-workspace-unavailable",
    )
  )
    return "groupDeleteNotEmpty";
  if (groups.filter((item) => item.kind === group.kind).length === 1) {
    if (group.kind === "todo") return "groupNeedsTodo";
    if (group.kind === "inbox") return "groupNeedsInbox";
    if (group.kind === "canceled") return "groupNeedsCanceled";
  }
  if (
    group.id === defaultGroup(groups, defaults?.defaultDraftGroup) ||
    group.id === workspaceDefault ||
    group.id === defaults?.defaultStartWorkGroup
  )
    return "groupDefaultInUse";
  return null;
}

/** Move only the selected card around a visible anchor; hidden neighbors keep relative order. */
export function moveCardToAnchor(
  order: readonly string[],
  moving: string,
  anchor: string,
  side: "before" | "after",
): string[] {
  if (moving === anchor || !order.includes(moving) || !order.includes(anchor))
    return [...order];
  const next = order.filter((id) => id !== moving);
  next.splice(next.indexOf(anchor) + (side === "after" ? 1 : 0), 0, moving);
  return next;
}
