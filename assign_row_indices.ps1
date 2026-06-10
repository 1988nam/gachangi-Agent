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
      # 기존 rowIndex가 유효하면(실제 구글시트 행을 가리킴) 그대로 보존한다.
      # 과거 '-or $true' 버그로 항상 재할당 → 시트 실제 행과 어긋나 이후 수정/삭제가
      # 엉뚱한 행을 건드렸다. 비어 있거나 0일 때만 순차 부여한다.
      if ($null -eq $item.rowIndex -or $item.rowIndex -eq 0) {
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
