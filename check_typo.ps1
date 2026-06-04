$dbPath = "data/transactions.json"
$json = [System.IO.File]::ReadAllText($dbPath, [System.Text.Encoding]::UTF8)
$txs = ConvertFrom-Json $json

# Construct Unicode strings for '헤영' (typo)
$he_typo = [char]0xd5e4 + [char]0xc601
$gg = [char]0xacf5 + [char]0xae08

# Check typo matches
$target1 = "*$he_typo*$gg*"
$matches1 = $txs | Where-Object { $_.desc -like $target1 }
Write-Host "Found typo matches (헤영 공금): $($matches1.Count)"
foreach ($m in $matches1) {
  Write-Host ("{0} - {1}: {2} ({3}원)" -f $m.month, $m.desc, $m.cat, $m.exp)
}

# Also list ALL entries that contain '공금' regardless of prefix
$matches2 = $txs | Where-Object { $_.desc -like "*$gg*" }
Write-Host "Found all '공금' matches: $($matches2.Count)"
foreach ($m in $matches2) {
  Write-Host ("{0} - {1}: {2} ({3}원)" -f $m.month, $m.desc, $m.cat, $m.exp)
}
