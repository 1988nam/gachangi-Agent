param()
$txt = [System.IO.File]::ReadAllText("data\transactions_backup_payment_methods.json", [System.Text.Encoding]::UTF8)
$idx = $txt.IndexOf("method")
while ($idx -ge 0) {
    $snippet = $txt.Substring($idx, 30)
    if ($snippet -match "method") {
        Write-Host "---"
        for ($i = 0; $i -lt [Math]::Min(28, $snippet.Length); $i++) {
            $c = $snippet[$i]
            $hex = [int][char]$c
            Write-Host "  [$i] '$c' = 0x$('{0:X4}' -f $hex)"
        }
        break
    }
    $idx = $txt.IndexOf("method", $idx + 1)
}

# Find the 정현 카드 entry
$target = [char]0xC815 + [char]0xD604
$idx2 = $txt.IndexOf($target)
if ($idx2 -ge 0) {
    $snip2 = $txt.Substring([Math]::Max(0, $idx2 - 15), 50)
    Write-Host "=== Around 정현 ==="
    for ($i = 0; $i -lt [Math]::Min(50, $snip2.Length); $i++) {
        $c = $snip2[$i]
        $hex = [int][char]$c
        Write-Host "  [$i] '$c' = 0x$('{0:X4}' -f $hex)"
    }
}
