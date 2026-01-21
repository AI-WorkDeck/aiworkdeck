# Documentation Architecture: Open Source & Commercial

This document explains the structure of the project's documentation and how it supports a dual-licensing model.

## Core Philosophy
We separate "Code" (Open Source) from "Product" (Commercial/Brand). This architecture is designed to be:
1.  **Defensible:** Prevents trademark confusion and unauthorized SaaS cloning.
2.  **Clear:** Users immediately know if they are compliant or need to pay.
3.  **Sustainable:** Funnels commercial usage into a revenue stream to support development.

## File Structure & Purpose

### 1. `README.md` (The Billboard)
- **Role:** First impression.
- **Key Elements:**
    - Explicit definitions: "Community Edition (Kernel)".
    - Immediate license notice: AGPLv3 for community, Commercial for SaaS.
    - Funnel: "Need to keep it closed? Buy a license."

### 2. `LICENSE` (The Law)
- **Role:** Legal enforceability.
- **Content:** Standard AGPLv3 text. No ambiguity.

### 3. `COMMERCIAL-LICENSE.md` (The Sales Path)
- **Role:** The "Buy Button".
- **Content:** Explains *why* you need it (SaaS, indemnification) and *how* to get it. It changes the conversation from "I'm copying your code" to "I'm buying a partnership".

### 4. `TRADEMARKS.md` (The Brand Shield)
- **Role:** Prevents "Reputation Hijacking".
- **Concept:** You can fork the *code* (AGPL), but you can't fork the *reputation* (Name/Logo). Competitors must rebrand, adding friction to low-effort copying.

### 5. `CLA.md` (The Future-Proofer)
- **Role:** Rights consolidation.
- **Concept:** Ensures that valid commercial licenses can still be issued even after accepting community code. Without this, a single contributor could theoretically block a commercial license deal by claiming copyright on their 5 lines of code.

### 6. `SECURITY.md` & `CONTRIBUTING.md` (The Professionalism)
- **Role:** Trust signals.
- **Effect:** Shows enterprise users that this is a mature, managed project, not a hobbyist script.
