#!/bin/bash

# This script is a placeholder/guide for downloading LibreOffice WASM.
# Since the binaries are large and often hosted on specific project pages (like ZetaOffice),
# this script creates the necessary structure and instructions.

TARGET_DIR="frontend/static/libreoffice-wasm"
mkdir -p "$TARGET_DIR"

echo "========================================================"
echo "      LibreOffice WASM (ZetaOffice) Setup Guide"
echo "========================================================"
echo ""
echo "Downloading ZetaOffice WASM binaries from CDN..."

BASE_URL="https://cdn.zetaoffice.net/zetaoffice_latest"

# List of files to download
FILES=(
  "soffice.js"
  "soffice.wasm"
  "soffice.data"
  "qtloader.js"
  "qtlogo.svg"
)

for file in "${FILES[@]}"; do
  echo "Downloading $file..."
  curl -L -o "$TARGET_DIR/$file" "$BASE_URL/$file" || {
     echo "Failed to download $file"
  }
done

echo "Download complete. Files saved in $TARGET_DIR"

