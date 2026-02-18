param(
  [int]$Port = 7681,
  [string]$User = 'admin',
  [Parameter(Mandatory = $true)]
  [string]$Password,
  [ValidateSet('powershell','cmd')]
  [string]$Shell = 'powershell'
)

$root = Split-Path -Parent $PSScriptRoot
$ttyd = Join-Path $root 'bin\ttyd.exe'

if (!(Test-Path $ttyd)) {
  Write-Error "ttyd not found: $ttyd"
  exit 1
}

$credential = "$User`:$Password"

if ($Shell -eq 'cmd') {
  & $ttyd --writable -i 0.0.0.0 -p $Port -P 30 --credential $credential cmd.exe
} else {
  & $ttyd --writable -i 0.0.0.0 -p $Port -P 30 --credential $credential powershell.exe -NoLogo -NoExit
}
