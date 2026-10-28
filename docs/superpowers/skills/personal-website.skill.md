# personal-website

> 本技能接管「个人网站」内容更新全流程中所有需要人判断的环节。项目根 `D:\DS harnessw\work station\personal-website`（git `main`，远程 `origin`，GitHub Pages https://chubbysx.github.io/work-space/）。**不重写任何现有脚本**，只调用它们。

## 触发 / 路由

当用户要更新或发布个人网站、往网站加照片或视频、改网站内容或 profile、提到 chubbysx 主页 / 构建网站 / 发布上线 / 预览网站时加载本技能。技能接管内容归位、构建预览、发布上线的全流程判断与操作。

## 运行时

- Python（`PY`）：`C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`；不存在则回落 `python`。
- Node（`NODE`）：`C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`；不存在则回落 `node`。
- 预览端口 `8367`（`http://127.0.0.1:8367`）。
- 压缩脚本（**本仓库外**）：`D:\DS harnessw\work station\compress_image.py`（图片，Pillow）/ `compress_video.ps1`（视频，ffmpeg）。它们的 `待压缩/`、`已压缩/`、`config.txt` / `config_image.txt`、`tools/ffmpeg/` 都在该目录下——**按绝对路径调，不要 `cd` 过去**（项目根保持不变）。

工作目录始终是项目根。下面命令里的 `%PY%`/`%NODE%` 指上面两个路径。

## 阶段 1 · 内容归位

**触发**：用户在对话里发图 / 视频 / 给本地路径，或说「加内容 / 更新网站」。

1. 接收素材（对话附件或本地路径）。**或从待上传批次读**：若用户说「处理待上传」（或 `D:\DS harnessw\work station\待上传\_inbox.json` 存在且有 `status:"pending"` 项），读该清单 → 对每个 pending 项，把 `待上传\<file>` 当作收到的素材，**用清单里的 `tag` 直接定相册、`name` 定文件名**（跳过 step 2 分类 + step 3 定名——分类由用户在上传 app 里选标签完成了）：**先按扩展名分视频/图片**——视频（`.mp4/.mov/.mkv/.avi/.webm`）：`tag`=`作品`→`content/works/video/`，否则→`content/daily/<tag>/`；图片：`tag`=`作品`→`content/works/image/`，否则→`content/daily/<tag>/`（文件夹不存在就**新建**，即新相册）；`name` 缺失用 `origName`；**`tag` 缺失（或为空）→ 按名字判断分类归位**（同 step 2 启发式：作品类→`works/image/`，日常→归到最贴切的现有相册；一组明显同主题→新建相册），并在告知时说明归到了哪个相册、可纠错。然后走 step 4（压缩，用 `name` 做最终名）→ step 5（归位到该相册）→ step 6（写说明，`name` 做一句话）。每项处理完**更新 `_inbox.json` 里该项 `status`**（成功=`processed`，压缩失败=`failed` 并记 stderr 关键行）。全部处理完报「处理了 N 项，M 成功 K 失败」。**清单空或 JSON 损坏 → 告知用户「待上传清单为空或损坏」，不静默跳过**。**该步骤已自动化**：用户可点监控窗右上「🔄 一键处理」按钮、或跑 `tools\process-uploads.bat`（node `tools\process-uploads.js`）——自动完成 分类→压缩→归位→原图归档→配文补齐→构建，结果写 `待上传\_process-report.json`；agent 在用户要求时复核结果或代跑，替代手工逐项。**归档原图**：处理成功（含补处理的旧批次）后，把仍留在 `待上传\` 的原图（`待上传\<file>`）移到 `待上传\已处理\` 归档（不删除、留底；`_inbox.json` 该项 `file` 同步改为 `已处理\<名>`），避免 `待上传\` 无限堆积几十 MB 原图。**设为封面**：若该项带 `cover:true` 且目标是现有相册（非新建）→ 归位放好后写 `content/daily/<相册>/_cover.txt`（内容=该图片最终基名，不含扩展名），该图即成相册封面（`build.js` 与桥接 `/albums` 都认 `_cover.txt`）。
   - **手机端指令 / 发布请求**：上传 app 里「🚀 发布网站（带备注）」和「📤 仅发指令」按钮会把指令写进 `D:\DS harnessw\work station\待上传\_requests.json`（条目 `{id, intent:'publish'|'command', text, ts, status:'pending'}`，最新在前）。**用户回话时**若该文件有 `status:"pending"` 项，把每条当作用户的显式指令：`publish` → 用户要求发布，`text` 是随附的备注 / 额外提示词（发布前按 `text` 的要求核对内容与范围）；`command` → `text` 就是要执行的文字指令。执行完把该项 `status` 改为 `processed` 并写回（UTF-8 无 BOM）。
2. **判断分类**（自主判断，判完告知用户）：
   - → `content/daily/`：生活日常、旅游、玩具、美食、校园 / 工作日记。
   - → `content/works/{video|image|doc}/`：建模渲染、完成度高的创作、正式作品。
   - 启发式：日常随拍 / 碎片记录 / 生活场景 → `daily/`；有意打磨的创作成品 / 对外展示的作品 → `works/`；**模糊时默认 `daily/`**，并在告知时说明「按日常归位，**如属作品请移**过去」。
3. **定名 + 定位**（沿用现有约定，先定名再压缩）：
   - 可选日期前缀：`2025-06-01 标题.jpg`。
   - 视频放 `works/video/`。
   - 一组图做相册 → 建子文件夹，文件夹名用相册主题、仿现有 `我的小玩具们` / `不爱出门的旅游` 风格（中文短语、带主题感）。
   - **同名冲突**：目标位置已存在同名文件时**不静默覆盖**——询问用户，或给新文件加 `_2` 后缀。最终名确定后用于第 4 步压缩。
4. **压缩**（用第 3 步定的最终名；先压再归位，**原图不进 `content/`、不进 git**）：
   - 压缩脚本在 `D:\DS harnessw\work station\`（仓库外），按绝对路径调，不 `cd`。
   - **图片**：把收到的图写到 `D:\DS harnessw\work station\待压缩\<最终名>.<ext>`；若 `已压缩\<最终名>.jpg`（或按 `config_image.txt` 格式为 `.webp`）已存在**先删**（避免被脚本 skip 拿到旧成品）；跑 `"%PY%" "D:\DS harnessw\work station\compress_image.py"`；从 `已压缩\` 取 `<最终名>.jpg|.webp`（待第 5 步移进 content/）；清掉 `待压缩\` 里这张原图。
   - **视频**：直接 `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DS harnessw\work station\compress_video.ps1" -InputPath "<收到的视频>"`（脚本自带 ffmpeg 查找：PATH → `tools\ffmpeg\`）；从 `已压缩\<base>.mp4` 取成品（待第 5 步移进 `content/works/video/`）；原视频不进 `待压缩/`、不进 content/。
   - **依赖**：图片需 Pillow（DSH python 自带，12.3+）；视频需 ffmpeg（`work station\tools\ffmpeg\` 已有，PATH 上没有但不影响脚本查找）。缺则停下告知，**不归位、不进 content/**。
   - **配置**：沿用现有 `config.txt`（视频：分辨率/帧率/画质/编码/音频码率）/ `config_image.txt`（图片：格式/分辨率/画质）；改 config 全局生效。
   - **扩展名变化**：视频统一出 `.mp4`（不论原 `.mov/.avi/.mkv`）；图片按 `config_image.txt` 格式出 `.jpg` 或 `.webp`。归位时**告知用户新文件名（含扩展名）**。
   - **失败**：压缩脚本报错（文件损坏等）→ 停下告知 stderr 关键行，不归位、不进 content/；用户可手动跳过压缩直接放原图（告知「原图较大，未压缩」）。
   - **只清理本次自己的文件**：`待压缩/`、`已压缩/` 里属于本次的文件用完删掉，**不动用户其它文件**（如 `已压缩/` 里既有的旧成品）。
5. **归位**：把第 4 步的压缩版移进第 3 步定的 `content/` 路径。
6. **写说明**：在压缩版旁写同名 `.txt`，一句话说明 + 可提取标签（如 `#机械 #建模`）。
7. **可纠错**：归位后明确告知用户「放在 `daily/xxx/`，叫 `yyy.jpg`（压缩后 <原大小>），说明是 `…`」；用户说放错了就移过去。

## 阶段 2 · 构建预览

**触发**：归位完成后自动衔接（也可单独说「构建 / 预览」）。

用 DSH runtime 调**现有脚本**（不重写），按序：

1. `"%PY%" tools\make_posters.py` — 截视频封面。无新视频时为 no-op，**不得报错**；若某视频的 ffmpeg 全缺失（`tools/ffmpeg.exe` → `imageio_ffmpeg` → PATH 都失败），报告该视频无封面，**不阻断构建**。
2. `"%PY%" tools\make_thumbs.py` — 生成 `.thumbs/*.webp` 缩略图。
3. `"%NODE%" build.js` — 扫 `content/` 生成 `js/data.js`（`window.SITE_DATA=...`）。

任一脚本失败（非零退出）→ 停下，把 stderr 关键行给用户，**不进入发布**。

完成后告知预览地址 `http://127.0.0.1:8367`（先确保 `启动预览.bat` 跑着，或直接开 `index.html`）。**本阶段不碰 git**。

## 阶段 3 · 发布

**触发**：用户说「发布 / 上线」。
> 或**手机端发来发布请求**：`待上传\_requests.json` 里有 `status:"pending"` 项（🚀 发布网站 = `intent:"publish"`，可带备注 `text`；📤 仅发指令 = `intent:"command"`）→ 当作**用户显式指令**：发布请求先按备注补处理，再走本阶段；任何请求处理后把该项 `status` 改 `processed`。

> **单批发布**：内容 + 更新历史 + 版本号合成**一个 commit、一次 push** 上线（与 `发布上线.bat` 完全同一套流程；bat 是手动上线入口，双击即按此流程跑）。避免「内容已上传、版本号未同步」的分批错位。

1. 若阶段 2 未跑或有新内容 → 先跑阶段 2。
2. `git add .`
2.5 发布前校验：`"%NODE%" tools\preflight.js`（内容完整性 / 根目录临时文件 / 待上传 pending / 配文与缩略图 / JSON 合法 / 构建新鲜度；exit 1 → 停下处理，**不进发布**）。
3. 备份并分析：
   - `copy /Y content\changelog.json content\changelog.json.bak`
   - `copy /Y content\version.json content\version.json.bak`
   - `"%NODE%" tools\analyze_and_record.js`（分析 `git diff --cached`，生成 changelog 顶部条目）
4. `"%NODE%" build.js`（这次构建做版本号 `c+1, d+1`）。
5. `"%PY%" tools\bump_publish.py`（`b+1, c=0, d-1`，同步 `data.json` / `js/data.js` 版本字段）——**版本号在 commit 前定版**，随内容一个 commit 推送，没有第二次 commit / push。
6. `git add .`（更新历史 + 版本号文件入暂存，与内容合成一个 commit）。
7. **🔴 STOP — 停下确认**。先**主动核对暂存区**：读 `git diff --cached --name-status`，逐项判断是否本次该发布的内容（`content/` 下 daily/works/profile/changelog/version、`.thumbs/`、`js/data.js`）。**若出现非内容文件（`build.js`、`css/`、`index.html`、`js/main.js`、`tools/` 或其它源码 / 配置）要明确告知用户**——它们会随这次提交进仓库；非本次意图就提示用户先 `git reset HEAD <file>` 取消暂存，清单干净后再继续。然后把以下内容列给用户，**等用户点头再继续**：
   - 本次提交清单：`git diff --cached --name-status`
   - changelog 摘要：读 `content/changelog.json` 顶部条目
   - 版本号变化：`bump_publish.py` 已执行（`b+1, c=0, d-1`，还原本次 build 的 `d+1`；一次发布的净效果 = `b+1, c→0, d 不变`）→ **读 `content/version.json` 当前值列给用户**（如 `1.12.0.137`），说明它随本次提交一起推送、一次到位。
8. 用户确认后：
   - 取时间戳 `TS`（PowerShell: `Get-Date -Format yyyy-MM-dd_HHmm`）。
   - `git commit -m "更新内容 <TS>"`（**内容 + 更新历史 + 版本号一个 commit**）。
   - **调用 `github-push` 技能推送**（探活 `github.com:443` + 重试；返回失败 → 进失败处理回滚）——**唯一一次推送**，成功后内容与版本号同时上线。
   - push 成功后跑 **发布后自检**：`"%NODE%" tools\postcheck.js`（探测线上 GitHub Pages 是否同步到本地版本号；Pages 有 1~2 分钟部署延迟，脚本自动重试约 7×15s；版本一致 → ✅ 告诉用户「线上已同步」）。

## 失败处理（沿用 bat 现有健壮逻辑）

| 场景 | 处理 |
|---|---|
| `make_posters.py` / `make_thumbs.py` / `build.js` 任一失败 | 停下报错，**不进入发布**；给脚本 stderr 关键行 |
| `github-push` 返回失败（唯一一次推送，内容+版本号一体） | **内容与版本号都未上线**。回滚：`copy /Y content\changelog.json.bak content\changelog.json` + `copy /Y content\version.json.bak content\version.json` → `del content\changelog.json.bak content\version.json.bak` → `git reset --mixed HEAD~1`（撤销 commit）→ `"%NODE%" build.js` 重建 → 报告「未记录更新历史，版本号未变」（多半网络或 git 凭证问题），**不擅自重推** |

## 约束

- 不重写 `make_posters.py` / `make_thumbs.py` / `analyze_and_record.js` / `bump_publish.py` / `build.js`，只调用。
- 不改站点样式 / 布局（日落海景风格、profile.json 控制台等不动）。
- 压缩调 `D:\DS harnessw\work station\` 的 `compress_image.py` / `compress_video.ps1`（不重写）；**原图不进 `content/`、不进 git**；`待压缩/`、`已压缩/` 只清理本次自己的文件，不动用户其它文件。
- 发布始终由用户显式触发，且 push 前必须停下确认。
- `发布上线.bat` 是**手动上线入口**，与技能阶段 3 完全同一套单批流程（一个 commit、一次 push）。
- 构建阶段不碰 git。
