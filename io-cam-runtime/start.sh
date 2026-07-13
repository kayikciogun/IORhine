#!/usr/bin/env bash
# Backend starter script for IO-CAM Runtime
# Created by Antigravity AI Coding Assistant

set -e

# Navigate to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Print banner
echo "========================================="
echo "  IO-CAM Backend Starter (Antigravity)   "
echo "========================================="

show_help() {
    echo "Usage: ./start.sh [options]"
    echo ""
    echo "Options:"
    echo "  -m, --mock       Force mock hardware mode (sets IO_CAM_MOCK_HARDWARE=1)"
    echo "  -i, --install    Force dependency installation/update"
    echo "  -h, --help       Show this help message"
    echo ""
}

FORCE_INSTALL=false
FORCE_MOCK=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -m|--mock) FORCE_MOCK=true ;;
        -i|--install) FORCE_INSTALL=true ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown option: $1"; show_help; exit 1 ;;
    esac
    shift
done

# 1. Setup .env if it doesn't exist
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "[+] .env file not found. Copying from .env.example..."
        cp .env.example .env
    else
        echo "[!] .env.example not found, skipping environment file setup."
    fi
fi

# 2. Check virtual environment
VENV_DIR=".venv"
FIRST_RUN=false

if [ ! -d "$VENV_DIR" ]; then
    echo "[+] Creating virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
    FIRST_RUN=true
fi

# Activate virtual environment
if [ -f "$VENV_DIR/bin/activate" ]; then
    echo "[+] Activating virtual environment..."
    source "$VENV_DIR/bin/activate"
else
    echo "[!] Activation script not found in $VENV_DIR/bin/activate"
    exit 1
fi

# 3. Check and install dependencies
# If it's a first run, or uvicorn is missing, or user requested it, install dependencies
if [ "$FIRST_RUN" = true ] || [ ! -x "$(command -v uvicorn)" ] || [ "$FORCE_INSTALL" = true ]; then
    echo "[+] Installing/Updating backend dependencies (pip install -e \".[dev]\")..."
    pip install --upgrade pip
    pip install -e ".[dev]"
else
    echo "[+] Dependencies are already installed. (Use -i or --install to force update)"
fi

# 4. Set Mock Hardware environment variable if requested
if [ "$FORCE_MOCK" = true ]; then
    echo "[+] Forcing Mock Hardware: IO_CAM_MOCK_HARDWARE=1"
    export IO_CAM_MOCK_HARDWARE=1
else
    # Check if IO_CAM_MOCK_HARDWARE is already in .env or environment
    if [ -f ".env" ] && grep -q "IO_CAM_MOCK_HARDWARE=1" .env; then
        echo "[+] Running with Mock Hardware (detected in .env)"
    else
        # We can also load the rest of the .env file automatically
        if [ -f ".env" ]; then
            echo "[+] Loading environment variables from .env"
            export $(grep -v '^#' .env | xargs)
        fi
    fi
fi

# 5. Run server
echo "[+] Starting FastAPI server on port 8000..."
echo "-----------------------------------------"
exec uvicorn app.main:app --reload --port 8000
