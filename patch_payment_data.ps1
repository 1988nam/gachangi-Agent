param()
$dbPath = "data\transactions.json"
$content = [System.IO.File]::ReadAllText($dbPath, [System.Text.Encoding]::UTF8)

$sz = $content.Length
Write-Host "Loaded: $sz chars"

# Method strings (via char codes only)
$m_woori   = [char]0xC6B0 + [char]0xB9AC + [char]0xC740 + [char]0xD589
$m_hyundai = [char]0xD604 + [char]0xB300 + [char]0xCE74 + [char]0xB4DC
$m_shinhan = [char]0xC2E0 + [char]0xD55C + [char]0xCE74 + [char]0xB4DC

# Search keywords (via char codes only)
$kw_costco = [char]0xCF54 + [char]0xC2A4 + [char]0xD2B8 + [char]0xCF54
$kw_gajon  = [char]0xAC00 + [char]0xC804

# Old method strings
$old_bank  = '"method":  "' + [char]0xC740 + [char]0xD589 + "/" + [char]0xD604 + [char]0xAE08 + '"'
$new_w_str = '"method":  "' + $m_woori + '"'

# PATCH 1: bank/cash -> woori (any remaining)
$cnt1 = ([regex]::Matches($content, [regex]::Escape($old_bank))).Count
$content = $content.Replace($old_bank, $new_w_str)
Write-Host "P1 bank->woori: $cnt1"

# PATCH 3+4: per-record costco->hyundai, gajon->shinhan
$lines = $content -split "\r?\n"
$pendingM = $null
$modC = 0
$modG = 0
$out = New-Object System.Collections.Generic.List[string]

foreach ($ln in $lines) {
    $t = $ln.Trim()

    # detect desc keyword
    if ($t.StartsWith('"desc"')) {
        if ($t -like "*$kw_costco*") {
            $pendingM = $m_hyundai
        } elseif ($t -like "*$kw_gajon*") {
            $pendingM = $m_shinhan
        } else {
            $pendingM = $null
        }
    }

    # apply to method line
    if (($pendingM -ne $null) -and $t.StartsWith('"method"')) {
        $comma = $ln.TrimEnd().EndsWith(",")
        $ind = [regex]::Match($ln, '^\s*').Value
        if ($comma) {
            $ln = $ind + '"method":  "' + $pendingM + '",'
        } else {
            $ln = $ind + '"method":  "' + $pendingM + '"'
        }
        if ($pendingM -eq $m_hyundai) { $modC++ } else { $modG++ }
        $pendingM = $null
    }

    $out.Add($ln)
}

$content = $out -join "`r`n"
Write-Host "P3 costco->hyundai: $modC"
Write-Host "P4 gajon->shinhan:  $modG"

[System.IO.File]::WriteAllText($dbPath, $content, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText("data\transactions_backup.json", $content, [System.Text.Encoding]::UTF8)
Write-Host "All patches complete."
