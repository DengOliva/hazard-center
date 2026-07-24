param(
    [Parameter(Mandatory=$true)]
    [string]$ServerUrl
)

$scriptPath = Join-Path $PSScriptRoot "training-right-click-upload.ps1"
$commandKey = "HKCU:\Software\Classes\*\shell\UploadToTrainingLedger"
New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $commandKey -Name "(Default)" -Value "Upload to Training Ledger"
Set-ItemProperty -Path $commandKey -Name "Icon" -Value "shell32.dll,167"
New-Item -Path "$commandKey\command" -Force | Out-Null
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -FilePath `"%1`" -ServerUrl `"$($ServerUrl.TrimEnd('/'))`""
Set-ItemProperty -Path "$commandKey\command" -Name "(Default)" -Value $command
Write-Host "Installed. Right-click a file and choose 'Upload to Training Ledger'."
