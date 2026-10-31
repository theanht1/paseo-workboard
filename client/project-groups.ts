import {
  cardsForStage,
  type Card,
  type CardOrderByStage,
  type Group,
  type Board,
} from "../shared/model";

export function sortPriorityCards(cards: readonly Card[]): Card[] {
  const rank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  return [...cards].sort(
    (a, b) => rank[a.priority ?? "p2"] - rank[b.priority ?? "p2"],
  );
}

export type TaskSection = {
  id: string;
  title: string;
  cards: Card[];
  total: number;
};

/**
 * Group by project identity, never its editable display name. Sorting leaves stored order intact.
 * On a multi-host board, aliases put each host's copy of a merged project in one lane.
 */
export function taskSections(input: {
  cards: Card[];
  fullCards: Card[];
  groups: Group[];
  cardOrderByStage: CardOrderByStage;
  projects: Board["projects"];
  projectAliases?: ReadonlyMap<string, string>;
  unassigned: string;
}): TaskSection[] {
  const sections = new Map<string, TaskSection>();
  const listed = (projectId: string) =>
    input.projectAliases?.get(projectId) ?? projectId;
  const key = (card: Card) =>
    card.projectId === null
      ? "project:none"
      : `project:id:${listed(card.projectId)}`;
  const projectNames = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );
  const counts = new Map<string, number>();
  const stages = new Set(input.groups.map((group) => group.id));
  for (const card of input.fullCards) {
    if (
      !stages.has(card.stage) ||
      card.archived?.status === "archived" ||
      card.archived?.status === "external"
    )
      continue;
    counts.set(key(card), (counts.get(key(card)) ?? 0) + 1);
  }
  const ordered = input.groups.flatMap((group) =>
    cardsForStage(input.cards, group.id, input.cardOrderByStage),
  );
  for (const card of ordered) {
    const id = key(card);
    if (!sections.has(id))
      sections.set(id, {
        id,
        title:
          (card.projectId !== null
            ? projectNames.get(listed(card.projectId))
            : undefined) ||
          card.projectName ||
          input.unassigned,
        cards: [],
        total: counts.get(id) ?? 0,
      });
    sections.get(id)!.cards.push(card);
  }
  const values = [...sections.values()];
  values.sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  return values;
}
