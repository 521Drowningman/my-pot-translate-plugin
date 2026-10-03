# 将插件打包为 .potext（把 info.json / main.js / icon.svg 压缩为 zip 后改名）
# 用法: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    # Windows PowerShell 5.1 默认按系统编码读文件，必须显式指定 UTF-8
    $id = (Get-Content info.json -Raw -Encoding UTF8 | ConvertFrom-Json).id
    $dest = Join-Path $PSScriptRoot "$id.potext"
    $zip = Join-Path $env:TEMP "$id.zip"
    foreach ($f in @($dest, $zip)) { if (Test-Path $f) { Remove-Item $f -Force } }
    # Compress-Archive 只接受 .zip 后缀，先压成 zip 再改名为 .potext
    Compress-Archive -Path info.json, main.js, icon.svg -DestinationPath $zip
    Move-Item $zip $dest
    Write-Host "已生成插件包: $dest"
} finally {
    Pop-Location
}
