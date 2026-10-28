# ============================================================
# bridge-dashboard.ps1 — 桥接服务显示面板（合并 push 状态）
# 常驻托盘；轮询 127.0.0.1:8390/monitor-data（免鉴权）+
# %LOCALAPPDATA%\MobileBridge\_push-state.json（github-push 写入）
# 显示：桥接状态 / 最近上传 / 事件日志 / 发布状态
# PS 5.1 兼容 · 深色 #222236 · 右上角置顶 · 关闭=收进托盘
# ============================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# DPI 感知（同 github-push-gui）
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class DpiHelper {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
'@
[void][DpiHelper]::SetProcessDPIAware()

$dark    = [System.Drawing.ColorTranslator]::FromHtml("#222236")
$panel   = [System.Drawing.ColorTranslator]::FromHtml("#2A2A3E")
$text    = [System.Drawing.ColorTranslator]::FromHtml("#E8E8F0")
$dim     = [System.Drawing.ColorTranslator]::FromHtml("#9AA0B0")
$green   = [System.Drawing.ColorTranslator]::FromHtml("#4CC38A")
$red     = [System.Drawing.ColorTranslator]::FromHtml("#E5534B")
$amber   = [System.Drawing.ColorTranslator]::FromHtml("#E5B84B")
$blue    = [System.Drawing.ColorTranslator]::FromHtml("#4BA3E5")
$gray    = [System.Drawing.ColorTranslator]::FromHtml("#7A7F8F")

$baseUrl = "http://127.0.0.1:8390"
$pushFile = Join-Path $env:LOCALAPPDATA "MobileBridge\_push-state.json"
$batPath  = Join-Path $PSScriptRoot "启动桥接.bat"

# ---------- 脚本级状态 ----------
$script:wasUp    = $false
$script:seen     = @{}   # recent item id -> name
$script:seenReq  = @{}   # request id -> 1
$script:lastPush = ""    # push-state ts

# ---------- 日志 ----------
$script:log = $null
function Add-Log {
  param([string]$msg, [System.Drawing.Color]$col)
  if (-not $script:log) { return }
  $script:log.SelectionStart = $script:log.TextLength
  $script:log.SelectionLength = 0
  $script:log.SelectionColor = $col
  $script:log.AppendText((Get-Date -Format "HH:mm:ss") + "  " + $msg + "`r`n")
  if ($script:log.TextLength -gt 30000) {
    $script:log.Clear()
    Add-Log "—— 日志已清空 ——" $dim
  }
  $script:log.SelectionStart = $script:log.TextLength
  $script:log.ScrollToCaret()
}

# ---------- 表单 ----------
$f = New-Object System.Windows.Forms.Form
$f.Text = "桥接面板"
$f.BackColor = $dark
$f.FormBorderStyle = 'None'
$f.StartPosition = 'Manual'
$f.ShowInTaskbar = $false
$f.TopMost = $true
$W = 420; $H = 560
$sa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$f.Size = New-Object System.Drawing.Size($W, $H)
$f.Location = New-Object System.Drawing.Point($sa.Right - $W - 20, $sa.Top + 20)

$fontT  = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Bold)
$fontS  = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$fontM  = New-Object System.Drawing.Font("Microsoft YaHei UI", 8.5)

# 标题栏
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "桥接面板 · 上传 / 发布中继"
$lblTitle.Font = $fontT
$lblTitle.ForeColor = $text
$lblTitle.BackColor = $dark
$lblTitle.Location = New-Object System.Drawing.Point(14, 10)
$lblTitle.Size = New-Object System.Drawing.Size(280, 24)
$f.Controls.Add($lblTitle)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "✕ 收进托盘"
$btnClose.Font = $fontS
$btnClose.FlatStyle = 'Flat'
$btnClose.FlatAppearance.BorderSize = 0
$btnClose.BackColor = $panel
$btnClose.ForeColor = $dim
$btnClose.Location = New-Object System.Drawing.Point($W - 108, 8)
$btnClose.Size = New-Object System.Drawing.Size(94, 28)
$f.Controls.Add($btnClose)

# 桥接状态行
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Font = $fontT
$lblStatus.ForeColor = $green
$lblStatus.BackColor = $dark
$lblStatus.Location = New-Object System.Drawing.Point(14, 40)
$lblStatus.Size = New-Object System.Drawing.Size(180, 26)
$lblStatus.Text = "● 检查中…"
$f.Controls.Add($lblStatus)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "启动桥接"
$btnStart.Font = $fontS
$btnStart.FlatStyle = 'Flat'
$btnStart.FlatAppearance.BorderSize = 0
$btnStart.BackColor = $panel
$btnStart.ForeColor = $text
$btnStart.Location = New-Object System.Drawing.Point(200, 38)
$btnStart.Size = New-Object System.Drawing.Size(100, 30)
$f.Controls.Add($btnStart)

$btnMon = New-Object System.Windows.Forms.Button
$btnMon.Text = "监控页"
$btnMon.Font = $fontS
$btnMon.FlatStyle = 'Flat'
$btnMon.FlatAppearance.BorderSize = 0
$btnMon.BackColor = $panel
$btnMon.ForeColor = $text
$btnMon.Location = New-Object System.Drawing.Point(306, 38)
$btnMon.Size = New-Object System.Drawing.Size(100, 30)
$f.Controls.Add($btnMon)

# 发布状态
$lblPush = New-Object System.Windows.Forms.Label
$lblPush.Font = $fontS
$lblPush.ForeColor = $dim
$lblPush.BackColor = $dark
$lblPush.Location = New-Object System.Drawing.Point(14, 72)
$lblPush.Size = New-Object System.Drawing.Size($W - 30, 40)
$lblPush.Text = "发布：— 最近没有推送"
$f.Controls.Add($lblPush)

# 最近上传
$lblUp = New-Object System.Windows.Forms.Label
$lblUp.Text = "最近上传"
$lblUp.Font = $fontS
$lblUp.ForeColor = $dim
$lblUp.BackColor = $dark
$lblUp.Location = New-Object System.Drawing.Point(14, 116)
$lblUp.Size = New-Object System.Drawing.Size(120, 20)
$f.Controls.Add($lblUp)

$list = New-Object System.Windows.Forms.ListBox
$list.BackColor = $panel
$list.ForeColor = $text
$list.Font = $fontM
$list.BorderStyle = 'None'
$list.Location = New-Object System.Drawing.Point(14, 138)
$list.Size = New-Object System.Drawing.Size($W - 30, 112)
$f.Controls.Add($list)

# 事件日志
$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = "事件日志（上传 ✓ / 删除 🗑 / 指令 📌 / 发布）"
$lblLog.Font = $fontS
$lblLog.ForeColor = $dim
$lblLog.BackColor = $dark
$lblLog.Location = New-Object System.Drawing.Point(14, 256)
$lblLog.Size = New-Object System.Drawing.Size(280, 20)
$f.Controls.Add($lblLog)

$log = New-Object System.Windows.Forms.RichTextBox
$log.BackColor = $panel
$log.ForeColor = $text
$log.Font = $fontM
$log.BorderStyle = 'None'
$log.ReadOnly = $true
$log.Location = New-Object System.Drawing.Point(14, 278)
$log.Size = New-Object System.Drawing.Size($W - 30, 250)
$log.DetectUrls = $false
$f.Controls.Add($log)
$script:log = $log

# 底部提示
$lblFoot = New-Object System.Windows.Forms.Label
$lblFoot.Text = "关闭=收进托盘 · 双击托盘图标展开/收起 · 退出在托盘菜单"
$lblFoot.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8)
$lblFoot.ForeColor = $dim
$lblFoot.BackColor = $dark
$lblFoot.Location = New-Object System.Drawing.Point(14, 536)
$lblFoot.Size = New-Object System.Drawing.Size($W - 30, 18)
$f.Controls.Add($lblFoot)

# ---------- 托盘 ----------
$bmp = New-Object System.Drawing.Bitmap(16, 16)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear($dark)
$g.FillEllipse((New-Object System.Drawing.SolidBrush($green)), 3, 3, 10, 10)
$ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $ico
$ni.Text = "桥接面板"
$ni.Visible = $true
$ni.ContextMenuStrip = New-Object System.Windows.Forms.ContextMenuStrip

$mShow = $ni.ContextMenuStrip.Items.Add("显示面板")
$mStart = $ni.ContextMenuStrip.Items.Add("启动桥接")
$mMon = $ni.ContextMenuStrip.Items.Add("打开监控页")
$ni.ContextMenuStrip.Items.Add("-") | Out-Null
$mExit = $ni.ContextMenuStrip.Items.Add("退出")

function Show-Panel {
  $f.Show()
  $f.Activate()
}
function Hide-Panel {
  $f.Hide()
}

$btnClose.Add_Click({ Hide-Panel; $ni.ShowBalloonTip(1500, "桥接面板", "已收进托盘，双击图标展开查看。", [System.Windows.Forms.ToolTipIcon]::Info) })
$mShow.Add_Click({ Show-Panel })
$ni.Add_DoubleClick({ Show-Panel })

$btnStart.Add_Click({
  if (Test-Path $batPath) {
    try { Start-Process -FilePath $batPath -WindowStyle Minimized; Add-Log "手动启动桥接…" $amber } catch { Add-Log ("启动失败: " + $_.Exception.Message) $red }
  } else { Add-Log "找不到 启动桥接.bat" $red }
})
$btnMon.Add_Click({ try { Start-Process ($baseUrl + "/monitor") } catch { Add-Log "无法打开监控页" $red } })

# ---------- 轮询 ----------
function Test-Bridge {
  try {
    $md = Invoke-RestMethod -Uri ($baseUrl + "/monitor-data") -TimeoutSec 2
    if (-not $script:wasUp) {
      $script:wasUp = $true
      $lblStatus.ForeColor = $green
      $lblStatus.Text = "● 桥接运行中 (8390)"
      Add-Log "桥接已启动，开始监听上传" $gray
    }
    # 上传进度
    $rows = @()
    foreach ($it in @($md.inflight)) {
      $pct = 0
      if ($it.total -and $it.total -gt 0) { $pct = [math]::Min(100, [math]::Round(100 * $it.received / $it.total)) }
      $rows += ("◐ " + $it.name + " — " + $pct + "%")
    }
    foreach ($it in @($md.recent)) {
      $kb = ""
      if ($it.size -and $it.size -gt 0) { $kb = " · " + [math]::Round($it.size / 1KB) + " KB" }
      $tag = ""
      if ($it.tag) { $tag = "（" + $it.tag + "）" }
      $rows += ("✓ " + $it.name + $tag + $kb)
      if (-not $script:seen.ContainsKey($it.id)) {
        $script:seen[$it.id] = $it.name
        Add-Log ("✓ " + $it.name + " 上传完成" + $tag) $green
      }
    }
    if ($rows.Count -eq 0) { $rows += "（暂无上传）" }
    $list.Items.Clear()
    foreach ($r in ($rows | Select-Object -Last 6)) { $list.Items.Add($r) | Out-Null }
    # 删除检测（recent 里消失的 id）
    $cur = @{}
    foreach ($it in @($md.recent)) { $cur[$it.id] = $true }
    $gone = @($script:seen.Keys | Where-Object { -not $cur.ContainsKey($_) })
    foreach ($gid in $gone) {
      $nm = $script:seen[$gid]
      $script:seen.Remove($gid) | Out-Null
      Add-Log ("🗑 已删除 " + $nm) $gray
    }
    # 手机指令
    foreach ($rq in @($md.requests)) {
      if (-not $script:seenReq.ContainsKey($rq.id)) {
        $script:seenReq[$rq.id] = 1
        $kind = if ($rq.intent -eq "publish") { "🚀 发布请求" } else { "📌 指令" }
        Add-Log ($kind + ": " + $rq.text) $amber
      }
    }
  } catch {
    if ($script:wasUp) {
      $script:wasUp = $false
      $lblStatus.ForeColor = $red
      $lblStatus.Text = "● 桥接未运行"
      Add-Log "桥接未运行（可点「启动桥接」，或等看门狗自愈）" $gray
    }
    $list.Items.Clear()
    $list.Items.Add("（桥接未运行）") | Out-Null
  }
}

function Read-Push {
  if (Test-Path $pushFile) {
    try {
      $j = Get-Content $pushFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.ts -ne $script:lastPush) {
        $script:lastPush = $j.ts
        $col = $dim; $txt = "发布：⏳ 等待推送"
        switch ($j.state) {
          "pushing" { $col = $blue; $txt = "🚀 发布：推送中… " + $j.msg }
          "ok"      { $col = $green; $txt = "✅ 发布：已上线 " + $j.msg }
          "fail"    { $col = $red;   $txt = "❌ 发布：失败 " + $j.msg }
          default   { $txt = "发布：⏳ 等待推送" }
        }
        $lblPush.ForeColor = $col
        $lblPush.Text = $txt
        Add-Log $txt $col
      }
    } catch { }
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({
  Test-Bridge
  Read-Push
})

# ---------- 启动 ----------
$f.Add_FormClosing({
  param($sender, $e)
  if (-not $script:exiting) {
    $e.Cancel = $true
    $f.Hide()
    $ni.ShowBalloonTip(1200, "桥接面板", "已收进托盘，双击图标展开查看。", [System.Windows.Forms.ToolTipIcon]::Info)
  }
})
$script:exiting = $false
$mExit.Add_Click({
  $script:exiting = $true
  $timer.Stop()
  $ni.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

Add-Log "面板已启动（轮询 $baseUrl/monitor-data）" $gray
$timer.Start()
Test-Bridge
Read-Push
$f.Hide()

# 无主窗体的消息循环：表单保持隐藏，从托盘图标展开
[System.Windows.Forms.Application]::Run()
