# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "main" / "native"))
import native_review_uno

if __name__ == "__main__":
    native_review_uno.main()
else:
    sys.modules[__name__] = native_review_uno
