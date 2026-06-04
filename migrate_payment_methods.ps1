param()

$src = "data\transactions_backup_payment_methods.json"
$dst = "data\transactions.json"
[System.IO.File]::Copy($src, $dst, $true)
Write-Host "Restored backup."

$txt = [System.IO.File]::ReadAllText($dst, [System.Text.Encoding]::UTF8)
Write-Host "File chars: $($txt.Length)"

# Verified char codes:
# 정=0xC815 현=0xD604 카=0xCE74 드=0xB4DC  (정현 카드)
# 혜=0xD61C 영=0xC601                       (혜영)
# 은=0xC740 행=0xD589                       (은행)
# 현=0xD604 금=0xAE08                       (현금)
# 우=0xC6B0 리=0xB9AC                       (우리)
# 하=0xD558 나=0xB098                       (하나)
# 뱅=0xBC45 크=0xD06C                       (뱅크)

$old_bank_cash = '"method":  "' + [char]0xC740 + [char]0xD589 + "/" + [char]0xD604 + [char]0xAE08 + '"'
$old_jh_card   = '"method":  "' + [char]0xC815 + [char]0xD604 + " " + [char]0xCE74 + [char]0xB4DC + '"'
$old_hye_card  = '"method":  "' + [char]0xD61C + [char]0xC601 + " " + [char]0xCE74 + [char]0xB4DC + '"'

# New values (no space between 혜영 and 카드)
$new_woori     = '"method":  "' + [char]0xC6B0 + [char]0xB9AC + [char]0xC740 + [char]0xD589 + '"'
$new_hana      = '"method":  "' + [char]0xD558 + [char]0xB098 + [char]0xCE74 + [char]0xB4DC + '"'
$new_hye       = '"method":  "' + [char]0xD61C + [char]0xC601 + [char]0xCE74 + [char]0xB4DC + '"'

$cnt_bk = ([regex]::Matches($txt, [regex]::Escape($old_bank_cash))).Count
$cnt_jh = ([regex]::Matches($txt, [regex]::Escape($old_jh_card))).Count
$cnt_hy = ([regex]::Matches($txt, [regex]::Escape($old_hye_card))).Count
Write-Host "Before: bank/cash=$cnt_bk, jh_card=$cnt_jh, hye_card=$cnt_hy"

$txt = $txt.Replace($old_bank_cash, $new_woori)
$txt = $txt.Replace($old_jh_card,   $new_hana)
$txt = $txt.Replace($old_hye_card,  $new_hye)

$cnt_bk2 = ([regex]::Matches($txt, [regex]::Escape($old_bank_cash))).Count
$cnt_jh2 = ([regex]::Matches($txt, [regex]::Escape($old_jh_card))).Count
$cnt_hy2 = ([regex]::Matches($txt, [regex]::Escape($old_hye_card))).Count
$cnt_w   = ([regex]::Matches($txt, [regex]::Escape($new_woori))).Count
$cnt_h   = ([regex]::Matches($txt, [regex]::Escape($new_hana))).Count
$cnt_hh  = ([regex]::Matches($txt, [regex]::Escape($new_hye))).Count

Write-Host "After:"
Write-Host "  Remaining old: bank/cash=$cnt_bk2, jh=$cnt_jh2, hye=$cnt_hy2"
Write-Host "  New: woori=$cnt_w, hana=$cnt_h, hyeyeong=$cnt_hh"

[System.IO.File]::WriteAllText($dst, $txt, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText("data\transactions_backup.json", $txt, [System.Text.Encoding]::UTF8)
Write-Host "Done. File size: $($txt.Length)"
