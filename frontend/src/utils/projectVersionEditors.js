// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { beginCheckpointSaveBarrier, checkpointSaveBarrier, endCheckpointSaveBarrier } from './checkpointSaveBarrier.js'

// Called only after durable saves. Reuse the file-level generation fence so
// uploads and replacement editors cannot overwrite the result of a version action.
export async function protectProjectVersionEditors({ projectId, operationId, fileIds, instances, current, registered, readWriteState }) {
  const barriers = []
  let reloadPromise
  const owns = b => checkpointSaveBarrier(projectId, b.fileId) === b
  const invalidate = () => {
    for (const b of barriers) if (owns(b)) {
      for (const inst of b.instances) if (String(inst.file?.id) === String(b.fileId)) inst.failCheckpointRestore?.(operationId)
    }
  }
  const release = () => {
    for (const b of barriers) endCheckpointSaveBarrier(projectId, b.fileId, operationId)
  }
  try {
    for (const fileId of new Set(fileIds.map(String))) {
      const b = beginCheckpointSaveBarrier(projectId, fileId, operationId)
      if (!b) throw new Error('aiActionBusy')
      b.instances = instances.filter(inst => String(inst.file?.id) === fileId)
      b.readWriteState = readWriteState
      barriers.push(b)
    }
    for (const b of barriers) {
      for (const inst of b.instances) {
        if (!current() || !registered(inst) || typeof inst.prepareCheckpointRestore !== 'function' ||
            !await inst.prepareCheckpointRestore(operationId)) throw new Error('aiEditorNotReady')
      }
      if (!await b.drained || !owns(b) || !current()) throw new Error('aiEditorNotReady')
    }
  } catch (error) {
    invalidate()
    release() // Mutation has not started; retrying a fresh load is safe.
    throw error
  }
  return {
    release, invalidate,
    reload() {
      if (!reloadPromise) reloadPromise = (async () => {
        let ok = true
        for (const b of barriers) for (const inst of b.instances) {
          if (!current() || !owns(b) || !registered(inst) || String(inst.file?.id) !== String(b.fileId)) { ok = false; continue }
          try {
            if (!await inst.reloadFromBackend(operationId) || !current() || !owns(b) || !registered(inst) ||
                String(inst.file?.id) !== String(b.fileId)) ok = false
          } catch { ok = false }
        }
        if (!ok) invalidate()
        return ok && current()
      })()
      return reloadPromise
    },
  }
}
