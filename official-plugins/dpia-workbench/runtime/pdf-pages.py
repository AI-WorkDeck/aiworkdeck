# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The subset of pdftoppm's CLI used by the upstream report runner."""
import argparse
from render import render_pages

parser = argparse.ArgumentParser()
parser.add_argument('-r', type=int, default=120)
parser.add_argument('-png', action='store_true')
parser.add_argument('document')
parser.add_argument('prefix')
args = parser.parse_args()
if not args.png or not 72 <= args.r <= 300:
    raise ValueError('Unsupported rendering options')
render_pages(args.document, args.prefix, args.r)
