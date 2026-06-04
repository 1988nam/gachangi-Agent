param()
$json = [System.IO.File]::ReadAllText("data\transactions.json", [System.Text.Encoding]::UTF8)
$txs = ConvertFrom-Json $json

$dist = @{}
foreach ($tx in $txs) {
    $m = if ($tx.method) { $tx.method } else { "(empty)" }
    if ($dist.ContainsKey($m)) {
        $dist[$m] = $dist[$m] + 1
    } else {
        $dist[$m] = 1
    }
}

Write-Host "=== Updated method distribution ==="
foreach ($key in ($dist.Keys | Sort-Object)) {
    Write-Host "  ${key} : $($dist[$key])"
}
Write-Host "Total: $($txs.Count)"
