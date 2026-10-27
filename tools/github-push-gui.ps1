# github-push-gui.ps1
# 探活 github.com:443 + git push，带右上角置顶状态小窗（深色极简，DPI 清晰，可手动停止）。
# 被 github-push 技能调用。耐心 10 轮 × 30s，每轮探活+推送；成功/失败 8 秒自动关。
# 输出一行结果（SUCCESS/FAIL + 失败原因总结）供调用方读取；不做回滚（回滚交调用方）。
param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Remote = "origin",
  [string]$Branch = "",
  [switch]$DryRun,
  [int]$MaxRounds = 10,
  [int]$RoundWait  = 30,
  [int]$FinalPause = 8
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# DPI 感知（PS 5.1：让窗体按原生像素渲染，不糊）
try {
  $sig = '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  $dt = Add-Type -MemberDefinition $sig -Name "DpiAware" -Namespace "Win32" -PassThru -ErrorAction Stop
  $dt::SetProcessDPIAware() | Out-Null
} catch {}

Set-Location -LiteralPath $Repo
if (-not $Branch) { $Branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim() }
if (-not $Branch) { $Branch = "main" }

# 配色（深色极简）
$bg    = [System.Drawing.Color]::FromArgb(34,34,54)
$white = [System.Drawing.Color]::FromArgb(235,235,245)
$gray  = [System.Drawing.Color]::FromArgb(150,150,165)
$amber = [System.Drawing.Color]::FromArgb(230,180,40)
$blue  = [System.Drawing.Color]::FromArgb(80,160,230)
$green = [System.Drawing.Color]::FromArgb(80,200,120)
$red   = [System.Drawing.Color]::FromArgb(220,90,90)

# 窗体（380x88，无边框，置顶，钉右上角）
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = "None"
$f.TopMost         = $true
$f.StartPosition   = "Manual"
$f.BackColor       = $bg
$f.Size            = New-Object System.Drawing.Size(380,88)
$f.ShowInTaskbar   = $false
$sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$f.Location = New-Object System.Drawing.Point(($sb.Width - 380 - 20), 20)

$bar = New-Object System.Windows.Forms.Panel
$bar.Location = New-Object System.Drawing.Point(0,0)
$bar.Size     = New-Object System.Drawing.Size(6,88)
$bar.BackColor = $amber
$f.Controls.Add($bar)

$lblT = New-Object System.Windows.Forms.Label
$lblT.Location = New-Object System.Drawing.Point(16,10)
$lblT.Size     = New-Object System.Drawing.Size(320,30)
$lblT.Font     = New-Object System.Drawing.Font("Microsoft YaHei UI",14,[System.Drawing.FontStyle]::Bold)
$lblT.ForeColor = $white
$lblT.BackColor = $bg
$lblT.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$lblT.Text = "准备推送…"
$f.Controls.Add($lblT)

$lblS = New-Object System.Windows.Forms.Label
$lblS.Location = New-Object System.Drawing.Point(16,44)
$lblS.Size     = New-Object System.Drawing.Size(320,28)
$lblS.Font     = New-Object System.Drawing.Font("Microsoft YaHei UI",10)
$lblS.ForeColor = $gray
$lblS.BackColor = $bg
$lblS.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$lblS.Text = "$Remote/$Branch"
$f.Controls.Add($lblS)

# 停止按钮（#1 手动中止）
$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Location = New-Object System.Drawing.Point(344,8)
$btnStop.Size     = New-Object System.Drawing.Size(26,26)
$btnStop.Font     = New-Object System.Drawing.Font("Microsoft YaHei UI",11,[System.Drawing.FontStyle]::Bold)
$btnStop.Text     = "✕"
$btnStop.FlatStyle = "Flat"
$btnStop.FlatAppearance.BorderSize = 0
$btnStop.BackColor = $bg
$btnStop.ForeColor = $gray
$btnStop.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$state = @{ stop = $false }
$btnStop.Add_Click({ $state.stop = $true; $btnStop.BackColor = $red; $btnStop.ForeColor = $white })
$f.Controls.Add($btnStop)

function Update-State {
  param($title,$sub,$color)
  $bar.BackColor = $color
  $lblT.Text = $title
  $lblS.Text = $sub
  [System.Windows.Forms.Application]::DoEvents()
}
function Elapsed {
  param($start)
  $e = (Get-Date) - $start
  return ("{0}:{1:00}" -f [int]$e.TotalMinutes, $e.Seconds)
}
function Wait-Pump {
  param($seconds)
  $end = Get-Date
  while (((Get-Date) - $end).TotalSeconds -lt $seconds) {
    [System.Windows.Forms.Application]::DoEvents()
    if ($state.stop) { return }
    Start-Sleep -Milliseconds 300
  }
}

$f.Show()
$start = Get-Date
$round = 0
$success = $false
$failReason = ""
$lastErr = ""

while ($round -lt $MaxRounds -and -not $success -and -not $state.stop) {
  $round++
  $el = Elapsed $start
  Update-State "第 $round/$MaxRounds 轮 · 探活 443" "已用 $el · $Remote/$Branch" $amber

  $up = $false
  try {
    $t = Test-NetConnection -ComputerName github.com -Port 443 -WarningAction SilentlyContinue
    $up = [bool]$t.TcpTestSucceeded
  } catch { $up = $false }

  if (-not $up) {
    Update-State "第 $round/$MaxRounds 轮 · 443 不通" "已用 $el · 等 ${RoundWait}s 重探" $amber
    $failReason = "443 持续封锁（$round 轮均不通）"
    if ($round -lt $MaxRounds) { Wait-Pump $RoundWait }
    continue
  }

  Update-State "推送中…" "$Remote/$Branch · 第 $round 轮推送" $blue
  $env:GIT_HTTP_LOW_SPEED_LIMIT = "1000"
  $env:GIT_HTTP_LOW_SPEED_TIME  = "20"
  $pa = @("push", $Remote, $Branch)
  if ($DryRun) { $pa += "--dry-run" }
  $pushOut = & git @pa 2>&1
  $code = $LASTEXITCODE

  if ($code -eq 0) {
    $success = $true
    Update-State "✅ 推送成功" "耗时 $el · $Remote/$Branch 已同步" $green
  } else {
    $lastErr = (($pushOut | ForEach-Object { "$_" }) | Select-Object -Last 2) -join " "
    Update-State "第 $round/$MaxRounds 轮 · 推送失败" "exit $code · 等 ${RoundWait}s 重探" $red
    $failReason = "推送失败 exit=$code"
    if ($round -lt $MaxRounds) { Wait-Pump $RoundWait }
  }
}

if ($state.stop) {
  $failReason = "用户手动停止（第 $round 轮）"
  Update-State "⏹ 已停止" $failReason $red
} elseif (-not $success) {
  Update-State "❌ 推送失败" ("$failReason · 耗时 " + (Elapsed $start)) $red
}

Wait-Pump $FinalPause
$f.Close()

$el = Elapsed $start
if ($success) {
  Write-Output ("SUCCESS push={0}/{1} rounds={2} elapsed={3}" -f $Remote,$Branch,$round,$el)
} else {
  $summary = $failReason
  if ($lastErr) { $summary += " | " + $lastErr }
  Write-Output ("FAIL reason={0} rounds={1} elapsed={2}" -f $summary,$round,$el)
  exit 1
}
