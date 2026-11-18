import { strings, type Language } from "../client/strings";

/** The terminal has no Paseo language setting; follow the POSIX locale variables. */
export function terminalLanguage(
  env: Readonly<Record<string, string | undefined>>,
): Language {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const zh = {
  openBoard: "打开 Workboard",
  newDraft: "新建 Workboard 草稿",
  attentionOnly: "仅需关注",
  refreshing: "刷新中",
  submitting: "提交中",
  draft: "草稿",
  newDraftPrompt: "新草稿：",
  newDraftHint: "Enter 创建 · Esc 取消",
  keys: "j/k 移动 · [/] 切换分组 · J/K 移到下/上一分组 · 0-3 优先级 · n 新草稿 · Enter 打开 workspace · a 仅需关注 · r 刷新 · ? 帮助",
  keysShort: "? 查看按键",
  needsStart: "草稿移入此分组需要先关联 workspace，请在 Paseo 应用中开始。",
  bindingPending: "此任务正在关联 workspace，请稍后再移动。",
  conflictMove: "标签冲突请在 Paseo 应用中解决。",
  noWorkspaceToOpen: "这是草稿，尚未关联 workspace。",
  moved: "已移到 {group}。",
  prioritySet: "优先级已设为 {priority}。",
};
const en: typeof zh = {
  openBoard: "Open Workboard",
  newDraft: "New Workboard draft",
  attentionOnly: "Needs attention only",
  refreshing: "Refreshing",
  submitting: "Submitting",
  draft: "Draft",
  newDraftPrompt: "New draft: ",
  newDraftHint: "Enter to create · Esc to cancel",
  keys: "j/k move · [/] group · J/K move to next/previous group · 0-3 priority · n new draft · Enter open workspace · a attention · r refresh · ? help",
  keysShort: "? for keys",
  needsStart:
    "A draft needs a workspace before it enters this group; start it in the Paseo app.",
  bindingPending:
    "This task is still being linked to a workspace; move it shortly.",
  conflictMove: "Resolve the label conflict in the Paseo app.",
  noWorkspaceToOpen: "This is a draft without a workspace.",
  moved: "Moved to {group}.",
  prioritySet: "Priority set to {priority}.",
};

export type TuiStrings = ReturnType<typeof strings> & { tui: typeof en };
export const tuiStrings = (language: Language): TuiStrings => ({
  ...strings(language),
  tui: language === "en" ? en : zh,
});
export const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
