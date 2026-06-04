param()
$txt = [System.IO.File]::ReadAllText("data\transactions.json", [System.Text.Encoding]::UTF8)
$idx = $txt.IndexOf("method")
if ($idx -ge 0) {
    $snippet = $txt.Substring($idx, 50)
    Write-Host "Snippet: [$snippet]"
    # Show hex values of each char
    for ($i = 0; $i -lt [Math]::Min(50, $snippet.Length); $i++) {
        $c = $snippet[$i]
        $hex = [int][char]$c
        Write-Host "  [$i] '$c' = 0x$('{0:X4}' -f $hex)"
    }
} else {
    Write-Host "method not found in file"
}
