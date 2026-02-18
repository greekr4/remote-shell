param(
  [int]$Port = 7681,
  [ValidateSet('powershell','cmd')]
  [string]$Shell = 'powershell'
)

$root = Split-Path -Parent $PSScriptRoot
$ttyd = Join-Path $root 'bin\ttyd.exe'

if (!(Test-Path $ttyd)) {
  Write-Error "ttyd not found: $ttyd"
  exit 1
}

if ($Shell -eq 'cmd') {
  & $ttyd --writable -i 127.0.0.1 -p $Port -P 30 cmd.exe
} else {
  & $ttyd --writable -i 127.0.0.1 -p $Port -P 30 powershell.exe -NoLogo -NoExit
}
