@echo off
REM =====================================================================
REM  GardenGrow AI - sync-to-github.bat  (Windows)
REM  ---------------------------------------------------------------------
REM  Double-click to upload this folder's latest app to GitHub:
REM      https://github.com/ally0900/Garden-App
REM  The public website updates 1-2 minutes later:
REM      https://ally0900.github.io/Garden-App/
REM
REM  It also downloads any changes already on GitHub first (for example,
REM  updates Claude uploaded), so nothing gets overwritten.
REM
REM  Optional: run it from Command Prompt with a note about the change:
REM      sync-to-github.bat "Added okra to the crop guide"
REM
REM  Never uploaded: API keys (.env, ai-settings.json), photos, videos, zips.
REM =====================================================================

setlocal
set "REPO_URL=https://github.com/ally0900/Garden-App.git"
set "SITE_URL=https://ally0900.github.io/Garden-App/"
set "BRANCH=main"
title Upload GardenGrow AI to GitHub

cd /d "%~dp0"
echo.
echo  GardenGrow AI  -^>  GitHub
echo  Folder: %CD%
echo.

REM ---------- 1. Is Git installed? ----------
where git >nul 2>&1
if errorlevel 1 (
  echo [X] Git isn't installed yet.
  echo     1. The download page will open now. Install with the default options.
  echo     2. Then double-click this file again.
  start "" "https://git-scm.com/download/win"
  goto :fail
)

REM ---------- 2. Is this the app folder? ----------
if not exist "index.html" (
  echo [X] index.html isn't in this folder.
  echo     Put sync-to-github.bat in the same folder as the app's index.html.
  goto :fail
)

REM ---------- 2b. Tell Git this folder is safe to use ----------
REM  Git refuses to work in a folder whose files were saved by a different
REM  Windows user ("dubious ownership"). Marking this one folder as safe fixes it.
set "SAFEDIR=%CD:\=/%"
git config --global --get-all safe.directory 2>nul | findstr /x /i /l /c:"%SAFEDIR%" >nul
if errorlevel 1 (
  git config --global --add safe.directory "%SAFEDIR%"
  echo [OK] Marked this folder as safe for Git.
)

REM ---------- 3. Keep secrets and personal files out of GitHub ----------
if not exist ".gitignore" type nul > ".gitignore"
call :ignore ".env"
call :ignore ".env.*"
call :ignore "ai-settings.json"
call :ignore "node_modules/"
call :ignore ".DS_Store"
call :ignore "*.jpg"
call :ignore "*.jpeg"
call :ignore "*.png"
call :ignore "*.heic"
call :ignore "*.mov"
call :ignore "*.mp4"
call :ignore "*.zip"
call :ignore "*.bundle"
call :ignore "GardenGrow-AI.html"

REM ---------- 4. Clear leftover Git lock files (only if Git isn't running) ----------
tasklist /fi "imagename eq git.exe" 2>nul | find /i "git.exe" >nul
if errorlevel 1 (
  if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1
  if exist ".git\HEAD.lock" del /f /q ".git\HEAD.lock" >nul 2>&1
  if exist ".git\objects\maintenance.lock" del /f /q ".git\objects\maintenance.lock" >nul 2>&1
)

REM ---------- 5. Connect this folder to GitHub (first time only) ----------
set "NEWREPO="
if not exist ".git" (
  echo Connecting this folder to GitHub...
  git init -q
  if errorlevel 1 goto :fail
  git symbolic-ref HEAD refs/heads/%BRANCH%
  set "NEWREPO=1"
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin "%REPO_URL%"
) else (
  git remote set-url origin "%REPO_URL%"
)

REM ---------- 6. Make sure Git knows who you are (needed to save changes) ----------
:askname
git config user.name >nul 2>&1
if errorlevel 1 (
  echo.
  echo Git needs your name and email once, to label your uploads.
  set "GNAME="
  set /p "GNAME=Your name (for example: Jane Smith): "
  call :setname
  goto :askname
)
:askemail
git config user.email >nul 2>&1
if errorlevel 1 (
  set "GMAIL="
  set /p "GMAIL=Your email (the one on your GitHub account): "
  call :setemail
  goto :askemail
)

REM ---------- 7. Get GitHub's latest history ----------
echo Checking GitHub for the latest version...
git fetch -q origin %BRANCH% 2>nul
if errorlevel 1 (
  echo [!] Couldn't reach GitHub. Check the internet connection.
  echo     ^(If this is the first upload, a sign-in window may appear next.^)
)
if defined NEWREPO (
  REM A brand-new folder: build on GitHub's history instead of starting over.
  git rev-parse -q --verify origin/%BRANCH% >nul 2>&1
  if not errorlevel 1 git reset -q --mixed origin/%BRANCH%
)

REM ---------- 8. Save your changes ----------
git add -A
git ls-files --error-unmatch .env >nul 2>&1
if not errorlevel 1 (
  git rm -q --cached .env
  echo [!] .env was about to be uploaded - left it out. Your key stays on this computer.
)
git diff --cached --quiet
if errorlevel 1 (
  set "MSG=%~1"
  if "%~1"=="" set "MSG=Update GardenGrow AI (%DATE% %TIME:~0,5%)"
  call git commit -q -m "%%MSG%%"
  if errorlevel 1 goto :fail
  echo [OK] Saved your changes:
  git show --stat --format="" HEAD
) else (
  echo No new changes in this folder.
)
git branch -M %BRANCH% >nul 2>&1

REM ---------- 9. Bring in anything new from GitHub ----------
git rev-parse -q --verify origin/%BRANCH% >nul 2>&1
if not errorlevel 1 (
  git merge-base --is-ancestor origin/%BRANCH% HEAD >nul 2>&1
  if errorlevel 1 (
    echo Adding the newer changes from GitHub...
    git rebase -q origin/%BRANCH%
    if errorlevel 1 (
      git rebase --abort >nul 2>&1
      echo.
      echo [X] The same part of a file was changed both here and on GitHub,
      echo     so nothing was uploaded and your files were left as they were.
      echo     Ask Claude to help combine them, or tell it which version to keep.
      goto :fail
    )
  )
)

REM ---------- 10. Upload ----------
git rev-list --count origin/%BRANCH%..HEAD >"%TEMP%\gg_ahead.txt" 2>nul || echo 1 >"%TEMP%\gg_ahead.txt"
set /p AHEAD=<"%TEMP%\gg_ahead.txt"
del "%TEMP%\gg_ahead.txt" >nul 2>&1
if "%AHEAD%"=="0" (
  echo.
  echo [OK] GitHub already has the latest version. Nothing to upload.
  goto :done
)
echo Uploading to GitHub... ^(a sign-in window may open the first time^)
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo [X] Upload failed.
  echo     If the message above says "Permission denied" or "403", this computer is
  echo     signed in to GitHub as a different account. To fix it:
  echo       1. Open the Start menu, type Credential Manager, and open it.
  echo       2. Click Windows Credentials.
  echo       3. Remove any entry named git:https://github.com
  echo       4. Double-click this file again and sign in as ally0900.
  echo     Otherwise, check the internet connection and try again.
  goto :fail
)
echo.
echo [OK] Uploaded! The website updates in 1-2 minutes.

:done
echo.
echo     GitHub:   https://github.com/ally0900/Garden-App
echo     Website:  %SITE_URL%
echo.
choice /c YN /n /t 20 /d N /m "Open the website now? [Y/N] "
if errorlevel 2 goto :end
start "" "%SITE_URL%"
:end
exit /b 0

:setname
if defined GNAME git config --global user.name "%GNAME%"
exit /b 0

:setemail
if defined GMAIL git config --global user.email "%GMAIL%"
exit /b 0

:ignore
findstr /l /x /c:"%~1" ".gitignore" >nul 2>&1 || (>> ".gitignore" echo %~1)
exit /b 0

:fail
echo.
pause
exit /b 1
