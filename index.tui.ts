import { createElement } from "react";
import { defineTuiPlugin } from "paseo-tui/plugin";
import { createBoardStore } from "./tui/board-store";
import { BoardView } from "./tui/BoardView";
import { terminalLanguage, tuiStrings } from "./tui/strings";

/** The paseo-tui entry: one board view and its actions per host running Workboard. */
export default defineTuiPlugin({
  id: "paseo-workboard",
  apiVersion: 1,
  activate(ctx) {
    const t = tuiStrings(terminalLanguage(process.env));
    const store = createBoardStore({ rpc: ctx.rpc });
    ctx.onDispose(store.dispose);
    ctx.registerView({
      id: "board",
      title: t.title,
      render: ({ focused }) =>
        createElement(BoardView, { ctx, store, t, focused }),
    });
    ctx.registerAction({
      id: "open",
      title: t.tui.openBoard,
      run: () => ctx.openView("board"),
    });
    ctx.registerAction({
      id: "new-draft",
      title: t.tui.newDraft,
      run: () => {
        store.setEditor("");
        ctx.openView("board");
      },
    });
  },
});
