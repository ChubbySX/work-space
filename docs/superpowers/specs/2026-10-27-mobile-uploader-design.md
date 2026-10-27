# 移动上传器 + 桥接 → personal-website 技能 设计

日期：2026-10-27  
状态：设计（待评审）

## 1. 背景

用户（钟智轩）希望在手机上选图/拍照 → 自动到达 PC 上的 DSH 会话 → 由 personal-website 技能接管归位、压缩、构建，再由用户触发发布上线。当前 personal-website 技能已成熟（归位+压缩+构建+发布+github-push GUI），但素材只能通过对话附件或本地路径提供——手机不在对话回路里。

## 2. 现状盘点

- **personal-website 技能**（live at `DSH_HOME/skills/personal-website`）：阶段1 归位（classify→定名→压缩→归位→txt）、阶段2 构建（make_posters→make_thumbs→build.js）、阶段3 发布（git add→analyze→build→STOP→commit→github-push GUI→bump→version push）。素材来源 = 对话附件 / 本地路径。
- **压缩脚本**（compress_image.py / compress_video.ps1）在 work station（仓库外），非破坏（待压缩→已压缩）。
- **github-push GUI**（`tools/github-push-gui.ps1`）：探活 443 + 推送 + 右上角状态小窗（✕停止、DPI、10轮×30s、失败总结）。
- **DSH 平台**：Electron 应用；agent 通信走 ACP（Agent Client Protocol，见 §3 ④）。

## 3. 决策（用户选定）

- **① agent 方向**：不做一个新 agent，做成「移动上传器 + 桥接」喂给现有 personal-website 技能。
- **② 网络**：主 LAN（家里同 WiFi）+ 副隧道（随时随地，Tailscale / 自建中继，实现时探国内 GFW 可行性）。
- **③ app 范围**：A 最小上传器（PWA：选图/拍照→POST→显示已收到→装主屏）。富 app（B）否决。
- **④ 触发**：先探 DSH 消息注入 API（实时最佳）；探查结论见下 → 不可行 → fallback ① 手动（用户聊天说"处理待上传"，零空轮询、不依赖 DSH 内部、最稳）。

### ④ 探查结论（证据）

DSH 源码在 174MB `app.asar`（打包）。解析其 asar 文件头得知 agent 通信走 `@agentclientprotocol/sdk`（ACP）：

- `AcpServer` 类（`server.js`）：注释 "ACP server transport for Streamable HTTP and WebSocket connections"。
- `handleRequest` 走 POST/GET/DELETE，但要求 `HEADER_SESSION_ID` / `HEADER_CONNECTION_ID`；底层是 JSON-RPC（`jsonrpc.js`、`AGENT_METHODS`、`isInitializeRequest`）+ WebSocket 升级（`prepareWebSocketUpgrade`、`Acp-Connection-Id`）。

即：**没有简单的 REST「POST /message 注入」端点**。要外部触发 agent，须实现完整 ACP 客户端（初始化会话 → 说 JSON-RPC `AGENT_METHODS` → 处理鉴权 / session-id）——重大子工程且强耦合 DSH 内部、脆弱（DSH 升级即可能坏）。→ **④-③ 不可行**（作为干净触发）。**采用 ④-① 手动触发**。ACP 客户端列为后续优化。

## 4. 架构

```
手机 PWA app ──(HTTP POST /upload, Bearer token)──> PC 桥接服务(Node, http 模块)
                                                        │ 写 待上传/<ts>_<安全名>.jpg
                                                        │ 追加 待上传/_inbox.json
                                                        ▼
                                                 待上传/ + _inbox.json（累积）
                                                        │
                              [手动触发: 用户聊天说"处理待上传"]
                                                        ▼
                            DSH 会话跑 personal-website 技能
                              阶段1: 读 _inbox.json 批次 → classify → 压缩 → 归位 → txt
                              阶段2: make_posters / make_thumbs / build.js
                              → 聊天报结果（归位明细 + 压缩比 + 预览 8367）
                                                        │
                              [用户触发发布] → 阶段3 → github-push GUI
```

## 5. 组件

### 5.1 PWA app（手机）
- 单页 HTML+JS（装主屏即 PWA，最小 manifest）。
- `<input type=file accept=image/* capture multiple>` 选图/拍照，多选。
- `POST multipart/form-data` 到桥接 `/upload`，带 `Authorization: Bearer <token>`。
- 显示已收到列表（文件名 / 大小 / 状态 pending|ok|fail）+ 失败重试按钮。
- 配置：桥接地址（LAN IP 或隧道域名）+ token（app 里填一次，存 localStorage）。

### 5.2 桥接服务（PC，Node）
- 用 DSH node.exe（`C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）跑一个 HTTP server（纯 `http` 模块，零外部依赖）。
- `POST /upload`（multipart，Bearer token）：解析文件 → 写 `D:\DS harnessw\work station\待上传\<ts>_<安全名>.jpg`（**不动** `待压缩/`、`已压缩/`——那是压缩脚本的暂存区）→ 追加 `待上传/_inbox.json`（`{id, file, origName, ts, status:"pending"}`）→ 返回 `{ok, id}`。`<安全名>` = 原名去特殊字符 + 时间戳前缀，防覆盖。
- `GET /status`：返回待上传文件数 + `_inbox.json` 摘要（pending/ok/fail 计数）。
- 绑定：主 LAN IP（如 `192.168.x.x:8390`）+ 副隧道（同端口经隧道暴露）。
- token 鉴权（共享密钥，存 `D:\DS harnessw\work station\待上传\_bridge_config.json`：`{token, bindPort, uploadRoot}`）。
- **不碰 git、不碰 content/、不调 DSH**——只存文件 + 写清单。

### 5.3 触发（④-① 手动）
- 用户在 DSH 聊天里说"处理待上传"（或类似）。
- personal-website 技能阶段1 增"从 `待上传/_inbox.json` 读批次"路径：读清单 → 对每个 pending 项走 classify→压缩→归位→txt → 标记 processed/failed → 报告。
- 零空轮询（不主动检查，只在用户说时跑）。

### 5.4 技能适配（personal-website 阶段1）
- 在阶段1「接收素材」增加：若用户说"处理待上传"（或 `待上传/_inbox.json` 存在且有 pending），从 `D:\DS harnessw\work station\待上传\_inbox.json` 读批次，逐项处理（同对话附件路径：classify→定名→压缩→归位→txt），处理完更新清单 `status`。
- 不改阶段2/3（构建+发布不变）。

## 6. 数据流

1. 手机选图 → POST `/upload` → 桥接存 `待上传/<ts>_<名>.jpg` + `_inbox.json` 追加（status=pending）。
2. （可累积多次上传。）
3. 用户聊天"处理待上传" → 技能读 `_inbox.json` → 逐项 classify→压缩→归位→txt → 更新清单 status=processed/failed。
4. 技能跑阶段2 构建 → 聊天报结果（归位明细 + 压缩比 + 预览 8367）。
5. 用户说"发布" → 阶段3 → github-push GUI。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 上传失败（网络） | app 重试；桥接未收到则不写清单 |
| 桥接存盘失败 | 返回 500；app 重试 |
| token 错误 / 缺失 | 401；app 提示检查配置 |
| 压缩失败（文件损坏） | 清单标 failed + 技能报 stderr 关键行；不阻断其它项 |
| 同名冲突 | 技能阶段1 既定规则（加 `_2` 后缀，不静默覆盖） |
| 发布失败 | github-push GUI（已有：✕停止 + 失败总结） |

## 8. 测试

- `curl POST /upload`（模拟 multipart）→ 验文件落 `待上传/` + `_inbox.json` 追加。
- 清单读写（并发上传不丢项、不串行阻塞）。
- 手机 LAN 访问桥接 + 上传一批测试图。
- 技能读 `_inbox.json` 批次 → 归位+压缩+构建 → 验 `data.js` 含新内容。
- 隧道（若探）：手机经隧道上传 → 同。
- 安全：token 错误 → 401；无 token → 不写。

## 9. 非目标

- 不做实时触发（④-③ ACP 注入，后续）。
- 不做富 app（编辑 / 分类 / 发布全在 app 里——否决；app 只上传）。
- 不碰 DSH 内部（不实现 ACP 客户端、不改 DSH 源）。
- 不改 personal-website 阶段2/3（构建 + 发布不变）。
- 不做云存储（文件只存本地 PC）。

## 10. 后续

- 隧道实现（Tailscale 国内可行性 / 自建中继 frp 类）。
- ④-③ 实时触发（若需要：实现 ACP 客户端，或 DSH 将来暴露 webhook / 官方注入 API）。
- app 增强（视频上传、批量进度、历史）。
