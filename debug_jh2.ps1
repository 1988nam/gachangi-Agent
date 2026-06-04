param()
$txt = [System.IO.File]::ReadAllText("data\transactions_backup_payment_methods.json", [System.Text.Encoding]::UTF8)

# Search for 정현 카드 in method field - find it by searching method field with 정현
# 정=0xC815 현=0xD604 카=? 드=?
# Let's find method field with 정 after it
$search = '"method":  "' + [char]0xC815
$idx = $txt.IndexOf($search)
if ($idx -ge 0) {
    $snip = $txt.Substring($idx, 35)
    Write-Host "Found at index $idx"
    for ($i = 0; $i -lt [Math]::Min(35, $snip.Length); $i++) {
        $c = $snip[$i]
        $hex = [int][char]$c
        Write-Host "  [$i] '$c' = 0x$('{0:X4}' -f $hex)"
    }
} else {
    Write-Host "Not found! Searching for just '0xC815' in method..."
    # Might be compact format 
    $search2 = '"method": "' + [char]0xC815
    $idx2 = $txt.IndexOf($search2)
    if ($idx2 -ge 0) {
        Write-Host "Found compact format at $idx2"
        $snip = $txt.Substring($idx2, 35)
        for ($i = 0; $i -lt [Math]::Min(35, $snip.Length); $i++) {
            $c = $snip[$i]
            $hex = [int][char]$c
            Write-Host "  [$i] '$c' = 0x$('{0:X4}' -f $hex)"
        }
    } else {
        Write-Host "Not found in either format"
        # search in whole txt
        $idx3 = $txt.IndexOf([char]0xC815 + [char]0xD604 + " " + [char]0xCB4C)
        Write-Host "Direct search result: $idx3"
        $idx4 = $txt.IndexOf([char]0xC815 + [char]0xD604 + " " + [char]0xCE74)
        Write-Host "Alt card char search result: $idx4"
    }
}
