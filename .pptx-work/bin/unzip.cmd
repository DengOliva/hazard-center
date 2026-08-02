@echo off
if "%~1"=="-Z1" (
  "C:\Program Files\7-Zip\7z.exe" l -ba -slt "%~2" | findstr /b "Path = " | findstr /v /c:"Path = %~2" | powershell -NoProfile -Command "$input -replace '^Path = ',''"
  exit /b %errorlevel%
)
if "%~1"=="-p" (
  "C:\Program Files\7-Zip\7z.exe" e -so "%~2" "%~3"
  exit /b %errorlevel%
)
exit /b 2
