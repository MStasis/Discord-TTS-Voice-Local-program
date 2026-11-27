function Wait-DiscordCondition {
  param([scriptblock]$Probe, [int]$TimeoutMs = 6000, [int]$StableReads = 2, [int]$IntervalMs = 200, [switch]$StopOnMismatch)
  $until = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $stable = 0
  do {
    if ([DateTime]::UtcNow -gt $script:deadline) { throw 'Discord 설정 적용 시간 초과' }
    try { $observed = [bool](& $Probe) } catch { $observed = $false }
    if (!$observed -and $StopOnMismatch) { return $false }
    if ($observed) { $stable++ } else { $stable = 0 }
    if ($stable -ge $StableReads) { return $true }
    Start-Sleep -Milliseconds $IntervalMs
  } while ([DateTime]::UtcNow -lt $until)
  return $false
}

function Invoke-DiscordSetting {
  param([scriptblock]$Test, [scriptblock]$Apply, [string]$Label, [int]$TimeoutMs = 6000)
  $lastError = ''
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    # A known mismatch needs an action, not an idle wait; already-set values still need stable reads.
    if (Wait-DiscordCondition -Probe $Test -TimeoutMs 500 -StopOnMismatch) { return }
    try { & $Apply | Out-Null } catch { $lastError = $_.Exception.Message }
    # Poll the actual state before retrying a toggle; a slow UI must not be toggled back.
    if (Wait-DiscordCondition -Probe $Test -TimeoutMs $TimeoutMs) { return }
  }
  throw "$Label 적용 확인 실패. $lastError"
}
