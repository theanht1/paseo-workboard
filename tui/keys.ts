import type { Priority } from "../shared/model";

/** The fields of an OpenTUI key event the board reads. */
export interface Key {
  name: string;
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export type Command =
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "edge"; edge: "first" | "last" }
  | { kind: "section"; delta: 1 | -1 }
  | { kind: "stage"; delta: 1 | -1 }
  | { kind: "priority"; priority: Priority }
  | { kind: "create" }
  | { kind: "open" }
  | { kind: "attention" }
  | { kind: "refresh" }
  | { kind: "help" };

const BY_SEQUENCE: Record<string, Command> = {
  j: { kind: "move", delta: 1 },
  k: { kind: "move", delta: -1 },
  g: { kind: "edge", edge: "first" },
  G: { kind: "edge", edge: "last" },
  "]": { kind: "section", delta: 1 },
  "[": { kind: "section", delta: -1 },
  J: { kind: "stage", delta: 1 },
  K: { kind: "stage", delta: -1 },
  "0": { kind: "priority", priority: "p0" },
  "1": { kind: "priority", priority: "p1" },
  "2": { kind: "priority", priority: "p2" },
  "3": { kind: "priority", priority: "p3" },
  n: { kind: "create" },
  o: { kind: "open" },
  a: { kind: "attention" },
  r: { kind: "refresh" },
  "?": { kind: "help" },
};
const BY_NAME: Record<string, Command> = {
  down: { kind: "move", delta: 1 },
  up: { kind: "move", delta: -1 },
  home: { kind: "edge", edge: "first" },
  end: { kind: "edge", edge: "last" },
  return: { kind: "open" },
  enter: { kind: "open" },
};

export function boardCommand(key: Key): Command | null {
  if (key.ctrl || key.meta) return null;
  return (
    (Object.hasOwn(BY_NAME, key.name) ? BY_NAME[key.name] : undefined) ??
    (Object.hasOwn(BY_SEQUENCE, key.sequence)
      ? BY_SEQUENCE[key.sequence]
      : null)
  );
}

export type LineEdit =
  | { kind: "edit"; value: string }
  | { kind: "submit"; value: string }
  | { kind: "cancel" };

const PRINTABLE = /^[^\p{Cc}]+$/u;

/** A single-line editor: typing appends, Backspace and Ctrl-U delete, Enter submits. */
export function editLine(value: string, key: Key): LineEdit {
  if (key.name === "escape") return { kind: "cancel" };
  if (key.name === "return" || key.name === "enter") {
    const title = value.trim();
    return title ? { kind: "submit", value: title } : { kind: "edit", value };
  }
  if (key.name === "backspace")
    return { kind: "edit", value: Array.from(value).slice(0, -1).join("") };
  if (key.ctrl && key.name === "u") return { kind: "edit", value: "" };
  if (!key.ctrl && !key.meta && PRINTABLE.test(key.sequence))
    return { kind: "edit", value: (value + key.sequence).slice(0, 1000) };
  return { kind: "edit", value };
}
