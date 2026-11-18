import { mutationErrorText } from "../client/mutation-errors";
import type { Mutation } from "../shared/rpc";
import {
  boardSections,
  createMutation,
  edgeSelection,
  jumpSection,
  moveSelection,
  priorityMutation,
  priorityName,
  sectionTitle,
  selectedCard,
  stageMove,
} from "./board-model";
import { WriteRefused, type BoardStore } from "./board-store";
import { boardCommand, editLine, type Key } from "./keys";
import { fill, type TuiStrings } from "./strings";

/** What the controller needs from the paseo-tui plugin context. */
export interface ControllerHost {
  focusWorkspace(workspaceId: string): void;
  notify(message: string, level?: "info" | "error"): void;
}

export function errorText(error: unknown, t: TuiStrings): string {
  if (error instanceof WriteRefused)
    return error.reason === "pending" ? t.mutationPending : t.disconnected;
  return mutationErrorText(error, t);
}

/** Runs one key press against the board; asynchronous work settles inside. */
export function handleKey(
  store: BoardStore,
  host: ControllerHost,
  t: TuiStrings,
  key: Key,
): void {
  const state = store.getState();
  if (state.editor !== null) {
    const edit = editLine(state.editor, key);
    if (edit.kind === "edit") store.setEditor(edit.value);
    else if (edit.kind === "cancel") store.setEditor(null);
    else {
      const board = state.board;
      if (!board) return;
      const sections = boardSections(board, state.attentionOnly);
      void submit(
        createMutation(
          board,
          selectedCard(sections, state.selection),
          edit.value,
        ),
        t.taskCreated,
        () => store.setEditor(null),
      );
    }
    return;
  }
  const command = boardCommand(key);
  if (!command) return;
  if (command.kind === "refresh") return void store.refresh();
  if (command.kind === "help") return store.toggleHelp();
  if (command.kind === "attention") return store.toggleAttention();
  const board = state.board;
  if (!board) return;
  if (command.kind === "create") return store.setEditor("");
  const sections = boardSections(board, state.attentionOnly);
  if (command.kind === "move")
    return store.select(
      moveSelection(sections, state.selection, command.delta),
    );
  if (command.kind === "edge")
    return store.select(edgeSelection(sections, command.edge));
  if (command.kind === "section")
    return store.select(jumpSection(sections, state.selection, command.delta));
  const card = selectedCard(sections, state.selection);
  if (!card) return;
  if (command.kind === "open") {
    if (card.workspaceId === null) host.notify(t.tui.noWorkspaceToOpen);
    else host.focusWorkspace(card.workspaceId);
    return;
  }
  if (command.kind === "priority")
    return void submit(
      priorityMutation(card, command.priority),
      fill(t.tui.prioritySet, {
        priority: priorityName(board, command.priority),
      }),
    );
  const move = stageMove(board, card, command.delta);
  if (move.kind === "mutation")
    return void submit(
      move.mutation,
      fill(t.tui.moved, {
        group: sectionTitle(
          { id: move.group.id, group: move.group, cards: [] },
          t,
        ),
      }),
    );
  if (move.reason === "needs-start") host.notify(t.tui.needsStart, "error");
  else if (move.reason === "binding")
    host.notify(t.tui.bindingPending, "error");
  else if (move.reason === "conflict") host.notify(t.tui.conflictMove, "error");

  async function submit(mutation: Mutation, done: string, then?: () => void) {
    try {
      await store.mutate(mutation);
      then?.();
      host.notify(done);
    } catch (error) {
      host.notify(errorText(error, t), "error");
    }
  }
}
