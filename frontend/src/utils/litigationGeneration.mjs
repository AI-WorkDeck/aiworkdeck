// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatAskUserAnswer } from './askUserAnswer.mjs'

const ACTIVE = new Set(['starting', 'running', 'waiting', 'checking', 'stopping', 'paused'])
const copy = value => JSON.parse(JSON.stringify(value))

// The map pipeline predates structured questions. Its checkpoint result already
// contains the exact user-facing questions; use that block if the model leaves
// it in ordinary prose. Never surface the internal next-step instructions.
function checkpointQuestion(bubble) {
  const tools = (bubble?.processes || []).flatMap(p => p.items || []).filter(i => i.type === 'tool')
  const checkpoint = tools.findLast(i => i.status === 'success' && /^\s*litigation_checkpoint\s*\(/.test(i.code))
  if (!checkpoint || tools.some(i => i.status === 'success' && /^\s*litigation_render\s*\(/.test(i.code))) return null
  const marker = '\n\n────────── 以下是给你（AI）的执行指引'
  const end = checkpoint.output.indexOf(marker)
  if (end < 0) return null
  const text = checkpoint.output.slice(0, end).trim()
  return text ? { text, options: [], descriptions: [], answered: false } : null
}

// Owns a dedicated native Agent stream, never a ChatInterface or its preferences.
// Persist the submission ID before sending: a lost HTTP receipt is retried through
// the existing inbox idempotency boundary, not by starting another conversation.
export function createLitigationGeneration({ stream, api, storage, isCurrent, openFile, changed,
  text, uuid = () => crypto.randomUUID(), now = () => Date.now() }) {
  let task = null
  let disposed = false
  let submitting = false
  let checking = null
  let restoring = null
  const current = () => !disposed && isCurrent()
  const persist = () => { if (current() && task) storage.save(copy(task)) }
  const last = () => stream.bubbles.value.at(-1)
  const pending = (prompt, clientRequestId = uuid(), extra = {}) => ({ ...extra, clientRequestId,
    prompt: `${prompt}\n\n${text('questionProtocol')}` })
  const requireCurrent = () => { if (!current()) throw new Error(text('contextChanged')) }
  const view = () => task ? copy({ taskId: task.id, phase: task.phase, message: task.message || '',
    question: task.question || null, startedAt: task.startedAt, resultFileId: task.resultFileId || null }) : { phase: 'idle' }
  const setPhase = (phase, message = '') => { task.phase = phase; task.message = message; persist() }

  stream.onClientAction(action => {
    if (!current() || !task || !ACTIVE.has(task.phase)) return
    // Only the diagram delivery signal is relevant. Never forward editor commands
    // from this task to the user's currently focused document.
    if (action.action === 'doc_open_file' && action.fileId) {
      task.outputIds = [...new Set([...task.outputIds, String(action.fileId)])]
      persist()
    }
  })

  async function recover() {
    if (restoring) return restoring
    restoring = (async () => {
      const [inbox, history] = await Promise.all([api.inbox(task.conversationId), api.history(task.conversationId)])
      requireCurrent()
      const entry = inbox.items?.find(item => item.clientRequestId === task.pending?.clientRequestId)
      task.accepted ||= !!entry || !!task.pending?.clientRequestId && history.some(message => message.clientRequestId === task.pending.clientRequestId)
      stream.resetSSE()
      stream.setConversationId(task.conversationId)
      stream.clearBubbles()
      for (const message of history) {
        if (message.role?.toUpperCase() === 'ASSISTANT') {
          stream.bubbles.value.push(stream.parseAssistantHistory(message.content || '', message.reasoning))
        } else {
          const previous = last()
          if (previous?.question) previous.question.answered = true
          stream.bubbles.value.push({ role: 'USER', content: message.content, clientRequestId: message.clientRequestId })
        }
      }
      await stream.loadConversationMetadata(task.conversationId)
      requireCurrent()
      stream.agentRunStatus.value = inbox.status || null
      stream.isStreaming.value = inbox.status === 'RUNNING'
      stream.agentAwaitingInput.value = inbox.status === 'AWAITING_INPUT'
      // No matching receipt means the persisted request may never have reached
      // the server. Keep its ID and offer retry instead of waiting indefinitely.
      if (!task.accepted) setPhase('failed', text('failed'))
      else if (!inbox.status) {
        if (last()?.question && !last().question.answered) {
          stream.agentAwaitingInput.value = true
          setPhase('running')
        } else if (task.outputIds.length || stream.fileChanges.value.length) {
          stream.agentRunStatus.value = 'FINISHED'
          setPhase('running')
        } else setPhase('paused', text('paused'))
      } else if (task.phase !== 'stopping') setPhase('running')
      if (!await stream.reattachSSE(task.conversationId)) throw new Error(text('reconnect'))
      requireCurrent()
    })().finally(() => { restoring = null })
    return restoring
  }

  async function restore() {
    if (restoring) return restoring
    if (task || disposed) return
    const saved = storage.load()
    if (!saved?.id || !saved.conversationId) return
    task = saved
    stream.setConversationId(task.conversationId)
    if (!ACTIVE.has(task.phase) && task.phase !== 'failed') return
    try { await recover() }
    catch (error) { if (current()) setPhase('failed', error.message) }
  }

  async function checkResult() {
    if (checking) return checking
    const captured = task
    setPhase('checking')
    checking = (async () => {
      try {
        const diagrams = await api.diagrams()
        if (!current() || task !== captured) return
        // A pre-existing gallery entry, or another concurrent task's new diagram,
        // must not turn a failed generation into success. Correlate actual file IDs.
        const ids = new Set([...task.outputIds, ...stream.fileChanges.value.map(f => String(f.fileId || ''))])
        const changedNames = stream.fileChanges.value.map(f => f.fileName).filter(Boolean)
        const diagram = diagrams.find(d => [d.drawioFileId, d.svgFileId, d.pngFileId].some(id => id && ids.has(String(id)))
          || (!task.baselineFolders?.includes(String(d.folderId)) && changedNames.some(name => name === d.name || name.startsWith(d.name + '.'))))
        if (!diagram) {
          setPhase('failed', text('noDiagram'))
          return
        }
        task.resultFileId = diagram.drawioFileId || diagram.svgFileId
        task.question = null
        setPhase('completed')
        changed()
        if (!task.opened) {
          task.opened = true
          persist()
          try { await openFile(task.resultFileId) }
          catch { if (current()) { task.message = text('openFailed'); persist() } }
        }
      } catch (error) {
        if (current() && task === captured) setPhase('failed', error.message)
      }
    })().finally(() => { checking = null })
    return checking
  }

  async function observe() {
    requireCurrent()
    await restore()
    if (!task || submitting || !ACTIVE.has(task.phase)) return view()
    const status = stream.agentRunStatus.value
    // The inbox snapshot may say RUNNING just before the reconnect reports a
    // terminal state. That authoritative state ends this task's local busy flag.
    if (status && status !== 'RUNNING') stream.isStreaming.value = false
    const bubble = last()
    const question = bubble?.question || (status === 'FINISHED' ? checkpointQuestion(bubble) : null)
    if (status === 'CANCELLED') setPhase('cancelled')
    else if (status === 'ERROR') setPhase('failed', bubble?.content?.trim() || text('failed'))
    else if (task.phase === 'stopping') {
      if (status === 'FINISHED') await checkResult()
      else if (!stream.isStreaming.value && [null, 'AWAITING_INPUT', 'PAUSED', 'INTERRUPTED', 'AWAITING_APPROVAL'].includes(status)) setPhase('cancelled', task.message)
      else if (now() - task.stoppingAt > 15000) task.message = text('stopUnconfirmed')
    } else if (status === 'AWAITING_APPROVAL') {
      const plan = (bubble?.artifacts || []).findLast(artifact => ['implementation_plan', 'plan'].includes(artifact.type)
        && artifact.status === 'draft' && artifact.data?.content?.trim())
      if (plan) {
        task.question = { text: plan.data.content.trim(), options: [], descriptions: [], answered: false,
          key: `${task.pending?.clientRequestId || task.conversationId}:approval:${plan.id || 'current'}` }
        setPhase('waiting')
      } else setPhase('paused', text('paused'))
    } else if (['PAUSED', 'INTERRUPTED'].includes(status)) setPhase('paused', text('paused'))
    else if ((status === 'AWAITING_INPUT' || stream.agentAwaitingInput.value || question) && !stream.isStreaming.value) {
      const q = question
      if (!q || q.answered) setPhase('failed', text('missingQuestion'))
      else {
        task.question = { ...copy(q), text: [bubble?.question ? bubble.content : '', q.text].filter(Boolean).join('\n\n'),
          key: `${task.pending.clientRequestId}:${q.id || q.text}` }
        setPhase('waiting')
      }
    } else if (status === 'FINISHED' && !stream.isStreaming.value) await checkResult()
    else if (!status && !stream.isStreaming.value) {
      if (task.outputIds.length || stream.fileChanges.value.length) await checkResult()
      else setPhase(task.accepted ? 'paused' : 'failed', text(task.accepted ? 'paused' : 'failed'))
    } else if (status === 'RUNNING' || stream.isStreaming.value) {
      setPhase('running', stream.linkStatus.value.state === 'reconnecting' ? text('reconnect') : '')
    }
    return view()
  }

  async function submit() {
    if (submitting) return
    submitting = true
    const captured = task
    setPhase('starting')
    try {
      await api.authorize()
      requireCurrent()
      if (captured !== task || task.phase === 'stopping') return
      const receipt = await stream.sendMessage({ ...task.pending, projectId: task.projectId,
        modelId: task.modelId, mode: 'AGENT', skillIds: ['litigation-visual'] })
      if (!current() || task !== captured) return
      if (!receipt) {
        setPhase('failed', last()?.content?.trim() || text('failed'))
      } else {
        task.accepted = true
        if (task.phase !== 'stopping') setPhase('running')
        else await stream.abort()
      }
    } catch (error) {
      if (current() && task === captured) setPhase('failed', error.message)
    } finally {
      submitting = false
      if (current()) await observe()
    }
  }

  async function generate(params) {
    if (task && ACTIVE.has(task.phase)) return view()
    const input = { scope: String(params.scope || '').slice(0, 10000), diagramHint: String(params.diagramHint || '').slice(0, 2000) }
    if (task?.phase === 'failed' && task.pending && JSON.stringify(input) === JSON.stringify(task.input)) {
      // Reconcile before replaying a lost ACK. sendMessage would otherwise mark
      // an already delivered question answered and replace it with an empty turn.
      try { await recover(); await observe() }
      catch (error) { setPhase('failed', error.message); return view() }
      if (ACTIVE.has(task.phase) || task.phase === 'completed') return view()
      if (task.accepted) { task.pending = pending(text('continuePrompt')); task.accepted = false }
      task.question = null
      persist()
      void submit()
      return view()
    }
    task = { id: uuid(), projectId: api.projectId, phase: 'starting', input, startedAt: now(),
      outputIds: [], pending: null, accepted: false }
    const captured = task
    // Return the acknowledgement immediately; the work is owned by the workbench,
    // so hiding/recreating the plugin iframe does not lose progress or errors.
    submitting = true
    void (async () => {
      try {
        await api.authorize()
        requireCurrent()
        task.baselineFolders = (await api.diagrams()).map(d => String(d.folderId))
        requireCurrent()
        const kickoff = await api.kickoff(input)
        requireCurrent()
        if (!kickoff?.prompt) throw new Error(text('failed'))
        const issued = await api.issue()
        requireCurrent()
        if (!issued?.conversationId) throw new Error(text('failed'))
        task.conversationId = issued.conversationId
        task.modelId = await api.model()
        requireCurrent()
        task.pending = pending(kickoff.prompt, params.clientRequestId || uuid())
        stream.clearBubbles()
        stream.setConversationId(task.conversationId)
        stream.agentRunStatus.value = null
        stream.agentAwaitingInput.value = false
        persist()
      } catch (error) {
        if (current() && task === captured) setPhase('failed', error.message)
      } finally { submitting = false }
      if (current() && task === captured && task.phase === 'starting') await submit()
      else if (current() && task === captured && task.phase === 'stopping') setPhase('cancelled')
    })()
    return view()
  }

  return {
    observe,
    async request(operation, params = {}) {
      requireCurrent()
      await restore()
      if (operation === 'generation') return observe()
      if (operation === 'generate') return generate(params)
      if (!task || params.taskId !== task.id) throw new Error(text('contextChanged'))
      if (operation === 'stop') {
        if (!ACTIVE.has(task.phase)) return view()
        if (['waiting', 'paused'].includes(task.phase) && !stream.isStreaming.value) {
          task.question = null
          setPhase('cancelled')
          return view()
        }
        task.stoppingAt = now()
        setPhase('stopping')
        if (task.conversationId) void stream.abort()
        else if (!submitting) setPhase('cancelled')
        return view()
      }
      if (operation === 'answer') {
        if (task.phase !== 'waiting' || params.questionKey !== task.question?.key) throw new Error(text('staleQuestion'))
        const q = task.question
        const answer = params.answer || {}
        const selected = Array.isArray(answer.selected) ? answer.selected : []
        if (selected.some(value => !q.options.includes(value)) || (!q.multiSelect && selected.length > 1)) throw new Error(text('staleQuestion'))
        const formatted = formatAskUserAnswer({ id: q.id, question: q.text, selected, other: String(answer.other || '').slice(0, 4000) })
        if (!formatted) throw new Error(text('emptyAnswer'))
        task.pending = pending(formatted.prompt, uuid(), { displayText: formatted.displayText })
        task.accepted = false
        task.question = null
      } else if (operation === 'continue') {
        if (!['failed', 'paused'].includes(task.phase)) return view()
        if (task.phase === 'failed') return generate(task.input)
        if (task.accepted) { task.pending = pending(text('continuePrompt')); task.accepted = false }
        if (!task.pending) return generate(task.input)
      } else throw new Error('Unknown litigation operation')
      persist()
      void submit()
      return view()
    },
    async revoke(message) {
      if (!task || !ACTIVE.has(task.phase)) return
      if (['waiting', 'paused'].includes(task.phase) && !stream.isStreaming.value) {
        task.question = null
        setPhase('cancelled', message)
        return
      }
      task.stoppingAt = now()
      setPhase('stopping', message)
      await stream.abort()
    },
    dispose() {
      // The saved dedicated conversation can be reattached when the project is
      // reopened. Do not cancel an already accepted run merely for hiding a pane.
      persist()
      disposed = true
      stream.setConversationId(null)
      stream.resetSSE()
    }
  }
}
