#!/bin/sh
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:?Usage: build.sh /absolute/output/awd-local-data}
mkdir -p "$(dirname -- "$output")"
xcrun swiftc -O -module-cache-path "$(dirname -- "$output")/swift-module-cache" \
  "$source_dir/main.swift" -o "$output" -lsqlite3
