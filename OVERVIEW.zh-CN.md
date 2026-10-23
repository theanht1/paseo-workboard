# Workboard

Workboard 将活跃的 Paseo workspace 和尚未关联 workspace 的想法放在任务看板与分组列表中。一个活跃 workspace 对应一个任务；只有标题的草稿在创建或关联 workspace 前不占用 workspace。任务状态由你决定，Agent 完成一轮回复不会自动将任务标为已完成。

移动任务会更新其受管理的 Paseo 状态标签；在 Paseo 中修改这些标签也会更新看板，普通标签保持不变。可选的状态标签互斥功能可在识别出新状态时移除旧标签，无法判断最新状态的冲突仍需手动处理。看板与列表共享任务、筛选和保存的排序。可按项目、待关注状态、Agent 活动、PR/MR 条件或最后对话日期筛选。PR/MR 与 CI 信息由 Paseo 提供，Workboard 不单独查询代码托管平台。客户端连接多台运行 Workboard 的 host 时，看板会合并它们的任务，并将每次修改写回任务所属 host；在设置中选择分组主机后，Paseo 打开期间其它 host 会镜像其分组。

设置中可以调整分组及默认值、将进行中的 workspace 置顶到侧边栏，或启用自动归档。自动归档默认关闭。启用后，插件等待最后一次可证明的对话超过配置期限，并在调用 Paseo 原生归档前检查 Agent、terminal、对话和 Git 状态。原生归档可能停止 Agent 和 terminal、移除托管 worktree；移除后 Workboard 无法将其恢复。

Workboard 需要 Paseo 0.11.0 或更高版本。daemon 端复用所选宿主的 Paseo 登录会话，读取 workspace、标签、对话证据及 Git 安全状态，保存任务设置，并执行请求的宿主操作。视图偏好与筛选条件按宿主保存在客户端本地。开始任务不会创建 Agent 或发送 prompt。插件在 daemon 宿主上以受信任代码运行。已验证宿主及限制见[验证记录](https://github.com/fxbing/paseo-workboard/blob/main/docs/zh-CN/verification.md)；设置与完整用法见 [README](README.zh-CN.md) 和[使用指南](https://github.com/fxbing/paseo-workboard/blob/main/docs/zh-CN/user-guide.md)。
