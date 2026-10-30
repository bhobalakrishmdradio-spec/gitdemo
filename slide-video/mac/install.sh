#!/bin/bash
# SlideCast installer for macOS.
#
# Installs the tools SlideCast needs (via Homebrew), asks for your Anthropic API
# key and a password, and registers SlideCast to start automatically when you
# log in. Run it again any time to update or change settings.
#
#   ./slide-video/mac/install.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_DIR="$HOME/.slidecast"
CONF="$CONF_DIR/config.env"
DATA_DIR="$HOME/Library/Application Support/SlideCast"
LOG="$HOME/Library/Logs/SlideCast.log"
LABEL="com.slidecast.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask_yes() {  # ask_yes "Question" default(y/n)
    local reply
    read -r -p "$1 [$( [[ $2 == y ]] && echo Y/n || echo y/N )] " reply
    reply=${reply:-$2}
    [[ $reply =~ ^[Yy] ]]
}

[[ "$(uname)" == Darwin ]] || die "This installer is for macOS."

# ------------------------------------------------------------------ Homebrew
bold "1/5  Checking Homebrew"
if ! command -v brew >/dev/null; then
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        [[ -x $b ]] && eval "$("$b" shellenv)" && break
    done
fi
if ! command -v brew >/dev/null; then
    echo "SlideCast uses Homebrew (https://brew.sh) to install ffmpeg, Python and fonts."
    ask_yes "Install Homebrew now?" y || die "Homebrew is required. Install it from https://brew.sh and run this again."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        [[ -x $b ]] && eval "$("$b" shellenv)" && break
    done
fi
command -v brew >/dev/null || die "Homebrew is not on PATH. Open a new Terminal window and run this again."

# ------------------------------------------------------------------ tools
bold "2/5  Installing tools (this can take a few minutes the first time)"
brew install python@3.12 ffmpeg espeak-ng
# DejaVu for captions; Noto for Hindi, Marathi, Tamil, Telugu, Malayalam, Kannada and Bengali.
brew install --cask font-dejavu font-noto-sans-devanagari font-noto-sans-tamil font-noto-sans-telugu \
    font-noto-sans-malayalam font-noto-sans-kannada font-noto-sans-bengali \
    || warn "Some fonts didn't install; captions in those languages may not display."
if ! [[ -d /Applications/LibreOffice.app ]]; then
    echo "PowerPoint (.pptx) uploads need LibreOffice (~800 MB). PDFs and images work without it."
    if ask_yes "Install LibreOffice?" n; then
        brew install --cask libreoffice || warn "LibreOffice didn't install; export decks as PDF instead."
    fi
fi

PY="$(brew --prefix python@3.12)/bin/python3.12"
[[ -x $PY ]] || die "Python 3.12 not found at $PY"
"$PY" -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

# ------------------------------------------------------------------ settings
bold "3/5  Settings"
mkdir -p "$CONF_DIR" "$DATA_DIR" "$(dirname "$LOG")" "$(dirname "$PLIST")"
chmod 700 "$CONF_DIR"

reconfigure=y
if [[ -f $CONF ]]; then
    ask_yes "Keep your current API key, password and access settings?" y && reconfigure=n
fi

if [[ $reconfigure == y ]]; then
    echo "Your Anthropic API key (from https://console.anthropic.com/settings/keys). Typing is hidden."
    while :; do
        read -r -s -p "API key: " API_KEY; echo
        [[ $API_KEY == sk-ant-* ]] && break
        warn "That doesn't look like an Anthropic key (they start with sk-ant-). Try again."
    done

    echo
    echo "Choose a password for SlideCast. You'll type it once on each device."
    while :; do
        read -r -s -p "Password (8+ characters): " PW1; echo
        read -r -s -p "Password again: " PW2; echo
        [[ ${#PW1} -ge 8 ]] || { warn "Use at least 8 characters."; continue; }
        [[ $PW1 == "$PW2" ]] && break
        warn "Passwords don't match. Try again."
    done

    echo
    echo "How will your iPhone and iPad reach this Mac?"
    echo "  1) Tailscale (recommended): works at home and away, encrypted, only your own devices."
    echo "  2) Home Wi-Fi only: no extra app, but only works on the same network as this Mac."
    read -r -p "Choose 1 or 2 [1]: " ACCESS
    if [[ ${ACCESS:-1} == 2 ]]; then HOST=0.0.0.0; else HOST=127.0.0.1; fi

    (
        umask 077
        {
            echo "# SlideCast settings. Re-run mac/install.sh to change them."
            printf 'ANTHROPIC_API_KEY=%q\n' "$API_KEY"
            printf 'SLIDECAST_PASSWORD=%q\n' "$PW1"
            printf 'SLIDECAST_SECRET=%q\n' "$(openssl rand -hex 32)"
            printf 'SLIDECAST_DATA=%q\n' "$DATA_DIR"
            printf 'SLIDECAST_HOST=%q\n' "$HOST"
            printf 'SLIDECAST_PORT=%q\n' "8000"
            printf 'SLIDECAST_KEEP_DAYS=%q\n' "30"
        } > "$CONF"
    )
    unset API_KEY PW1 PW2
fi
chmod 600 "$CONF"
# shellcheck disable=SC1090
read -r HOST PORT < <(. "$CONF"; echo "$SLIDECAST_HOST $SLIDECAST_PORT")

# ------------------------------------------------------------------ auto-start
bold "4/5  Starting SlideCast (and at every login)"
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$(xml_escape "$APP_DIR/mac/run.sh")</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>$(xml_escape "$LOG")</string>
    <key>StandardErrorPath</key><string>$(xml_escape "$LOG")</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" && break
    sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" \
    || die "SlideCast didn't start. See the log: $LOG"

# ------------------------------------------------------------------ iPhone/iPad access
bold "5/5  iPhone & iPad access"
PHONE_URL=""
if [[ $HOST == 127.0.0.1 ]]; then
    TS=""
    for t in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
        command -v "$t" >/dev/null 2>&1 && TS=$t && break
    done
    if [[ -n $TS ]] && "$TS" status >/dev/null 2>&1; then
        if "$TS" serve --bg "$PORT" >/dev/null 2>&1; then
            DNS=$("$TS" status --json | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
            PHONE_URL="https://$DNS"
        else
            warn "Couldn't turn on 'tailscale serve'. You may need to enable HTTPS for your tailnet:"
            warn "https://login.tailscale.com/admin/dns (turn on MagicDNS and HTTPS Certificates), then run this again."
        fi
    else
        warn "Tailscale isn't installed or signed in on this Mac yet."
        echo "  1. Install Tailscale from the Mac App Store (or https://tailscale.com/download) and sign in."
        echo "  2. Install Tailscale on your iPhone and iPad from the App Store, same account."
        echo "  3. Run this installer again; it will finish the setup."
    fi
else
    PHONE_URL="http://$(scutil --get LocalHostName).local:$PORT"
    echo "If macOS asks whether Python may accept incoming connections, click Allow."
fi

bold "✓ SlideCast is running"
echo "On this Mac:      http://localhost:$PORT"
echo "                  Safari ▸ File ▸ Add to Dock…  makes it an app with its own icon."
if [[ -n $PHONE_URL ]]; then
    echo "iPhone & iPad:    $PHONE_URL"
    echo "                  Open it in Safari ▸ Share ▸ Add to Home Screen."
fi
echo "Settings:         $CONF"
echo "Videos:           $DATA_DIR"
echo "Log:              $LOG"
echo "Keep the Mac awake while making videos from your phone (System Settings ▸ Battery/Energy)."
open "http://localhost:$PORT"
