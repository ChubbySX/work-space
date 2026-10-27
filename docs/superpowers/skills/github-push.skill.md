# github-push

> 让 `git push` 到 GitHub 高成功率。根因是 `github.com:443` 的**间歇性 SNI 封锁**（TLS ClientHello 带 SNI=github.com 被拦；不是配置 / 认证问题）——发布前先探活，通了再推、不通等 / 重试。**不做回滚**（回滚是调用方发布流程的职责）。

## 触发 / 路由

当要 `git push` 到 github.com 远端、发布前推送、或被其它发布流程（如 personal-website 技能 stage 3）调用时加载本技能。只处理「把本地 commit 推到 github.com 远端」这一件事的可靠性。

## 运行时

- PowerShell（探活用 `Test-NetConnection`；GUI 用 WinForms；pwsh 专属；Windows 环境）。
- 工作目录 = 调用方的 git 仓库根（不切目录）。
- 当前分支由 `git rev-parse --abbrev-ref HEAD` 自动取得，推 `origin <分支>`。
- 界面脚本 `tools/github-push-gui.ps1`（在调用方仓库 `tools/` 下；WinForms 置顶小窗，深色极简风，钉屏幕右上角）。窗体 **DPI 感知**（原生像素渲染、清晰不糊）、**380×88**、字号 14/10pt，右上角带 **✕ 停止按钮**（点即中止，返回「用户手动停止」）。

## 流程

运行界面脚本（自带探活 + 推送 + 右上角状态窗，每轮刷新文字，不用盯黑窗口）：

```
pwsh -NoProfile -ExecutionPolicy Bypass -File <仓库>\tools\github-push-gui.ps1 -Repo <仓库> [-Branch <分支>] [-DryRun]
```

脚本内部逻辑（探活 → 推 循环，**每轮探活 + 推送一次**）：

1. **探活**（最多 **10 轮，每轮间隔 30s，~5min 上限**）：
   - `Test-NetConnection github.com:443`，看 `.TcpTestSucceeded`；窗显示「第 N/10 轮 · 443 不通 · 已用 M:SS」。
   - 通 → 进入第 2 步。
   - 不通 → 等 30s 重探；10 轮全不通 → **返回失败**（443 持续封锁，不强行推、不自动切 SSH / 代理）。
2. **推**（窗显示「推送中… · 第 N 轮推送」）：
   - 设 fail-fast env：`GIT_HTTP_LOW_SPEED_LIMIT=1000`、`GIT_HTTP_LOW_SPEED_TIME=20`（卡住即断）。
   - `git push origin <分支>`（捕获 stderr）。
   - exit 0 → **返回成功**，窗显示「✅ 推送成功 · 耗时 · 已同步」。
   - 失败 → 窗显示「推送失败 · 重探」，回到第 1 步（重新探活）。
3. **10 轮全失败** → **返回失败**，窗显示「❌ 推送失败」。
4. **用户点 ✕** → 即刻中止，返回失败（「用户手动停止（第 N 轮）」）。

成功 / 失败 / 停止后窗停留 **8 秒自动关**。脚本末行输出 `SUCCESS push=origin/<分支> rounds=N elapsed=M:SS` 或 `FAIL reason=...(含 git 最后报错) rounds=N elapsed=M:SS` 供调用方读取。

## 返回与报告

- **成功**：返回成功 + 实际推送范围（如 `b626073..b7c5a40 main -> main`）。
- **失败**：返回失败 + **原因总结**（443 持续封锁 / 推送失败 exit 码 / 用户手动停止）+ git 最后报错文本（若有）。**交给调用方决定后续**（发布流程会据此回滚）。
- **不做回滚、不撤销 commit、不碰 changelog / version**——那些是发布流程的职责。

## 约束

- 只探 `github.com:443`；不自动切 SSH（22）或 HTTP 代理——用户若长期不通，可手动 `git config http.proxy ...` 或换 SSH 远端（见下方备注）。
- 不做回滚 / 不撤销已做的 commit。
- 不改远端地址、不动 credential。
- 默认 **10 轮 × 30s（~5min）**可调（脚本参数 `-MaxRounds` / `-RoundWait`）。

## 备注（手动兜底，不自动执行）

- **443 长期不通**：可配 `git config --global http.proxy http://127.0.0.1:7890`（换成你的代理端口），或临时 `git -c http.proxy=... push`。
- **换 SSH**：远端改 `git@github.com:<user>/<repo>.git`（走 22 端口，绕过 443 SNI）；需 SSH key 已加到 GitHub 且（若 key 带 passphrase）ssh-agent 已装载。
- **直 IP 绕 SNI**：`hosts` 写 `20.205.243.166 github.com`（IP 会变，不推荐长期用）。
