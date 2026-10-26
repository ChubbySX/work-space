# Personal Website Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `personal-website` 专属技能，让 agent 接管个人网站「内容归位 → 构建预览 → 发布上线」全流程中所有需要人判断的环节。

**Architecture:** 单技能 `personal-website`（DSH local skill，存 `DSH_HOME/skills/`）。技能 body 是三阶段工作流指令（非可执行代码），模型照它判断分类、调用现有脚本、在发布前停下确认。**不重写任何现有脚本**——技能只调用它们。

**Tech Stack:** DSH skill（markdown body + `create_skill` 工具）；被调用的现有工具 `tools/make_posters.py` / `tools/make_thumbs.py` / `tools/analyze_and_record.js` / `tools/bump_publish.py` / `build.js`；DSH python/node runtime。

**Spec:** `docs/superpowers/specs/2026-10-26-personal-website-agent-design.md`

## Global Constraints

- 项目根 `D:\DS harnessw\work station\personal-website`，git branch `main`，remote `origin`。
- DSH python：`C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（不存在则回落 `python`）。
- DSH node：`C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（不存在则回落 `node`）。
- 预览端口 `8367`（`http://127.0.0.1:8367`）。
- 版本号 `a.b.c.d`；`build.js` 做 `c+1, d+1`；`bump_publish.py` 做 `b+1, c=0, d-1`（还原 build 的 `d+1`）；一次发布的净效果 = `b+1, c→0, d 不变`。
- 发布内容 commit message：`更新内容 <yyyy-MM-dd_HHmm>`（TS 由 `Get-Date -Format yyyy-MM-dd_HHmm` 取）；版本号 commit message：`发布版本号更新`。
- push：`git push origin main`，最多 3 次重试，间隔 3s。
- 发布失败回滚：`copy .bak` 回 `changelog.json`/`version.json` → `del .bak` → `git reset --mixed HEAD~1` → `build.js` 重建 → 报告「未记录更新历史，版本号未变」，不重推。
- **构建阶段不碰 git；发布 push 前必须停下让 Chubby 确认。**
- 不重写现有脚本。

## Review Focus

1. **模糊分类**（既像日常又像作品）→ 应默认 `daily/` 并在告知时说明「如属作品请移过去」。→ Task 3 边界图验证。
2. **同名文件冲突**（归位目标已存在同名文件）→ 不静默覆盖，询问或加后缀。→ Task 1 body 含规则 + Task 3 同名验证。
3. **make_posters 的 ffmpeg 全缺失**（`tools/ffmpeg.exe` + `imageio_ffmpeg` + PATH 都失败）→ 报告该视频无封面，不阻断构建。→ Task 1 body 含降级 + Task 3 无新视频时 no-op 验证。
4. **push 失败后状态**（网络/git 凭证）→ 回滚后报告，不擅自重推。→ Task 1 body 逐字含 bat [7] 回滚步骤 + Task 4 dry-run 不真 push（以 body 校验为准）。
5. **一组图做相册的子文件夹命名** → 用相册主题做文件夹名，仿现有 `我的小玩具们`/`不爱出门的旅游` 风格。→ Task 1 body 含规则 + Task 3 相册验证。

## File Structure

- **Create** `docs/superpowers/skills/personal-website.skill.md` — 技能 body 源文件（版本控制，可重建 skill；`create_skill` 的 body 取自它）。
- **Register** `DSH_HOME/skills/personal-website`（via `create_skill`，跨会话留存；与 superpower 插件包技能区分）。
- 不修改任何现有脚本/站点文件。验证用 `content/` 现有素材，测试产物可删。

---

### Task 1: 编写技能 body 源文件

**Files:**
- Create: `docs/superpowers/skills/personal-website.skill.md`

**Interfaces:**
- Produces: 技能 body 文本（供 Task 2 `create_skill` 的 `body` 参数 + Task 3/4 的行为校验对象）。

- [ ] **Step 1: 编写 body，必含以下章节与确切值**

写指令式 prose 围绕这些确决策（implementer 写措辞，但下列值/命令/规则必须逐字出现）：

**§触发/路由** — 复用 spec §4.1 的 description：「当用户要更新或发布个人网站、往网站加照片或视频、改网站内容或 profile、提到 chubbysx 主页/构建网站/发布上线/预览网站时加载本技能。」

**§阶段1 内容归位** —
- classify 启发式：`daily/` = 生活/旅游/玩具/美食/校园日记/工作日记；`works/{video|image|doc}/` = 建模渲染/完成度高的创作/正式作品；模糊时默认 `daily/` 并告知「如属作品请移过去」。
- 命名：可选日期前缀 `yyyy-MM-dd 标题.ext`；视频 → `works/video/`；一组图做相册 → 建子文件夹，名用相册主题、仿 `我的小玩具们` 风格。
- 同名冲突：不静默覆盖，询问 Chubby 或加 `_2` 后缀。
- 写同名 `.txt`：一句话说明 + 标签（如 `#机械 #建模`）。
- 归位后明确告知「放在 `daily/xxx/`，叫 `yyy.jpg`，说明是 `…`」；可纠错。

**§阶段2 构建预览** — 确切命令（用 DSH `PY`/`NODE`）：
- `"%PY%" tools\make_posters.py` → `"%PY%" tools\make_thumbs.py` → `"%NODE%" build.js`
- `make_posters` 无新视频时为 no-op，不得报错；ffmpeg 全失败时报告该视频无封面，不阻断构建。
- 完成后告知 `http://127.0.0.1:8367`。**不碰 git**。

**§阶段3 发布** — 确切序列：
1. 若阶段2未跑或有新内容 → 先跑阶段2。
2. `git add .`
3. `copy /Y content\changelog.json content\changelog.json.bak` + `copy /Y content\version.json content\version.json.bak`
4. `"%NODE%" tools\analyze_and_record.js`
5. `"%NODE%" build.js`（`c+1, d+1`）
6. **🔴 STOP** 展示给 Chubby：`git diff --cached --name-status` 清单 + `changelog.json` 顶部摘要 + `version.json` 当前值 + `bump_publish` 将做 `b+1, c=0, d-1`。**等确认。**
7. 确认后：`git commit -m "更新内容 <TS>"` → `git push origin main`（3 次重试，间隔 3s）。
8. push 成功 → `"%PY%" tools\bump_publish.py` → `git add .` → `git commit -m "发布版本号更新"` → `git push origin main`（3 次重试）。

**§失败处理** — 逐字沿用 bat [7]/[8]：
- 构建（make_posters/make_thumbs/build.js）任一失败 → 停下报错，不进入发布。
- push 3 次失败 → `copy .bak` 回 changelog/version + `del .bak` + `git reset --mixed HEAD~1` + `build.js` 重建 + 报告「未记录更新历史，版本号未变」，**不重推**。
- 版本号 push 失败 → 报告「内容已上传、版本号未同步」，不静默。

**§运行时** — `PY`/`NODE` 路径与回落（见 Global Constraints）。

- [ ] **Step 2: grep 校验 body 含全部必需关键字**

Run（项目根下）:
```
pwsh -c "$b = Get-Content 'docs/superpowers/skills/personal-website.skill.md' -Raw; @('make_posters.py','make_thumbs.py','analyze_and_record.js','bump_publish.py','build.js','git reset --mixed HEAD~1','更新内容','发布版本号更新','b+1','c=0','d-1','STOP','daily','works','如属作品请移','不静默覆盖','8367') | ForEach-Object { '{0}: {1}' -f $_, ($b -match [regex]::Escape($_)) }"
```
Expected: 每行 `: True`。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/skills/personal-website.skill.md
git commit -m "docs: 编写 personal-website 技能 body 源文件"
```

---

### Task 2: 注册技能 + 加载验证

**Files:**
- Register: `DSH_HOME/skills/personal-website`（via `create_skill`）

**Interfaces:**
- Consumes: Task 1 body 文本。

- [ ] **Step 1: 用 create_skill 注册**

调用 `create_skill`，参数：
- `name` = `personal-website`
- `description` = spec §4.1 description 原文
- `body` = `docs/superpowers/skills/personal-website.skill.md` 内容

- [ ] **Step 2: 验证注册成功**

Run:
```
pwsh -c "Test-Path (Join-Path $env:DSH_HOME 'skills/personal-website')"
```
Expected: `True`（或 create_skill 返回的成功确认）。

- [ ] **Step 3: 加载验证**

本回合尝试调用 `skill(name='personal-website')`。若 DSH 按回合重扫技能则立即加载成功；若 `available_skills` 列表在会话启动时注入、本回合未刷新，则记下「下一回合验证其出现在 available_skills」，并在下一个 continuation 回合确认。
Expected: skill 可加载（本回合或下一回合）。

---

### Task 3: 归位 + 构建 实跑验证

**Files:**
- 用 `content/` 现有素材；测试产物（复制的新图）可删可留。

**Interfaces:**
- Consumes: Task 2 已注册技能。

- [ ] **Step 1: 选一张现有图模拟「发图」**

挑 `content/daily/` 下任一子文件夹的一张图，复制为测试新条目（如 `content/daily/工作日记/test-agent-001.jpg`）。

- [ ] **Step 2: 走阶段1，验证 classify + 归位 + .txt**

agent 判断分类、归位、写同名 `.txt`。验证：归位路径合理、`.txt` 生成、告知文案含「放在哪/叫什么/说明」。

- [ ] **Step 3: 边界图验证模糊分类（Review Focus #1）**

挑一张既像日常又像作品的图，验证：默认归 `daily/` + 告知「如属作品请移过去」。

- [ ] **Step 4: 同名冲突验证（Review Focus #2）**

把测试图复制成与目标已有文件同名，验证：不静默覆盖（加后缀或询问）。

- [ ] **Step 5: 相册子文件夹命名验证（Review Focus #5）**

选一个现有 daily 子文件夹（如 `我的小玩具们`），验证 body 指示的命名风格与之一致。

- [ ] **Step 6: 走阶段2 构建**

Run（项目根，`PY`/`NODE` 取 Global Constraints 路径）:
```
& $PY tools\make_posters.py
& $PY tools\make_thumbs.py
& $NODE build.js
```

- [ ] **Step 7: 验证构建产物**

Run:
```
pwsh -c "$d = Get-Content 'js/data.js' -Raw; ($d -match 'window\.SITE_DATA') -and (git status --porcelain | Select-String 'js/data.js')"
```
Expected: `True`（data.js 含 `window.SITE_DATA=`）；make_posters 无新视频时 no-op 无 stderr 报错。

- [ ] **Step 8: 清理测试产物**

删 `test-agent-001.*` 测试文件；`git checkout -- js/data.js` 还原构建对 data.js 的改动（构建阶段不碰 git 的体现）。或若 Chubby 愿留作真实内容则跳过。

---

### Task 4: 发布 dry-run 验证

**Files:**
- 临时 mutate `content/changelog.json` / `content/version.json`（`.bak` 保护，验完还原）。

**Interfaces:**
- Consumes: Task 3 留下的可暂存内容（若 Step 8 未删测试图）。

- [ ] **Step 1: 暂存 + 备份**

Run:
```
git add .
Copy-Item content\changelog.json content\changelog.json.bak -Force
Copy-Item content\version.json content\version.json.bak -Force
```

- [ ] **Step 2: 生成 changelog + 构建**

Run:
```
& $NODE tools\analyze_and_record.js
& $NODE build.js
```

- [ ] **Step 3: 🔴 STOP 展示确认面板**

展示给 Chubby（不执行 commit/push）:
- `git diff --cached --name-status` 清单
- `content/changelog.json` 顶部条目摘要
- `content/version.json` 当前值 + `bump_publish` 将做 `b+1, c=0, d-1`（净 `b+1, c→0, d 不变`）

- [ ] **Step 4: 验证未发生 commit/push**

Run:
```
pwsh -c "$before = (git log --oneline -1); Write-Output $before; git status --porcelain"
```
Expected: `git log` 顶端与 dry-run 前一致（无新 commit）；`git status` 仍有 staged/working 改动（未 push）。

- [ ] **Step 5: 还原到 dry-run 前状态**

Run:
```
Copy-Item content\changelog.json.bak content\changelog.json -Force
Copy-Item content\version.json.bak content\version.json -Force
Remove-Item content\changelog.json.bak, content\version.json.bak -Force
git reset
& $NODE build.js
```

- [ ] **Step 6: 验证 git 干净**

Run: `git status --porcelain`
Expected: 与 Task 4 开始前一致（无遗留 staged/`.bak`）。

---

## Self-Review（已完成）

- **Spec 覆盖**：§4.1 定位→Task 1/2；§5.1 归位→Task 1 body + Task 3 验证；§5.2 构建→Task 1 body + Task 3；§5.3 发布→Task 1 body + Task 4；§6 失败→Task 1 body；§7 验证→Task 3/4；§8 非目标→Global Constraints「不重写脚本」+ 发布必由 Chubby 触发。全覆盖。
- **Step 粒度**：每步一个可检查动作，无 TBD/「处理边界」空话。
- **类型/命名一致**：`personal-website` 全程一致；脚本名与 bat 一致。
- **Review Focus**：5 条均 pin 到 Task 1 body 规则 + Task 3/4 验证。
- **比例**：plan 与 spec 长度相当，body 的确切值是「implementer 不能自决的决策」故列出，其余措辞留给 implementer。
