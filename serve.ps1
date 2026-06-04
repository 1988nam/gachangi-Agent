# 가챙이 대시보드 - PowerShell HTTP 서버
# 실행: .\serve.ps1

$port = 8080
$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($root)) {
  $root = [System.IO.Directory]::GetCurrentDirectory()
}
if ([string]::IsNullOrWhiteSpace($root)) {
  $root = "."
}
$root = $root.Trim().Replace("`r", "").Replace("`n", "")
$dataDir = "$root/data"
$url  = "http://localhost:$port/"

Write-Host "  📂 Root Directory: '$root' (Length: $($root.Length))" -ForegroundColor Yellow
Write-Host "  📂 Data Directory: '$dataDir' (Length: $($dataDir.Length))" -ForegroundColor Yellow

if (-not [System.IO.Directory]::Exists($dataDir)) {
  [System.IO.Directory]::CreateDirectory($dataDir) | Out-Null
}
$dbFile = "$dataDir/transactions.json"
$backupFile = "$dataDir/transactions_backup.json"
$migrationFlagFile = "$dataDir/.migrated"

Write-Host "  📂 Database File: '$dbFile' (Length: $($dbFile.Length))" -ForegroundColor Yellow

# 백업 본 복구 및 초기 설정
if (-not [System.IO.File]::Exists($dbFile)) {
  if ([System.IO.File]::Exists($backupFile)) {
    [System.IO.File]::Copy($backupFile, $dbFile)
    Write-Host "  ♻️ transactions.json 복원 완료 (백업파일 활용)" -ForegroundColor Green
  } else {
    [System.IO.File]::WriteAllText($dbFile, "[]")
  }
}

# 데이터 저장 + 백업 헬퍼 함수
function Save-DataWithBackup($jsonText) {
  [System.IO.File]::WriteAllText($dbFile, $jsonText)
  [System.IO.File]::WriteAllText($backupFile, $jsonText)
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)
$listener.Start()

Write-Host ""
Write-Host "  ✅ 가챙이 대시보드 서버 시작!" -ForegroundColor Green
Write-Host "  🌐 브라우저에서 열기: $url" -ForegroundColor Cyan
Write-Host "  ⏹  종료: Ctrl+C`n" -ForegroundColor Yellow

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

# 브라우저 자동 오픈
Start-Process $url

while ($listener.IsListening) {
  $context  = $listener.GetContext()
  $req      = $context.Request
  $res      = $context.Response

  $rawPath  = $req.Url.LocalPath

  # ─── API 라우팅 ───

  # 1. POST /api/logs (에이전트 에러 로그)
  if ($req.HttpMethod -eq 'POST' -and $rawPath -eq '/api/logs') {
    try {
      $reader = [System.IO.StreamReader]::new($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()

      $logsDir = [System.IO.Path]::Combine($root, "logs")
      if (-not [System.IO.Directory]::Exists($logsDir)) {
        [System.IO.Directory]::CreateDirectory($logsDir) | Out-Null
      }

      $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
      $logFile = [System.IO.Path]::Combine($logsDir, "agent_failure_$timestamp.log")
      [System.IO.File]::WriteAllText($logFile, $body)

      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
      Write-Host "  POST $rawPath - Log saved to logs/" -ForegroundColor Green
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # 2. GET /api/transactions
  if ($req.HttpMethod -eq 'GET' -and $rawPath -eq '/api/transactions') {
    try {
      $content = [System.IO.File]::ReadAllText($dbFile)
      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $res.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
      $res.Headers.Add("Pragma", "no-cache")
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes($content)
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
      Write-Host "  GET $rawPath - Loaded database" -ForegroundColor Green
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # 3. POST /api/transactions
  if ($req.HttpMethod -eq 'POST' -and $rawPath -eq '/api/transactions') {
    try {
      $reader = [System.IO.StreamReader]::new($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()

      $newItems = ConvertFrom-Json $body
      $existingContent = [System.IO.File]::ReadAllText($dbFile)
      $existingItems = ConvertFrom-Json $existingContent
      if ($null -eq $existingItems) { $existingItems = @() }

      if ($newItems -is [System.Management.Automation.PSCustomObject]) {
        $newItems = @($newItems)
      }

      $maxRowIndex = 0
      foreach ($item in $existingItems) {
        if ([int]$item.rowIndex -gt $maxRowIndex) {
          $maxRowIndex = [int]$item.rowIndex
        }
      }

      foreach ($item in $newItems) {
        $maxRowIndex++
        $item | Add-Member -MemberType NoteProperty -Name "rowIndex" -Value $maxRowIndex -Force
        $existingItems += $item
      }

      $updatedJson = ConvertTo-Json $existingItems -Depth 10
      Save-DataWithBackup $updatedJson

      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
      Write-Host "  POST $rawPath - Added $($newItems.Length) transactions" -ForegroundColor Green
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # 4. PUT /api/transactions
  if ($req.HttpMethod -eq 'PUT' -and $rawPath -eq '/api/transactions') {
    try {
      $reader = [System.IO.StreamReader]::new($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()

      $updates = ConvertFrom-Json $body
      if ($updates -is [System.Management.Automation.PSCustomObject]) {
        $updates = @($updates)
      }

      $existingContent = [System.IO.File]::ReadAllText($dbFile)
      $existingItems = ConvertFrom-Json $existingContent
      if ($null -eq $existingItems) { $existingItems = @() }

      foreach ($up in $updates) {
        $target = $existingItems | Where-Object { [int]$_.rowIndex -eq [int]$up.rowIndex -and $_.month -eq $up.month }
        if ($null -ne $target) {
          if ($null -ne $up.date) { $target.date = $up.date }
          if ($null -ne $up.desc) { $target.desc = $up.desc }
          if ($null -ne $up.inc) { $target.inc = [int]$up.inc }
          if ($null -ne $up.exp) { $target.exp = [int]$up.exp }
          if ($null -ne $up.cat) { $target.cat = $up.cat }
          if ($null -ne $up.method) { $target.method = $up.method }
          if ($null -ne $up.needsReview) { $target.needsReview = $up.needsReview }
          if ($null -ne $up.bgColor) { $target.bgColor = $up.bgColor }
        }
      }

      $updatedJson = ConvertTo-Json $existingItems -Depth 10
      Save-DataWithBackup $updatedJson

      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
      Write-Host "  PUT $rawPath - Updated $($updates.Length) transactions" -ForegroundColor Green
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # 5. POST /api/transactions/delete
  if ($req.HttpMethod -eq 'POST' -and $rawPath -eq '/api/transactions/delete') {
    try {
      $reader = [System.IO.StreamReader]::new($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()

      $params = ConvertFrom-Json $body
      $month = $params.month
      $rowIndexes = @($params.rowIndexes)

      $existingContent = [System.IO.File]::ReadAllText($dbFile)
      $existingItems = ConvertFrom-Json $existingContent
      if ($null -eq $existingItems) { $existingItems = @() }

      $newItems = @()
      foreach ($item in $existingItems) {
        $isMatch = ($item.month -eq $month) -and ($rowIndexes -contains [int]$item.rowIndex)
        if (-not $isMatch) {
          $newItems += $item
        }
      }

      $updatedJson = ConvertTo-Json $newItems -Depth 10
      Save-DataWithBackup $updatedJson

      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
      Write-Host "  POST $rawPath - Deleted $($rowIndexes.Length) transactions from $month" -ForegroundColor Green
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # 5.5 GET /api/migration-status
  if ($req.HttpMethod -eq 'GET' -and $rawPath -eq '/api/migration-status') {
    try {
      $hasMigrated = [System.IO.File]::Exists($migrationFlagFile)
      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $res.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
      $res.Headers.Add("Pragma", "no-cache")
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"migrated": ' + $hasMigrated.ToString().ToLower() + '}')
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # 6. POST /api/migrate
  if ($req.HttpMethod -eq 'POST' -and $rawPath -eq '/api/migrate') {
    try {
      if ([System.IO.File]::Exists($migrationFlagFile)) {
        $res.StatusCode = 403
        $res.ContentType = "application/json; charset=utf-8"
        $body = [System.Text.Encoding]::UTF8.GetBytes('{"success":false,"message":"이미 마이그레이션이 완료되었습니다."}')
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
        $res.OutputStream.Close()
        continue
      }

      $reader = [System.IO.StreamReader]::new($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()

      Save-DataWithBackup $body
      [System.IO.File]::WriteAllText($migrationFlagFile, (Get-Date).ToString("o"))

      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
      $res.ContentLength64 = $responseBytes.Length
      $res.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
      Write-Host "  POST $rawPath - Successfully migrated Google Sheets database to local" -ForegroundColor Green
    } catch {
      $res.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Error: $($_.Exception.Message)")
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
    continue
  }

  # ─── 정적 파일 라우팅 ───
  $filePath = [System.IO.Path]::Combine($root, $rawPath.TrimStart('/').Replace('/', '\'))

  if ([System.IO.Directory]::Exists($filePath)) {
    $filePath = [System.IO.Path]::Combine($filePath, 'index.html')
  }

  if ([System.IO.File]::Exists($filePath)) {
    $ext      = [System.IO.Path]::GetExtension($filePath)
    $mime     = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
    $content  = [System.IO.File]::ReadAllBytes($filePath)

    $res.ContentType   = $mime
    $res.ContentLength64 = $content.Length
    $res.OutputStream.Write($content, 0, $content.Length)
    Write-Host "  $($req.HttpMethod) $rawPath" -ForegroundColor DarkGray
  } else {
    $res.StatusCode = 404
    $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rawPath")
    $res.OutputStream.Write($body, 0, $body.Length)
  }

  $res.OutputStream.Close()
}
