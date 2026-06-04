param()
$txt = [System.IO.File]::ReadAllText("data\transactions.json", [System.Text.Encoding]::UTF8)

$m1 = [char]0xC6B0 + [char]0xB9AC + [char]0xC740 + [char]0xD589
$m2 = [char]0xD558 + [char]0xB098 + [char]0xCE74 + [char]0xB4DC
$m3 = [char]0xD604 + [char]0xB300 + [char]0xCE74 + [char]0xB4DC
$m4 = [char]0xC2E0 + [char]0xD55C + [char]0xCE74 + [char]0xB4DC
$m5 = [char]0xCE74 + [char]0xCE74 + [char]0xC624 + [char]0xBC45 + [char]0xD06C
$m6 = [char]0xD61C + [char]0xC601 + [char]0xCE74 + [char]0xB4DC

$p = '"method":  "'
$e = '"'

$c1 = ([regex]::Matches($txt, [regex]::Escape($p + $m1 + $e))).Count
$c2 = ([regex]::Matches($txt, [regex]::Escape($p + $m2 + $e))).Count
$c3 = ([regex]::Matches($txt, [regex]::Escape($p + $m3 + $e))).Count
$c4 = ([regex]::Matches($txt, [regex]::Escape($p + $m4 + $e))).Count
$c5 = ([regex]::Matches($txt, [regex]::Escape($p + $m5 + $e))).Count
$c6 = ([regex]::Matches($txt, [regex]::Escape($p + $m6 + $e))).Count

Write-Host "=== Method Distribution ==="
Write-Host "woori:   $c1"
Write-Host "hana:    $c2"
Write-Host "hyundai: $c3"
Write-Host "shinhan: $c4"
Write-Host "kakao:   $c5"
Write-Host "hye:     $c6"
Write-Host "Total: $($c1 + $c2 + $c3 + $c4 + $c5 + $c6)"

$old1 = '"method":  "' + [char]0xC740 + [char]0xD589 + "/" + [char]0xD604 + [char]0xAE08 + '"'
$old2 = '"method":  "' + [char]0xC815 + [char]0xD604 + " " + [char]0xCE74 + [char]0xB4DC + '"'
$o1 = ([regex]::Matches($txt, [regex]::Escape($old1))).Count
$o2 = ([regex]::Matches($txt, [regex]::Escape($old2))).Count
Write-Host "OLD bank/cash: $o1, OLD jh card: $o2"
