Get-Process ttyd -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Output 'ttyd stopped.'
