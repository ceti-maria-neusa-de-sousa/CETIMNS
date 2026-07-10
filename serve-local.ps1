param(
  [int]$Port = 8080
)

$root = (Get-Location).Path
$hostIp = [System.Net.IPAddress]::Parse("127.0.0.1")
$listener = [System.Net.Sockets.TcpListener]::new($hostIp, $Port)

$contentTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".svg" = "image/svg+xml"
  ".pdf" = "application/pdf"
  ".mp4" = "video/mp4"
  ".webm" = "video/webm"
}

function Write-Response {
  param(
    [System.Net.Sockets.TcpClient]$Client,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body
  )

  $stream = $Client.GetStream()
  $header = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $stream.Write($Body, 0, $Body.Length)
  }
  $stream.Flush()
}

try {
  $listener.Start()
  Write-Host "CETI site running at http://127.0.0.1:$Port/"
  Write-Host "Press Ctrl+C to stop."

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if (-not $requestLine) {
        continue
      }

      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") {
          break
        }
      }

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Bad request")
        Write-Response -Client $client -StatusCode 400 -StatusText "Bad Request" -ContentType "text/plain; charset=utf-8" -Body $body
        continue
      }

      $requestPath = [Uri]::UnescapeDataString($parts[1])
      if ([string]::IsNullOrWhiteSpace($requestPath) -or $requestPath -eq "/") {
        $requestPath = "/index.html"
      }

      $relativePath = $requestPath.TrimStart("/")
      $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))
      $rootPath = [System.IO.Path]::GetFullPath($root)

      if (-not $filePath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Write-Response -Client $client -StatusCode 403 -StatusText "Forbidden" -ContentType "text/plain; charset=utf-8" -Body $body
        continue
      }

      if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        Write-Response -Client $client -StatusCode 404 -StatusText "Not Found" -ContentType "text/plain; charset=utf-8" -Body $body
        continue
      }

      $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
      if ($contentTypes.ContainsKey($extension)) {
        $contentType = $contentTypes[$extension]
      } else {
        $contentType = "application/octet-stream"
      }

      $body = [System.IO.File]::ReadAllBytes($filePath)
      Write-Response -Client $client -StatusCode 200 -StatusText "OK" -ContentType $contentType -Body $body
    } catch {
      $body = [System.Text.Encoding]::UTF8.GetBytes("Internal server error")
      try {
        Write-Response -Client $client -StatusCode 500 -StatusText "Internal Server Error" -ContentType "text/plain; charset=utf-8" -Body $body
      } catch {
      }
    } finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
