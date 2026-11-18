import {
  attentionReasons,
  boardNow,
  visibleCards,
} from "../client/board-utils";
import { DEFAULT_FILTERS } from "../client/filters";
import {
  cardsForStage,
  DEFAULT_PRIORITY_STYLES,
  groupColorKey,
  groupKind,
  isDraftGroup,
  orderedGroups,
  PRIORITY_LABELS,
  resolvePriority,
  priorityLabels,
  type Board,
  type Card,
  type Group,
  type GroupColor,
  type Priority,
} from "../shared/model";
import type { Mutation } from "../shared/rpc";
import { groupTitle } from "../client/strings";
import type { TuiStrings } from "./strings";

/** One group of the list; the conflict section has no group and leads when present. */
export interface Section {
  id: string;
  group: Group | null;
  cards: Card[];
}
export type Row =
  | { kind: "header"; section: Section }
  | { kind: "card"; section: Section; card: Card };
/** The selected card, with its row index kept so a vanished card selects its neighbor. */
export interface Selection {
  id: string | null;
  index: number;
}

export function boardSections(board: Board, attentionOnly: boolean): Section[] {
  const cards = visibleCards(
    board,
    "all",
    "",
    attentionOnly,
    DEFAULT_FILTERS,
    boardNow(board),
  );
  const sections: Section[] = orderedGroups(board.settings).map((group) => ({
    id: group.id,
    group,
    cards: cardsForStage(cards, group.id, board.cardOrderByStage),
  }));
  const conflicts = cardsForStage(cards, "conflict");
  if (conflicts.length > 0)
    sections.unshift({ id: "conflict", group: null, cards: conflicts });
  return sections;
}

export function boardRows(sections: readonly Section[]): Row[] {
  return sections.flatMap((section): Row[] => [
    { kind: "header", section },
    ...section.cards.map((card): Row => ({ kind: "card", section, card })),
  ]);
}

const selectedCards = (sections: readonly Section[]) =>
  sections.flatMap((section) => section.cards);

/** The selection after the board changed: the same card, else the one now at its index. */
export function resolveSelection(
  sections: readonly Section[],
  selection: Selection,
): Selection {
  const cards = selectedCards(sections);
  const index = cards.findIndex((card) => card.id === selection.id);
  if (index >= 0) return { id: selection.id, index };
  if (cards.length === 0) return { id: null, index: 0 };
  const clamped = Math.min(Math.max(selection.index, 0), cards.length - 1);
  return { id: cards[clamped].id, index: clamped };
}

export function moveSelection(
  sections: readonly Section[],
  selection: Selection,
  delta: number,
): Selection {
  const current = resolveSelection(sections, selection);
  return resolveSelection(sections, {
    id: null,
    index: current.index + delta,
  });
}

export function edgeSelection(
  sections: readonly Section[],
  edge: "first" | "last",
): Selection {
  return resolveSelection(sections, {
    id: null,
    index: edge === "first" ? 0 : Number.MAX_SAFE_INTEGER,
  });
}

/** The first card of the next (or previous) section that has cards. */
export function jumpSection(
  sections: readonly Section[],
  selection: Selection,
  delta: 1 | -1,
): Selection {
  const current = resolveSelection(sections, selection);
  const position = sections.findIndex((section) =>
    section.cards.some((card) => card.id === current.id),
  );
  for (
    let index = position + delta;
    index >= 0 && index < sections.length;
    index += delta
  ) {
    const card = sections[index].cards[0];
    if (card) return resolveSelection(sections, { id: card.id, index: 0 });
  }
  return current;
}

export function selectedCard(
  sections: readonly Section[],
  selection: Selection,
): Card | null {
  const { id } = resolveSelection(sections, selection);
  return selectedCards(sections).find((card) => card.id === id) ?? null;
}

export type StageMove =
  | { kind: "mutation"; mutation: Mutation; group: Group }
  | {
      kind: "blocked";
      reason: "edge" | "needs-start" | "binding" | "conflict";
    };

/**
 * Moving a card one group along the configured order, with the same expected
 * labels and group the Paseo app sends; the server stays the authority.
 */
export function stageMove(board: Board, card: Card, delta: 1 | -1): StageMove {
  if (card.stage === "conflict") return { kind: "blocked", reason: "conflict" };
  if (card.binding !== null) return { kind: "blocked", reason: "binding" };
  const groups = orderedGroups(board.settings);
  const target =
    groups[groups.findIndex(({ id }) => id === card.stage) + delta];
  if (!target || !groups.some(({ id }) => id === card.stage))
    return { kind: "blocked", reason: "edge" };
  if (
    card.workspaceId === null &&
    !isDraftGroup(target.id, board.settings.groups)
  )
    return { kind: "blocked", reason: "needs-start" };
  return {
    kind: "mutation",
    group: target,
    mutation: {
      action: "stage",
      taskId: card.id,
      stage: target.id,
      expectedLabels: card.managedLabels,
      expectedGroup: { id: target.id, kind: target.kind, label: target.label },
    },
  };
}

export function priorityMutation(card: Card, priority: Priority): Mutation {
  return {
    action: "priority",
    taskId: card.id,
    updatedAt: card.updatedAt,
    priority,
    expectedLabels: priorityLabels(card.labels, card.managedLabels),
  };
}

/** A new draft joins the selected card's To do group, else the host's default draft group. */
export function createMutation(
  board: Board,
  card: Card | null,
  title: string,
): Mutation {
  const stage = card && card.stage !== "conflict" ? card.stage : null;
  return {
    action: "create",
    title,
    description: "",
    projectId: null,
    ...(stage !== null && groupKind(stage, board.settings.groups) === "todo"
      ? { stage }
      : {}),
  };
}

export const cardPriority = (card: Card): Priority =>
  card.priority ?? resolvePriority(card.labels, card.managedLabels);

export function sectionTitle(section: Section, t: TuiStrings): string {
  return section.group ? groupTitle(section.group, t) : t.conflict;
}

export function groupColorOf(section: Section): GroupColor {
  return section.group ? groupColorKey(section.group) : "red";
}

export function priorityColorOf(board: Board, priority: Priority): GroupColor {
  return (board.settings.priorityStyles ?? DEFAULT_PRIORITY_STYLES)[priority]
    .color;
}

export function priorityName(board: Board, priority: Priority): string {
  const name = board.settings.priorityStyles?.[priority].name;
  return name
    ? `${PRIORITY_LABELS[priority]} ${name}`
    : PRIORITY_LABELS[priority];
}

/** The card's status after its title: draft, or activity with its change request. */
export function cardStatus(card: Card, t: TuiStrings): string {
  const parts = [card.projectName];
  if (card.workspaceId === null) parts.push(t.tui.draft);
  else {
    parts.push(
      card.agents.length === 0 ? t.noAgents : t.activity[card.activity],
    );
    const request = card.changeRequest;
    if (request && !card.changeRequestUnavailable) {
      parts.push(
        `${request.number === null ? "" : `#${request.number} `}${t.changeRequestStates[request.state]}`,
      );
      if (request.checksStatus && request.checksStatus !== "none")
        parts.push(t.checks[request.checksStatus]);
    }
  }
  return parts.filter(Boolean).join(" · ");
}

export function attentionTexts(card: Card, t: TuiStrings): string[] {
  const issues: Record<string, string> = t.issues;
  return attentionReasons(card).map((reason) => {
    if (reason === "waiting" || reason === "error" || reason === "attention")
      return t.attentionActivity[reason];
    if (reason === "checks-failure") return t.checks.failure;
    if (reason === "changes-requested") return t.reviews.changes_requested;
    return issues[reason] ?? reason;
  });
}

/** The first row to draw so the selected row stays visible in `height` rows. */
export function windowStart(
  rowCount: number,
  selectedRow: number,
  height: number,
  previousStart: number,
): number {
  if (height <= 0 || rowCount <= height) return 0;
  const last = rowCount - height;
  let start = Math.min(Math.max(previousStart, 0), last);
  if (selectedRow < start) start = selectedRow;
  if (selectedRow >= start + height) start = selectedRow - height + 1;
  return Math.min(Math.max(start, 0), last);
}
