// The subset of the paseo-tui plugin API v1 and OpenTUI that the TUI entry uses.
// paseo-tui supplies these modules at runtime and refuses a plugin that declares
// another `apiVersion`, so these declarations change only with that version.
declare module "paseo-tui/plugin" {
  import type { ReactNode } from "react";

  export interface KeyEvent {
    name: string;
    sequence: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
  }
  export interface Theme {
    fg: string;
    muted: string;
    faint: string;
    accent: string;
    error: string;
    warn: string;
    success: string;
    border: string;
    selectionBg: string;
    labelViolet: string;
    labelSky: string;
    labelEmerald: string;
    labelOrange: string;
    labelPink: string;
    labelIndigo: string;
    labelTeal: string;
    labelRed: string;
    labelAmber: string;
    labelBlue: string;
    status: Record<
      "running" | "idle" | "error" | "attention" | "question",
      string
    >;
  }
  export interface TuiPluginViewProps {
    focused: boolean;
  }
  export interface TuiPluginView {
    id: string;
    title: string;
    render(props: TuiPluginViewProps): ReactNode;
  }
  export interface TuiPluginAction {
    id: string;
    title: string;
    run(): void | Promise<void>;
    defaultKeys?: readonly string[];
  }
  export type TuiPluginNoticeLevel = "info" | "error";
  export interface TuiPluginContext {
    host: { serverId: string; label: string };
    rpc(method: string, input?: unknown): Promise<unknown>;
    registerView(view: TuiPluginView): () => void;
    registerAction(action: TuiPluginAction): () => void;
    openView(viewId: string): void;
    focusWorkspace(workspaceId: string): void;
    notify(message: string, level?: TuiPluginNoticeLevel): void;
    theme: Readonly<Theme>;
    onDispose(dispose: () => void): void;
  }
  export interface TuiPlugin {
    id: string;
    apiVersion: 1;
    activate(context: TuiPluginContext): void | Promise<void>;
  }
  export function defineTuiPlugin(plugin: TuiPlugin): TuiPlugin;
  export function useViewKeyboard(handler: (key: KeyEvent) => void): void;
}

declare module "@opentui/react" {
  export function useTerminalDimensions(): { width: number; height: number };
}
