// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// agentStream: user-visible strings of the AI chat SSE stream (useAgentStream.js).
// SSE event names / status literals (awaiting_input etc.) and the AI_REGION_BLOCKED
// marker are contracts and are intentionally not here.
export default {
  // Background task panel
  taskInProgress: 'Task in progress…',
  taskStarting: 'Task starting…',
  taskCompleted: 'Task completed',
  taskFailed: 'Task failed',
  // Stream connection markers (markdown fragments appended to bubble content)
  connectionInterrupted: '*[Connection lost]*',
  // Stop notice (rendered from the separate bubble.stopNotice field, plain text)
  // "Stopping" is the wording until the cancelled event arrives: we cannot promise
  // the provider stops billing the moment the request is dropped.
  stopPending: 'Stopping…',
  stopUnconfirmed: 'Local waiting has ended, but the server stop was not confirmed. Check the task status after reconnecting.',
  // The request went out but no server confirmation came back (usually this stream died too)
  stopRequested: 'Stop requested, no server confirmation received',
  // The cancelled event arrived: this run really did stop
  stopConfirmed: 'Generation stopped',
  // Interrupt marker saved by the backend error path, moved out of the body on history load (BUG-42)
  stoppedWithError: 'Generation error, interrupted',
  // The run had already finished on its own when Stop was pressed (/cancel returned cancelled=false)
  stopAlreadyFinished: 'This run had already finished; there was nothing to stop',
  // Re-entrancy guard toast on send
  alreadyStreamingToast: 'AI is still running. Wait for it to finish or click Stop.',
  // Error messages
  chatRequestFailed: 'Chat request failed: HTTP {status}',
  errorWithMessage: '**Error**: {message}',
  executionInterrupted: '> **Execution interrupted**: {message}',
  regionBlockedNotice: '> **This model is not available in your current network region**: models hosted overseas are blocked by their providers when accessed from a Mainland China network. Switch to the AI WorkDeck Cloud channel in Settings, or choose a model marked as available in both regions and resend.',
  quotaExhaustedNotice: '> **AI service credits exhausted**: the balance or quota for the current channel has been used up. With your own key, top up with your provider (such as OpenRouter); with the AI WorkDeck Cloud channel, check your credit allocation on the account page.',
  contextOverflowNotice: '> **The conversation exceeds the model context window**: automatic compression was attempted but it still does not fit. Start a new conversation, or attach fewer or shorter files.',
  networkUnreachableNotice: '> **Network connection failed**: this machine could not reach the AI service (the network may be down, DNS may have failed, or a proxy may be blocking it). Check your connection and send the message again.',
  interruptedRunEndedNotice: '> **The connection was interrupted**: this run finished in the background while the connection was down, so the text above may be incomplete. Refresh the page or reopen this conversation to see the full record.',
  internalErrorNotice: '> **This run was interrupted by an internal error**: the work already done and the tool execution log have been saved and remain visible in the history. Send another message to continue; if this keeps happening, use the feedback button in the bottom-right corner to send us this conversation.',
  // Subtask progress rows
  subtaskStarted: 'Subtask started',
  subtaskEnded: 'Subtask finished',
  // Document streaming placeholder
  docStreamingPlaceholder: '*(Streaming content into the document…)*',
  // Streaming write failed: surface it rather than leaving the placeholder above (dev-board#465)
  docStreamFailedNotice: '> **The content did not make it into the document**: {reason}. The file was created but may be empty - open it to check, and ask me to write it again if needed.',
  docStreamReasonEditorNotReady: 'the document editor is not ready yet',
  docStreamReasonLoadFailed: 'the document failed to open; nothing was written',
  docStreamReasonWrongTarget: 'the editor currently has a different document open than the write target',
  docStreamReasonInsertFailed: 'stream_insert failed',
  docStreamReasonFlushFailed: 'stream_flush failed',
  docStreamReasonBlocked: 'the content could not be written into the document',
  docStreamReasonNoBody: 'the model did not emit any document body',
  docStreamReasonNothingReceived: 'the document received no content',
  missingFileIdError: 'Missing file ID',
  fileNotFoundError: 'File not found',
  editorNotReadyError: 'Editor is not ready',
  editorNotReadyOpenDocError: 'Editor is not ready. Please open a document first',
  editorStillBootingError: 'Editor is still starting up. Please retry the same step shortly',
  editorLoadFailedError: 'The document failed to open ({code}), so this step was not executed; please inform the user and stop editing this document',
  checkpointMissingIdError: 'Checkpoint restore is missing the file or operation ID',
  checkpointInProgressError: 'A checkpoint restore is already in progress for this document',
  checkpointStillRestoringError: 'Checkpoint restore is still in progress. Please reload the document shortly',
  checkpointEditorNotReadyError: 'Target editor is not ready yet; snapshot was not restored',
  checkpointPauseSaveFailedError: 'Could not pause saving on the target document; snapshot was not restored. Reopen the document and try again',
  checkpointCancelledError: 'Checkpoint restore was cancelled or superseded',
  checkpointDrainedUncertainError: 'Previous save outcome is uncertain; snapshot was not restored. Please verify the file and try again',
  checkpointEditorChangedError: 'Target editor changed during restore. Please reopen the document to verify',
  checkpointStateChangedError: 'Checkpoint restore state has changed. Please start the restore again',
  checkpointReloadFailedError: 'Snapshot was written back, but the editor failed to reload. Stop editing and reopen the document',
  checkpointUnknownPhaseError: 'Unknown checkpoint restore phase',
  checkpointRestoringStepSkippedError: 'Checkpoint restore is in progress; this step was not executed. Please wait for the restore to complete',
  pdfExportFailedError: 'PDF export failed',
  pdfExportEmptyError: 'PDF export result is empty',
  pdfExportTooLargeError: 'Exported PDF exceeds {mb}MB and cannot be saved into the project via AI; please use "File -> Export as PDF" instead',
  // Fallback process card title (ProcessCard.vue matches this exact string, do not reword)
  systemOperation: 'System Actions',
  // Artifact fallback file names
  taskListArtifact: 'Task List',
  planArtifact: 'Plan',
}
