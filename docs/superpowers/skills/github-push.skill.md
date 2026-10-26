# github-push

> 让 `git push` 到 GitHub 高成功率。根因是 `github.com:443` 的**间歇性 SNI 封锁**（TLS ClientHello 带 SNI=github.com 被拦；不是配置 / 认证问题）——发布前先探活，通了再推、不通等 / 重试。**不做回滚**（回滚是调用方发布流程的职责）。

## 触发 / 路由

当要 `git push` 到 github.com 远端、发布前推送、或被其它发布流程（如 personal-website 技能 stage 3）调用时加载本技能。只处理「把本地 commit 推到 github.com 远端」这一件事的可靠性。

## 运行时

- PowerShell（探活用 `Test-NetConnection`，pwsh 专属；Windows 环境）。
- 工作目录 = 调用方的 git 仓库根（不切目录）。
- 当前分支由 `git rev-parse --abbrev-ref HEAD` 自动取得，推 `origin <分支>`。

## 流程

把推送当成「探活 → 推」的循环，**最多 3 次「推」尝试**：

1. **探活**（最多 5 轮，每轮间隔 30s，~2.5min 上限）：
   - `Test-NetConnection -ComputerName github.com -Port 443 -WarningAction SilentlyContinue`，看 `.TcpTestSucceeded`。
   - 通 → 进入第 2 步。
   - 不通 → 报告「443 不通（疑似 SNI 封锁），第 N/5 轮，等 30s 重探」；5 轮全不通 → **返回失败**（443 持续封锁，不强行推、不自动切 SSH / 代理）。
2. **推**：
   - 设环境变量 fail-fast：`GIT_HTTP_LOW_SPEED_LIMIT=1000`、`GIT_HTTP_LOW_SPEED_TIME=20`（卡住即断，不等死连接）。
   - `git push origin <分支>`（捕获 stderr）。
   - exit 0 → **返回成功**。
   - 失败 → 报告「第 N/3 次推送失败：<stderr 关键行>」，回到第 1 步（重新探活）。
3. 3 次「推」全失败 → **返回失败**。

## 返回与报告

- **成功**：返回成功 + 实际推送范围（如 `b626073..b7c5a40 main -> main`）。
- **失败**：返回失败 + 卡在哪一步（探活耗尽 / push 失败）、探活最后结果、push 错误文本。**交给调用方决定后续**（发布流程会据此回滚）。
- **不做回滚、不撤销 commit、不碰 changelog / version**——那些是发布流程的职责。

## 约束

- 只探 `github.com:443`；不自动切 SSH（22）或 HTTP 代理——用户若长期不通，可手动 `git config http.proxy ...` 或换 SSH 远端（见下方备注）。
- 不做回滚 / 不撤销已做的 commit。
- 不改远端地址、不动 credential。
- 默认 5 轮探活 × 30s / 3 次推送可调（调用方可缩短 / 加长）。

## 备注（手动兜底，不自动执行）

- **443 长期不通**：可配 `git config --global http.proxy http://127.0.0.1:7890`（换成你的代理端口），或临时 `git -c http.proxy=... push`。
- **换 SSH**：远端改 `git@github.com:<user>/<repo>.git`（走 22 端口，绕过 443 SNI）；需 SSH key 已加到 GitHub 且（若 key 带 passphrase）ssh-agent 已装载。
- **直 IP 绕 SNI**：`hosts` 写 `20.205.243.166 github.com`（IP 会变，不推荐长期用）。
