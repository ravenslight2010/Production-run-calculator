# Speed-first model selection for coding-assistant pilot testing.
# Later: set $env:CA_MODEL_POLICY = "balanced" for quality-leaning picks.
function Get-CodingModelChoice {
  param(
    [ValidateSet("speed", "balanced")]
    [string]$Policy = $(if ($env:CA_MODEL_POLICY) { $env:CA_MODEL_POLICY } else { "speed" })
  )

  $ramGB = 0
  try {
    $bytes = [int64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
    $ramGB = [math]::Round($bytes / 1GB, 1)
  } catch { $ramGB = 0 }

  $hasNvidia = $false
  $vramGB = 0
  try {
    $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue)
    foreach ($g in $gpus) {
      if ($g.Name -match "NVIDIA") { $hasNvidia = $true }
      if ($g.AdapterRAM -and $g.AdapterRAM -gt 0 -and $g.AdapterRAM -lt 200GB) {
        $gb = [math]::Round($g.AdapterRAM / 1GB, 1)
        if ($gb -gt $vramGB) { $vramGB = $gb }
      }
    }
  } catch { }

  # nvidia-smi VRAM if available (more accurate)
  try {
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
      $hasNvidia = $true
      $line = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
      if ($line) {
        $mb = 0
        [void][int]::TryParse(($line -replace "\s",""), [ref]$mb)
        if ($mb -gt 0) { $vramGB = [math]::Round($mb / 1024, 1) }
      }
    }
  } catch { }

  $model = "qwen2.5-coder:3b"
  $reason = "default speed tier"

  if ($Policy -eq "speed") {
    # Prefer low latency while testing
    if ($hasNvidia -and $vramGB -ge 8 -and $ramGB -ge 16) {
      $model = "qwen2.5-coder:7b"
      $reason = "speed policy: NVIDIA ~${vramGB}GB VRAM, ${ramGB}GB RAM -> 7b"
    } elseif ($hasNvidia -and $vramGB -ge 6 -and $ramGB -ge 12) {
      $model = "qwen2.5-coder:7b"
      $reason = "speed policy: modest NVIDIA + ${ramGB}GB RAM -> 7b"
    } elseif ($ramGB -ge 24 -and $hasNvidia) {
      $model = "qwen2.5-coder:7b"
      $reason = "speed policy: high RAM + GPU -> 7b"
    } else {
      $model = "qwen2.5-coder:3b"
      $reason = "speed policy: CPU or limited RAM (${ramGB}GB) / VRAM (${vramGB}GB) -> 3b for latency"
    }
  } else {
    # balanced: quality when hardware allows; still avoid 30b unless strong
    if ($hasNvidia -and $vramGB -ge 20 -and $ramGB -ge 48) {
      $model = "qwen3-coder:30b"
      $reason = "balanced: high-end GPU/RAM -> 30b"
    } elseif ($hasNvidia -and $vramGB -ge 6 -and $ramGB -ge 12) {
      $model = "qwen2.5-coder:7b"
      $reason = "balanced: GPU capable -> 7b"
    } elseif ($ramGB -ge 16) {
      $model = "qwen2.5-coder:7b"
      $reason = "balanced: ${ramGB}GB RAM CPU -> 7b"
    } else {
      $model = "qwen2.5-coder:3b"
      $reason = "balanced: limited host -> 3b"
    }
  }

  return [pscustomobject]@{
    Model = $model
    Policy = $Policy
    RamGB = $ramGB
    VramGB = $vramGB
    HasNvidia = $hasNvidia
    Reason = $reason
  }
}
