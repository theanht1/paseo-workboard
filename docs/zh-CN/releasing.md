# 发布

[English](../releasing.md) · [README](../../README.zh-CN.md)

一次发布对应一个带 tag 的源码快照，以及公开的升级说明：

| 记录     | 位置                          | 作用                   |
| -------- | ----------------------------- | ---------------------- |
| 源码标签 | 发布提交上的 Git tag `vX.Y.Z` | 指向不可变的源码       |
| 升级记录 | 该 tag 的 GitHub Release      | 相对上一版本的升级说明 |

按 README 的说明，用户从默认分支安装。Release 不会改变该安装命令解析到的内容；它标记一个已审阅的快照，并附带该快照的说明。仓库不保存更新日志，因此 [GitHub Releases](https://github.com/fxbing/paseo-workboard/releases) 是唯一的升级记录。

把本项目的包发布到 npm 不属于当前发布流程。`npm pack` 只用于生成本地验证产物，`npm run check:package` 只检查其内容，两者都不会发布。`package.json` 中的 `publishConfig` 和 `prepublishOnly` 仅作为包配置保留，不使发布成为流程的一部分。

## 发布包约定

Paseo 加载 TypeScript 客户端/服务端入口及相对模块，所有外部运行时依赖由 Paseo 或 Node 提供。开发依赖保留在 `devDependencies`，无需 manifest 构建命令或编译后的分发目录。参见 [Paseo 发布指南](https://paseo.sh/docs/plugins/publishing)。

打包内容包含 manifest、入口、`client/`、`server/`、`shared/`、中英文 README、两份 `OVERVIEW`、`images/`（图标、截图和 GIF）以及 MIT 许可证。测试、开发脚本、daemon 数据、日志、凭证与 `node_modules` 不进入发布包。paseo-tui 入口（`index.tui.ts`、`tui/`）同样不进入发布包：Paseo 不加载它，终端用户在源码检出中运行 `npm run build:tui` 构建 `dist/tui.js`。

`npm run check:package` 检查包身份/版本、manifest 最低版本、Cafe 提取所需 README 标题、完整文件清单、README 相对链接目标、引用素材的文件签名和图标尺寸。CI 执行这些检查并生成可下载的 tarball 供审查，CI 中不存在任何发布动作。

## 准备并验证候选版本

1. 同步更新 `package.json` 与 `package-lock.json`。每次发布变更都使用新的正式语义版本；保持中英文文档一致。
2. `requirements.paseo` 应设置预期的最低版本；扩大范围前在当前目标宿主运行集成测试。内部桥接校验响应结构，但无法保证后续 Paseo 版本始终兼容。
3. 在干净 checkout 中运行：

   ```sh
   npm ci
   npm run check
   npm run format:check
   npm run check:package
   WORKBOARD_VERSION="$(node -p "require('./package.json').version")"
   WORKBOARD_RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workboard-release.XXXXXX")"
   npm pack --pack-destination "$WORKBOARD_RELEASE_DIR"
   ```

4. 按[隔离集成测试指南](../../tests/integration/README.zh-CN.md)启动带标记的临时 Paseo home。将生成的包解压到另一个临时目录，并安装到隔离 daemon；不要给解压包安装开发依赖：

   ```sh
   WORKBOARD_PACKAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workboard-package.XXXXXX")"
   tar -xzf "$WORKBOARD_RELEASE_DIR/paseo-workboard-$WORKBOARD_VERSION.tgz" -C "$WORKBOARD_PACKAGE_DIR"
   paseo plugin install "$WORKBOARD_PACKAGE_DIR/package" --home "$WORKBOARD_INTEGRATION_HOME"
   paseo plugin ls --home "$WORKBOARD_INTEGRATION_HOME" --json
   npm run test:integration
   ```

   要求插件 `running`、看板已连接且集成测试通过；视觉行为仅用虚构任务检查。先停止隔离 daemon，再删除其 home 和解压包。

5. 审阅 tarball 与 Git diff，排除本机数据。本地通过不代表 GitHub Actions 已成功、tag 或 Release 已创建；这些结果都要在实际执行时到对应位置确认。

## 审批边界

先在本地准备并验证，提交版本号、完整发布说明、兼容性变化、tarball 校验值及发布目标供用户确认。批准前不得 push 源码、创建 tag 或 GitHub Release、提交目录变更。已批准公开内容发生实质变化时需要重新审阅。新建 Release 不能代替上述检查，必须验证要打 tag 的那个修订。

在请求批准前就写好发布说明，使批准覆盖最终要发布的文本。说明保存在仓库之外的临时文件中，写入完整正文，并与校验值和发布目标放在同一次请求里：

```sh
WORKBOARD_NOTES="$(mktemp "${TMPDIR:-/tmp}/workboard-notes.XXXXXX")"
"${EDITOR:-vi}" "$WORKBOARD_NOTES"
test -s "$WORKBOARD_NOTES" || echo "说明为空"
```

该文件的内容就是下面第 2 步要发布的正文。在说明及其余请求内容获得批准前，不要创建 tag 或 Release。

## 发布 tag 与 GitHub Release

发布需要目标 GitHub 仓库的推送权限；仓库不保存发布凭证。只有上面已写好并经批准的说明就位后才执行发布。

1. 核对 README 安装说明，然后将已验证的源码放到公开仓库默认分支。只能从已审阅、已合并的提交发布。打 tag 前验证该修订，并核对待上传 tarball 中的包文件与其一致。如果合并改变了这些文件，从合并后的修订重新执行候选验证和打包。如果最终包内容或校验值与已批准的产物不同，重新展示最终产物并取得批准后，再打 tag 或上传。
2. 在该合并提交上创建 annotated tag 和 GitHub Release。tag `vX.Y.Z` 必须与 `package.json` 一致；Release 正文就是已批准的升级记录，只写上一版本用户需要知道的内容：

   ```sh
   test -s "$WORKBOARD_NOTES" || { echo "已批准的说明为空或不存在"; exit 1; }
   git tag -a "v$WORKBOARD_VERSION" -m "paseo-workboard $WORKBOARD_VERSION"
   git push origin "v$WORKBOARD_VERSION"
   gh release create "v$WORKBOARD_VERSION" \
     "$WORKBOARD_RELEASE_DIR/paseo-workboard-$WORKBOARD_VERSION.tgz" \
     --title "paseo-workboard $WORKBOARD_VERSION" \
     --notes-file "$WORKBOARD_NOTES"
   ```

   这些命令只使用已有变量，绝不在其中创建说明文件。正文先写用户可感知的变化，再写行为变化、兼容性变化（如新的 `requirements.paseo` 最低版本）和已知限制，并遵循与其它文档相同的虚构示例规则。不要向仓库添加说明文件；不要附加日志、本机路径或未审阅的二进制文件，唯一附件是打包好的 tarball。Release 创建后删除该临时说明文件。

3. 确认 tag 指向已审阅的提交，且 Release 显示的版本、标题和说明正确。不要移动或删除已发布的 tag；说明写错时直接编辑 Release，tag 指向的源码有误时修复后发布新版本。
4. 不要将发布说明、更新日志或验证记录加入仓库。

## 目录收录

目录收录更新独立于本仓库的发布流程：发布流程不包含它们，GitHub Release 也不会自动更新已有的 npm 来源目录页面。

[_paseo-cafe.json_](../paseo-cafe.json)只保存准备好的收录元数据：分类、平台与 caveats。它仅作参考；放在仓库中不会产生注册，也不属于 GitHub Release。

保持在包内 `OVERVIEW.md`、`OVERVIEW.zh-CN.md`、manifest 图标与 media 路径及素材准确。

Cafe 从英文 README 提取安装和限制内容，因此保留 `## Installation`、`## Limitations` 标题。`images/` 下的截图和演示视频为可选项；使用真实产品画面及公开或虚构数据。
