import {
  cardsForStage,
  type Board,
  type Card,
  type CardOrderByStage,
} from "../shared/model";
import type { Mutation } from "../shared/rpc";

/** One host's board as the federated view sees it. */
export type HostBoard = { serverId: string; label: string; board: Board };
export type Federation = {
  /** The local board extended with every remote card the local groups can place. */
  board: Board;
  /** Card ID to the serverId that owns it. */
  owners: Map<string, string>;
  /** Project ID to the serverId that owns it. */
  projectOwners: Map<string, string>;
  /** Remote cards whose group does not exist on this board, per host. */
  hidden: { serverId: string; label: string; count: number }[];
};

const activityTime = (card: Card) => {
  const value =
    card.workspaceId === null ? card.updatedAt : card.lastConversationAt;
  return value === null ? -Infinity : Date.parse(value);
};
const offBoard = (card: Card) =>
  card.archived?.status === "archived" || card.archived?.status === "external";

/**
 * Interleave per-host columns without breaking any host's own order, which its server owns.
 * The preferred order (the last cross-host arrangement seen here) breaks ties between hosts;
 * cards it does not rank follow by activity, like a column without a saved order.
 */
export function mergeColumn(
  columns: readonly (readonly Card[])[],
  preferred: readonly string[] = [],
): string[] {
  const ranks = new Map(preferred.map((id, index) => [id, index]));
  const heads = columns.map(() => 0);
  const merged: string[] = [];
  for (;;) {
    let best = -1;
    for (let host = 0; host < columns.length; host++) {
      const card = columns[host][heads[host]];
      if (!card) continue;
      if (best < 0) {
        best = host;
        continue;
      }
      const current = columns[best][heads[best]];
      const rank = ranks.get(card.id) ?? Infinity;
      const currentRank = ranks.get(current.id) ?? Infinity;
      if (
        rank < currentRank ||
        (rank === currentRank && activityTime(card) > activityTime(current))
      )
        best = host;
    }
    if (best < 0) return merged;
    merged.push(columns[best][heads[best]++].id);
  }
}

/** Groups come from the local host; remote cards join only groups with the same identity. */
export function mergeBoards(
  local: HostBoard,
  remotes: readonly HostBoard[],
  preferred: CardOrderByStage = {},
): Federation {
  const owners = new Map<string, string>();
  const projectOwners = new Map<string, string>();
  const groupIds = new Set(
    local.board.settings.groups.map((group) => group.id),
  );
  const hidden: Federation["hidden"] = [];
  const hosts = [local, ...remotes];
  const cards: Card[] = [];
  const projects: Board["projects"] = [];
  for (const host of hosts) {
    let count = 0;
    for (const card of host.board.cards) {
      if (owners.has(card.id)) continue;
      if (
        host !== local &&
        !groupIds.has(card.stage) &&
        card.stage !== "conflict" &&
        !offBoard(card)
      ) {
        count++;
        continue;
      }
      owners.set(card.id, host.serverId);
      cards.push(card);
    }
    if (count)
      hidden.push({ serverId: host.serverId, label: host.label, count });
    for (const project of host.board.projects) {
      if (projectOwners.has(project.id)) continue;
      projectOwners.set(project.id, host.serverId);
      projects.push(
        host === local
          ? project
          : { ...project, name: `${project.name} · ${host.label}` },
      );
    }
  }
  if (!remotes.length)
    return { board: local.board, owners, projectOwners, hidden };
  const cardOrderByStage: CardOrderByStage = {};
  for (const id of groupIds) {
    const columns = hosts.map((host) =>
      cardsForStage(
        cards.filter((card) => owners.get(card.id) === host.serverId),
        id,
        host.board.cardOrderByStage,
      ),
    );
    cardOrderByStage[id] = mergeColumn(columns, preferred[id]);
  }
  return {
    board: { ...local.board, cards, projects, cardOrderByStage },
    owners,
    projectOwners,
    hidden,
  };
}

export type Routed = { serverId: string; mutation: Mutation };

/** Send each mutation to the host that owns its task; card orders split by owner. */
export function routeMutation(
  mutation: Mutation,
  owners: ReadonlyMap<string, string>,
  localServerId: string,
): Routed[] {
  const owner = (id: string) => owners.get(id) ?? localServerId;
  if (mutation.action === "reorder-cards") {
    const serverId = owner(mutation.taskId);
    const mine = (id: string) => owner(id) === serverId;
    return [
      {
        serverId,
        mutation: {
          ...mutation,
          expectedOrder: mutation.expectedOrder.filter(mine),
          cardOrder: mutation.cardOrder.filter(mine),
        },
      },
    ];
  }
  if (mutation.action === "reset-card-order") {
    const servers = [...new Set(mutation.expectedOrder.map(owner))];
    return (servers.length ? servers : [localServerId]).map((serverId) => ({
      serverId,
      mutation: {
        ...mutation,
        expectedOrder: mutation.expectedOrder.filter(
          (id) => owner(id) === serverId,
        ),
      },
    }));
  }
  return [
    {
      serverId: "taskId" in mutation ? owner(mutation.taskId) : localServerId,
      mutation,
    },
  ];
}
