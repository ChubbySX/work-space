# Personal Website Agent — 设计规格

| 项 | 值 |
|---|---|
| 日期 | 2026-10-26 |
| 作者 | Chubby + DSH agent |
| 状态 | Draft（待 Chubby 审阅） |
| 项目 | personal-website（GitHub Pages: https://chubbysx.github.io/work-space/） |
| 后续 | 审阅通过后转 writing-plans 写实施计划 |

---

## 1. 背景与目标

### 1.1 背景
personal-website 是一个成熟的静态站点流水线，核心玩法是「把文件丢进文件夹 → 双击 `构建网站.bat` → 内容自动上架」。它由三个 `.bat` 脚本驱动（`启动预览.bat` / `构建网站.bat` / `发布上线.bat`），背后是一组 Python/JS 工具（`make_posters.py` / `make_thumbs.py` / `analyze_and_record.js` / `bump_publish.py` / `build.js`）。

这套流水线**非常好用，但它不是 agent**：每一步都是确定性脚本，没有任何「模型在环中判断」的环节。所有需要人判断的事——图片该归到 `daily/` 还是 `works/`、文件起什么名、说明写什么、构建失败了读日志重试、发布前核对——都压在 Chubby 一个人手动操作上。

### 1.2 目标
把这套流水线「agent 化」：让一个专属技能接管所有需要人判断的环节，Chubby 只需在对话里发图、说「发布」。

> Agent 的本质 = 模型自主地判断 / 规划 / 调用工具 / 处理异常 / 跨回合持久化。本技能让模型在「个人网站内容更新」这个场景里承担这些职责。

### 1.3 为什么是「写成专属技能」而不是改脚本
脚本已经够健壮了（发布 bat 自带 3 次重试 + `.bak` 回滚 + `git reset`），不需要重写。缺的是**把人的判断力接进来**——这正是 skill 层的职责：技能 body 给模型一组工作流指令，模型在对话里照着判断、调用现有脚本、在关键点停下确认。

---

## 2. 现状盘点（设计依据）

### 2.1 目录约定（content/）
```
content/
├── profile.json          # 文字控制台（个人简介文本）
├── version.json          # 版本号 a.b.c.d
├── changelog.json        # 更新历史（slice 0,20）
├── chubby-logo.jpg
├── hero-dusk.jpg
├── audio/*.mp3
├── daily/                # 日常：生活照/旅游/玩具/美食/校园日记/工作日记
│   ├── 不爱出门的旅游/
│   ├── 美食就是好吃的意思！/
│   ├── 青岛在青理/
│   ├── 我的小玩具们/
│   ├── 工作日记/
│   └── ...
├── works/                # 作品
│   ├── video/            # 含 .poster.jpg（make_posters 生成）
│   ├── image/
│   └── doc/
└── .thumbs/*.webp        # make_thumbs 生成
```

### 2.2 脚本职责
| 脚本 | 作用 | 关键行为 |
|---|---|---|
| `tools/make_posters.py` | 视频截封面 | 扫 `works/video` + `daily` 找缺 `.poster.jpg` 的视频；ffmpeg `-ss` seek（试 3/1/0.5s）`-frames:v 1 -vf scale=800:-1 -q:v 3`；ffmpeg 解析链 `tools/ffmpeg.exe` → `imageio_ffmpeg` → PATH |
| `tools/make_thumbs.py` | 生成缩略图 | 输出 `.thumbs/*.webp` |
| `build.js` | 扫描内容生成数据 | 扫 `content/` → 生成 `js/data.js`（`window.SITE_DATA=...`） |
| `tools/analyze_and_record.js` | 生成更新日志 | `git diff --cached --name-status` → 分类 daily/video/image/doc/project/profile/code → 提取 diff 模式（CSS 类 `/^+.*?\.([\w-]*)\s*[\{,]/`、JS 函数、HTML 段）→ `git diff --numstat` 统计 → 拼摘要「1.新增日常照…;2.…」→ unshift 进 `changelog.json`（保留 20 条） |
| `tools/bump_publish.py` | 发版号 | 版本 `b+1, c=0, d-1`（还原 build.js 的 `d+1`）；同步写入 `version.json` + `data.json` + `js/data.js`（`re.sub` 替换 `"version"` 字段） |

### 2.3 三个 .bat 的步骤序列（技能要复用的逻辑）
- **构建网站.bat**（3 步）：`make_posters.py` → `make_thumbs.py` → `build.js`
- **发布上线.bat**（8 步）：`make_posters` → `make_thumbs` → `git add` → `analyze_and_record.js`（先备份 changelog/version `.bak`）→ `build.js` → `git commit '更新内容 <TS>'` → `git push origin main`（3 次重试；失败回滚 `.bak` + `git reset --mixed HEAD~1` + 重建，提示「未记录更新历史，版本号未变」）→ `bump_publish.py` → push 版本号（3 次重试；失败则内容已上、版本未同步）
- **启动预览.bat**：`python -m http.server 8367`（DSH python: `C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`），开浏览器

### 2.4 运行时
- Python：优先 DSH runtime（`C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`），回落系统 python
- Node：同理 DSH runtime 优先

---

## 3. 设计决策（brainstorming 澄清结论）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | agent 方向 | 写成**专属技能**（architectural 路径，而非改脚本/搭独立服务） |
| 2 | 发布自主权 | **构建自主**；发布前**停下确认**，等 Chubby 点头再 push |
| 3 | 内容来源/scope | 对话里发图 → agent **归位 + 构建 + 发布**全包（含素材整理） |
| 4 | 归位自主权 | agent **自己判断** daily/works，归位后告诉 Chubby 放哪；错了可纠错 |

技能架构选择：**单技能 `personal-website` + 内部三阶段**（而非「全流程内联」或「拆两个技能」）。理由：单入口易触发（直接解决「技能没看到运用」的旧困惑），内部分三段正好对应现有「构建网站.bat / 发布上线.bat」两段式，「发布前停」自然落在段边界。

---

## 4. 技能架构

### 4.1 技能定位
- **技能名**：`personal-website`（kebab-case）
- **存放**：`DSH_HOME/skills/personal-website`（`create_skill` 默认位置，跨会话留存；与 superpower 插件包技能区分开）
- **description（路由描述，决定何时加载）**：

  > 当用户要更新或发布个人网站、往网站加照片或视频、改网站内容或 profile、提到 chubbysx 主页 / 构建网站 / 发布上线 / 预览网站时加载本技能。技能接管内容归位、构建预览、发布上线的全流程判断与操作。

  这段描述是「技能能否被用起来」的关键——描述写准，模型才会在 Chubby 开口时主动调用 `skill` 工具加载它。

- **本质**：技能 body 是给模型的**工作流指令**（非可执行代码），告诉模型「调哪个脚本、按什么规则归位、在哪停」，模型照着执行。

### 4.2 三阶段总览
```
用户发图 ──► 阶段1 内容归位 ──► 阶段2 构建预览 ──► (停)
                                                  │
用户说"发布" ────────────────────────────────────► 阶段3 发布（push 前再停一次确认）
```
- 阶段 1、2 在「发图/加内容」时衔接跑完，**不碰 git**。
- 阶段 3 在「发布/上线」时触发，**push 前停下**给 Chubby 核对提交清单 + changelog + 版本号变化。

---

## 5. 详细设计

### 5.1 阶段 1 · 内容归位
**触发**：Chubby 在对话里发图 / 视频 / 给本地路径，或说「加内容 / 更新网站」。

**流程**：
1. 接收素材（对话附件或本地路径）。
2. 模型**判断分类**（自主判断，判完告知）：
   - → `content/daily/`：生活日常、旅游、玩具、美食、校园/工作日记
   - → `content/works/{video|image|doc}/`：建模渲染、完成度高的创作、正式作品
3. **归位 + 命名**（沿用现有约定）：
   - 可选日期前缀：`2025-06-01 标题.jpg`
   - 视频放 `works/video/`
   - 一组图做相册 → 建子文件夹
4. **写说明**：同名 `.txt`，一句话说明 + 可提取标签（如 `#机械 #建模`）。
5. **可纠错**：归位后明确告知「放在 `daily/不爱出门的旅游/`，叫 `xxx.jpg`，说明是 `…`」；Chubby 说错了就移。

**判断细则（写进技能 body 的启发式，非硬规则）**：
- 日常随拍、碎片记录、生活场景 → `daily/`
- 有意打磨的创作成品、对外展示的作品 → `works/`
- 模糊时默认 `daily/` 并在告知时说明「按日常归位，如属作品请告知我移过去」

### 5.2 阶段 2 · 构建预览
**触发**：归位完成后自动衔接（也可单独说「构建/预览」）。

**流程**：用 DSH runtime 调**现有脚本**（不重写）：
1. `tools/make_posters.py`（若有新视频）
2. `tools/make_thumbs.py`
3. `build.js`

**完成后**：告知预览地址 `http://127.0.0.1:8367`（或直接开 `index.html`）。

**边界**：纯本地构建，可反复跑，**不碰 git**。

### 5.3 阶段 3 · 发布
**触发**：Chubby 说「发布 / 上线」。

**流程**：
1. 若阶段 2 未跑或内容有变 → 先跑阶段 2。
2. `git add .` 暂存。
3. 调 `tools/analyze_and_record.js` 生成 changelog（分析 `git diff --cached`）。
4. **🔴 停下确认**：模型把以下内容列给 Chubby：
   - 本次提交清单（新增/修改了哪些文件）
   - changelog 摘要
   - 版本号将怎么变（`bump_publish.py` 的 b+1/c=0/d-1）
5. Chubby 确认后：`git commit` + `git push origin main`。
6. push 成功 → `bump_publish.py` + push 版本号。

---

## 6. 失败处理（沿用 bat 现有健壮逻辑）

| 场景 | 处理 |
|---|---|
| `make_posters` / `make_thumbs` / `build.js` 任一失败 | 停下报错，**不进入发布**；给出脚本 stderr 关键行 |
| push 失败 | 3 次重试（沿用 bat）；仍失败 → 回滚 `changelog.json`/`version.json`（`.bak` 备份）+ `git reset --mixed HEAD~1` 撤销 commit + 报告原因（多半网络或 git 凭证），**不擅自重推** |
| 版本号 push 失败 | 内容已上线但版本未同步——明确告知，不静默 |

bat 里那套「备份 → 分析 → 构建 → 失败回滚」的周全设计，原样收进技能，模型只负责在异常时停下并报告。

---

## 7. 验证方案

技能写完后，在本会话**实跑验证**：

1. **归位 + 构建实跑**：拿 `content/` 里一张现有图，模拟「发图 → 归位 → 构建」走通，确认技能 body 指令可被模型正确执行、脚本调用路径正确。
2. **发布段 dry-run**：跑到 push 前那个确认点就停，核对展示的提交清单 / changelog / 版本号变化是否准确——**不真推 GitHub**。

验证通过 → 技能可用。后续真实发布由 Chubby 说「发布」触发。

---

## 8. 非目标 / Scope 边界

- **不重写现有脚本**：`make_posters.py` 等保持原样，技能只调用它们。
- **不改站点样式/布局**：日落海景风格、profile.json 控制台等不动。
- **不做自动定时发布**：发布始终由 Chubby 显式触发（符合决策 2「发布前停」）。
- **不引入第二个 LLM provider**：本技能用当前模型（glm-5.2）即可，无需多模型路由。

---

## 9. 后续

1. Chubby 审阅本 spec → 确认或提修改。
2. 审阅通过 → 转 `writing-plans` 技能，把本设计拆成可执行、可测试的实施计划（create_skill 写技能 body + 实跑验证）。
3. 实施计划确认后 → 执行（`subagent-driven-development` 或内联执行）。
