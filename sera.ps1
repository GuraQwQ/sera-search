#requires -Version 7.3

$PSNativeCommandArgumentPassing = 'Standard'
$PSNativeCommandUseErrorActionPreference = $false
$nodePath = if ($env:SERA_NODE -and (Test-Path -LiteralPath $env:SERA_NODE -PathType Leaf)) {
    $env:SERA_NODE
} else {
    Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
}
if ($nodePath) {
    & $nodePath -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
    if ($LASTEXITCODE -eq 0) {
        & $nodePath (Join-Path $PSScriptRoot 'portable.mjs') @args
        exit $LASTEXITCODE
    }
}
[Console]::Error.WriteLine('需要 Node.js 22+；完整地理扩展需要 Node.js 24+。')
[Console]::Error.WriteLine('下载：https://nodejs.org/en/download')
[Console]::Error.WriteLine('可设置 SERA_NODE 指向已有的 node.exe。')
exit 1
