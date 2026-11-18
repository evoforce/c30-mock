# 应急清理:终止失控的 `pnpm ... lint` 自递归进程链(内存暴涨到 100% 时用)
#
# 事故背景(2026-11-18):
#   `pnpm exec turbo run lint` 在本机(Windows + Volta/corepack 的 pnpm shim)会degenerate成
#   无限递归 —— 每一级都是 `pnpm.exe run lint` 派生出 `cmd.exe /C pnpm run lint`,再派生下一级,
#   进程数每秒涨几十个,几分钟内堆到 1.4 万个进程(pnpm/cmd 各一半),内存被吃满。
#   根因在 turbo → pnpm 的调用链上,故根 `lint` 脚本已改为 `pnpm -r run lint`(不再经过 turbo)。
#   若仍有人直接跑 `turbo run lint` 触发复发,用本脚本清理。
#
# 用法(管理员/普通用户均可,无需提权):
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/kill-runaway-lint.ps1
#   pwsh ... -File scripts/kill-runaway-lint.ps1 -DryRun          # 只看数量,不杀
#   pwsh ... -File scripts/kill-runaway-lint.ps1 -TimeoutSeconds 300
#
# 关键点:**先杀 cmd,再杀 pnpm**。递归链是 pnpm → cmd → pnpm,
# cmd 是「传播节点」;只杀 pnpm 时,它的父 cmd 会立刻再拉一个新的 pnpm,数量原地不动。
param(
    [switch]$DryRun,
    [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = 'Stop'

function Get-CycleStats {
    # WQL 服务端过滤,比拿 1 万多个进程回客户端筛快一个数量级
    $cmds = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe' AND CommandLine LIKE '%pnpm%lint%'" -ErrorAction SilentlyContinue)
    $pnpm = @(Get-CimInstance Win32_Process -Filter "Name='pnpm.exe' AND CommandLine LIKE '%lint%'" -ErrorAction SilentlyContinue)
    return [pscustomobject]@{
        CmdPids  = @($cmds | Select-Object -ExpandProperty ProcessId)
        PnpmPids = @($pnpm | Select-Object -ExpandProperty ProcessId)
    }
}

function Stop-PidList {
    param([int[]]$Pids)
    foreach ($id in $Pids) {
        try {
            $p = Get-Process -Id $id -ErrorAction Stop
            $p.Kill()
        } catch {
            # 进程可能已退出,忽略
        }
    }
}

$stats = Get-CycleStats
Write-Host ("初始: cmd={0} pnpm={1} (总进程 {2})" -f $stats.CmdPids.Count, $stats.PnpmPids.Count, @(Get-Process).Count)

if (-not $stats.CmdPids.Count -and -not $stats.PnpmPids.Count) {
    Write-Host '未发现失控的 lint 进程链,无需清理。'
    exit 0
}

if ($DryRun) {
    Write-Host 'DryRun: 未执行终止。'
    exit 0
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$pass = 0
while ((Get-Date) -lt $deadline) {
    $pass++
    $s = Get-CycleStats
    if (-not $s.CmdPids.Count -and -not $s.PnpmPids.Count) {
        Write-Host ("第 {0} 轮:已清空。" -f $pass)
        break
    }
    Write-Host ("第 {0} 轮: cmd={1} pnpm={2}" -f $pass, $s.CmdPids.Count, $s.PnpmPids.Count)
    # 先 cmd(传播节点),再 pnpm(其父 cmd 已死,不会再复活)
    Stop-PidList -Pids $s.CmdPids
    Stop-PidList -Pids $s.PnpmPids
    Start-Sleep -Milliseconds 300
}

Start-Sleep -Seconds 2
$final = Get-CycleStats
$total = @(Get-Process).Count
if ($final.CmdPids.Count -or $final.PnpmPids.Count) {
    Write-Warning ("仍有残留: cmd={0} pnpm={1}(可重跑本脚本,或 -TimeoutSeconds 加大)" -f $final.CmdPids.Count, $final.PnpmPids.Count)
    exit 1
}
Write-Host ("清理完成:共 {0} 轮,总进程 {1}。" -f $pass, $total)
exit 0
