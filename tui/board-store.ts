import type { Board } from "../shared/model";
import { mutateRpc, snapshotRpc, type Mutation } from "../shared/rpc";
import type { Selection } from "./board-model";

export interface BoardState {
  board: Board | null;
  /** The last snapshot failure; the previous board stays visible. */
  error: unknown;
  refreshing: boolean;
  submitting: boolean;
  selection: Selection;
  attentionOnly: boolean;
  /** The new-draft title being typed, or null when not editing. */
  editor: string | null;
  help: boolean;
}
/** Refused locally, as the Paseo app does: a write is in flight or the data is stale. */
export class WriteRefused extends Error {
  constructor(readonly reason: "pending" | "disconnected") {
    super(reason);
  }
}
export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
export interface BoardStoreOptions {
  rpc(method: string, input?: unknown): Promise<unknown>;
  timers?: Timers;
  /** Polling while the view has the keyboard, and while it is only mounted. */
  focusedIntervalMs?: number;
  idleIntervalMs?: number;
}
export type BoardStore = ReturnType<typeof createBoardStore>;

/** Validates the input before sending and the output before trusting it. */
async function call<Input, Output>(
  contract: {
    name: string;
    input: { parseAsync(value: unknown): Promise<Input> };
    output: { parseAsync(value: unknown): Promise<Output> };
  },
  rpc: BoardStoreOptions["rpc"],
  input: unknown,
): Promise<Output> {
  const output = await rpc(
    contract.name,
    await contract.input.parseAsync(input),
  );
  return contract.output.parseAsync(output);
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * One host's board for the TUI. Every RPC result is validated by the shared
 * contracts, every promise is settled here (plugin timers are not isolated by
 * paseo-tui), and a newer revision is never replaced by an older reply.
 */
export function createBoardStore(options: BoardStoreOptions) {
  const timers = options.timers ?? defaultTimers;
  const focusedMs = options.focusedIntervalMs ?? 2_000;
  const idleMs = options.idleIntervalMs ?? 15_000;
  let state: BoardState = {
    board: null,
    error: null,
    refreshing: false,
    submitting: false,
    selection: { id: null, index: 0 },
    attentionOnly: false,
    editor: null,
    help: false,
  };
  const listeners = new Set<() => void>();
  /** Mounted views and whether each has the keyboard. */
  const views = new Map<symbol, boolean>();
  const focused = () => [...views.values()].some(Boolean);
  let disposed = false;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;

  const update = (patch: Partial<BoardState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const accept = (board: Board) => {
    if (!state.board || board.revision >= state.board.revision)
      update({ board });
  };
  const schedule = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    if (disposed || views.size === 0) return;
    timer = timers.set(
      () => {
        timer = null;
        void refresh();
      },
      focused() ? focusedMs : idleMs,
    );
  };
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    inFlight ??= (async () => {
      update({ refreshing: true });
      try {
        accept(await call(snapshotRpc, options.rpc, {}));
        update({ error: null });
      } catch (error) {
        update({ error });
      } finally {
        inFlight = null;
        update({ refreshing: false });
        schedule();
      }
    })();
    return inFlight;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    /** Resolves to the server's board, or rejects with its error or a WriteRefused. */
    async mutate(mutation: Mutation): Promise<Board> {
      if (state.submitting) throw new WriteRefused("pending");
      if (!state.board?.connected) throw new WriteRefused("disconnected");
      update({ submitting: true });
      try {
        const board = await call(mutateRpc, options.rpc, mutation);
        accept(board);
        return board;
      } finally {
        update({ submitting: false });
      }
    },
    /**
     * Registers a mounted view until the returned function runs. Polling runs only
     * while a view is mounted, faster while one has the keyboard; showing the first
     * view or gaining the keyboard refreshes at once.
     */
    show(hasKeyboard: boolean): () => void {
      const refreshNow = views.size === 0 || (hasKeyboard && !focused());
      const id = Symbol("view");
      views.set(id, hasKeyboard);
      if (refreshNow) void refresh();
      else if (!inFlight) schedule();
      return () => {
        views.delete(id);
        if (!inFlight) schedule();
      };
    },
    select: (selection: Selection) => update({ selection }),
    toggleAttention: () => update({ attentionOnly: !state.attentionOnly }),
    toggleHelp: () => update({ help: !state.help }),
    setEditor: (editor: string | null) => update({ editor }),
    dispose() {
      disposed = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
      listeners.clear();
    },
  };
}
