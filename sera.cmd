@echo off
setlocal
if defined SERA_NODE if exist "%SERA_NODE%" goto configured
where node.exe >nul 2>nul
if errorlevel 1 goto missing
node.exe -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)" >nul 2>nul
if errorlevel 1 goto missing
node.exe "%~dp0portable.mjs" %*
exit /b %errorlevel%
:configured
"%SERA_NODE%" -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)" >nul 2>nul
if errorlevel 1 goto missing
"%SERA_NODE%" "%~dp0portable.mjs" %*
exit /b %errorlevel%
:missing
echo Node.js 22+ is required. Full geospatial support requires Node.js 24+.
echo Download: https://nodejs.org/en/download
echo Set SERA_NODE to an existing node.exe path.
exit /b 1
