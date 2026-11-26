@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo CoC 7th TRPG를 Marinara에서 뺄까요? 게임 기록은 지우지 않아요.
pause
node "%~dp0install.mjs" uninstall
echo.
pause
