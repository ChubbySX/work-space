# github-push-gui.ps1
# 探活 github.com:443 + git push，带右上角置顶状态小窗（深色极简风）。
# 被 github-push 技能调用。耐心 20 轮 × 60s，最多 3 次推送；成功/失败 8 秒自动关。
# 输出一行结果（SUCCESS/FAIL ...）供调用方读取；不做回滚（回滚交调用方）。
param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Remote = "origin",
  [string]$Branch = "",            # 空 = git rev-parse --abbrev-ref HEAD
  [switch]$DryRun,                 # 只探活 + git push --dry-run，不真推
  [int]$MaxRounds = 20,
  [int]$RoundWait  = 60,
  [int]$MaxPushAttempts = 3,
  [int]$FinalPause = 8             # 最终结果停留秒数后自动关
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

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

# 构建窗体（320x72，无边框，置顶，钉右上角）
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle   = "None"
$f.TopMost           = $true
$f.StartPosition     = "Manual"
$f.BackColor         = $bg
$f.Size              = New-Object System.Drawing.Size(320,72)
$f.ShowInTaskbar     = $false
$sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$f.Location = New-Object System.Drawing.Point(($sb.Width - 320 - 20), 20)

$bar = New-Object System.Windows.Forms.Panel
$bar.Location = New-Object System.Drawing.Point(0,0)
$bar.Size     = New-Object System.Drawing.Size(6,72)
$bar.BackColor = $amber
$f.Controls.Add($bar)

$lblT = New-Object System.Windows.Forms.Label
$lblT.Location = New-Object System.Drawing.Point(16,10)
$lblT.Size     = New-Object System.Drawing.Size(290,26)
$lblT.Font     = New-Object System.Drawing.Font("Microsoft YaHei UI",12,[System.Drawing.FontStyle]::Bold)
$lblT.ForeColor = $white
$lblT.BackColor = $bg
$lblT.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$lblT.Text = "准备推送…"
$f.Controls.Add($lblT)

$lblS = New-Object System.Windows.Forms.Label
$lblS.Location = New-Object System.Drawing.Point(16,38)
$lblS.Size     = New-Object System.Drawing.Size(290,24)
$lblS.Font     = New-Object System.Drawing.Font("Microsoft YaHei UI",9)
$lblS.ForeColor = $gray
$lblS.BackColor = $bg
$lblS.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$lblS.Text = "$Remote/$Branch"
$f.Controls.Add($lblS)

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
# 带消息泵的等待（窗体不冻）
function Wait-Pump {
  param($seconds)
  $end = Get-Date
  while (((Get-Date) - $end).TotalSeconds -lt $seconds) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 300
  }
}

$f.Show()
$start = Get-Date
$round = 0
$pushAttempts = 0
$success = $false
$failReason = ""

while ($round -lt $MaxRounds -and -not $success) {
  $round++
  $el = Elapsed $start

  # 探活 github.com:443
  Update-State "第 $round/$MaxRounds 轮 · 探活 443" "已用 $el · $Remote/$Branch" $amber
  $up = $false
  try {
    $t = Test-NetConnection -ComputerName github.com -Port 443 -WarningAction SilentlyContinue
    $up = [bool]$t.TcpTestSucceeded
  } catch { $up = $false }

  if (-not $up) {
    Update-State "第 $round/$MaxRounds 轮 · 443 不通" "已用 $el · 等待恢复" $amber
    $failReason = "443 持续封锁"
    if ($round -lt $MaxRounds) { Wait-Pump $RoundWait }
    continue
  }

  # 443 通 → 推送（不超过 MaxPushAttempts 次）
  if ($pushAttempts -ge $MaxPushAttempts) { $failReason = "推送 $MaxPushAttempts 次仍失败"; break }
  $pushAttempts++
  Update-State "推送中…" "$Remote/$Branch · 第 $pushAttempts 次推送" $blue

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
    Update-State "第 $round/$MaxRounds 轮 · 推送失败" "第 $pushAttempts 次失败 · 重探" $red
    $failReason = "push exit $code"
    if ($round -lt $MaxRounds) { Wait-Pump $RoundWait }
  }
}

if (-not $success) {
  Update-State "❌ 推送失败" ("$failReason · 耗时 " + (Elapsed $start)) $red
}

# 最终结果停留
Wait-Pump $FinalPause
$f.Close()

$el = Elapsed $start
if ($success) {
  Write-Output ("SUCCESS push={0}/{1} rounds={2} pushAttempts={3} elapsed={4}" -f $Remote,$Branch,$round,$pushAttempts,$el)
} else {
  Write-Output ("FAIL reason={0} rounds={1} pushAttempts={2} elapsed={3}" -f $failReason,$round,$pushAttempts,$el)
  exit 1
}
