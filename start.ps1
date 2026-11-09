param(
  [switch]$NoOpen,
  [int]$Port = 5173
)

# 墨记单词 - local server
# Usage: right click -> Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))

$mime = @{
  '.html'        = 'text/html; charset=utf-8'
  '.css'         = 'text/css; charset=utf-8'
  '.js'          = 'application/javascript; charset=utf-8'
  '.json'        = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'         = 'image/svg+xml'
  '.png'         = 'image/png'
  '.jpg'         = 'image/jpeg'
  '.ico'         = 'image/x-icon'
  '.txt'         = 'text/plain; charset=utf-8'
}

$listener = $null
for ($p = $Port; $p -lt ($Port + 15); $p++) {
  try {
    $l = [System.Net.HttpListener]::new()
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $Port = $p
    break
  } catch { }
}

if (-not $listener) {
  Write-Host "No free port between $Port and $($Port + 14)." -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  Moji Words is running:' -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Cyan
Write-Host ''
Write-Host '  Open the URL in Edge/Chrome, then choose "Install app" to add it to your desktop.'
Write-Host '  Press Ctrl+C to stop.'
Write-Host ''

if (-not $NoOpen) { Start-Process $url }

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }

    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $res.Close()
      continue
    }

    if (Test-Path -LiteralPath $full -PathType Container) {
      $full = Join-Path $full 'index.html'
    }

    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.ContentLength64 = $bytes.Length
      $res.Headers.Add('Cache-Control', 'no-cache')
      try {
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
      } catch { }
    } else {
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.StatusCode = 404
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $body.Length
      try {
        $res.OutputStream.Write($body, 0, $body.Length)
        $res.OutputStream.Close()
      } catch { }
    }
  } catch {
    try { $ctx.Response.Abort() } catch { }
  }
}
