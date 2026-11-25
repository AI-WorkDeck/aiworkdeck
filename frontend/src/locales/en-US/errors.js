// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "You're offline, so the request wasn't sent. Check your connection, then select Retry.",
  "timeout": "The service took too long to respond. Try again in a moment; for large files, split them into smaller parts.",
  "localServiceDown": "The local service isn't ready or has stopped. Wait a few seconds; if this keeps happening, restart AI WorkDeck.",
  "signInRequired": "This feature needs an AI WorkDeck account. Sign in and you'll come right back here.",
  "sessionExpired": "Your sign-in has expired. Sign in again; unsaved work is kept.",
  "forbidden": "You don't have permission to do this. Ask the matter owner or your firm admin for access.",
  "balanceLow": "Your AI credit has run out; this request wasn't charged. Top up in Settings → Account & balance.",
  "rateLimited": "Too many requests right now, so the model service is throttling. Wait a minute and try again.",
  "modelUnavailable": "The selected model is unavailable right now. Try again later, or pick another model below the message box.",
  "modelKeyInvalid": "The model provider rejected the key this computer still uses from an older setup. Sign in to your AI WorkDeck account to use the official AI channel instead.",
  "streamInterrupted": "The answer was cut off; what arrived so far is kept above. Select Retry to generate it again.",
  "streamInterruptedResumable": "The answer was cut off; what arrived so far is kept above. Select Continue to pick up where it stopped, or Retry to start over.",
  "streamInterruptedTwice": "It was cut off again. Select Retry to generate the whole answer again.",
  "serverError": "Something went wrong on our side and this action didn't finish. Try again later; if it keeps happening, send us feedback.",
  "conflict": "This was changed elsewhere, or the previous action is still running. Refresh and try again.",
  "fileTooLarge": "The file is too large (limit {limit}). Compress or split it, then upload again.",
  "fileUnreadable": "This file can't be opened; it may be damaged or password-protected. Save a fresh copy from the original app and try again.",
  "notFound": "We can't find this item; it may have been moved or deleted. Refresh the list.",
  "marketplaceUnavailable": "Can't reach the Marketplace right now; installed plugins still work. Check your connection, then select Refresh.",
  "pluginInstallFailed": "Couldn't install “{name}”; nothing else changed. Try again later; if it still fails, send feedback with the details.",
  "unknown": "That didn't work. Try again; if it keeps happening, send feedback with the details.",
  "actions": {
    "retry": "Retry",
    "details": "Details",
    "hideDetails": "Hide details",
    "continue": "Continue",
    "continueTooltip": "Pick up where it stopped without regenerating what's already there",
    "refresh": "Refresh",
    "signIn": "Sign in",
    "feedback": "Feedback"
  }
}
