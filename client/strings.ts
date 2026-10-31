import type { Group, GroupColor } from "../shared/model";

export type Language = "zh" | "en";

const zh = {
  grouping: "分组方式",
  sorting: "排序方式",
  projectGrouping: "项目分组",
  statusGrouping: "状态分组",
  defaultSort: "默认排序",
  groupByProject: "按项目分组",
  groupByStatus: "按状态分组",
  priorityFirst: "优先级排序",
  prioritySortHint:
    "默认开启，按 P0 → P3 排序，同级保留已保存的默认顺序。适用于看板、项目泳道和列表；关闭后可在同组内手动排序。",
  priority: "优先级",
  priorities: { p0: "P0", p1: "P1", p2: "P2", p3: "P3" },
  prioritySettings: "优先级",
  prioritySettingsHint:
    "P0 最高，P2 为默认值。自定义名称和颜色会同步到所有任务，Pn 编号始终可见。优先级标签始终互斥；冲突无法自动判断时，请重新选择。",
  priorityName: "名称",
  priorityColor: "颜色",
  priorityNameInvalid: "请输入 1–24 个字符的名称。",
  prioritySaveFailed: "保存失败，请刷新后重试。",
  resetPriority: "恢复此档默认值",
  boardView: "看板",
  listView: "列表",
  expandAll: "展开全部",
  collapseAll: "折叠全部",
  expandGroup: "展开分组",
  collapseGroup: "折叠分组",
  moveGroupUp: "向上移动",
  moveGroupDown: "向下移动",
  expandToSeeMatches: "展开查看匹配任务",
  listGroupCount: "{matched} / {total}",
  groupKeyboardHintList: "拖动调整分组顺序；Alt+上/下方向键调整顺序。",
  listCardOrderHint:
    "在本组排序；可用 Alt+上/下方向键。筛选时只移动当前任务，其它任务相对顺序保持。",
  listDropToReorder: "在本组调整任务顺序",
  viewSaveFailed: "显示设置已生效，但无法记住。请检查客户端存储权限。",
  movedToGroup: "“{task}”已移至“{group}”",
  moreActions: "更多操作",
  taskOrderSaved: "已保存“{task}”的顺序",
  confirmationFailed: "操作未完成，请刷新后重试。",
  clearSearch: "清除搜索",
  conflictCount: "{count} 个冲突",
  mutationPending: "此操作正在提交，请稍后再试。",
  navigationUnavailable:
    "当前界面无法打开 workspace，请从 Paseo 的 workspace 列表打开。",
  groupKeyboardHint: "点击打开分组选项；Alt/Meta+左/右方向键调整顺序。",
  startNeedsWorkspace: "请选择要关联的 workspace。",
  startNeedsDirectory: "请输入 workspace 目录。",
  startNeedsProject: "请选择项目；workspace 将使用项目目录。",
  startNeedsGitProject: "创建 worktree 需要选择 Git 项目。",
  undoMove: "撤销移动",
  undoMoveHint: "在 8 秒内放回移动前的分组；任务变化后不可撤销。",
  undoMoveExpired: "撤销窗口已过期或任务已变化，请刷新后手动调整分组。",
  moveUndone: "任务已放回原分组。",
  locale: "zh-CN",
  title: "Workboard",
  addTask: "新建任务",
  openTask: "打开",
  taskCount: "{count} 个任务",
  emptyBoardHint:
    "已有工作区会自动显示在这里。也可以先记下草稿，开始工作时再创建或关联工作区。",
  startWorkspaceHint:
    "这里只创建或关联工作区；进入工作区后再启动 Agent，不会自动发送提示词。",
  search: "搜索任务或项目",
  allProjects: "全部项目",
  unassigned: "未分配",
  attention: "只看需关注",
  filters: "筛选",
  allStates: "全部状态",
  agentFilter: "Agent 状态",
  requestFilter: "PR / MR 状态",
  filterSummary: "{count} / {total} 个任务 · {filters} 项筛选",
  filterSaveFailed: "筛选已生效，但无法记住条件。请检查客户端存储权限。",
  clearFilters: "清除筛选",
  requestFilters: {
    all: "全部状态",
    none: "未关联",
    open: "开放",
    draft: "草稿",
    merged: "已合并",
    closed: "已关闭",
    unknown: "状态未知",
    "checks-failed": "CI 失败",
    "changes-requested": "需要修改",
    unavailable: "暂不可用",
  },
  quickCreate: "输入标题，Enter 创建",
  quickCreateHint: "仅创建草稿；开始工作时再绑定 workspace。",
  quickCreated: "草稿已创建，可继续输入下一项。",
  quickCreatedHidden: "草稿已创建，当前筛选条件将其隐藏。",
  taskCreated: "草稿已创建。",
  taskUpdated: "任务已更新。",
  taskUpdatedHidden: "任务已更新，当前筛选条件将其隐藏。",
  quickCreateFailed: "未能创建，标题已保留，请重试。",
  attentionReason: "需关注原因",
  attentionActivity: {
    waiting: "Agent 等待输入或权限批准",
    error: "Agent 报错，请打开 workspace 查看",
    attention: "Agent 有未读回复",
  },
  openWorkspace: "打开 workspace",
  pinAutomatic:
    "Paseo 侧边栏：由 Workboard 自动置顶。离开自动置顶的分组后取消。",
  pinManual: "Paseo 侧边栏：已有或手动置顶，Workboard 不会自动取消。",
  archive: "归档",
  settings: "设置",
  refresh: "刷新",
  save: "保存",
  cancel: "取消",
  working: "正在处理…",
  edit: "编辑",
  notes: "说明",
  details: "展开详情",
  dragTask: "拖动任务到其它阶段",
  dragGroup: "拖动调整分组顺序",
  groupOptions: "分组选项",
  groupLocator: "定位分组",
  collapseColumn: "折叠列",
  expandColumn: "展开列",
  moveCardUp: "上移任务",
  moveCardDown: "下移任务",
  cardOrderHint:
    "在本列排序；可用 Alt+上/下方向键。筛选时只移动当前任务，其它任务相对顺序保持。",
  resetCardOrder: "恢复活动排序",
  dropToReorder: "在本列调整任务顺序",
  moveGroupLeft: "向左移动",
  moveGroupRight: "向右移动",
  resizeColumn: "调整列宽",
  resizeHint: "拖动调整宽度，双击恢复默认；方向键调整，Home 恢复默认。",
  resetColumnWidth: "恢复默认列宽",
  columnWidths: "列宽",
  widthCompact: "紧凑 · 220 px",
  widthStandard: "标准 · 280 px",
  widthWide: "宽 · 360 px",
  resetDefaults: "恢复默认",
  resetDefaultsHint:
    "清空所有筛选，并将看板和所有项目泳道的列宽恢复为 280 px。",
  dropToGroup: "移至：{group} · Esc 取消",
  dropToStart: "移至：{group} · 松手后选择 workspace",
  dropHere: "松手移入此分组",
  dragCancelHint: "Esc 取消",
  groupDragHint: "松手保存分组顺序 · Esc 取消",
  dragChanged: "任务已发生变化，本次拖动已取消。",
  layoutSaveFailed: "无法记住列布局，本次调整仍生效。请检查客户端存储权限。",
  layoutSaved: "分组顺序已保存",
  allHosts: "所有主机",
  allHostsHint: "显示所有已连接且安装了 Workboard 的主机上的任务",
  hostField: "主机",
  thisHost: "{host}（当前主机）",
  hostsTitle: "多主机",
  hostsHint:
    "Workboard 在每台主机上独立运行。看板会合并所有已连接且安装了 Workboard 的主机；对任务的修改写回其所属主机。",
  groupMaster: "分组主机",
  groupMasterHint:
    "Paseo 打开期间，其它主机会镜像该主机的分组及顺序。选择“无”则各主机分别管理分组。",
  groupMasterNone: "无（各主机保留自己的分组）",
  hostRoles: {
    master: "分组主机：其它主机镜像它的分组",
    synced: "跟随 {master}：分组已同步",
    waiting: "跟随 {master}：等待其上线",
    pending: "正在检查…",
    independent: "保留自己的分组",
    error: "跟随 {master}：未同步，{error}",
  },
  hostOffline: "离线",
  hostNoWorkboard: "此主机未提供 Workboard，或运行的版本较旧",
  hostUnavailable: "无法加载“{host}”，暂不显示其任务。",
  hiddenRemoteTasks:
    "“{host}”有 {count} 个任务位于本看板没有的分组中。将本主机设为分组主机即可显示。",
  groupsFollowing:
    "分组镜像自“{master}”。请在该主机上编辑，或将分组主机设为“无”。",
  changeGroupMaster: "更改分组主机",
  changeGroupMasterConfirm:
    "{hosts} 将以“{master}”的分组及顺序替换自己的分组。若某主机仍有任务位于“{master}”没有的分组中，该主机保持不变，直到这些任务被移走。",
  clearGroupMasterConfirm: "各主机将保留当前分组，并分别管理。",
  groupSyncPartial: "以下主机未保存此更改：{hosts}",
  hideDetails: "收起详情",
  changeRequestStates: {
    open: "开放",
    draft: "草稿",
    merged: "已合并",
    closed: "已关闭",
    unknown: "状态未知",
  },
  checks: { pending: "CI 进行中", success: "CI 通过", failure: "CI 失败" },
  checkCounts: {
    success: "{count}成功",
    failure: "{count}失败",
    pending: "{count}进行中",
    skipped: "{count}跳过",
    cancelled: "{count}已取消",
  },
  reviews: {
    approved: "评审通过",
    changes_requested: "需要修改",
    pending: "待评审",
  },
  changeRequestUnavailable: "暂时无法获取 MR / PR",
  openChangeRequestError: "无法打开 MR / PR 链接",
  start: "开始工作",
  startHint: "选择项目并创建或关联 workspace。",
  status: "状态",
  create: "创建草稿",
  update: "保存修改",
  titleField: "标题",
  description: "说明（可选）",
  resumeBinding: "继续上次创建或绑定操作，复用同一个 workspace。",
  selectProject: "选择项目",
  newWorkspace: "新建 workspace",
  existingWorkspace: "关联已有 workspace",
  chooseWorkspace: "选择 workspace",
  chooseSource: "选择创建方式",
  directory: "目录",
  projectDirectory: "项目目录",
  customDirectory: "指定其他目录",
  projectDirectoryHint:
    "使用所选项目的现有目录创建 workspace，无需手动填写路径。",
  worktreeAutoHint: "Paseo 自动创建独立的 Git worktree；留空名称即可自动命名。",
  worktree: "Git worktree",
  worktreeName: "worktree 名称（可选）",
  noWorkspace: "草稿 · 未创建 workspace",
  noConversation: "尚无对话",
  unknownConversation: "对话时间待核实",
  noAgents: "没有 Agent",
  conversationAtLeast: "不早于 {date}",
  conversationAtMost: "不晚于 {date}",
  expires: "将于 {date} 归档",
  overdue: "已到期，等待检查",
  syncing: "同步中",
  retry: "重试",
  connected: "已连接",
  disconnected: "数据未刷新，写入已暂停",
  loading: "正在载入任务…",
  loadError: "无法读取看板",
  empty: "这里还没有任务",
  emptyFiltered: "没有符合筛选条件的任务",
  conflict: "标签冲突",
  conflictSummary: "{count} 个任务存在标签冲突",
  conflictHint: "为以下任务选择一个分组，修复多个状态标签。",
  resolveConflict: "选择分组",
  archived: "归档记录",
  archiveRules:
    "仅显示 Workboard 自动归档的任务，默认显示已归档记录；归档中或结果待核实的记录在“待处理”中。撤销会通过 Paseo 恢复 workspace，托管 worktree 能否重建取决于宿主保留的分支和目录。恢复后保留原分组，暂停该任务的自动归档，直到更换分组。Paseo 中的手动或其他自动归档请在原生归档页管理；手动归档草稿可在设置中恢复。",
  archiveCompleted: "已归档",
  archiveNeedsReview: "待处理",
  archiveInProgress: "归档中",
  undoArchive: "撤销归档",
  undoArchiveConfirm:
    "撤销“{name}”的归档？若 workspace 仍活跃且未在归档，则直接放回看板；否则通过 Paseo 恢复，宿主可能重建托管 worktree。已停止的 Agent 和 terminal 不会自动重新运行。恢复后暂停自动归档，直到该任务更换分组。恢复失败时保留归档记录。",
  checkArchiveUndo: "核实恢复结果",
  checkArchiveUndoConfirm:
    "检查“{name}”是否已在 Paseo 恢复？此操作只核实状态，不会再次发送恢复请求；如尚未恢复，请先在 Paseo 中处理。",
  archiveUndoUnknown: "撤销归档结果待核实",
  archiveUndoPending: "正在恢复 workspace，请等待；恢复期间暂停修改看板",
  archivePaused: "自动归档已暂停，更换分组后恢复",
  archivedDrafts: "已归档草稿",
  archivedDraftRules:
    "这里只保留手动归档的草稿。放回看板会恢复到原分组，不涉及 workspace 或 worktree。",
  back: "返回看板",
  archiveDraft: "归档草稿",
  archiveDraftConfirm:
    "归档草稿“{name}”？归档后将移出看板，可在设置的“已归档草稿”中放回原分组。",
  autoArchive: "自动归档",
  autoArchiveMigrationPaused:
    "升级时补建了已废弃分组，其标签可能匹配已有 workspace。自动归档已关闭，请核对到期任务后重新开启；存在到期任务时会先要求确认。",
  archiveCanceled: "自动归档已废弃任务",
  archiveDone: "自动归档已完成任务",
  archiveCanceledAfterDays: "已废弃任务等待天数",
  archiveDoneAfterDays: "已完成任务等待天数",
  archiveDaysHint: "输入 1–365 的整数，保存后生效。",
  archiveDaysInvalid: "请输入 1–365 的整数。",
  autoArchiveGroupSyncPaused:
    "从分组主机镜像的分组让更多标签计为已完成或已废弃。本主机已关闭相应的自动归档规则，请核对到期任务后重新开启；存在到期任务时会先要求确认。",
  defaultDraftGroupSetting: "新草稿默认分组",
  defaultStartGroupSetting: "未标记 workspace 默认分组",
  defaultStartWorkGroupSetting: "开始工作默认分组（进行中）",
  defaultByKind: "自动（按分组类型）",
  detachDraft: "还原合并草稿",
  detachDraftConfirm:
    "将“{name}”还原为独立草稿，并从此任务备注中移除合并时追加的内容？",
  archiveRuleHint: "最后对话超过 {days} 天且安全检查通过后归档。",
  archiveCandidates: "待归档任务",
  archiveCandidatesEmpty: "按新设置，目前没有到期任务。",
  archiveCandidateDue: "等待 {days} 天 · 到期时间：{date}",
  archiveCandidateExact: "最后一次已验证对话：{date}",
  archiveCandidateScheduled:
    "记录的活动时间已到复核时间；最后一次对话时间尚未验证。",
  archiveCandidateUpperBound: "最后对话不晚于：{date}（保守上界）",
  enableAutoArchive: "保存自动归档设置",
  enableAutoArchiveConfirm:
    "按新设置有 {count} 个任务已到期（已废弃 {canceled} 个，已完成 {done} 个）。保存后会在安全检查通过时自动归档对应 workspace，可能停止 Agent 和 terminal，并移除托管 worktree。",
  enable: "开启",
  pinInProgressWorkspaces: "进行中任务在 Paseo 侧边栏自动置顶",
  pinInProgressHint:
    "按“进行中”分组判断；离开该分组时仅取消插件添加的置顶，保留你手动置顶的 workspace。",
  pinReviewWorkspaces: "待验收任务在 Paseo 侧边栏自动置顶",
  pinReviewHint:
    "按“待验收”分组判断；两个开关都开启时，任务从进行中移到待验收会保留置顶。离开这些分组时仅取消插件添加的置顶。",
  exclusiveStatusLabels: "状态标签互斥（新标签替换旧标签）",
  exclusiveStatusHint:
    "任务在外部获得新的状态标签时，自动移除上一次的状态标签，只保留最新选择的分组；仅作用于下方分组配置的标签，其他标签不受影响。无法判断哪个标签更新时，仍会显示标签冲突提示。",
  dateFilter: "日期",
  dateRanges: {
    any: "不限制",
    today: "今天",
    "3days": "3 天内",
    week: "本周",
    month: "当月",
  },
  settingsTitle: "设置",
  generalSettings: "通用",
  groups: "分组",
  addGroup: "新增分组",
  editGroup: "编辑分组",
  deleteGroup: "删除分组",
  deleteGroupConfirm: "删除分组“{name}”？此操作无法撤销。",
  groupName: "分组名称",
  groupType: "分组类型",
  groupLabel: "Workspace 标签",
  groupLabelPlaceholder: "留空使用 task:分组名称",
  groupColor: "分组颜色",
  groupColorHint: "仅用于看板显示，不改变任务规则或 workspace 标签。",
  groupColors: {
    gray: "灰色",
    blue: "蓝色",
    cyan: "青色",
    teal: "蓝绿色",
    green: "绿色",
    amber: "琥珀色",
    orange: "橙色",
    violet: "紫色",
    pink: "粉色",
    red: "红色",
  } satisfies Record<GroupColor, string>,
  groupsHint:
    "保存或删除分组立即生效，删除前移走任务并更改默认落点。至少各保留一个待归类、待开始和已废弃类型分组。",
  groupSaveFailed: "保存失败，输入已保留。请查看错误提示后重试。",
  groupTypeHints: {
    inbox:
      "未配置默认落点时，首个待归类组接收未标记 workspace；导入不会写入标签。",
    todo: "接收 Todo 草稿；创建草稿不会创建 workspace 或会话。",
    "in-progress":
      "仅在开启“进行中任务在 Paseo 侧边栏自动置顶”时自动置顶；离开分组时仅取消插件添加的置顶。",
    review:
      "等待人工验收；Agent 结束不会把任务自动标为完成。仅在开启“待验收任务在 Paseo 侧边栏自动置顶”时自动置顶。",
    done: "仅当“自动归档已完成任务”已启用、等待期限已到且安全检查通过时，才会归档 workspace。",
    canceled:
      "仅当“自动归档已废弃任务”已启用、等待期限已到且安全检查通过时，才会归档 workspace；草稿可手动归档。",
  },
  groupTasks: "{count} 个任务",
  defaultGroup: "默认接收草稿",
  defaultWorkspaceGroup: "默认接收未标记 workspace",
  groupNotEmpty: "请先移走任务，再删除分组或修改草稿分组类型。",
  groupDeleteNotEmpty: "分组内还有任务，移走后可删除。",
  groupNeedsTodo: "至少保留一个待开始类型分组。",
  groupNeedsInbox: "至少保留一个待归类类型分组。",
  groupNeedsCanceled: "至少保留一个已废弃类型分组，以便归档草稿。",
  groupDefaultInUse: "此分组是默认落点，请先在设置中更改对应默认分组。",
  groupLabelDuplicate: "每个分组必须使用不同的标签。",
  groupInvalid: "请填写有效的分组名称和标签。",
  noStartGroup: "请先在设置中添加一个进行中类型的分组。",
  duePreview: "按当前映射，有 {count} 个已到期任务会在下次检查时处理。",
  duePreviewBreakdown:
    "按当前规则，已到期：已废弃 {canceled} 个，已完成 {done} 个。",
  mappingPreview: "修改映射会影响 {count} 个已绑定任务。",
  activity: {
    idle: "空闲",
    running: "运行中",
    waiting: "等待输入",
    attention: "需要关注",
    error: "出错",
  },
  stages: {
    inbox: "待归类",
    todo: "待开始",
    "in-progress": "进行中",
    review: "待验收",
    done: "已完成",
    canceled: "已废弃",
  },
  issues: {
    "no-conversation": "尚无对话",
    "conversation-unknown": "对话时间待核实",
    "labels-conflict": "标签冲突",
    "priority-labels-conflict": "优先级标签冲突，请重新选择优先级",
    "priority-sync-uncertain": "优先级写入结果未知，请刷新并重新选择优先级",
    "agent-busy": "Agent 仍在工作",
    "terminal-open": "请先关闭 terminal",
    "script-running": "workspace script 仍在运行",
    "git-dirty": "Git 有未提交修改",
    "git-no-upstream": "Git 没有可验证的 upstream",
    "git-unpushed": "Git 有未推送提交",
    "git-detached": "Git 处于 detached HEAD",
    "git-unknown": "无法核实 Git 状态",
    "directory-unavailable": "目录不可用",
    "native-archive-unknown": "归档结果待人工核实",
    "changed-during-check": "检查期间状态已变化",
    "label-sync-incomplete": "标签同步未完成",
    "workspace-unavailable": "workspace 不可用或正在归档",
    "archive-restored-workspace-unavailable":
      "任务已放回看板，但 workspace 不在宿主活跃清单中；请核实原生状态",
  },
  conversationReasons: {
    "replay-timestamp": "Paseo 回放历史时用水合时刻打戳，已改用记录的上下界",
    "truncated-window": "只读取了有限的历史窗口",
    "timeline-unreadable": "时间线读取失败",
    "child-enumeration-unavailable": "无法枚举 provider 子 agent",
    "child-timeline-unreadable": "子 agent 时间线读取失败",
  },
  childrenNotListedIdle:
    "Agent 处于空闲状态，刷新时不会唤醒它来列出 provider 子 agent；归档前才会检查",
  archiveConfirmedByUser: "归档结果已由用户确认",
  mutationErrors: {
    "group-sync-follower": "分组镜像自分组主机，请在分组主机上编辑。",
    "group-sync-not-following": "此主机未跟随该分组主机，请刷新后重试。",
    "group-sync-master-revoked": "该主机已不再是分组主机，请在设置中重新选择。",
    "host-unavailable": "任务所属主机已断开，请稍后重试。",
    "card-order-changed": "列内任务顺序或成员已改变，请刷新后重试。",
    "card-order-invalid":
      "排序无效；只能移动当前任务并保留其它任务的相对顺序。",
    "card-order-mover-unavailable":
      "任务已移列、归档或正在绑定，无法排序；请刷新。",
    "stage-group-changed":
      "目标分组已改变或已删除，操作未执行；请关闭状态菜单后重新选择分组。",
    "stage-task-changed": "任务已被修改，撤销未执行；请刷新后核实当前分组。",
    "Storage is unavailable": "存储不可用，请重新打开 Workboard 后重试。",
    "Paseo directory pagination is incomplete":
      "Paseo 目录清单不完整，请刷新后重试。",
    "Paseo plugin IPC unavailable":
      "Paseo 插件通信不可用，请重新打开 Workboard。",
    "Paseo disconnected": "Paseo 连接中断，请重新连接。",
    "Paseo request failed": "Paseo 请求失败，请重试。",
    "Unexpected Paseo response type":
      "Paseo 返回了无法识别的响应，请刷新后重试。",
    "Workboard bridge closed": "Workboard 通信已关闭，请重新打开。",
    "Paseo workspace pin response workspace mismatch":
      "Paseo 置顶响应对应了其它 workspace，请刷新后核实。",
    "Paseo workspace pin rejected": "Paseo 拒绝了 workspace 置顶操作，请重试。",
    "Paseo did not apply the workspace pin":
      "Paseo 未完成 workspace 置顶，请刷新后核实。",
    "Paseo did not remove the workspace pin":
      "Paseo 未取消 workspace 置顶，请刷新后核实。",
    "Workboard installation mismatch; use the manifest plugin ID":
      "Workboard 安装标识不匹配，请使用 manifest 中的插件 ID。",
    "Paseo did not provide its plugin API":
      "Paseo 未提供插件 API，请重新打开 Workboard。",
    "Workboard stopped": "Workboard 已停止，请重新打开。",
    "Task no longer exists": "任务已不存在，请刷新。",
    "Workboard storage belongs to another Paseo host":
      "存储数据属于另一个 Paseo host，无法修改。",
    "Paseo disconnected during refresh": "刷新时 Paseo 连接中断，请重试。",
    "Settings changed; refresh before saving": "设置已变化，请刷新后再保存。",
    "Groups cannot be reordered here": "请在看板上调整分组顺序。",
    "Group order changed; refresh before saving":
      "分组顺序已变化，请刷新后再保存。",
    "A workspace binding still uses this group; finish binding first":
      "绑定操作仍使用此分组，请先完成或取消绑定。",
    "Move the drafts out before deleting this group or changing its type":
      "请先移走草稿，再删除分组或改变其类型。",
    "Workspaces changed; refresh before deleting a group":
      "workspace 已变化，请刷新后再删除分组。",
    "Paseo is disconnected": "Paseo 未连接，请重试连接。",
    "Choose a To do group for a new draft": "新草稿需要待开始类型分组。",
    "Group order changed; refresh before reordering":
      "分组顺序已变化，请刷新后再调整。",
    "Group order is invalid": "分组顺序无效，请刷新后重试。",
    "Task is archived": "任务已归档，请到归档页处理。",
    "Workspace priority labels changed; refresh before saving":
      "优先级标签已变化，请刷新后重试。",
    "Priority synchronization could not be verified":
      "无法确认优先级同步结果，请刷新后检查。",
    "Binding is pending": "正在关联工作区，请稍后重试。",
    "Priority labels are reserved; choose a different status label":
      "优先级标签是保留标签，请为状态选择其他标签。",
    "Priority label is used by a status group; rename its status label first":
      "此优先级标签已被状态分组占用，请先修改该分组的状态标签。",
    "Task changed; refresh before saving": "任务已变化，请刷新后再保存。",
    "Task already has a workspace": "任务已绑定 workspace，请刷新。",
    "Add an In progress group before starting work":
      "请先添加进行中类型分组，再开始工作。",
    "Choose a working or completed group for the workspace":
      "请为 workspace 选择工作中或终态分组。",
    "A previous binding is pending; retry its original target":
      "上一次绑定尚未完成，请重试原目标或取消绑定。",
    "Group no longer exists": "分组已不存在，请刷新。",
    "Workspace binding is still pending":
      "workspace 绑定尚未完成，请先完成或取消绑定。",
    "Start work and bind a workspace first": "请先开始工作并绑定 workspace。",
    "Only canceled, unbound drafts can be archived here":
      "这里只能归档已废弃且未绑定的草稿。",
    "Binding workspace is unavailable":
      "绑定的 workspace 不可用，请核实后重试或取消绑定。",
    "Workspace is unavailable or archiving": "workspace 不可用或正在归档。",
    "Workspace labels changed; refresh before changing stage":
      "workspace 标签已变化，操作未执行；请刷新后再调整分组。",
    "Workspace labels changed during synchronization":
      "同步期间 workspace 标签已变化，请刷新后核实。",
    "Label synchronization could not be verified":
      "无法核实标签同步结果，请刷新后核实。",
    "Native archive returned no timestamp":
      "无法核实原生归档结果，请到归档页处理。",
    "Native workspace still active after archive response":
      "归档响应后 workspace 仍活跃，请核实原生状态。",
    "archive-draft-group-unavailable":
      "原分组类型已改变，不再支持草稿；归档记录已保留。",
    "group-tasks-in-use": "分组内还有任务，请先移走任务。",
    "group-default-in-use": "此分组是默认落点，请先在设置中更改对应默认分组。",
    "group-default-start-work-invalid":
      "开始工作默认分组只能选择现有的进行中类型组，请更换默认分组。",
    "group-default-terminal":
      "未标记 workspace 的默认落点不能是已完成或已废弃类型；请先选择非终态默认分组，再修改该组类型。",
    "detach-draft-stale": "任务已变化，请刷新后再还原草稿。",
    "detach-draft-missing": "该草稿的合并记录已不存在，请刷新。",
    "detach-draft-id-in-use":
      "原草稿 ID 已被其它任务占用，无法还原；合并记录已保留。",
    "detach-draft-text-changed":
      "合并时追加的文本已改变或存在多个匹配，无法安全移除；合并记录已保留。",
    "detach-draft-archived": "已归档任务无法还原合并草稿；合并记录已保留。",
    "cancel-binding-missing": "任务没有待处理的绑定。",
    "cancel-binding-changed": "绑定已变化，请刷新后再取消。",
    "archive-resolution-stale": "任务或归档记录已变化，请刷新后再处理。",
    "archive-undo-pending": "正在恢复 workspace，请等待结果。",
    "archive-recovery-unavailable":
      "Paseo 无法恢复此 workspace；请在原生归档页检查项目、目录和分支。",
    "Native restore workspace mismatch":
      "宿主返回了其它 workspace 的恢复结果，已停止操作。",
    "Native restore rejected": "Paseo 拒绝恢复，请在原生归档页检查目录和分支。",
    "archive-undo-unknown":
      "尚未确认 workspace 已恢复；请先在 Paseo 中检查，再核实恢复结果。",
    "archive-resolution-unavailable": "任务没有待核实的归档结果。",
    "archive-group-unavailable":
      "原分组已删除，无法放回该分组。请先恢复分组配置。",
  },
  bootErrors: {
    "invalid-storage-data":
      "已保存的 Workboard 数据无法解析，自动重试已停止。请联系维护者修复存储数据。",
    "unsupported-storage-version":
      "已保存的数据版本无法识别，自动重试已停止。请联系维护者处理存储数据。",
  },
  confirmArchived: "确认已归档",
  confirmArchivedConfirm:
    "确认“{name}”已经归档？这会保留归档记录，任务仍在归档页。",
  restoreTask: "放回看板",
  restoreTaskConfirm:
    "将“{name}”放回看板？将清除归档记录，任务回到原分组；此操作不会恢复原生 workspace 或目录。",
  cancelBinding: "取消绑定",
  cancelBindingConfirm:
    "取消“{name}”的绑定？之前创建或关联 workspace 的操作未完成，取消后可重新选择操作；已创建或关联的 workspace 会保留。",
  cancelBindingBusy: "绑定操作仍在进行中，请稍后再试。",
};

const en: typeof zh = {
  grouping: "Grouping",
  sorting: "Sorting",
  projectGrouping: "By project",
  statusGrouping: "By status",
  defaultSort: "Default order",
  groupByProject: "Group by project",
  groupByStatus: "Group by status",
  priorityFirst: "Priority first",
  prioritySortHint:
    "Enabled by default: P0 → P3, retaining saved default order within each level. Applies to Board, project lanes and List. Turn off to reorder tasks within a group.",
  priority: "Priority",
  priorities: { p0: "P0", p1: "P1", p2: "P2", p3: "P3" },
  prioritySettings: "Priorities",
  prioritySettingsHint:
    "P0 is highest; P2 is the default. Custom names and colors apply to all tasks; the Pn code stays visible. Priority labels are always exclusive; choose explicitly when a conflict cannot be attributed.",
  priorityName: "Name",
  priorityColor: "Color",
  priorityNameInvalid: "Enter a name of 1–24 characters.",
  prioritySaveFailed: "Could not save. Refresh and try again.",
  resetPriority: "Restore this level’s defaults",
  boardView: "Board",
  listView: "List",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  expandGroup: "Expand group",
  collapseGroup: "Collapse group",
  moveGroupUp: "Move up",
  moveGroupDown: "Move down",
  expandToSeeMatches: "Expand to see matching tasks",
  listGroupCount: "{matched} / {total}",
  groupKeyboardHintList:
    "Drag to reorder groups; Alt+Up/Down Arrow also reorders.",
  listCardOrderHint:
    "Reorder in this group, or use Alt+Up/Down Arrow. With filters, only the selected task moves; other tasks keep their relative order.",
  listDropToReorder: "Reorder tasks in this group",
  viewSaveFailed:
    "Display settings applied but could not be remembered. Check client storage permissions.",
  movedToGroup: "Moved “{task}” to “{group}”",
  moreActions: "More actions",
  taskOrderSaved: "Saved the order of “{task}”",
  confirmationFailed: "The operation did not complete. Refresh and retry.",
  clearSearch: "Clear search",
  conflictCount: "{count} conflicts",
  mutationPending: "This control is already submitting. Try again shortly.",
  navigationUnavailable:
    "Workspace navigation is unavailable here. Open it from the Paseo workspace list.",
  groupKeyboardHint:
    "Press to open group options; Alt/Meta+Left/Right Arrow reorders.",
  startNeedsWorkspace: "Select a workspace to attach.",
  startNeedsDirectory: "Enter a workspace directory.",
  startNeedsProject: "Select a project to use its directory for the workspace.",
  startNeedsGitProject: "Select a Git project to create a worktree.",
  undoMove: "Undo move",
  undoMoveHint:
    "Return to the previous group within 8 seconds; task changes invalidate undo.",
  undoMoveExpired:
    "Undo expired or the task changed. Refresh and move it manually.",
  moveUndone: "The task was returned to its previous group.",
  locale: "en",
  title: "Workboard",
  addTask: "New task",
  openTask: "Open",
  taskCount: "{count} tasks",
  emptyBoardHint:
    "Existing workspaces appear here automatically. Capture a draft now, then create or attach a workspace when you start.",
  startWorkspaceHint:
    "This creates or attaches a workspace. Start an Agent from the workspace; no prompt is sent automatically.",
  search: "Search tasks or projects",
  allProjects: "All projects",
  unassigned: "Unassigned",
  attention: "Needs attention",
  filters: "Filters",
  allStates: "All states",
  agentFilter: "Agent activity",
  requestFilter: "PR / MR status",
  filterSummary: "{count} / {total} tasks · {filters} filters",
  filterSaveFailed:
    "Filters are applied but could not be remembered. Check client storage permissions.",
  clearFilters: "Clear filters",
  requestFilters: {
    all: "All states",
    none: "Not linked",
    open: "Open",
    draft: "Draft",
    merged: "Merged",
    closed: "Closed",
    unknown: "Unknown state",
    "checks-failed": "CI failed",
    "changes-requested": "Changes requested",
    unavailable: "Unavailable",
  },
  quickCreate: "Task title, Enter to create",
  quickCreateHint:
    "Creates a draft only. Link a workspace when you start work.",
  quickCreated: "Draft created. Add another whenever you are ready.",
  quickCreatedHidden: "Draft created; the current filters hide it.",
  taskCreated: "Draft created.",
  taskUpdated: "Task updated.",
  taskUpdatedHidden: "Task updated; the current filters hide it.",
  quickCreateFailed:
    "Could not create the draft. Your title is kept; try again.",
  attentionReason: "Needs attention because",
  attentionActivity: {
    waiting: "An agent is waiting for input or permission",
    error: "An agent failed; open the workspace to inspect it",
    attention: "An agent has an unread reply",
  },
  openWorkspace: "Open workspace",
  pinAutomatic:
    "Paseo sidebar: automatically pinned by Workboard. Leaving the pinned groups removes this pin.",
  pinManual:
    "Paseo sidebar: existing or manual pin. Workboard will not remove it automatically.",
  archive: "Archive",
  settings: "Settings",
  refresh: "Refresh",
  save: "Save",
  cancel: "Cancel",
  working: "Working…",
  edit: "Edit",
  notes: "Notes",
  details: "Show details",
  dragTask: "Drag task to another stage",
  dragGroup: "Drag to reorder group",
  groupOptions: "Group options",
  groupLocator: "Find group",
  collapseColumn: "Collapse column",
  expandColumn: "Expand column",
  moveCardUp: "Move task up",
  moveCardDown: "Move task down",
  cardOrderHint:
    "Reorder in this column with Alt+Up/Down Arrow. With filters, only this task moves; other tasks retain relative order.",
  resetCardOrder: "Restore activity order",
  dropToReorder: "Reorder tasks in this column",
  moveGroupLeft: "Move left",
  moveGroupRight: "Move right",
  resizeColumn: "Resize column",
  resizeHint:
    "Drag to resize, double-click to reset. Arrow keys resize; Home resets.",
  resetColumnWidth: "Reset column width",
  columnWidths: "Column width",
  widthCompact: "Compact · 220 px",
  widthStandard: "Standard · 280 px",
  widthWide: "Wide · 360 px",
  resetDefaults: "Restore defaults",
  resetDefaultsHint:
    "Clear all filters and restore 280 px columns in the board and every project lane.",
  dropToGroup: "Move to: {group} · Esc to cancel",
  dropToStart: "Move to: {group} · Release to choose a workspace",
  dropHere: "Release to move into this group",
  dragCancelHint: "Esc to cancel",
  groupDragHint: "Release to save group order · Esc to cancel",
  dragChanged: "The task changed. This drag was canceled.",
  layoutSaveFailed:
    "Could not remember the column layout. This session is updated; check client storage permissions.",
  layoutSaved: "Group order saved",
  allHosts: "All hosts",
  allHostsHint: "Show tasks from every connected host running Workboard",
  hostField: "Host",
  thisHost: "{host} (this host)",
  hostsTitle: "Hosts",
  hostsHint:
    "Workboard runs separately on each host. The board combines every connected host running Workboard; task changes are written to the host that owns the task.",
  groupMaster: "Group master",
  groupMasterHint:
    "While Paseo is open, other hosts mirror this host's groups and order. Choose None to manage groups on each host.",
  groupMasterNone: "None (each host keeps its own groups)",
  hostRoles: {
    master: "Group master: other hosts mirror its groups",
    synced: "Following {master}: groups in sync",
    waiting: "Following {master}: waiting for it to come online",
    pending: "Checking…",
    independent: "Keeps its own groups",
    error: "Following {master}: not synced. {error}",
  },
  hostOffline: "Offline",
  hostNoWorkboard:
    "Workboard is not available on this host, or it runs an older release",
  hostUnavailable: "{host} could not be loaded; its tasks are not shown.",
  hiddenRemoteTasks:
    "{count} tasks on {host} are in groups this board does not have. Make this host the group master to show them.",
  groupsFollowing:
    "Groups are mirrored from {master}. Edit them there, or set the group master to None.",
  changeGroupMaster: "Change group master",
  changeGroupMasterConfirm:
    "{hosts} will replace their groups and order with those of {master}. A host that still has tasks in groups {master} lacks stays unchanged until those tasks move.",
  clearGroupMasterConfirm:
    "Every host keeps its current groups and manages them separately.",
  groupSyncPartial: "These hosts did not save the change: {hosts}",
  hideDetails: "Hide details",
  changeRequestStates: {
    open: "Open",
    draft: "Draft",
    merged: "Merged",
    closed: "Closed",
    unknown: "Unknown state",
  },
  checks: { pending: "CI pending", success: "CI passed", failure: "CI failed" },
  checkCounts: {
    success: "{count} passed",
    failure: "{count} failed",
    pending: "{count} pending",
    skipped: "{count} skipped",
    cancelled: "{count} cancelled",
  },
  reviews: {
    approved: "Approved",
    changes_requested: "Changes requested",
    pending: "Awaiting review",
  },
  changeRequestUnavailable: "MR / PR information is unavailable",
  openChangeRequestError: "Could not open the MR / PR link",
  start: "Start work",
  startHint: "Choose a project and create or link a workspace.",
  status: "Status",
  create: "Create draft",
  update: "Save changes",
  titleField: "Title",
  description: "Description (optional)",
  resumeBinding: "Resume the previous operation using the same workspace.",
  selectProject: "Select project",
  newWorkspace: "New workspace",
  existingWorkspace: "Link existing workspace",
  chooseWorkspace: "Choose workspace",
  chooseSource: "Choose how to create it",
  directory: "Directory",
  projectDirectory: "Project directory",
  customDirectory: "Other directory",
  projectDirectoryHint:
    "Create a workspace in the selected project's existing directory. No path entry needed.",
  worktreeAutoHint:
    "Paseo creates an isolated Git worktree. Leave the name blank to name it automatically.",
  worktree: "Git worktree",
  worktreeName: "Worktree name (optional)",
  noWorkspace: "Draft · no workspace",
  noConversation: "No conversation yet",
  unknownConversation: "Conversation time needs verification",
  noAgents: "No Agents",
  conversationAtLeast: "No earlier than {date}",
  conversationAtMost: "No later than {date}",
  expires: "Archives {date}",
  overdue: "Due; waiting for checks",
  syncing: "Syncing",
  retry: "Retry",
  connected: "Connected",
  disconnected: "Data is stale; changes are paused",
  loading: "Loading tasks…",
  loadError: "Could not load the board",
  empty: "No tasks here yet",
  emptyFiltered: "No tasks match these filters",
  conflict: "Label conflict",
  conflictSummary: "Conflicting task labels ({count})",
  conflictHint:
    "Choose one group for each task below to resolve its conflicting status labels.",
  resolveConflict: "Choose group",
  archived: "Archive",
  archiveRules:
    "Only tasks automatically archived by Workboard appear here. Completed archives are shown by default; in-progress or unverified outcomes appear under Needs review. Undo asks Paseo to restore the workspace; rebuilding a managed worktree depends on the host’s retained branch and directories. The task keeps its group, with automatic archiving paused until it changes groups. Manage manual and other native archives in Paseo. Restore manually archived drafts from Settings.",
  archiveCompleted: "Archived",
  archiveNeedsReview: "Needs review",
  archiveInProgress: "Archiving",
  undoArchive: "Undo archive",
  undoArchiveConfirm:
    "Undo the archive for “{name}”? If its workspace is still active and not archiving, return it to the board; otherwise ask Paseo to restore it, possibly rebuilding its managed worktree. Stopped agents and terminals do not restart automatically. Automatic archiving stays paused until the task changes groups. If recovery fails, the archive record is kept.",
  checkArchiveUndo: "Check recovery",
  checkArchiveUndoConfirm:
    "Check whether “{name}” is active in Paseo again? This only verifies the outcome and does not resend the restore request. If it is still unavailable, recover it in Paseo first.",
  archiveUndoUnknown: "Recovery outcome needs verification",
  archiveUndoPending:
    "Restoring the workspace; board changes are paused until recovery finishes",
  archivePaused: "Automatic archiving paused until the group changes",
  archivedDrafts: "Archived drafts",
  archivedDraftRules:
    "Manually archived drafts are kept here. Restore to board returns a draft to its original group without changing a workspace or worktree.",
  back: "Back to board",
  archiveDraft: "Archive draft",
  archiveDraftConfirm:
    "Archive draft “{name}”? It will leave the board. Restore it to its original group from Archived drafts in Settings.",
  autoArchive: "Automatic archive",
  autoArchiveMigrationPaused:
    "An upgrade added a Canceled group whose label may match existing workspaces. Automatic archive was turned off. Review due tasks before re-enabling it; due tasks require confirmation first.",
  archiveCanceled: "Automatically archive Canceled tasks",
  archiveDone: "Automatically archive Done tasks",
  archiveCanceledAfterDays: "Canceled archive delay (days)",
  archiveDoneAfterDays: "Done archive delay (days)",
  archiveDaysHint: "Enter an integer from 1 to 365, then save.",
  archiveDaysInvalid: "Enter an integer from 1 to 365.",
  autoArchiveGroupSyncPaused:
    "Groups mirrored from the group master made more labels count as Done or Canceled. The affected automatic-archive rules were turned off on this host. Review due tasks before re-enabling them; due tasks require confirmation first.",
  defaultDraftGroupSetting: "Default group for new drafts",
  defaultStartGroupSetting: "Default group for unlabeled workspaces",
  defaultStartWorkGroupSetting: "Default Start work group (In progress)",
  defaultByKind: "Automatic (by group type)",
  detachDraft: "Restore merged draft",
  detachDraftConfirm:
    "Restore “{name}” as an independent draft and remove its originally appended text from this task's notes?",
  archiveRuleHint:
    "Archive after {days} days since the last verified conversation when safety checks pass.",
  archiveCandidates: "Tasks due for archive",
  archiveCandidatesEmpty: "No tasks are currently due under the new settings.",
  archiveCandidateDue: "{days}-day delay · Due: {date}",
  archiveCandidateExact: "Last verified conversation: {date}",
  archiveCandidateScheduled:
    "Recorded activity is due for recheck; the last conversation time has not been verified.",
  archiveCandidateUpperBound:
    "Last conversation no later than: {date} (conservative upper bound)",
  enableAutoArchive: "Save automatic archive settings",
  enableAutoArchiveConfirm:
    "{count} task(s) are due under the new settings ({canceled} Canceled, {done} Done). Saving will archive their workspaces after safety checks, which may stop agents and terminals and remove managed worktrees.",
  enable: "Enable",
  pinInProgressWorkspaces: "Pin in-progress tasks in the Paseo sidebar",
  pinInProgressHint:
    "Use the In progress group. Leaving it removes only the pin added by this plugin; manually pinned workspaces stay pinned.",
  pinReviewWorkspaces: "Pin review tasks in the Paseo sidebar",
  pinReviewHint:
    "Use the Review group. With both switches on, a task keeps its pin when it moves from In progress to Review. Leaving the pinned groups removes only the pin added by this plugin.",
  exclusiveStatusLabels: "Exclusive status labels (newest replaces old)",
  exclusiveStatusHint:
    "When a task gains a new status label outside Workboard, remove the previous status label and keep only the latest group. Only labels configured as groups below are affected; ordinary labels are untouched. Conflicts whose newest label cannot be determined still raise the banner.",
  dateFilter: "Date",
  dateRanges: {
    any: "Any time",
    today: "Today",
    "3days": "Last 3 days",
    week: "This week",
    month: "This month",
  },
  settingsTitle: "Settings",
  generalSettings: "General",
  groups: "Groups",
  addGroup: "Add group",
  editGroup: "Edit group",
  deleteGroup: "Delete group",
  deleteGroupConfirm: "Delete group “{name}”? This cannot be undone.",
  groupName: "Group name",
  groupType: "Group type",
  groupLabel: "Workspace label",
  groupLabelPlaceholder: "Defaults to task:group-name",
  groupColor: "Group color",
  groupColorHint:
    "Used only on the board. It does not change task rules or workspace labels.",
  groupColors: {
    gray: "Gray",
    blue: "Blue",
    cyan: "Cyan",
    teal: "Teal",
    green: "Green",
    amber: "Amber",
    orange: "Orange",
    violet: "Violet",
    pink: "Pink",
    red: "Red",
  },
  groupsHint:
    "Saving or deleting a group takes effect immediately. Move tasks and change default destinations before deletion. Keep at least one Inbox, To do and Canceled group.",
  groupSaveFailed:
    "Saving failed. Your input is kept; check the error and try again.",
  groupTypeHints: {
    inbox:
      "The first Inbox group receives unlabeled workspaces when no default destination is configured. Importing does not write labels.",
    todo: "Receives Todo drafts. Creating a draft creates no workspace or conversation.",
    "in-progress":
      "Pins only when in-progress sidebar pinning is enabled. Leaving the group removes only the pin added by this plugin.",
    review:
      "Waits for human acceptance. An agent finishing does not mark the task done. Pins only when review sidebar pinning is enabled.",
    done: "Archives a workspace only when the Done automatic-archive rule is enabled, its delay has elapsed, and safety checks pass.",
    canceled:
      "Archives a workspace only when the Canceled automatic-archive rule is enabled, its delay has elapsed, and safety checks pass. Drafts can be archived manually.",
  },
  groupTasks: "{count} tasks",
  defaultGroup: "Default for drafts",
  defaultWorkspaceGroup: "Default for unlabeled workspaces",
  groupNotEmpty:
    "Move tasks first before deleting the group or changing a draft group's type.",
  groupDeleteNotEmpty: "Move the remaining tasks before deleting this group.",
  groupNeedsTodo: "Keep at least one To do group.",
  groupNeedsInbox: "Keep at least one Inbox group.",
  groupNeedsCanceled: "Keep at least one Canceled group for archiving drafts.",
  groupDefaultInUse:
    "This group is a default destination. Change its default group in settings first.",
  groupLabelDuplicate: "Each group needs a different label.",
  groupInvalid: "Enter a valid group name and label.",
  noStartGroup: "Add an In progress group in settings before starting work.",
  duePreview:
    "With this mapping, {count} due task(s) will be handled at the next check.",
  duePreviewBreakdown:
    "With these rules, currently due: {canceled} Canceled, {done} Done.",
  mappingPreview: "This mapping affects {count} linked task(s).",
  activity: {
    idle: "Idle",
    running: "Running",
    waiting: "Waiting",
    attention: "Needs attention",
    error: "Error",
  },
  stages: {
    inbox: "Inbox",
    todo: "To do",
    "in-progress": "In progress",
    review: "Review",
    done: "Done",
    canceled: "Canceled",
  },
  issues: {
    "no-conversation": "No conversation yet",
    "conversation-unknown": "Conversation time needs verification",
    "labels-conflict": "Label conflict",
    "priority-labels-conflict": "Priority label conflict; choose a priority",
    "priority-sync-uncertain":
      "Priority write outcome unknown; refresh and choose a priority",
    "agent-busy": "An agent is still working",
    "terminal-open": "Close the terminal first",
    "script-running": "A workspace script is still running",
    "git-dirty": "Git has uncommitted changes",
    "git-no-upstream": "Git has no verifiable upstream",
    "git-unpushed": "Git has unpushed commits",
    "git-detached": "Git is on a detached HEAD",
    "git-unknown": "Could not verify Git state",
    "directory-unavailable": "Directory is unavailable",
    "native-archive-unknown": "Archive result needs manual verification",
    "changed-during-check": "State changed during the check",
    "label-sync-incomplete": "Label sync is incomplete",
    "workspace-unavailable": "Workspace is unavailable or archiving",
    "archive-restored-workspace-unavailable":
      "Task restored to board, but the workspace is absent from the host active list; verify its native state",
  },
  conversationReasons: {
    "replay-timestamp":
      "Paseo stamps replayed history with the hydration moment; recorded bounds are used instead",
    "truncated-window": "Only a bounded history window was read",
    "timeline-unreadable": "The timeline could not be read",
    "child-enumeration-unavailable": "Provider children cannot be listed",
    "child-timeline-unreadable":
      "A provider child's timeline could not be read",
  },
  childrenNotListedIdle:
    "The agent is idle, so a refresh does not wake it to list its provider children; they are checked before archive",
  archiveConfirmedByUser: "Archive outcome confirmed by user",
  mutationErrors: {
    "group-sync-follower":
      "Groups are mirrored from the group master; edit them there.",
    "group-sync-not-following":
      "This host does not follow that group master; refresh and try again.",
    "group-sync-master-revoked":
      "That host is no longer the group master; choose one again in Settings.",
    "host-unavailable":
      "The host that owns this task is disconnected; try again later.",
    "card-order-changed":
      "Column order or membership changed. Refresh and retry.",
    "card-order-invalid":
      "Invalid order. Move only the selected task and retain other tasks' relative order.",
    "card-order-mover-unavailable":
      "The task moved, was archived, or is binding. It cannot be reordered; refresh first.",
    "stage-group-changed":
      "The target group changed or was deleted. Close and reopen the status menu to choose a group again.",
    "stage-task-changed":
      "The task changed. Undo was refused; refresh and verify its current group.",
    "Storage is unavailable":
      "Storage is unavailable. Reopen Workboard and retry.",
    "Paseo directory pagination is incomplete":
      "The Paseo directory list is incomplete. Refresh and retry.",
    "Paseo plugin IPC unavailable":
      "Paseo plugin communication is unavailable. Reopen Workboard.",
    "Paseo disconnected": "Paseo disconnected. Reconnect before retrying.",
    "Paseo request failed": "The Paseo request failed. Retry it.",
    "Unexpected Paseo response type":
      "Paseo returned an unexpected response. Refresh and retry.",
    "Workboard bridge closed": "Workboard communication is closed. Reopen it.",
    "Paseo workspace pin response workspace mismatch":
      "The Paseo pin response referred to another workspace. Refresh and verify it.",
    "Paseo workspace pin rejected":
      "Paseo rejected the workspace pin operation. Retry it.",
    "Paseo did not apply the workspace pin":
      "Paseo did not pin the workspace. Refresh and verify it.",
    "Paseo did not remove the workspace pin":
      "Paseo did not unpin the workspace. Refresh and verify it.",
    "Workboard installation mismatch; use the manifest plugin ID":
      "The Workboard installation ID does not match. Use the manifest plugin ID.",
    "Paseo did not provide its plugin API":
      "Paseo did not provide its plugin API. Reopen Workboard.",
    "Workboard stopped": "Workboard has stopped. Reopen it.",
    "Task no longer exists": "The task no longer exists. Refresh first.",
    "Workboard storage belongs to another Paseo host":
      "Stored data belongs to another Paseo host and cannot be changed here.",
    "Paseo disconnected during refresh":
      "Paseo disconnected while refreshing. Retry the connection.",
    "Settings changed; refresh before saving":
      "Settings changed. Refresh before saving.",
    "Groups cannot be reordered here": "Reorder groups on the board.",
    "Group order changed; refresh before saving":
      "Group order changed. Refresh before saving.",
    "A workspace binding still uses this group; finish binding first":
      "A binding still uses this group. Finish or cancel it first.",
    "Move the drafts out before deleting this group or changing its type":
      "Move drafts out before deleting the group or changing its type.",
    "Workspaces changed; refresh before deleting a group":
      "Workspaces changed. Refresh before deleting the group.",
    "Paseo is disconnected": "Paseo is disconnected. Retry the connection.",
    "Choose a To do group for a new draft":
      "Choose a To do group for the new draft.",
    "Group order changed; refresh before reordering":
      "Group order changed. Refresh before reordering.",
    "Group order is invalid": "Group order is invalid. Refresh and retry.",
    "Task is archived": "The task is archived. Open Archive to resolve it.",
    "Workspace priority labels changed; refresh before saving":
      "Workspace priority labels changed. Refresh before saving.",
    "Priority synchronization could not be verified":
      "Priority synchronization could not be verified. Refresh and review.",
    "Binding is pending": "Workspace binding is pending. Try again later.",
    "Priority labels are reserved; choose a different status label":
      "Priority labels are reserved. Choose a different status label.",
    "Priority label is used by a status group; rename its status label first":
      "This priority label is used by a status group. Rename that group's status label first.",
    "Task changed; refresh before saving":
      "The task changed. Refresh before saving.",
    "Task already has a workspace":
      "The task already has a workspace. Refresh first.",
    "Add an In progress group before starting work":
      "Add an In progress group before starting.",
    "Choose a working or completed group for the workspace":
      "Choose a working or terminal group for the workspace.",
    "A previous binding is pending; retry its original target":
      "A previous binding is pending. Retry its original target or cancel it.",
    "Group no longer exists": "The group no longer exists. Refresh first.",
    "Workspace binding is still pending":
      "Workspace binding is pending. Finish or cancel it first.",
    "Start work and bind a workspace first":
      "Start work and bind a workspace first.",
    "Only canceled, unbound drafts can be archived here":
      "Only unbound Canceled drafts can be archived here.",
    "Binding workspace is unavailable":
      "The binding workspace is unavailable. Verify it, then retry or cancel binding.",
    "Workspace is unavailable or archiving":
      "The workspace is unavailable or being archived.",
    "Workspace labels changed; refresh before changing stage":
      "Workspace labels changed; the operation was not applied. Refresh before moving.",
    "Workspace labels changed during synchronization":
      "Workspace labels changed during synchronization. Refresh and verify them.",
    "Label synchronization could not be verified":
      "Label synchronization could not be verified. Refresh and check the result.",
    "Native archive returned no timestamp":
      "The native archive result could not be verified. Open Archive to resolve it.",
    "Native workspace still active after archive response":
      "The workspace remained active after the archive response. Verify its native state.",
    "archive-draft-group-unavailable":
      "The original group type no longer accepts drafts. The archive record is kept.",
    "group-tasks-in-use": "This group still contains tasks. Move them first.",
    "group-default-in-use":
      "This group is a default destination. Change its default group in settings first.",
    "group-default-start-work-invalid":
      "The default Start work group must be an existing In progress group. Choose a different default.",
    "group-default-terminal":
      "The default for unlabeled workspaces cannot be Done or Canceled. Choose a nonterminal default before changing that group's type.",
    "detach-draft-stale":
      "The task changed. Refresh before restoring the draft.",
    "detach-draft-missing":
      "The draft's merge record is no longer present. Refresh first.",
    "detach-draft-id-in-use":
      "Another task uses the original draft ID. Restoration was refused; the merge record is kept.",
    "detach-draft-text-changed":
      "The originally appended text changed or matches more than once. It cannot be removed safely; the merge record is kept.",
    "detach-draft-archived":
      "An archived task cannot restore merged drafts. The merge record is kept.",
    "cancel-binding-missing": "The task has no pending binding.",
    "cancel-binding-changed": "The binding changed. Refresh before canceling.",
    "archive-resolution-stale":
      "The task or archive record changed. Refresh before resolving it.",
    "archive-undo-pending":
      "The workspace is being restored. Wait for the result.",
    "archive-recovery-unavailable":
      "Paseo cannot recover this workspace. Check its project, directory and branch in the native archive page.",
    "Native restore workspace mismatch":
      "The host returned a recovery result for another workspace. Recovery was stopped.",
    "Native restore rejected":
      "Paseo rejected recovery. Check the directory and branch in its native archive page.",
    "archive-undo-unknown":
      "Workspace recovery is not confirmed. Check it in Paseo, then verify recovery here.",
    "archive-resolution-unavailable":
      "The task has no unresolved archive outcome.",
    "archive-group-unavailable":
      "The original group was deleted. Restore its configuration before returning the task to it.",
  },
  bootErrors: {
    "invalid-storage-data":
      "Saved Workboard data cannot be parsed. Contact a maintainer to repair it; automatic retries have stopped.",
    "unsupported-storage-version":
      "The saved data version isn't recognized; automatic retries have stopped. Contact a maintainer about the stored data.",
  },
  confirmArchived: "Confirm archived",
  confirmArchivedConfirm:
    "Confirm “{name}” is actually archived? This keeps the archive record; the task stays on this page.",
  restoreTask: "Restore to board",
  restoreTaskConfirm:
    "Restore “{name}” to the board? This clears the archive record and returns the task to its group. It does not restore the native workspace or directory.",
  cancelBinding: "Cancel binding",
  cancelBindingConfirm:
    "Cancel the binding for “{name}”? The previous create-or-link operation did not finish; canceling lets you choose another action. Any created or linked workspace is kept.",
  cancelBindingBusy:
    "The binding operation is still running. Try again shortly.",
};

export const strings = (language: Language) => (language === "en" ? en : zh);
export function groupTitle(
  group: Group,
  t: ReturnType<typeof strings>,
): string {
  return group.name ?? t.stages[group.kind];
}
export function stageTitle(
  stage: string,
  groups: readonly Group[],
  t: ReturnType<typeof strings>,
): string {
  if (stage === "conflict") return t.conflict;
  const group = groups.find((group) => group.id === stage);
  return group ? groupTitle(group, t) : stage;
}
