import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsInput,
  SettingsAction,
  SettingsSelect,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  Icon,
  Modal,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  defaultWorkspaceGroup,
  defaultStartWorkGroup,
  groupSyncRole,
  isDraftGroup,
  isTerminalGroup,
  orderedGroups,
  type Board,
  type Card,
  type Group,
  type Settings,
  type Stage,
} from "../shared/model";
import {
  CANCEL_BINDING_BUSY_ERROR_CODE,
  mutateRpc,
  snapshotRpc,
  type Mutation,
} from "../shared/rpc";
import {
  groupDeleteReason,
  mappingPreview,
  shortDate,
  visibleCards,
  withOptimisticStages,
} from "./board-utils";
import { groupTitle, stageTitle, strings } from "./strings";
import { GroupEditor, GroupSettings, newGroup } from "./GroupSettings";
import { BoardView } from "./BoardView";
import { ListView } from "./ListView";
import { TaskItem } from "./TaskItem";
export { TaskItem as TaskCard } from "./TaskItem";
import {
  loadViewPreferences,
  saveViewPreferences,
  type ViewPreferences,
} from "./view-preferences";
import { groupColor } from "./colors";
import { loadBoardFilters, saveBoardFilters, toggleButtonState } from "./web";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  type BoardFilters,
} from "./filters";
import { FilterPanel } from "./FilterPanel";
import { QuickCreate } from "./QuickCreate";
import { HintButton, HintProvider } from "./Hint";
import { usePaseoLanguage } from "./paseo-language";
import { ConfirmationModal } from "./ConfirmationModal";
import { mergeBoards, routeMutation, type HostBoard } from "./federation";
import {
  hostLabel,
  useHostRuntimes,
  useHostSummaries,
  useRemoteBoards,
} from "./federation-hooks";
import { requestGroupSync } from "./host-runtimes";
import {
  loadHostPreferences,
  saveHostPreferences,
  type HostPreferences,
} from "./host-preferences";
import { HostSettings, type HostStatus } from "./HostSettings";

type Page = "board" | "archive" | "settings";
type DraftForm = {
  task?: Card;
  title: string;
  description: string;
  projectId: string | null;
  /** The host a new draft is created on. */
  serverId?: string;
} | null;
type HostOption = { serverId: string; label: string; board: Board };
const GROUP_ACTIONS = new Set<Mutation["action"]>([
  "settings",
  "reorder-groups",
  "group-sync",
]);
/** Keep a list's identity while its items are unchanged, for memoized merging. */
function useStableList<T>(list: T[]): T[] {
  const stable = useRef(list);
  if (
    stable.current.length !== list.length ||
    stable.current.some((item, index) => item !== list[index])
  )
    stable.current = list;
  return stable.current;
}
type StartForm = { card: Card; stage?: Stage } | null;
type MoveUndo = {
  group: Pick<Group, "id" | "kind" | "label">;
  card: Card;
  expiresAt: number;
};
const sameUndoGroup = (board: Board | undefined, undo: MoveUndo) => {
  const current = board?.settings.groups.find(
    (group) => group.id === undo.group.id,
  );
  return (
    !!current &&
    current.kind === undo.group.kind &&
    current.label === undo.group.label
  );
};
const sameCard = (left: Card | undefined, right: Card) =>
  !!left && JSON.stringify(left) === JSON.stringify(right);

export function WorkboardScreen(
  props: PluginSurfaceProps & { initialPage?: Page },
) {
  return (
    <HintProvider key={props.host.id} theme={props.theme}>
      <HostWorkboard {...props} />
    </HintProvider>
  );
}

function HostWorkboard(props: PluginSurfaceProps & { initialPage?: Page }) {
  const callSnapshot = useRpc(snapshotRpc);
  const callMutation = useRpc(mutateRpc);
  const cache = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState<Page>(props.initialPage ?? "board");
  const [filters, setFilters] = useState(() => loadBoardFilters(props.host.id));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const storageWarned = useRef(false);
  const viewStorageWarned = useRef(false);
  const [viewPreferences, setViewPreferences] = useState(() =>
    loadViewPreferences(props.host.id),
  );
  const viewPreferencesRef = useRef(viewPreferences);
  const [quickDrafts, setQuickDrafts] = useState<
    Record<string, { title: string; error: boolean }>
  >({});
  const [latestMoveUndoId, setLatestMoveUndoId] = useState<string | null>(null);
  const { projectId, search, attentionOnly } = filters;
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
  const [draft, setDraft] = useState<DraftForm>(null);
  const [starting, setStarting] = useState<StartForm>(null);
  const [statusCard, setStatusCard] = useState<Card | null>(null);
  const [archivingDraft, setArchivingDraft] = useState<Card | null>(null);
  const [detachingDraft, setDetachingDraft] = useState<{
    card: Card;
    draftId: string;
  } | null>(null);
  const [cancelingBinding, setCancelingBinding] = useState<Card | null>(null);
  const [pendingMutationIds, setPendingMutationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [moveUndos, setMoveUndos] = useState<Map<string, MoveUndo>>(
    () => new Map(),
  );
  const [optimisticCardOrders, setOptimisticCardOrders] = useState<
    Record<string, string[]>
  >({});
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [editingGroup, setEditingGroup] = useState<{
    group: Group;
    settings: Settings;
    revision: number;
  } | null>(null);
  const [optimisticStages, setOptimisticStages] = useState<Map<string, Stage>>(
    () => new Map(),
  );
  const boardQuery = useQuery({
    queryKey: ["workboard", props.host.id],
    queryFn: () => callSnapshot({}),
    refetchInterval: 1_500,
  });
  const serverBoard = boardQuery.data;
  const language = usePaseoLanguage();
  const t = strings(language);
  const runtimes = useHostRuntimes();
  const hostSummaries = useHostSummaries();
  const remoteBoards = useRemoteBoards(
    serverBoard?.serverId,
    runtimes,
    hostSummaries,
  );
  const [hostPreferences, setHostPreferences] = useState(() =>
    loadHostPreferences(props.host.id),
  );
  const hostPreferencesRef = useRef(hostPreferences);
  const updateHostPreferences = (patch: Partial<HostPreferences>) => {
    const next = { ...hostPreferencesRef.current, ...patch };
    hostPreferencesRef.current = next;
    setHostPreferences(next);
    if (
      !saveHostPreferences(props.host.id, next) &&
      !viewStorageWarned.current
    ) {
      viewStorageWarned.current = true;
      toast.show(t.viewSaveFailed, { variant: "warning" });
    }
  };
  // Query data keeps its identity between unchanged polls; merge only when it changes.
  const remoteData = useStableList(
    hostPreferences.allHosts
      ? remoteBoards.flatMap((remote) => (remote.board ? [remote.board] : []))
      : [],
  );
  const shownRemotes = useMemo(
    () =>
      remoteData.map(
        (board): HostBoard => ({
          serverId: board.serverId,
          label: hostLabel(hostSummaries, board.serverId),
          board,
        }),
      ),
    [remoteData, hostSummaries],
  );
  const federation = useMemo(
    () =>
      serverBoard &&
      mergeBoards(
        {
          serverId: serverBoard.serverId,
          label: hostLabel(hostSummaries, serverBoard.serverId),
          board: serverBoard,
        },
        shownRemotes,
        hostPreferences.crossHostOrder,
      ),
    [serverBoard, shownRemotes, hostSummaries, hostPreferences.crossHostOrder],
  );
  const updateViewPreferences = (patch: Partial<ViewPreferences>) => {
    const next = { ...viewPreferencesRef.current, ...patch };
    viewPreferencesRef.current = next;
    setViewPreferences(next);
    if (
      !saveViewPreferences(props.host.id, next) &&
      !viewStorageWarned.current
    ) {
      viewStorageWarned.current = true;
      toast.show(t.viewSaveFailed, { variant: "warning" });
    }
  };
  const mutationPending = useRef(new Set<string>());
  const liveBoard = useRef(federation?.board);
  liveBoard.current = federation?.board;
  const liveServer = useRef(serverBoard);
  liveServer.current = serverBoard;
  const liveFederation = useRef(federation);
  liveFederation.current = federation;
  const liveRemotes = useRef(remoteBoards);
  liveRemotes.current = remoteBoards;
  const liveShown = useRef(shownRemotes);
  liveShown.current = shownRemotes;
  const liveUndos = useRef(moveUndos);
  liveUndos.current = moveUndos;
  const filterValues = useRef(filters);
  const filterSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterDirty = useRef(false);
  const persistFilters = useCallback(() => {
    filterDirty.current = false;
    if (
      !saveBoardFilters(props.host.id, filterValues.current) &&
      !storageWarned.current
    ) {
      storageWarned.current = true;
      toast.show(t.filterSaveFailed, { variant: "warning" });
    }
  }, [props.host.id, toast, t.filterSaveFailed]);
  useEffect(
    () => () => {
      if (filterSave.current) clearTimeout(filterSave.current);
      if (filterDirty.current) persistFilters();
    },
    [persistFilters],
  );
  useEffect(() => {
    const prune = () =>
      setMoveUndos((current) => {
        const next = new Map(
          [...current].filter(
            ([id, undo]) =>
              undo.expiresAt > Date.now() &&
              sameUndoGroup(liveBoard.current, undo) &&
              sameCard(
                liveBoard.current?.cards.find((card) => card.id === id),
                undo.card,
              ),
          ),
        );
        liveUndos.current = next;
        return next.size === current.size ? current : next;
      });
    prune();
    if (!moveUndos.size) return;
    const timer = setTimeout(
      prune,
      Math.max(
        0,
        Math.min(...[...moveUndos.values()].map((undo) => undo.expiresAt)) -
          Date.now(),
      ),
    );
    return () => clearTimeout(timer);
  }, [federation?.board, moveUndos]);
  const writeEligible = useRef(false);
  const updateFilters = useCallback(
    (patch: Partial<BoardFilters>) => {
      const next = { ...filterValues.current, ...patch };
      filterValues.current = next;
      setFilters(next);
      filterDirty.current = true;
      if (filterSave.current) clearTimeout(filterSave.current);
      filterSave.current = setTimeout(() => {
        filterSave.current = null;
        persistFilters();
      }, 300);
    },
    [persistFilters],
  );
  // Remote projects are filterable too; wait for every host before dropping a saved filter.
  const remotesLoading = remoteBoards.some(
    (remote) => !remote.board && !remote.failed,
  );
  const knownProjects = federation?.board.projects;
  useEffect(() => {
    if (
      serverBoard?.connected &&
      !remotesLoading &&
      projectId !== "all" &&
      projectId !== "none" &&
      !knownProjects?.some((project) => project.id === projectId)
    )
      updateFilters({ projectId: "all" });
  }, [
    projectId,
    serverBoard?.connected,
    remotesLoading,
    knownProjects,
    updateFilters,
  ]);
  writeEligible.current = !!serverBoard?.connected && !boardQuery.isError;
  const mutate = useCallback(
    async (
      mutation: Mutation,
      pendingMutationId = "taskId" in mutation
        ? `${mutation.action}:${mutation.taskId}`
        : mutation.action,
      target?: string,
    ) => {
      if (mutationPending.current.has(pendingMutationId)) {
        toast.error(t.mutationPending);
        return undefined;
      }
      if (!writeEligible.current) {
        toast.error(t.disconnected);
        return undefined;
      }
      mutationPending.current.add(pendingMutationId);
      setPendingMutationIds(new Set(mutationPending.current));
      try {
        const local = liveServer.current!;
        const routes = target
          ? [{ serverId: target, mutation }]
          : routeMutation(
              mutation,
              liveFederation.current?.owners ?? new Map(),
              local.serverId,
            );
        const settled = await Promise.allSettled(
          routes.map(async (route) => {
            const remote = liveRemotes.current.find(
              (item) => item.runtime.serverId === route.serverId,
            );
            if (route.serverId !== local.serverId && !remote)
              throw new Error("host-unavailable");
            const key =
              route.serverId === local.serverId
                ? props.host.id
                : route.serverId;
            const next = remote
              ? await remote.runtime.rpc(mutateRpc, route.mutation)
              : await callMutation(route.mutation);
            await cache.cancelQueries({ queryKey: ["workboard", key] });
            cache.setQueryData<Board>(["workboard", key], (previous) =>
              previous && previous.revision > next.revision ? previous : next,
            );
            return next;
          }),
        );
        const failed = settled.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
        const boards = new Map(
          settled.map((result) => {
            const next = (result as PromiseFulfilledResult<Board>).value;
            return [next.serverId, next];
          }),
        );
        if (GROUP_ACTIONS.has(mutation.action)) requestGroupSync();
        const merged = mergeBoards(
          {
            serverId: local.serverId,
            label: "",
            board: boards.get(local.serverId) ?? local,
          },
          liveShown.current.map((remote) => ({
            ...remote,
            board: boards.get(remote.serverId) ?? remote.board,
          })),
          hostPreferencesRef.current.crossHostOrder,
        );
        return merged.board;
      } catch (error) {
        toast.error(mutationErrorText(error, t));
        return undefined;
      } finally {
        mutationPending.current.delete(pendingMutationId);
        setPendingMutationIds(new Set(mutationPending.current));
      }
    },
    [cache, callMutation, props.host.id, t, toast],
  );
  if (boardQuery.isPending)
    return <Centered theme={props.theme} text={t.loading} />;
  if (!serverBoard || !federation)
    return (
      <Centered
        theme={props.theme}
        text={t.loadError}
        action={t.refresh}
        onPress={() => void boardQuery.refetch()}
      />
    );
  const board = withOptimisticStages(
    {
      ...federation.board,
      cardOrderByStage: {
        ...federation.board.cardOrderByStage,
        ...optimisticCardOrders,
      },
    },
    optimisticStages,
  );
  const localId = serverBoard.serverId;
  const multiHost = shownRemotes.length > 0;
  const labelOf = (serverId: string) => hostLabel(hostSummaries, serverId);
  const ownerOf = (card: Card) => federation.owners.get(card.id) ?? localId;
  const boardOf = (serverId: string) =>
    (serverId === localId
      ? undefined
      : remoteBoards.find((remote) => remote.runtime.serverId === serverId)
          ?.board) ?? serverBoard;
  const hostOptions: HostOption[] = [
    { serverId: localId, label: labelOf(localId), board: serverBoard },
    ...shownRemotes,
  ];
  const syncRole = groupSyncRole(serverBoard.settings, localId);
  const groupsLockedBy =
    syncRole === "follower"
      ? labelOf(serverBoard.settings.groupSyncMaster!)
      : null;
  const groupsLocked = () => {
    if (!groupsLockedBy) return false;
    toast.show(t.groupsFollowing.replace("{master}", groupsLockedBy), {
      variant: "warning",
    });
    return true;
  };
  // Deleting a master's group also reaches the hosts that mirror it.
  const groupScope = new Set([
    localId,
    ...(syncRole === "master"
      ? remoteBoards
          .filter(
            (remote) => remote.board?.settings.groupSyncMaster === localId,
          )
          .map((remote) => remote.runtime.serverId)
      : []),
  ]);
  const projectHost =
    projectId === "all" || projectId === "none"
      ? localId
      : (federation.projectOwners.get(projectId) ?? localId);
  const hostStatuses: HostStatus[] = [
    ...new Set([
      localId,
      ...hostSummaries.map((host) => host.serverId),
      ...runtimes.flatMap((runtime) =>
        runtime.serverId ? [runtime.serverId] : [],
      ),
    ]),
  ].map((serverId) => {
    const summary = hostSummaries.find((host) => host.serverId === serverId);
    const runtime = runtimes.find((item) => item.serverId === serverId);
    return {
      serverId,
      label: labelOf(serverId),
      local: serverId === localId,
      online:
        serverId === localId ||
        (summary ? summary.status === "online" : !!runtime),
      settings:
        serverId === localId
          ? serverBoard.settings
          : remoteBoards.find((remote) => remote.runtime.serverId === serverId)
              ?.board?.settings,
      sync: runtime?.sync,
    };
  });
  const setGroupMaster = async (master: string | null) => {
    const targets = hostStatuses.filter((host) => host.online && host.settings);
    const results = await Promise.all(
      targets.map((host) =>
        mutate(
          { action: "group-sync", master },
          `group-sync:${host.serverId}`,
          host.serverId,
        ),
      ),
    );
    const failed = targets.filter((_, index) => !results[index]);
    if (failed.length)
      toast.show(
        t.groupSyncPartial.replace(
          "{hosts}",
          failed.map((host) => host.label).join(", "),
        ),
        { variant: "warning" },
      );
    return !failed.length;
  };
  const cards = visibleCards(board, projectId, search, attentionOnly, filters);
  const filterCount = activeFilterCount(filters);
  const hasActiveFilter = filterCount > 0;
  const allCards = visibleCards(board, "all", "", false);
  const conflicts = cards.filter((card) => card.stage === "conflict");
  const archived = board.cards.filter((card) => card.archived !== null);
  const writesDisabled = !board.connected || boardQuery.isError;
  const groupsPending = pendingMutationIds.has("settings:groups");
  const draftPending = pendingMutationIds.has(
    draft?.task ? `edit:${draft.task.id}` : "create",
  );
  const startPending =
    !!starting && pendingMutationIds.has(`start:${starting.card.id}`);
  if (page === "archive")
    return (
      <ArchivePage
        board={board}
        cards={archived}
        t={t}
        theme={props.theme}
        disabled={writesDisabled}
        mutate={mutate}
        onBack={() => setPage("board")}
      />
    );
  if (page === "settings")
    return (
      <SettingsPage
        board={serverBoard}
        hosts={hostStatuses}
        groupsLockedBy={groupsLockedBy}
        onSetGroupMaster={setGroupMaster}
        t={t}
        theme={props.theme}
        disabled={writesDisabled}
        saving={groupsPending}
        pendingMutationIds={pendingMutationIds}
        mutate={mutate}
        onBack={
          props.initialPage === "settings" ? undefined : () => setPage("board")
        }
      />
    );
  const setStage = async (card: Card, stage: Stage) => {
    if (mutationPending.current.has(`stage:${card.id}`)) {
      toast.error(t.mutationPending);
      return false;
    }
    if (
      card.workspaceId === null &&
      !isDraftGroup(stage, board.settings.groups)
    ) {
      setStatusCard(null);
      setStarting({ card, stage });
      return false;
    }
    setMoveUndos((current) => {
      const next = new Map(current);
      next.delete(card.id);
      liveUndos.current = next;
      return next;
    });
    setOptimisticStages((current) => new Map(current).set(card.id, stage));
    const next = await mutate({
      action: "stage",
      taskId: card.id,
      stage,
      expectedLabels: card.managedLabels,
    });
    setOptimisticStages((current) => {
      const updated = new Map(current);
      updated.delete(card.id);
      return updated;
    });
    if (next) {
      setStatusCard(null);
      const moved = next.cards.find((item) => item.id === card.id);
      const originalGroup = board.settings.groups.find(
        (group) => group.id === card.stage,
      );
      if (
        moved &&
        moved.stage === stage &&
        stage !== card.stage &&
        originalGroup
      ) {
        const undo = {
          group: {
            id: originalGroup.id,
            kind: originalGroup.kind,
            label: originalGroup.label,
          },
          card: moved,
          expiresAt: Date.now() + 8000,
        };
        setLatestMoveUndoId(card.id);
        setMoveUndos((current) => {
          const entries = new Map(current).set(card.id, undo);
          liveUndos.current = entries;
          return entries;
        });
      }
    }
    return !!next;
  };
  const undoMove = async (id: string) => {
    const undo = liveUndos.current.get(id);
    const card = liveBoard.current?.cards.find((item) => item.id === id);
    if (
      !undo ||
      undo.expiresAt <= Date.now() ||
      !sameCard(card, undo.card) ||
      !sameUndoGroup(liveBoard.current, undo)
    ) {
      toast.error(t.undoMoveExpired);
      return;
    }
    if (mutationPending.current.has(`stage:${id}`)) {
      toast.error(t.mutationPending);
      return;
    }
    const next = await mutate({
      action: "stage",
      taskId: id,
      stage: undo.group.id,
      expectedLabels: undo.card.managedLabels,
      expectedUpdatedAt: undo.card.updatedAt,
      expectedGroup: undo.group,
    });
    setMoveUndos((current) => {
      const entries = new Map(current);
      entries.delete(id);
      liveUndos.current = entries;
      return entries;
    });
    if (next) toast.show(t.moveUndone, { variant: "success" });
  };
  const saveCardOrder = async (
    input: Extract<Mutation, { action: "reorder-cards" | "reset-card-order" }>,
  ) => {
    const pendingId = `card-order:${input.stage}`;
    if (mutationPending.current.has(pendingId)) {
      toast.error(t.mutationPending);
      return false;
    }
    setOptimisticCardOrders((current) => ({
      ...current,
      [input.stage]: input.action === "reorder-cards" ? input.cardOrder : [],
    }));
    const next = await mutate(input, pendingId);
    setOptimisticCardOrders((current) => {
      const copy = { ...current };
      delete copy[input.stage];
      return copy;
    });
    if (next && multiHost) {
      const crossHostOrder = { ...hostPreferencesRef.current.crossHostOrder };
      if (input.action === "reorder-cards")
        crossHostOrder[input.stage] = input.cardOrder;
      else delete crossHostOrder[input.stage];
      updateHostPreferences({ crossHostOrder });
    }
    if (!next) {
      void boardQuery.refetch();
      for (const remote of remoteBoards) remote.refetch();
    }
    return !!next;
  };
  const editGroup = (group: Group) =>
    !groupsLocked() &&
    setEditingGroup({
      group,
      settings: board.settings,
      revision: board.revision,
    });
  const deleteReason = (group: Group) => {
    const reason = groupDeleteReason(
      board.cards.filter((card) => groupScope.has(ownerOf(card))),
      board.settings.groups,
      group,
      board.settings,
    );
    return reason ? t[reason] : null;
  };
  const createTask = () =>
    setDraft({
      title: "",
      description: "",
      projectId: projectId === "all" || projectId === "none" ? null : projectId,
      serverId: projectHost,
    });
  const clearFilters = () => updateFilters(DEFAULT_FILTERS);
  const notifyTaskSaved = (next: Board, editedId?: string, quick = false) => {
    const saved = editedId
      ? next.cards.find((card) => card.id === editedId)
      : next.cards.find(
          (card) =>
            card.workspaceId === null &&
            !board.cards.some((existing) => existing.id === card.id),
        );
    const hidden =
      saved &&
      !visibleCards(next, projectId, search, attentionOnly, filters).some(
        (card) => card.id === saved.id,
      );
    const message = editedId
      ? hidden
        ? t.taskUpdatedHidden
        : t.taskUpdated
      : hidden
        ? t.quickCreatedHidden
        : quick
          ? t.quickCreated
          : t.taskCreated;
    toast.show(message, {
      variant: hidden ? "info" : "success",
      durationMs: hidden ? 6000 : 2500,
    });
  };
  const TaskView = viewPreferences.mode === "list" ? ListView : BoardView;
  const latestMove = latestMoveUndoId
    ? moveUndos.get(latestMoveUndoId)
    : undefined;
  return (
    <View
      style={[styles.screen, { backgroundColor: props.theme.colors.surface0 }]}
    >
      <View
        style={[styles.toolbar, { borderColor: props.theme.colors.border }]}
      >
        <View
          style={[
            styles.toolbarLeading,
            props.layout.compact && styles.toolbarLeadingCompact,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            disabled={writesDisabled}
            onPress={createTask}
            style={({ pressed }) => [
              styles.toolbarButton,
              {
                backgroundColor: props.theme.colors.accent,
                opacity: writesDisabled ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Icon
              name="Plus"
              size={16}
              color={props.theme.colors.accentForeground}
            />
            <Text
              style={[
                styles.controlText,
                { color: props.theme.colors.accentForeground },
              ]}
            >
              {t.addTask}
            </Text>
          </Pressable>
          <ProjectPicker
            board={board}
            value={projectId}
            setValue={(projectId) => updateFilters({ projectId })}
            t={t}
            theme={props.theme}
            compact={props.layout.compact}
          />
        </View>
        <View
          style={[
            styles.search,
            {
              borderColor: props.theme.colors.border,
              backgroundColor: props.theme.colors.surface1,
            },
          ]}
        >
          <Icon
            name="Search"
            size={16}
            color={props.theme.colors.foregroundMuted}
          />
          <TextInput
            accessibilityLabel={t.search}
            value={search}
            onChangeText={(search) => updateFilters({ search })}
            placeholder={t.search}
            placeholderTextColor={props.theme.colors.foregroundMuted}
            style={[
              styles.searchInput,
              { color: props.theme.colors.foreground },
            ]}
          />
          {search.length > 0 && (
            <HintButton
              hint={t.clearSearch}
              accessibilityRole="button"
              accessibilityLabel={t.clearSearch}
              onPress={() => updateFilters({ search: "" })}
              style={styles.iconAction}
            >
              <Icon
                name="X"
                size={16}
                color={props.theme.colors.foregroundMuted}
              />
            </HintButton>
          )}
        </View>
        <View style={styles.toolbarActions}>
          <View style={styles.viewSwitch}>
            {(["board", "list"] as const).map((mode) => (
              <Pressable
                key={mode}
                testID={`workboard-view-${mode}`}
                accessibilityRole="button"
                accessibilityLabel={mode === "board" ? t.boardView : t.listView}
                {...toggleButtonState(viewPreferences.mode === mode)}
                onPress={() => updateViewPreferences({ mode })}
                style={[
                  styles.toolbarButton,
                  viewPreferences.mode === mode && {
                    backgroundColor: props.theme.colors.surface2,
                  },
                ]}
              >
                <Icon
                  name={mode === "board" ? "Columns3" : "List"}
                  size={16}
                  color={props.theme.colors.foreground}
                />
                <Text
                  style={[
                    styles.controlText,
                    { color: props.theme.colors.foreground },
                  ]}
                >
                  {mode === "board" ? t.boardView : t.listView}
                </Text>
              </Pressable>
            ))}
          </View>
          {remoteBoards.length > 0 && (
            <HintButton
              hint={t.allHostsHint}
              testID="workboard-all-hosts"
              accessibilityRole="button"
              accessibilityLabel={t.allHosts}
              {...toggleButtonState(hostPreferences.allHosts)}
              onPress={() =>
                updateHostPreferences({ allHosts: !hostPreferences.allHosts })
              }
              style={({ pressed }) => [
                styles.toolbarButton,
                {
                  backgroundColor: hostPreferences.allHosts
                    ? props.theme.colors.accent
                    : pressed
                      ? props.theme.colors.surface2
                      : "transparent",
                },
              ]}
            >
              <Icon
                name="Server"
                size={16}
                color={
                  hostPreferences.allHosts
                    ? props.theme.colors.accentForeground
                    : props.theme.colors.foreground
                }
              />
              {!props.layout.compact && (
                <Text
                  style={[
                    styles.controlText,
                    {
                      color: hostPreferences.allHosts
                        ? props.theme.colors.accentForeground
                        : props.theme.colors.foreground,
                    },
                  ]}
                >
                  {t.allHosts}
                </Text>
              )}
            </HintButton>
          )}
          <HintButton
            hint={t.attention}
            accessibilityRole="button"
            accessibilityLabel={t.attention}
            {...toggleButtonState(attentionOnly)}
            onPress={() => updateFilters({ attentionOnly: !attentionOnly })}
            style={({ pressed }) => [
              styles.toolbarButton,
              {
                backgroundColor: attentionOnly
                  ? props.theme.colors.accent
                  : pressed
                    ? props.theme.colors.surface2
                    : "transparent",
              },
            ]}
          >
            <Icon
              name="CircleAlert"
              size={16}
              color={
                attentionOnly
                  ? props.theme.colors.accentForeground
                  : props.theme.colors.foreground
              }
            />
            {!props.layout.compact && (
              <Text
                style={[
                  styles.controlText,
                  {
                    color: attentionOnly
                      ? props.theme.colors.accentForeground
                      : props.theme.colors.foreground,
                  },
                ]}
              >
                {t.attention}
              </Text>
            )}
          </HintButton>
          <HintButton
            hint={t.filters}
            accessibilityRole="button"
            accessibilityLabel={t.filters}
            accessibilityState={{ expanded: filtersOpen }}
            aria-expanded={filtersOpen}
            onPress={() => setFiltersOpen((value) => !value)}
            style={({ pressed }) => [
              styles.toolbarButton,
              {
                backgroundColor: filtersOpen
                  ? props.theme.colors.accent
                  : pressed
                    ? props.theme.colors.surface2
                    : "transparent",
              },
            ]}
          >
            <Icon
              name="SlidersHorizontal"
              size={16}
              color={
                filtersOpen
                  ? props.theme.colors.accentForeground
                  : props.theme.colors.foreground
              }
            />
            {props.layout.compact ? (
              filterCount > 0 && (
                <View
                  testID="workboard-filter-count"
                  style={[
                    styles.filterBadge,
                    { backgroundColor: props.theme.colors.accent },
                  ]}
                >
                  <Text
                    style={[
                      styles.cardMeta,
                      { color: props.theme.colors.accentForeground },
                    ]}
                  >
                    {filterCount}
                  </Text>
                </View>
              )
            ) : (
              <Text
                style={[
                  styles.controlText,
                  {
                    color: filtersOpen
                      ? props.theme.colors.accentForeground
                      : props.theme.colors.foreground,
                  },
                ]}
              >
                {`${t.filters}${filterCount ? ` (${filterCount})` : ""}`}
              </Text>
            )}
          </HintButton>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.archive} (${archived.length})`}
            onPress={() => setPage("archive")}
            style={({ pressed }) => [
              styles.toolbarButton,
              pressed && { backgroundColor: props.theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Archive"
              size={16}
              color={props.theme.colors.foregroundMuted}
            />
            <Text
              style={[
                styles.controlText,
                { color: props.theme.colors.foregroundMuted },
              ]}
            >
              {props.layout.compact
                ? archived.length
                : `${t.archive} (${archived.length})`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.settings}
            onPress={() => setPage("settings")}
            style={({ pressed }) => [
              styles.toolbarButton,
              pressed && { backgroundColor: props.theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Settings"
              size={16}
              color={props.theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
      </View>
      {latestMove && (
        <View testID="workboard-move-feedback" style={styles.filterSummary}>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.cardMeta,
              { color: props.theme.colors.foreground, flex: 1 },
            ]}
          >
            {t.movedToGroup
              .replace("{task}", latestMove.card.title)
              .replace(
                "{group}",
                stageTitle(latestMove.card.stage, board.settings.groups, t),
              )}
          </Text>
          <Pressable
            testID="workboard-move-feedback-undo"
            accessibilityRole="button"
            accessibilityLabel={t.undoMove}
            disabled={
              writesDisabled ||
              pendingMutationIds.has(`stage:${latestMove.card.id}`)
            }
            onPress={() => void undoMove(latestMove.card.id)}
            style={[
              styles.toolbarButton,
              {
                opacity:
                  writesDisabled ||
                  pendingMutationIds.has(`stage:${latestMove.card.id}`)
                    ? 0.5
                    : 1,
              },
            ]}
          >
            <Text style={{ color: props.theme.colors.accent }}>
              {t.undoMove}
            </Text>
          </Pressable>
        </View>
      )}
      {filtersOpen && (
        <FilterPanel filters={filters} onChange={updateFilters} t={t} />
      )}
      {(hasActiveFilter || filtersOpen) && (
        <View style={styles.filterSummary}>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.cardMeta,
              { color: props.theme.colors.foregroundMuted, flex: 1 },
            ]}
          >
            {t.filterSummary
              .replace("{count}", String(cards.length - conflicts.length))
              .replace(
                "{total}",
                String(
                  allCards.filter((card) => card.stage !== "conflict").length,
                ),
              )
              .replace("{filters}", String(filterCount))}
            {` · ${t.conflictCount.replace("{count}", String(conflicts.length))}`}
          </Text>
          {hasActiveFilter && (
            <Pressable
              accessibilityRole="button"
              onPress={clearFilters}
              style={styles.toolbarButton}
            >
              <Icon
                name="X"
                size={14}
                color={props.theme.colors.foregroundMuted}
              />
              <Text
                style={[
                  styles.cardMeta,
                  { color: props.theme.colors.foreground },
                ]}
              >
                {t.clearFilters}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {(!board.connected || boardQuery.isError) && (
        <View style={styles.filterSummary}>
          <Text
            style={[styles.notice, { color: props.theme.colors.statusWarning }]}
          >
            {t.disconnected}
          </Text>
          <Pressable
            testID="workboard-reconnect"
            accessibilityRole="button"
            accessibilityLabel={t.refresh}
            onPress={() => void boardQuery.refetch()}
            style={styles.toolbarButton}
          >
            <Text style={{ color: props.theme.colors.foreground }}>
              {t.refresh}
            </Text>
          </Pressable>
        </View>
      )}
      {board.error && (
        <Text
          style={[styles.notice, { color: props.theme.colors.statusDanger }]}
        >
          {bootErrorText(board.error, t)}
        </Text>
      )}
      {hostPreferences.allHosts &&
        remoteBoards
          .filter(
            (remote) => remote.failed || remote.board?.connected === false,
          )
          .map((remote) => (
            <Text
              key={`unavailable:${remote.runtime.serverId}`}
              style={[
                styles.notice,
                { color: props.theme.colors.statusWarning },
              ]}
            >
              {t.hostUnavailable.replace("{host}", remote.label)}
            </Text>
          ))}
      {federation.hidden.map((host) => (
        <Text
          key={`hidden:${host.serverId}`}
          testID="workboard-hidden-remote"
          style={[styles.notice, { color: props.theme.colors.foregroundMuted }]}
        >
          {t.hiddenRemoteTasks
            .replace("{count}", String(host.count))
            .replace("{host}", host.label)}
        </Text>
      ))}
      {conflicts.length > 0 && (
        <ConflictNotice
          cards={conflicts}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onSelect={setStatusCard}
        />
      )}
      <TaskView
        collapsed={new Set(viewPreferences.collapsedListGroups)}
        onCollapsedChange={(collapsedListGroups) =>
          updateViewPreferences({ collapsedListGroups })
        }
        quickCreateErrors={
          new Set(
            Object.entries(quickDrafts)
              .filter(([, draft]) => draft.error)
              .map(([id]) => id),
          )
        }
        key={props.host.id}
        hostId={props.host.id}
        groupColor={(group) => groupColor(group, props.theme)}
        disabled={writesDisabled}
        pendingStages={new Set(optimisticStages.keys())}
        reordering={pendingMutationIds.has("reorder-groups")}
        highlightedCards={new Set(moveUndos.keys())}
        cards={cards}
        fullCards={board.cards}
        cardOrderByStage={board.cardOrderByStage}
        filterKey={JSON.stringify(filters)}
        orderPending={
          new Set(
            [...pendingMutationIds]
              .filter((id) => id.startsWith("card-order:"))
              .map((id) => id.slice("card-order:".length)),
          )
        }
        onReorderCards={(card, expectedOrder, cardOrder) =>
          saveCardOrder({
            action: "reorder-cards",
            taskId: card.id,
            stage: card.stage as Stage,
            expectedOrder,
            cardOrder,
          })
        }
        onResetCardOrder={(stage, expectedOrder) =>
          saveCardOrder({ action: "reset-card-order", stage, expectedOrder })
        }
        hasActiveFilter={hasActiveFilter}
        onClearFilters={clearFilters}
        onCreateTask={writesDisabled ? undefined : createTask}
        renderQuickCreate={(group) =>
          group.kind === "todo" ? (
            <QuickCreate
              key={group.id}
              disabled={writesDisabled}
              t={t}
              theme={props.theme}
              groupName={groupTitle(group, t)}
              title={quickDrafts[group.id]?.title ?? ""}
              error={quickDrafts[group.id]?.error ?? false}
              saving={pendingMutationIds.has(`create:${group.id}`)}
              onChangeTitle={(title) =>
                setQuickDrafts((current) => ({
                  ...current,
                  [group.id]: { title, error: false },
                }))
              }
              onCreate={async (title) => {
                if (mutationPending.current.has(`create:${group.id}`))
                  return false;
                setQuickDrafts((current) => ({
                  ...current,
                  [group.id]: { title, error: false },
                }));
                const next = await mutate(
                  {
                    action: "create",
                    stage: group.id,
                    title,
                    description: "",
                    projectId:
                      projectId === "all" || projectId === "none"
                        ? null
                        : projectId,
                  },
                  `create:${group.id}`,
                  projectHost,
                );
                setQuickDrafts((current) => ({
                  ...current,
                  [group.id]: { title: next ? "" : title, error: !next },
                }));
                if (!next) return false;
                notifyTaskSaved(next, undefined, true);
                return true;
              }}
            />
          ) : null
        }
        groups={orderedGroups({
          ...board.settings,
          groupOrder: optimisticOrder ?? board.settings.groupOrder,
        })}
        compact={props.layout.compact}
        stage={
          board.settings.groups.find((group) => group.id === selectedStage)
            ?.id ??
          defaultWorkspaceGroup(
            board.settings.groups,
            board.settings.defaultStartGroup,
          )
        }
        setStage={setSelectedStage}
        t={t}
        theme={props.theme}
        onStage={setStage}
        onReorder={async (groupOrder, expectedGroupOrder) => {
          if (groupsLocked()) return false;
          if (mutationPending.current.has("reorder-groups")) {
            toast.error(t.mutationPending);
            return false;
          }
          setOptimisticOrder(groupOrder);
          const next = await mutate({
            action: "reorder-groups",
            groupOrder,
            expectedGroupOrder,
          });
          setOptimisticOrder(null);
          if (next)
            toast.show(t.layoutSaved, { variant: "success", durationMs: 1600 });
          return !!next;
        }}
        onEdit={editGroup}
        onAdd={() => editGroup(newGroup(board.settings.groups))}
        deleteReason={deleteReason}
        onDelete={async (group) => {
          if (groupsLocked()) return false;
          const reason = deleteReason(group);
          if (reason) {
            toast.show(reason, { variant: "warning" });
            return false;
          }
          return !!(await mutate({
            action: "settings",
            revision: board.revision,
            expectedSettings: board.settings,
            settings: {
              ...board.settings,
              groups: board.settings.groups.filter(
                (item) => item.id !== group.id,
              ),
            },
          }));
        }}
        renderCard={(card, showDragHandle) => (
          <TaskItem
            presentation={viewPreferences.mode === "list" ? "row" : "card"}
            card={card}
            board={board}
            host={multiHost ? labelOf(ownerOf(card)) : undefined}
            t={t}
            theme={props.theme}
            disabled={writesDisabled}
            pending={
              pendingMutationIds.has(`stage:${card.id}`) ||
              pendingMutationIds.has(`card-order:${card.stage}`)
            }
            compact={props.layout.compact}
            showDragHandle={showDragHandle}
            onUndo={
              moveUndos.has(card.id) ? () => undoMove(card.id) : undefined
            }
            onOpen={() => {
              if (!props.navigation) {
                toast.error(t.navigationUnavailable);
                return;
              }
              if (card.workspaceId)
                props.navigation.openWorkspace({
                  workspaceId: card.workspaceId,
                  serverId: ownerOf(card),
                });
            }}
            onEdit={() =>
              setDraft({
                task: card,
                title: card.title,
                description: card.description,
                projectId: card.projectId,
              })
            }
            onStart={() => setStarting({ card })}
            onStatus={() => setStatusCard(card)}
            onArchive={() => setArchivingDraft(card)}
            onCancelBinding={() => setCancelingBinding(card)}
            onDetachDraft={(draftId) => setDetachingDraft({ card, draftId })}
          />
        )}
      />
      {editingGroup && (
        <GroupEditor
          key={editingGroup.group.id}
          board={{
            ...board,
            cards: board.cards.filter((card) => groupScope.has(ownerOf(card))),
          }}
          group={editingGroup.group}
          groups={editingGroup.settings.groups}
          disabled={writesDisabled || groupsPending}
          saving={groupsPending}
          t={t}
          theme={props.theme}
          onClose={() => setEditingGroup(null)}
          onChange={async (groups) =>
            !!(await mutate(
              {
                action: "settings",
                revision: editingGroup.revision,
                expectedSettings: editingGroup.settings,
                settings: { ...editingGroup.settings, groups },
              },
              "settings:groups",
            ))
          }
        />
      )}
      <TaskModal
        disabled={writesDisabled || draftPending}
        pending={draftPending}
        form={draft}
        hosts={
          draft?.task
            ? [
                {
                  serverId: ownerOf(draft.task),
                  label: labelOf(ownerOf(draft.task)),
                  board: boardOf(ownerOf(draft.task)),
                },
              ]
            : hostOptions
        }
        t={t}
        theme={props.theme}
        onClose={() => setDraft(null)}
        onSave={(form) =>
          void (
            form.task
              ? mutate({
                  action: "edit",
                  taskId: form.task.id,
                  updatedAt: form.task.updatedAt,
                  title: form.title,
                  description: form.description,
                  projectId: form.projectId,
                })
              : mutate(
                  {
                    action: "create",
                    title: form.title,
                    description: form.description,
                    projectId: form.projectId,
                  },
                  undefined,
                  form.serverId,
                )
          ).then((next) => {
            if (!next) return;
            notifyTaskSaved(next, form.task?.id);
            setDraft(null);
          })
        }
      />
      <StartModal
        disabled={writesDisabled || startPending}
        pending={startPending}
        stage={starting?.stage}
        card={starting?.card ?? null}
        board={starting ? boardOf(ownerOf(starting.card)) : serverBoard}
        t={t}
        theme={props.theme}
        onClose={() => setStarting(null)}
        onStart={(target, stage) =>
          void mutate({
            action: "start",
            taskId: starting!.card.id,
            target,
            stage,
          }).then((next) => {
            if (!next) return;
            const workspaceId =
              target.kind === "existing"
                ? target.workspaceId
                : next.cards.find((card) => card.id === starting!.card.id)
                    ?.workspaceId;
            if (workspaceId)
              props.navigation?.openWorkspace({
                workspaceId,
                serverId: ownerOf(starting!.card),
              });
            setStarting(null);
          })
        }
      />
      {archivingDraft && (
        <ConfirmationModal
          title={t.archiveDraft}
          description={t.archiveDraftConfirm.replace(
            "{name}",
            archivingDraft.title,
          )}
          confirmLabel={t.archiveDraft}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setArchivingDraft(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "archive-draft",
              taskId: archivingDraft.id,
            }))
          }
        />
      )}
      {detachingDraft && (
        <ConfirmationModal
          title={t.detachDraft}
          description={t.detachDraftConfirm.replace(
            "{name}",
            detachingDraft.card.mergedDrafts.find(
              (source) => source.draftId === detachingDraft.draftId,
            )!.title,
          )}
          confirmLabel={t.detachDraft}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setDetachingDraft(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "detach-draft",
              taskId: detachingDraft.card.id,
              draftId: detachingDraft.draftId,
              updatedAt: detachingDraft.card.updatedAt,
            }))
          }
        />
      )}
      {cancelingBinding?.binding && (
        <ConfirmationModal
          title={t.cancelBinding}
          description={t.cancelBindingConfirm.replace(
            "{name}",
            cancelingBinding.title,
          )}
          confirmLabel={t.cancelBinding}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setCancelingBinding(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "cancel-binding",
              taskId: cancelingBinding.id,
              operationId: cancelingBinding.binding!.operationId,
            }))
          }
        />
      )}
      <StageModal
        disabled={
          writesDisabled ||
          (!!statusCard && pendingMutationIds.has(`stage:${statusCard.id}`))
        }
        groups={orderedGroups(board.settings)}
        card={statusCard}
        t={t}
        theme={props.theme}
        onClose={() => setStatusCard(null)}
        onStage={setStage}
      />
    </View>
  );
}

function ConflictNotice({
  cards,
  disabled,
  t,
  theme,
  onSelect,
}: {
  cards: Card[];
  disabled: boolean;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onSelect(card: Card): void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={[
        styles.conflict,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.conflictRow,
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
      >
        <Icon
          name="TriangleAlert"
          size={16}
          color={theme.colors.statusWarning}
        />
        <Text
          style={[styles.conflictTitle, { color: theme.colors.foreground }]}
        >
          {t.conflictSummary.replace("{count}", String(cards.length))}
        </Text>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          size={16}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded && (
        <>
          <Text
            style={[
              styles.conflictHint,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {t.conflictHint}
          </Text>
          <ScrollView style={styles.conflictList}>
            {cards.map((card) => (
              <Pressable
                key={card.id}
                accessibilityRole="button"
                accessibilityLabel={`${card.title} · ${t.resolveConflict}`}
                disabled={disabled}
                onPress={() => onSelect(card)}
                style={({ pressed }) => [
                  styles.conflictRow,
                  { opacity: disabled ? 0.5 : 1 },
                  pressed && { backgroundColor: theme.colors.surface2 },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.conflictTitle,
                    { color: theme.colors.foreground },
                  ]}
                >
                  {card.title}
                </Text>
                <Text
                  style={[
                    styles.cardMeta,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  {t.resolveConflict}
                </Text>
                <Icon
                  name="ArrowRightLeft"
                  size={15}
                  color={theme.colors.foregroundMuted}
                />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}
function Centered({
  theme,
  text,
  action,
  onPress,
}: {
  theme: PluginSurfaceProps["theme"];
  text: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[styles.centered, { backgroundColor: theme.colors.surface0 }]}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{text}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onPress}>
          <Text style={[styles.primary, { color: theme.colors.foreground }]}>
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
function ProjectPicker({
  board,
  value,
  setValue,
  t,
  theme,
  compact,
}: {
  board: Board;
  value: string;
  setValue(value: string): void;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: "all", name: t.allProjects },
    { id: "none", name: t.unassigned },
    ...board.projects,
  ];
  return (
    <View
      style={[styles.projectPicker, compact && styles.projectPickerCompact]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.selectProject}: ${options.find((item) => item.id === value)?.name}`}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.toolbarButton,
          styles.projectTrigger,
          {
            borderColor: theme.colors.border,
            backgroundColor: pressed
              ? theme.colors.surface2
              : theme.colors.surface1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.controlText,
            styles.projectName,
            { color: theme.colors.foreground },
          ]}
        >
          {options.find((item) => item.id === value)?.name}
        </Text>
        <View style={styles.fixedIcon}>
          <Icon
            name="ChevronDown"
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </View>
      </Pressable>
      {open && (
        <Modal open title={t.selectProject} onOpenChange={setOpen}>
          <Modal.Content>
            <ScrollView style={styles.choiceList}>
              {options.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  key={option.id}
                  {...toggleButtonState(option.id === value)}
                  style={({ pressed }) => [
                    styles.menuItem,
                    {
                      backgroundColor:
                        option.id === value
                          ? theme.colors.accent
                          : pressed
                            ? theme.colors.surface2
                            : "transparent",
                    },
                  ]}
                  onPress={() => {
                    setValue(option.id);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={{
                      color:
                        option.id === value
                          ? theme.colors.accentForeground
                          : theme.colors.foreground,
                    }}
                  >
                    {option.name}
                  </Text>
                  {option.id === value && (
                    <Icon
                      name="Check"
                      size={16}
                      color={theme.colors.accentForeground}
                    />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </Modal.Content>
        </Modal>
      )}
    </View>
  );
}
function TaskModal({
  disabled,
  pending,
  form,
  hosts,
  t,
  theme,
  onClose,
  onSave,
}: {
  disabled: boolean;
  pending: boolean;
  form: DraftForm;
  /** The first host is the default; a new draft may choose another. */
  hosts: HostOption[];
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onSave(form: NonNullable<DraftForm>): void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [serverId, setServerId] = useState<string | undefined>();
  useEffect(() => {
    if (form) {
      setTitle(form.title);
      setDescription(form.description);
      setProjectId(form.projectId);
      setServerId(form.serverId);
    }
  }, [form]);
  if (!form) return null;
  const host = hosts.find((option) => option.serverId === serverId) ?? hosts[0];
  const board = host.board;
  const linked = form.task?.workspaceId !== null && form.task !== undefined;
  const saveDisabled = disabled || pending || (!linked && !title.trim());
  return (
    <Modal
      open
      title={form.task ? t.edit : t.addTask}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <Modal.Content>
        <TextInput
          accessibilityLabel={t.titleField}
          autoFocus={!linked}
          editable={!linked && !disabled}
          value={linked ? form.task!.title : title}
          onChangeText={setTitle}
          placeholder={t.titleField}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
            },
          ]}
        />
        <TextInput
          editable={!disabled}
          accessibilityLabel={t.description}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder={t.description}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            styles.textarea,
            {
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
            },
          ]}
        />
        {!form.task && hosts.length > 1 && (
          <ScrollView
            horizontal
            accessibilityLabel={t.hostField}
            style={styles.tabScroll}
            contentContainerStyle={styles.projectChoices}
          >
            {hosts.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.hostField}: ${option.label}`}
                {...toggleButtonState(option === host)}
                key={option.serverId}
                disabled={disabled}
                onPress={() => {
                  if (option === host) return;
                  setServerId(option.serverId);
                  setProjectId(null);
                }}
                style={[
                  styles.chip,
                  disabled && styles.disabledControl,
                  option === host && {
                    backgroundColor: theme.colors.surface2,
                  },
                ]}
              >
                <Text style={{ color: theme.colors.foreground }}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        <ScrollView
          horizontal
          style={styles.tabScroll}
          contentContainerStyle={styles.projectChoices}
        >
          <Pressable
            accessibilityRole="button"
            {...toggleButtonState(projectId === null)}
            disabled={disabled || linked}
            onPress={() => setProjectId(null)}
            style={[
              styles.chip,
              (disabled || linked) && styles.disabledControl,
              projectId === null && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Text style={{ color: theme.colors.foreground }}>
              {t.unassigned}
            </Text>
          </Pressable>
          {board.projects.map((project) => (
            <Pressable
              accessibilityRole="button"
              {...toggleButtonState(projectId === project.id)}
              key={project.id}
              disabled={disabled || linked}
              onPress={() => setProjectId(project.id)}
              style={[
                styles.chip,
                (disabled || linked) && styles.disabledControl,
                projectId === project.id && {
                  backgroundColor: theme.colors.surface2,
                },
              ]}
            >
              <Text style={{ color: theme.colors.foreground }}>
                {project.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.modalActions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onClose}
            style={[styles.toolbarButton, pending && styles.disabledControl]}
          >
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {t.cancel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: pending }}
            disabled={saveDisabled}
            style={[
              styles.toolbarButton,
              saveDisabled && styles.disabledControl,
            ]}
            onPress={() =>
              onSave({
                ...form,
                title: linked ? form.task!.title : title.trim(),
                description,
                projectId,
                serverId: host.serverId,
              })
            }
          >
            <Text
              style={[
                styles.primary,
                {
                  color: saveDisabled
                    ? theme.colors.foregroundMuted
                    : theme.colors.foreground,
                },
              ]}
            >
              {pending ? t.working : form.task ? t.update : t.create}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
function StartModal({
  disabled,
  pending,
  stage,
  card,
  board,
  t,
  theme,
  onClose,
  onStart,
}: {
  disabled: boolean;
  pending: boolean;
  card: Card | null;
  stage?: Stage;
  board: Board;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onStart(
    target: Extract<Mutation, { action: "start" }>["target"],
    stage: Stage,
  ): void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState("");
  const [sourceKind, setSourceKind] = useState<"directory" | "worktree">(
    "directory",
  );
  const [existing, setExisting] = useState("");
  const [directory, setDirectory] = useState("");
  const [worktreeSlug, setWorktreeSlug] = useState("");
  useEffect(() => {
    if (!card) return;
    setMode("new");
    setProjectId(card.projectId ?? "");
    setSourceKind("directory");
    setExisting("");
    setDirectory(
      board.projects.find((project) => project.id === card.projectId)
        ?.directory ?? "",
    );
    setWorktreeSlug("");
  }, [card]);
  if (!card) return null;
  const existingCards = board.cards.filter(
    (item) => item.workspaceId && !item.archived && !item.binding,
  );
  const project = board.projects.find((item) => item.id === projectId);
  const targetStage =
    card.binding?.stage ??
    stage ??
    defaultStartWorkGroup(
      board.settings.groups,
      board.settings.defaultStartWorkGroup,
    );
  const hasTarget =
    !!targetStage &&
    board.settings.groups.some((group) => group.id === targetStage);
  const valid =
    card.binding ||
    (mode === "existing"
      ? existing
      : sourceKind === "directory"
        ? directory.trim()
        : project?.isGit);
  const missing = [
    !hasTarget ? t.noStartGroup : null,
    !card.binding && mode === "existing" && !existing
      ? t.startNeedsWorkspace
      : null,
    !card.binding &&
    mode === "new" &&
    sourceKind === "directory" &&
    !directory.trim()
      ? t.startNeedsDirectory
      : null,
    !card.binding &&
    mode === "new" &&
    sourceKind === "worktree" &&
    !project?.isGit
      ? t.startNeedsGitProject
      : null,
  ].filter(Boolean);
  const startDisabled = disabled || pending || !valid || !hasTarget;
  const start = () => {
    if (!targetStage) return;
    if (card.binding) onStart(card.binding.target, targetStage);
    else if (mode === "existing" && existing)
      onStart({ kind: "existing", workspaceId: existing }, targetStage);
    else if (sourceKind === "directory" && directory.trim())
      onStart(
        {
          kind: "new",
          source: {
            kind: "directory",
            path: directory.trim(),
            projectId: projectId || undefined,
          },
        },
        targetStage,
      );
    else if (sourceKind === "worktree" && projectId)
      onStart(
        {
          kind: "new",
          source: {
            kind: "worktree",
            projectId,
            worktreeSlug: worktreeSlug.trim() || undefined,
          },
        },
        targetStage,
      );
  };
  return (
    <Modal
      open
      title={t.start}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <Modal.Content>
        {card.binding ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {t.resumeBinding}
          </Text>
        ) : (
          <>
            <View style={styles.modeRow}>
              <Pressable
                accessibilityRole="button"
                {...toggleButtonState(mode === "new")}
                disabled={disabled}
                onPress={() => setMode("new")}
                style={[
                  styles.toolbarButton,
                  disabled && styles.disabledControl,
                ]}
              >
                <Text
                  style={{
                    color:
                      mode === "new"
                        ? theme.colors.foreground
                        : theme.colors.foregroundMuted,
                  }}
                >
                  {t.newWorkspace}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                {...toggleButtonState(mode === "existing")}
                disabled={disabled}
                onPress={() => setMode("existing")}
                style={[
                  styles.toolbarButton,
                  disabled && styles.disabledControl,
                ]}
              >
                <Text
                  style={{
                    color:
                      mode === "existing"
                        ? theme.colors.foreground
                        : theme.colors.foregroundMuted,
                  }}
                >
                  {t.existingWorkspace}
                </Text>
              </Pressable>
            </View>
            {mode === "existing" ? (
              <ScrollView style={styles.choiceList}>
                {existingCards.length ? (
                  existingCards.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      {...toggleButtonState(item.workspaceId === existing)}
                      key={item.id}
                      disabled={disabled}
                      onPress={() => setExisting(item.workspaceId!)}
                      style={[
                        styles.choice,
                        disabled && styles.disabledControl,
                        item.workspaceId === existing && {
                          backgroundColor: theme.colors.surface2,
                        },
                      ]}
                    >
                      <Text style={{ color: theme.colors.foreground }}>
                        {item.title}
                      </Text>
                      <Text style={{ color: theme.colors.foregroundMuted }}>
                        {item.projectName || t.unassigned} ·{" "}
                        {item.stage === "conflict"
                          ? t.conflict
                          : stageTitle(item.stage, board.settings.groups, t)}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={{ color: theme.colors.foregroundMuted }}>
                    {t.empty}
                  </Text>
                )}
              </ScrollView>
            ) : (
              <>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {t.selectProject}
                </Text>
                <ScrollView style={styles.choiceList}>
                  {board.projects.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      {...toggleButtonState(item.id === projectId)}
                      key={item.id}
                      disabled={disabled}
                      onPress={() => {
                        setProjectId(item.id);
                        setDirectory(item.directory);
                        if (!item.isGit) setSourceKind("directory");
                      }}
                      style={[
                        styles.choice,
                        disabled && styles.disabledControl,
                        item.id === projectId && {
                          backgroundColor: theme.colors.surface2,
                        },
                      ]}
                    >
                      <Text style={{ color: theme.colors.foreground }}>
                        {item.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.modeRow}>
                  <Pressable
                    accessibilityRole="button"
                    {...toggleButtonState(sourceKind === "directory")}
                    disabled={disabled}
                    onPress={() => setSourceKind("directory")}
                    style={[
                      styles.toolbarButton,
                      disabled && styles.disabledControl,
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          sourceKind === "directory"
                            ? theme.colors.foreground
                            : theme.colors.foregroundMuted,
                      }}
                    >
                      {t.directory}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    {...toggleButtonState(sourceKind === "worktree")}
                    disabled={disabled || !project?.isGit}
                    onPress={() => setSourceKind("worktree")}
                    style={[
                      styles.toolbarButton,
                      (disabled || !project?.isGit) && styles.disabledControl,
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          sourceKind === "worktree"
                            ? theme.colors.foreground
                            : theme.colors.foregroundMuted,
                      }}
                    >
                      {t.worktree}
                    </Text>
                  </Pressable>
                </View>
                {sourceKind === "directory" ? (
                  <TextInput
                    accessibilityLabel={t.directory}
                    editable={!disabled}
                    value={directory}
                    onChangeText={setDirectory}
                    placeholder={t.directory}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        color: theme.colors.foreground,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                ) : (
                  <TextInput
                    accessibilityLabel={t.worktreeName}
                    editable={!disabled}
                    value={worktreeSlug}
                    onChangeText={setWorktreeSlug}
                    placeholder={t.worktreeName}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        color: theme.colors.foreground,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                )}
              </>
            )}
          </>
        )}
        {missing.length > 0 && (
          <Text
            testID="workboard-start-missing"
            accessibilityRole="alert"
            style={{ color: theme.colors.statusWarning }}
          >
            {missing.join("\n")}
          </Text>
        )}
        <View style={styles.modalActions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onClose}
            style={[styles.toolbarButton, pending && styles.disabledControl]}
          >
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {t.cancel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: pending }}
            disabled={startDisabled}
            onPress={start}
            style={[
              styles.toolbarButton,
              startDisabled && styles.disabledControl,
            ]}
          >
            <Text
              style={[
                styles.primary,
                {
                  color: startDisabled
                    ? theme.colors.foregroundMuted
                    : theme.colors.foreground,
                },
              ]}
            >
              {pending ? t.working : card.binding ? t.retry : t.start}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
function StageModal({
  groups,
  disabled,
  card,
  t,
  theme,
  onClose,
  onStage,
}: {
  disabled: boolean;
  card: Card | null;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onStage(card: Card, stage: Stage): Promise<boolean>;
  groups: Group[];
}) {
  if (!card) return null;
  return (
    <Modal open title={t.status} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <ScrollView style={styles.choiceList}>
          {groups.map((group) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: card.stage === group.id }}
              disabled={disabled}
              key={group.id}
              onPress={() => void onStage(card, group.id)}
              style={({ pressed }) => [
                styles.stageMenuItem,
                {
                  backgroundColor:
                    card.stage === group.id
                      ? theme.colors.accent
                      : pressed
                        ? theme.colors.surface2
                        : "transparent",
                },
              ]}
            >
              <View
                style={[
                  styles.stageDot,
                  { backgroundColor: groupColor(group, theme) },
                ]}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.menuItemLabel,
                  {
                    color: disabled
                      ? theme.colors.foregroundMuted
                      : card.stage === group.id
                        ? theme.colors.accentForeground
                        : theme.colors.foreground,
                  },
                ]}
              >
                {stageTitle(group.id, groups, t)}
              </Text>
              {card.stage === group.id && (
                <Icon
                  name="Check"
                  size={16}
                  color={
                    disabled
                      ? theme.colors.foregroundMuted
                      : theme.colors.accentForeground
                  }
                />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}
function PageHeader({
  title,
  t,
  theme,
  onBack,
}: {
  title: string;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onBack?(): void;
}) {
  return (
    <View style={[styles.pageHeader, { borderColor: theme.colors.border }]}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.toolbarButton,
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon
            name="ArrowLeft"
            size={16}
            color={theme.colors.foregroundMuted}
          />
          <Text
            style={[
              styles.controlText,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {t.back}
          </Text>
        </Pressable>
      )}
      <Text style={[styles.heading, { color: theme.colors.foreground }]}>
        {title}
      </Text>
    </View>
  );
}
export function ArchivePage({
  board,
  cards,
  t,
  theme,
  onBack,
  disabled,
  mutate,
}: {
  board: Board;
  cards: Card[];
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onBack(): void;
  disabled: boolean;
  mutate(input: Mutation): Promise<Board | undefined>;
}) {
  const [resolving, setResolving] = useState<{
    card: Card;
    outcome: "confirm" | "restore";
  } | null>(null);
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.surface0 }]}>
      <PageHeader title={t.archived} t={t} theme={theme} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.compactList}>
        {cards.length ? (
          cards.map((card) => (
            <View
              key={card.id}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.surface1,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text
                style={[styles.cardTitle, { color: theme.colors.foreground }]}
              >
                {card.title}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {card.archived?.group
                  ? groupTitle(card.archived.group, t)
                  : stageTitle(
                      card.archived?.stage ?? card.stage,
                      board.settings.groups,
                      t,
                    )}{" "}
                ·{" "}
                {card.archived?.detail === "archive-confirmed-by-user"
                  ? t.archiveConfirmedByUser
                  : card.archived?.detail}
              </Text>
              {(card.archived?.status === "uncertain" ||
                card.archived?.status === "external") && (
                <Text
                  selectable
                  style={{ color: theme.colors.foregroundMuted }}
                >
                  ID: {card.archived.operationId}
                </Text>
              )}
              {(card.archived?.status === "uncertain" ||
                card.archived?.status === "external" ||
                card.archived?.kind === "draft") && (
                <View style={styles.cardFooter}>
                  {(card.archived?.kind === "draft"
                    ? ["restore" as const]
                    : (["confirm", "restore"] as const)
                  ).map((outcome) => (
                    <Pressable
                      key={outcome}
                      accessibilityRole="button"
                      disabled={disabled}
                      onPress={() => setResolving({ card, outcome })}
                      style={styles.toolbarButton}
                    >
                      <Text style={{ color: theme.colors.foreground }}>
                        {outcome === "confirm"
                          ? t.confirmArchived
                          : t.restoreTask}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {card.archived?.archivedAt
                  ? shortDate(card.archived.archivedAt, t.locale)
                  : card.archived?.status}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: theme.colors.foregroundMuted }}>{t.empty}</Text>
        )}
      </ScrollView>
      {resolving && (
        <ConfirmationModal
          title={
            resolving.outcome === "confirm" ? t.confirmArchived : t.restoreTask
          }
          description={(resolving.outcome === "confirm"
            ? t.confirmArchivedConfirm
            : t.restoreTaskConfirm
          ).replace("{name}", resolving.card.title)}
          confirmLabel={
            resolving.outcome === "confirm" ? t.confirmArchived : t.restoreTask
          }
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setResolving(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "resolve-archive",
              taskId: resolving.card.id,
              updatedAt: resolving.card.updatedAt,
              operationId: resolving.card.archived!.operationId,
              outcome: resolving.outcome,
            }))
          }
        />
      )}
    </View>
  );
}
export function SettingsPage({
  board,
  hosts = [],
  groupsLockedBy = null,
  onSetGroupMaster,
  t,
  theme,
  disabled,
  saving,
  pendingMutationIds,
  mutate,
  onBack,
}: {
  board: Board;
  hosts?: readonly HostStatus[];
  /** The master's label while this host mirrors its groups. */
  groupsLockedBy?: string | null;
  onSetGroupMaster?(master: string | null): Promise<boolean>;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  saving: boolean;
  pendingMutationIds?: ReadonlySet<string>;
  mutate(
    mutation: Mutation,
    pendingMutationId?: string,
  ): Promise<Board | undefined>;
  onBack?(): void;
}) {
  const [confirmed, setConfirmed] = useState({
    settings: board.settings,
    revision: board.revision,
  });
  const [archiveDaysEdit, setArchiveDaysEdit] = useState<{
    base: number;
    text: string;
  } | null>(null);
  const [confirmAutoArchive, setConfirmAutoArchive] = useState(false);
  const current =
    board.revision > confirmed.revision
      ? { settings: board.settings, revision: board.revision }
      : confirmed;
  const settings = current.settings;
  const groups = settings.groups;
  const daysText =
    archiveDaysEdit?.base === settings.archiveAfterDays
      ? archiveDaysEdit.text
      : String(settings.archiveAfterDays);
  const validDays =
    /^\d+$/.test(daysText) && Number(daysText) >= 1 && Number(daysText) <= 365;
  const preview = mappingPreview(board.cards, settings, Date.now());
  const controlDisabled = (id: string) =>
    disabled || !!pendingMutationIds?.has(`settings:${id}`);
  const persist = async (next: Settings, control = "groups") => {
    const result = await mutate(
      {
        action: "settings",
        revision: current.revision,
        expectedSettings: current.settings,
        settings: next,
      },
      `settings:${control}`,
    );
    if (result)
      setConfirmed({ settings: result.settings, revision: result.revision });
    return result;
  };
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.surface0 }]}>
      <PageHeader title={t.settingsTitle} t={t} theme={theme} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.settings}>
        <View style={styles.settingsContent}>
          <SettingsSection title={t.generalSettings}>
            <SettingsCard>
              <SettingsSwitch
                label={t.pinInProgressWorkspaces}
                hint={t.pinInProgressHint}
                value={settings.pinInProgressWorkspaces}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      pinInProgressWorkspaces: value,
                    },
                    "pin",
                  );
                }}
                disabled={controlDisabled("pin")}
                testID="workboard-pin-in-progress"
              />
              <SettingsSwitch
                label={t.exclusiveStatusLabels}
                hint={t.exclusiveStatusHint}
                value={settings.exclusiveStatusLabels}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      exclusiveStatusLabels: value,
                    },
                    "exclusive",
                  );
                }}
                disabled={controlDisabled("exclusive")}
                testID="workboard-exclusive-status-labels"
              />
              <SettingsSwitch
                label={t.autoArchive}
                hint={[
                  t.autoArchiveHint.replace(
                    "{days}",
                    String(settings.archiveAfterDays),
                  ),
                  settings.archiveMappingNeedsReview
                    ? t.autoArchiveMigrationPaused
                    : "",
                  settings.archivePausedByGroupSync
                    ? t.autoArchiveGroupSyncPaused
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
                value={settings.autoArchive}
                onValueChange={async (value) => {
                  if (value && preview.due > 0) {
                    setConfirmAutoArchive(true);
                    return;
                  }
                  await persist({ ...settings, autoArchive: value }, "archive");
                }}
                disabled={controlDisabled("archive")}
                testID="workboard-auto-archive"
              />
              <SettingsInput
                key={settings.archiveAfterDays}
                label={t.archiveAfterDays}
                hint={t.archiveAfterDaysHint}
                initialValue={String(settings.archiveAfterDays)}
                onChangeText={(text) =>
                  setArchiveDaysEdit({ base: settings.archiveAfterDays, text })
                }
                error={validDays ? null : t.archiveAfterDaysInvalid}
                disabled={controlDisabled("days")}
                testID="workboard-archive-days"
              />
              <SettingsAction
                label={t.archiveAfterDays}
                actionLabel={t.save}
                onPress={async () => {
                  if (
                    validDays &&
                    (await persist(
                      {
                        ...settings,
                        archiveAfterDays: Number(daysText),
                      },
                      "days",
                    ))
                  )
                    setArchiveDaysEdit(null);
                }}
                disabled={
                  controlDisabled("days") ||
                  !validDays ||
                  Number(daysText) === settings.archiveAfterDays
                }
                testID="workboard-save-archive-days"
              />
              <SettingsSelect
                label={t.defaultDraftGroupSetting}
                value={
                  groups.some(
                    (group) =>
                      group.id === settings.defaultDraftGroup &&
                      group.kind === "todo",
                  )
                    ? settings.defaultDraftGroup!
                    : ""
                }
                options={[
                  { value: "", label: t.defaultByKind },
                  ...groups
                    .filter((group) => group.kind === "todo")
                    .map((group) => ({
                      value: group.id,
                      label: groupTitle(group, t),
                    })),
                ]}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      defaultDraftGroup: value || null,
                    },
                    "draft-default",
                  );
                }}
                disabled={controlDisabled("draft-default")}
                testID="workboard-default-draft"
              />
              <SettingsSelect
                label={t.defaultStartGroupSetting}
                value={
                  groups.some(
                    (group) =>
                      group.id === settings.defaultStartGroup &&
                      !isTerminalGroup(group.id, groups),
                  )
                    ? settings.defaultStartGroup!
                    : ""
                }
                options={[
                  { value: "", label: t.defaultByKind },
                  ...groups
                    .filter((group) => !isTerminalGroup(group.id, groups))
                    .map((group) => ({
                      value: group.id,
                      label: groupTitle(group, t),
                    })),
                ]}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      defaultStartGroup: value || null,
                    },
                    "workspace-default",
                  );
                }}
                disabled={controlDisabled("workspace-default")}
                testID="workboard-default-workspace"
              />
              <SettingsSelect
                label={t.defaultStartWorkGroupSetting}
                value={
                  groups.some(
                    (group) =>
                      group.id === settings.defaultStartWorkGroup &&
                      group.kind === "in-progress",
                  )
                    ? settings.defaultStartWorkGroup!
                    : ""
                }
                options={[
                  { value: "", label: t.defaultByKind },
                  ...groups
                    .filter((group) => group.kind === "in-progress")
                    .map((group) => ({
                      value: group.id,
                      label: groupTitle(group, t),
                    })),
                ]}
                onValueChange={async (value) => {
                  await persist(
                    { ...settings, defaultStartWorkGroup: value || null },
                    "start-work-default",
                  );
                }}
                disabled={controlDisabled("start-work-default")}
                testID="workboard-default-start-work"
              />
            </SettingsCard>
          </SettingsSection>
          {onSetGroupMaster &&
            (hosts.length > 1 || settings.groupSyncMaster !== null) && (
              <HostSettings
                hosts={hosts}
                master={settings.groupSyncMaster}
                disabled={
                  disabled ||
                  [...(pendingMutationIds ?? [])].some((id) =>
                    id.startsWith("group-sync:"),
                  )
                }
                t={t}
                theme={theme}
                errorText={(code) => mutationErrorText(new Error(code), t)}
                onSetMaster={onSetGroupMaster}
              />
            )}
          {groupsLockedBy && (
            <Text
              testID="workboard-groups-following"
              style={[styles.hintText, { color: theme.colors.statusWarning }]}
            >
              {t.groupsFollowing.replace("{master}", groupsLockedBy)}
            </Text>
          )}
          <GroupSettings
            board={{ ...board, settings }}
            groups={groups}
            onChange={async (next) =>
              !!(await persist({ ...settings, groups: next }))
            }
            disabled={disabled || !!groupsLockedBy}
            saving={saving}
            t={t}
            theme={theme}
          />
          <View>
            {(settings.autoArchive || preview.affected > 0) && (
              <View style={styles.settingsPreview}>
                <Text
                  style={[
                    styles.hintText,
                    { color: theme.colors.statusWarning },
                  ]}
                >
                  {t.mappingPreview.replace(
                    "{count}",
                    String(preview.affected),
                  )}
                </Text>
                <Text
                  style={[
                    styles.hintText,
                    { color: theme.colors.statusWarning },
                  ]}
                >
                  {t.duePreview.replace("{count}", String(preview.due))}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      {confirmAutoArchive && (
        <ConfirmationModal
          title={t.enableAutoArchive}
          description={t.enableAutoArchiveConfirm.replace(
            "{count}",
            String(preview.due),
          )}
          confirmLabel={t.enable}
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setConfirmAutoArchive(false)}
          onConfirm={async () =>
            !!(await persist({ ...settings, autoArchive: true }, "archive"))
          }
        />
      )}
    </View>
  );
}
function bootErrorText(
  error: string | null,
  t: ReturnType<typeof strings>,
): string | null {
  return error
    ? ((t.bootErrors as Record<string, string>)[error] ?? error)
    : null;
}
const styles = StyleSheet.create({
  viewSwitch: { flexDirection: "row", gap: 2 },
  screen: { flex: 1, minHeight: 0 },
  filterSummary: {
    paddingHorizontal: 12,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toolbar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  toolbarLeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  toolbarLeadingCompact: { width: "100%" },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  toolbarButton: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  controlText: { fontSize: 14, lineHeight: 20 },
  projectPicker: { minWidth: 0, maxWidth: 180, flexShrink: 1 },
  projectPickerCompact: { flex: 1, maxWidth: "100%" },
  projectTrigger: { borderWidth: 1 },
  projectName: { flexShrink: 1 },
  fixedIcon: { flexShrink: 0 },
  pageHeader: {
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  primary: { fontWeight: "600", textDecorationLine: "underline" },
  search: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 140,
    maxWidth: 360,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    padding: 0,
    fontSize: 14,
    lineHeight: 20,
  },
  chip: {
    minHeight: 36,
    minWidth: 36,
    justifyContent: "center",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
  },
  disabledControl: { opacity: 0.5 },
  menuItem: { padding: 12 },
  stageMenuItem: {
    minHeight: 40,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stageDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  menuItemLabel: { flex: 1, minWidth: 0 },
  notice: { paddingHorizontal: 16, paddingTop: 8 },
  conflict: {
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  conflictRow: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  conflictTitle: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  conflictHint: {
    paddingHorizontal: 10,
    paddingBottom: 6,
    fontSize: 12,
    lineHeight: 18,
  },
  conflictList: { maxHeight: 160 },
  compactList: { padding: 10, gap: 7 },
  tabScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 52 },
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 4,
  },
  cardTitle: { fontWeight: "600", fontSize: 14, lineHeight: 18 },
  cardMeta: { fontSize: 12, lineHeight: 16 },
  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    alignItems: "center",
    gap: 5,
  },
  filterBadge: {
    minWidth: 18,
    minHeight: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  iconAction: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 40 },
  textarea: { minHeight: 92, textAlignVertical: "top" },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 18,
    paddingTop: 8,
  },
  projectChoices: { gap: 6 },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    paddingVertical: 8,
  },
  choiceList: { maxHeight: 220 },
  choice: { padding: 10, borderRadius: 7 },
  settings: { padding: 16, paddingBottom: 24 },
  settingsContent: { width: "100%", maxWidth: 760, alignSelf: "center" },
  settingsPreview: { gap: 4 },
  hintText: { fontSize: 13, lineHeight: 18 },
});

export function mutationErrorText(
  error: unknown,
  t: ReturnType<typeof strings>,
): string {
  if (!(error instanceof Error)) return t.loadError;
  const messages: Record<string, string> = {
    ...t.issues,
    ...t.mutationErrors,
    ...t.bootErrors,
    [CANCEL_BINDING_BUSY_ERROR_CODE]: t.cancelBindingBusy,
  };
  return Object.hasOwn(messages, error.message)
    ? messages[error.message]
    : t.loadError;
}
