$root = $PSScriptRoot
Write-Host "Initial PSScriptRoot: '$root' (length: $($root.Length))"

if ($null -eq $root -or $root -eq '') {
  $root = [System.IO.Directory]::GetCurrentDirectory()
  Write-Host "GetCurrentDirectory: '$root' (length: $($root.Length))"
}

if ($null -eq $root -or $root -eq '') {
  $root = "."
  Write-Host "Fallback root: '$root'"
}

Write-Host "Final root: '$root'"
$dataDir = [System.IO.Path]::Combine($root, "data")
Write-Host "dataDir: '$dataDir' (length: $($dataDir.Length))"
