param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string]$ServerUrl
)

$events = Invoke-RestMethod -Uri "$ServerUrl/api/training-ledger/events"
if (-not $events.items -or $events.items.Count -eq 0) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Create a training item on the website first.", "Training Ledger") | Out-Null
    exit 1
}

$choices = $events.items | ForEach-Object { "$($_.id) | $($_.training_date) | $($_.name)" }
$selected = $choices | Out-GridView -Title "Choose a training item" -OutputMode Single
if (-not $selected) { exit 0 }
$eventId = ($selected -split "\|")[0].Trim()
$password = Read-Host "Training ledger admin password"

$result = & curl.exe -sS -X POST `
    -F "password=$password" `
    -F "files=@$FilePath" `
    "$ServerUrl/api/training-ledger/events/$eventId/files"
Add-Type -AssemblyName PresentationFramework
if ($LASTEXITCODE -eq 0 -and $result -match '"ok":true') {
    [System.Windows.MessageBox]::Show("Upload complete. The date was added to the filename.", "Training Ledger") | Out-Null
} else {
    [System.Windows.MessageBox]::Show("Upload failed: $result", "Training Ledger") | Out-Null
    exit 1
}
