import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTerminalDimensions } from "@opentui/react";
import {
  useViewKeyboard,
  type Theme,
  type TuiPluginContext,
} from "paseo-tui/plugin";
import type { GroupColor } from "../shared/model";
import { mutationErrorText } from "../client/mutation-errors";
import {
  attentionTexts,
  boardRows,
  boardSections,
  cardPriority,
  cardStatus,
  groupColorOf,
  priorityColorOf,
  priorityName,
  resolveSelection,
  sectionTitle,
  windowStart,
} from "./board-model";
import type { BoardStore } from "./board-store";
import { handleKey } from "./controller";
import { BOLD, box, color, span, text } from "./elements";
import { fill, type TuiStrings } from "./strings";

function paletteColor(theme: Readonly<Theme>, name: GroupColor): string {
  const colors: Record<GroupColor, string> = {
    gray: theme.muted,
    blue: theme.labelBlue,
    cyan: theme.labelSky,
    teal: theme.labelTeal,
    green: theme.labelEmerald,
    amber: theme.labelAmber,
    orange: theme.labelOrange,
    violet: theme.labelViolet,
    pink: theme.labelPink,
    red: theme.labelRed,
  };
  return colors[name] || theme.accent;
}

/** A load failure the server names; anything else is a generic load error. */
function loadErrorText(error: unknown, t: TuiStrings): string {
  const text = mutationErrorText(error, t);
  return text === t.confirmationFailed ? t.loadError : text;
}

export interface BoardViewProps {
  ctx: TuiPluginContext;
  store: BoardStore;
  t: TuiStrings;
  focused: boolean;
}

export function BoardView({ ctx, store, t, focused }: BoardViewProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { height: terminalHeight } = useTerminalDimensions();
  const [listHeight, setListHeight] = useState(Math.max(terminalHeight - 8, 1));
  const start = useRef(0);
  useEffect(() => store.show(focused), [store, focused]);
  useViewKeyboard((key) => handleKey(store, ctx, t, key));

  const theme = ctx.theme;
  const board = state.board;
  const sections = board ? boardSections(board, state.attentionOnly) : [];
  const rows = boardRows(sections);
  const selection = resolveSelection(sections, state.selection);
  const selectedRow = rows.findIndex(
    (row) => row.kind === "card" && row.card.id === selection.id,
  );
  start.current = windowStart(
    rows.length,
    Math.max(selectedRow, 0),
    listHeight,
    start.current,
  );
  const selected = selectedRow >= 0 ? rows[selectedRow] : null;
  const taskCount = sections.reduce((sum, item) => sum + item.cards.length, 0);

  const status = [
    fill(t.taskCount, { count: String(taskCount) }),
    state.attentionOnly ? t.tui.attentionOnly : null,
    state.submitting
      ? t.tui.submitting
      : state.refreshing
        ? t.tui.refreshing
        : null,
  ].filter(Boolean);
  const problem =
    state.error !== null
      ? loadErrorText(state.error, t)
      : board && !board.connected
        ? t.disconnected
        : board?.error
          ? loadErrorText(new Error(board.error), t)
          : null;

  const header = text(
    {},
    span({ fg: color(theme.accent), attributes: BOLD }, t.title),
    span(
      { fg: color(theme.muted) },
      ` · ${ctx.host.label} · ${status.join(" · ")}`,
    ),
    problem ? span({ fg: color(theme.error) }, ` · ${problem}`) : null,
  );

  const list = !board
    ? [
        text(
          { key: "loading", fg: color(theme.muted) },
          problem ? "" : t.loading,
        ),
      ]
    : rows.slice(start.current, start.current + listHeight).map((row) => {
        if (row.kind === "header")
          return text(
            { key: `h:${row.section.id}` },
            span(
              {
                fg: color(paletteColor(theme, groupColorOf(row.section))),
                attributes: BOLD,
              },
              `▍${sectionTitle(row.section, t)} `,
            ),
            span({ fg: color(theme.faint) }, `(${row.section.cards.length})`),
          );
        const card = row.card;
        const isSelected = card.id === selection.id;
        const priority = cardPriority(card);
        const attention = attentionTexts(card, t).length;
        return text(
          {
            key: `c:${card.id}`,
            bg: isSelected ? color(theme.selectionBg) : undefined,
          },
          span({ fg: color(theme.accent) }, isSelected ? " ▸ " : "   "),
          span(
            {
              fg: color(paletteColor(theme, priorityColorOf(board, priority))),
            },
            `${priorityName(board, priority)} `,
          ),
          span({ fg: color(theme.fg) }, card.title),
          span({ fg: color(theme.muted) }, `  ${cardStatus(card, t)}`),
          attention > 0
            ? span({ fg: color(theme.warn) }, `  ⚠ ${attention}`)
            : null,
        );
      });

  const selectedCard = selected?.kind === "card" ? selected.card : null;
  const reasons = selectedCard ? attentionTexts(selectedCard, t) : [];
  const detail = reasons.length
    ? text({ fg: color(theme.warn) }, `⚠ ${reasons.join(" · ")}`)
    : text(
        { fg: color(theme.muted) },
        selectedCard?.description.split("\n", 1)[0] ?? "",
      );

  const footer =
    state.editor !== null
      ? text(
          {},
          span({ fg: color(theme.accent) }, t.tui.newDraftPrompt),
          span({ fg: color(theme.fg) }, `${state.editor}▏`),
          span({ fg: color(theme.faint) }, `  ${t.tui.newDraftHint}`),
        )
      : text(
          {
            fg: color(focused ? theme.muted : theme.faint),
            ...(state.help ? { wrapMode: "word", truncate: false } : {}),
          },
          state.help ? t.tui.keys : t.tui.keysShort,
        );

  return box(
    { flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 },
    header,
    box(
      {
        flexDirection: "column",
        flexGrow: 1,
        overflow: "hidden",
        onSizeChange() {
          if (this.height > 0 && this.height !== listHeight)
            setListHeight(this.height);
        },
      },
      ...list,
    ),
    detail,
    footer,
  );
}
