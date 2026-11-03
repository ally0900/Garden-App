#!/usr/bin/env bash
# =====================================================================
#  GardenGrow AI — upload-to-github.sh
#  ---------------------------------------------------------------------
#  Uploads this project folder to GitHub. Run it again any time to
#  upload your latest changes.
#
#  HOW TO RUN (Mac Terminal):
#    1. Open Terminal.
#    2. Type:  cd   (with a space after it), drag this folder into the
#       Terminal window, and press Enter.
#    3. Type:  bash upload-to-github.sh   and press Enter.
#
#  Optional: add a message describing your changes:
#       bash upload-to-github.sh "Added a new crop to the crop guide"
#
#  Your secret API key file (.env) is NEVER uploaded. This script
#  checks for it and stops if it would be.
# =====================================================================

set -euo pipefail

# ---------- Settings you can change ----------
DEFAULT_REPO_NAME="gardengrow-ai"
DEFAULT_BRANCH="main"

# ---------- Helpers ----------
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }
ask() {  # ask "Question" "default" -> prints the answer
  local prompt="$1" default="${2:-}" reply
  if [ -n "$default" ]; then read -r -p "$prompt [$default]: " reply || true; else read -r -p "$prompt: " reply || true; fi
  printf "%s" "${reply:-$default}"
}

# Always work in the folder this script lives in.
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

echo
bold "🌱 GardenGrow AI → GitHub"
echo "Folder: $PROJECT_DIR"
echo

# ---------- 1. Make sure git is installed ----------
if ! command -v git >/dev/null 2>&1; then
  red "Git isn't installed yet."
  echo "On a Mac, run:   xcode-select --install"
  echo "(or download it from https://git-scm.com), then run this script again."
  exit 1
fi

# ---------- 2. Make sure the .gitignore protects secrets and student data ----------
touch .gitignore
add_ignore() { grep -qxF -- "$1" .gitignore || echo "$1" >> .gitignore; }
add_ignore ".env"
add_ignore ".env.*"
add_ignore "!.env.example"
add_ignore "node_modules/"
add_ignore ".DS_Store"
add_ignore "*.zip"
add_ignore "gardengrow-backup-*.json"   # classroom backups contain student work, keep them off GitHub
add_ignore "GardenGrow AI App/"         # an extra copy of the app unzipped inside this folder

# ---------- 3. Set up the git repository (first time only) ----------
if [ ! -d .git ]; then
  git init -q
  git checkout -q -b "$DEFAULT_BRANCH" 2>/dev/null || true
  green "✔ Created a new git repository in this folder."
fi
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")"

# Git needs a name and email for each saved version (they appear on GitHub).
if [ -z "$(git config user.name || true)" ]; then
  NAME="$(ask "Your name (shown on GitHub commits)")"
  git config user.name "$NAME"
fi
if [ -z "$(git config user.email || true)" ]; then
  EMAIL="$(ask "Your email (use the one on your GitHub account)")"
  git config user.email "$EMAIL"
fi

# ---------- 4. Connect to a GitHub repository (first time only) ----------
REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
CREATED_WITH_GH="no"

if [ -z "$REMOTE_URL" ]; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    # GitHub CLI is installed and signed in: we can create the repository for you.
    echo "The GitHub CLI is signed in, so I can create the repository for you."
    REPO_NAME="$(ask "Repository name" "$DEFAULT_REPO_NAME")"
    VIS="$(ask "Make it private or public? (private/public)" "private")"
    case "$VIS" in public|Public|PUBLIC) VIS_FLAG="--public" ;; *) VIS_FLAG="--private" ;; esac
    gh repo create "$REPO_NAME" "$VIS_FLAG" --source=. --remote=origin \
      --description "GardenGrow AI: scan, learn, grow. A classroom garden assistant." >/dev/null
    REMOTE_URL="$(git remote get-url origin)"
    CREATED_WITH_GH="yes"
    green "✔ Created the GitHub repository: $REMOTE_URL"
  else
    echo "First, create an EMPTY repository on GitHub:"
    echo "  1. Go to https://github.com/new"
    echo "  2. Repository name: $DEFAULT_REPO_NAME (or anything you like)"
    echo "  3. Choose Private (recommended) or Public"
    echo "  4. Do NOT tick “Add a README”, .gitignore, or license"
    echo "  5. Click “Create repository” and copy the HTTPS link"
    echo "     (it looks like https://github.com/your-username/$DEFAULT_REPO_NAME.git)"
    echo
    REMOTE_URL="$(ask "Paste the repository link here")"
    REMOTE_URL="$(printf "%s" "$REMOTE_URL" | tr -d '[:space:]')"
    if [ -z "$REMOTE_URL" ]; then red "No link entered. Nothing was uploaded."; exit 1; fi
    case "$REMOTE_URL" in
      *github.com*|*.git) ;;
      *) yellow "That doesn't look like a GitHub link, but I'll try it anyway." ;;
    esac
    git remote add origin "$REMOTE_URL"
    echo "Checking the link (GitHub may ask you to sign in)…"
    if ! git ls-remote origin >/dev/null 2>&1 && ! git ls-remote origin; then
      git remote remove origin
      red "Couldn't reach that repository. Check the link and your sign-in, then run this script again."
      exit 1
    fi
    green "✔ Connected this folder to $REMOTE_URL"
  fi
fi

# ---------- 5. Save a new version (commit) ----------
git add -A

# Safety check: never upload the API key file.
if git diff --cached --name-only | grep -Eq '(^|/)\.env$|(^|/)\.env\.[^e]'; then
  git reset -q
  red "STOPPED: your secret .env file was about to be uploaded."
  echo "Check that .gitignore contains a line that says .env, then run this script again."
  exit 1
fi

if git diff --cached --quiet; then
  echo "No new changes to save. Checking that GitHub is up to date…"
else
  echo "Files in this upload:"
  git diff --cached --name-status | sed 's/^/   /'
  MSG="${1:-}"
  if [ -z "$MSG" ]; then
    MSG="$(ask "Describe this update" "Update GardenGrow AI ($(date '+%b %d, %Y'))")"
  fi
  git commit -q -m "$MSG"
  green "✔ Saved a new version: \"$MSG\""
fi

# ---------- 6. Upload (push) to GitHub ----------
echo
echo "Uploading to GitHub…"
echo "(If asked to sign in: your username is your GitHub username, and the"
echo " “password” is a personal access token from https://github.com/settings/tokens,"
echo " not your normal password. Your Mac will remember it after the first time.)"
echo

if ! git push -u origin "$BRANCH"; then
  yellow "GitHub already has some files this folder doesn't (for example a README made on the website)."
  echo "Combining them with your files, then trying again…"
  if git pull --no-rebase --no-edit --allow-unrelated-histories origin "$BRANCH" && git push -u origin "$BRANCH"; then
    :
  else
    red "The upload didn't finish."
    echo "Common fixes:"
    echo "  • Sign-in failed: make a token at https://github.com/settings/tokens (tick “repo”), then run again."
    echo "  • Wrong link: run   git remote set-url origin <correct link>   and run this script again."
    echo "  • “Merge conflict”: the same file was changed in both places. Open the files listed above,"
    echo "    keep the version you want, then run this script again."
    exit 1
  fi
fi

# ---------- Done ----------
WEB_URL="$(git remote get-url origin | sed -e 's#^git@github.com:#https://github.com/#' -e 's#\.git$##')"
echo
green "🎉 Done! Your project is on GitHub:"
bold  "   $WEB_URL"
echo
echo "Next time you change the app, just run   bash upload-to-github.sh   again."
if [ "$CREATED_WITH_GH" = "yes" ]; then echo "(The repository was created as ${VIS_FLAG#--}.)"; fi
echo "Note: sample-photo.js contains a photo of the project garden. Keep the repository"
echo "private if you'd rather not share it publicly."
