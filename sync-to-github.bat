@echo off
REM =====================================================================
REM  GardenGrow AI - sync-to-github.bat  (Windows)
REM  ---------------------------------------------------------------------
REM  Uploads this folder's app files to https://github.com/ally0900/Garden-App
REM  Double-click it any time to upload your latest changes.
REM
REM  Optional: run it from Command Prompt with a message describing the change:
REM      sync-to-github.bat "Added a new crop to the crop guide"
REM
REM  Never uploaded: your .env (API key), photos, videos, and zip files.
REM =====================================================================

setlocal
set "REPO_URL=https://github.com/ally0900/Garden-App.git"
set "BRANCH=main"

cd /d "%~dp0"
echo.
echo  GardenGrow AI  -^>  GitHub
echo  Folder: %CD%
echo  Repo:   %REPO_URL%
echo.

REM ---------- 1. Make sure Git is installed ----------
where git >nul 2>&1
if errorlevel 1 (
  echo [X] Git isn't installed yet.
  echo     Download it from https://git-scm.com/download/win
  echo     Install with the default options, then double-click this file again.
  goto :fail
)

REM ---------- 2. Protect secrets and personal files ----------
if not exist ".gitignore" type nul > ".gitignore"
call :ignore ".env"
call :ignore ".env.*"
call :ignore "!.env.example"
call :ignore "node_modules/"
call :ignore ".DS_Store"
call :ignore "*.jpg"
call :ignore "*.jpeg"
call :ignore "*.png"
call :ignore "*.heic"
call :ignore "*.mov"
call :ignore "*.mp4"
call :ignore "*.zip"
call :ignore "GardenGrow-AI.html"

if not exist ".env.example" (
  > ".env.example" echo # Copy this file, name the copy ".env", and paste your real key below.
  >> ".env.example" echo # Never share .env or upload it to GitHub. It's listed in .gitignore.
  >> ".env.example" echo ANTHROPIC_API_KEY=paste-your-key-here
)

REM ---------- 3. Set up the repository (first run only) ----------
if not exist ".git" (
  echo Setting up Git in this folder...
  git init -q
  if errorlevel 1 goto :fail
  git symbolic-ref HEAD refs/heads/%BRANCH%
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin "%REPO_URL%"
) else (
  git remote set-url origin "%REPO_URL%"
)

REM ---------- 4. Make sure Git knows who you are ----------
git config user.name >nul 2>&1
if errorlevel 1 (
  set /p "GNAME=Your name (shown on GitHub commits): "
  call git config user.name "%%GNAME%%"
)
git config user.email >nul 2>&1
if errorlevel 1 (
  set /p "GMAIL=Your email (the one on your GitHub account): "
  call git config user.email "%%GMAIL%%"
)

REM ---------- 5. Stage changes, and double-check .env is NOT included ----------
git add -A
git ls-files --error-unmatch .env >nul 2>&1
if not errorlevel 1 (
  git rm -q --cached .env
  echo [!] .env was about to be uploaded - removed it. Your key stays on this computer only.
)

git diff --cached --quiet
if errorlevel 1 (
  set "MSG=%~1"
  if "%~1"=="" set "MSG=Update GardenGrow AI (%DATE% %TIME:~0,5%)"
  call git commit -q -m "%%MSG%%"
  if errorlevel 1 goto :fail
  echo [OK] Saved your changes.
) else (
  echo No new changes to save.
)
git branch -M %BRANCH% >nul 2>&1

REM ---------- 6. Get anything new from GitHub, then upload ----------
git ls-remote --exit-code --heads origin %BRANCH% >nul 2>&1
if not errorlevel 1 (
  echo Getting the latest from GitHub...
  git pull -q --rebase origin %BRANCH%
  if errorlevel 1 (
    echo [X] Your files and GitHub's copy changed in the same place.
    echo     Fix the files Git lists, then run:  git rebase --continue
    echo     Or undo with:  git rebase --abort
    goto :fail
  )
)

echo Uploading to GitHub... (a sign-in window may open the first time)
git push -u origin %BRANCH%
if errorlevel 1 (
  echo [X] Upload failed. Check that you're signed in to the ally0900 GitHub account
  echo     and have access to the Garden-App repository.
  goto :fail
)

echo.
echo [OK] Done! See it at https://github.com/ally0900/Garden-App
echo.
pause
exit /b 0

:ignore
findstr /l /x /c:"%~1" ".gitignore" >nul 2>&1 || (>> ".gitignore" echo %~1)
exit /b 0

:fail
echo.
pause
exit /b 1
