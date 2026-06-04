$dbPath = "data/transactions.json"
$backupPath = "data/transactions_backup.json"

if (Test-Path $dbPath) {
  $json = [System.IO.File]::ReadAllText($dbPath, [System.Text.Encoding]::UTF8)
  $txs = ConvertFrom-Json $json
  
  # Group by month and assign row indices starting from 4
  $grouped = $txs | Group-Object month
  $updatedTxs = @()
  
  foreach ($g in $grouped) {
    $monthName = $g.Name
    $idx = 4
    foreach ($item in $g.Group) {
      # If rowIndex is already present and valid, we could keep it, but it's safer to re-assign sequentially
      # since they were originally sequential in Google Sheets anyway.
      if ($null -eq $item.rowIndex -or $item.rowIndex -eq 0 -or $true) {
        $item | Add-Member -MemberType NoteProperty -Name "rowIndex" -Value $idx -Force
      }
      $updatedTxs += $item
      $idx++
    }
  }
  
  # Convert to JSON and save
  $updatedJson = ConvertTo-Json $updatedTxs -Depth 10
  [System.IO.File]::WriteAllText($dbPath, $updatedJson, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($backupPath, $updatedJson, [System.Text.Encoding]::UTF8)
  
  Write-Host "Successfully assigned rowIndices to $($updatedTxs.Count) transactions."
} else {
  Write-Host "Database file not found."
}
