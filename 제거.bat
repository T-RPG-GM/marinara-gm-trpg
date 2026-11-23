@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 마리나라 GM 전용 TRPG를 Marinara에서 뺄까요? 게임 기록은 지우지 않아요.
pause
node "%~dp0install.mjs" uninstall
echo.
pause
