import { ref, reactive, nextTick } from 'vue'
import { getApiBaseUrl } from '@/services/api.js'
import { getSessionId } from '@/utils/auth.js'

export function useAgentStream() {
    // STATE: List of all bubbles (history + active)
    const bubbles = ref([])
    const isConnected = ref(false)
    const isStreaming = ref(false)
    const error = ref(null)
    const currentConversationId = ref(null)

    // POINTER: The current bubble we are writing to (Assistant)
    const currentAssistantBubble = ref(null)

    // Abort Controllers
    let sseAbortController = null
    let messageAbortController = null

    // Parser State (Local to the current stream)
    let parserBuffer = ''
    let activeTag = null
    let activeProcessId = null
    // Event parser state
    let currentEventName = null
    let currentEventData = ''

    // --- HELPER: Create a new Assistant Bubble Structure ---
    const createAssistantBubble = () => ({
        id: `msg-${Date.now()}`,
        role: 'ASSISTANT',
        thinking: { status: 'idle', content: '', duration: 0, startTime: 0, endTime: 0 },
        title: '',
        processes: [],
        artifacts: [],
        walkthrough: '',
        content: '', // Main Answer (from <final> tag)
        rawLog: '',
        isStreaming: false
    })

    const createUserBubble = (content, images = [], contextFiles = []) => ({
        id: `msg-${Date.now()}`,
        role: 'USER',
        content: content,
        images: images,
        contextFiles: contextFiles
    })

    // --- RESET PARSER STATE ---
    const resetParser = () => {
        parserBuffer = ''
        activeTag = null
        activeProcessId = null
    }

    // --- RESET SSE CONNECTION STATE ---
    // Call this when switching conversations to ensure clean state
    const resetSSE = () => {
        console.log('[AgentStream] Resetting SSE state')
        // Abort any existing connections
        if (sseAbortController) {
            try { sseAbortController.abort() } catch (e) { }
            sseAbortController = null
        }
        if (messageAbortController) {
            try { messageAbortController.abort() } catch (e) { }
            messageAbortController = null
        }
        // Reset connection states
        isConnected.value = false
        isStreaming.value = false
        // Reset parser state
        resetParser()
        // Reset event parser state
        currentEventName = null
        currentEventData = ''
        // Clear bubble pointer (will be set fresh on next send)
        currentAssistantBubble.value = null
    }

    // --- CLEAR BUBBLES ---
    const clearBubbles = () => {
        bubbles.value.splice(0, bubbles.value.length)
    }

    // --- SET CONVERSATION ID (with auto-reset) ---
    const setConversationIdWithReset = (id) => {
        // Only reset if actually changing conversations
        if (currentConversationId.value !== id) {
            console.log('[AgentStream] Conversation changing:', currentConversationId.value, '->', id)
            resetSSE()
        }
        currentConversationId.value = id
    }

    // --- SSE Connection ---
    const connectSSE = (conversationId) => {
        if (sseAbortController && isConnected.value) return Promise.resolve()

        sseAbortController = new AbortController()
        const baseUrl = getApiBaseUrl()
        const url = `${baseUrl}/api/agent/connect/${conversationId}`
        const sessionId = getSessionId()

        return new Promise(async (resolve, reject) => {
            try {
                console.log('[AgentStream] Connecting SSE:', url)
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId || '' },
                    signal: sseAbortController.signal
                })

                if (!response.ok) throw new Error(`SSE Connection Failed: ${response.status}`)

                isConnected.value = true
                resolve()

                const reader = response.body.getReader()
                const decoder = new TextDecoder('utf-8')
                let buffer = ''

                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const chunk = decoder.decode(value, { stream: true })
                    buffer += chunk

                    const lines = buffer.split(/\r?\n/)
                    buffer = lines.pop() // Keep incomplete line

                    for (const line of lines) {
                        parseSSELineFull(line)
                    }
                }
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('[AgentStream] SSE Error:', err)
                    if (!isConnected.value && !isStreaming.value) reject(err)
                }
                isConnected.value = false
            } finally {
                sseAbortController = null
                isConnected.value = false
            }
        })
    }

    const sendMessage = async ({ prompt, fileList = [], projectId, modelId = 'default', assistantId, _userImages = [], _userContextFiles = [] }) => {
        // 1. Add User Message with images and context files for display
        bubbles.value.push(createUserBubble(prompt, _userImages, _userContextFiles))

        // 2. Prepare Assistant Bubble
        const newBubble = createAssistantBubble()
        newBubble.isStreaming = true
        bubbles.value.push(newBubble)
        currentAssistantBubble.value = newBubble

        isStreaming.value = true
        resetParser()

        // 3. Ensure Conversation
        if (!currentConversationId.value) {
            currentConversationId.value = `conv-${Date.now()}`
        }
        const conversationId = currentConversationId.value

        try {
            await connectSSE(conversationId)

            // 4. Send POST
            messageAbortController = new AbortController()
            const payload = {
                projectId: typeof projectId === 'string' ? parseInt(projectId) : projectId,
                conversationId,
                message: prompt,
                model: modelId,
                // Send full context metadata for folder support
                contextItems: fileList.map(f => ({
                    id: String(f.id),
                    name: f.fileName || f.name || 'Unknown',
                    isDir: f.isDir === true,
                    fileType: f.fileType || ''
                })),
                fileIds: fileList.map(f => f.id) // Legacy compatibility
            }

            await fetch(`${getApiBaseUrl()}/api/agent/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() || '' },
                body: JSON.stringify(payload),
                signal: messageAbortController.signal
            })

        } catch (err) {
            if (err.name !== 'AbortError') {
                error.value = err.message
                if (currentAssistantBubble.value) {
                    currentAssistantBubble.value.content += `\n**Error**: ${err.message}`
                    currentAssistantBubble.value.isStreaming = false
                }
                isStreaming.value = false
            }
        }
    }

    const abort = () => {
        if (messageAbortController) messageAbortController.abort()
        if (sseAbortController) sseAbortController.abort()
        isStreaming.value = false
        if (currentAssistantBubble.value) {
            currentAssistantBubble.value.isStreaming = false
        }
    }

    // --- PARSER LOGIC --- (Using currentAssistantBubble.value)\n
    const parseSSELineFull = (line) => {
        if (!line.trim()) {
            if (currentEventData) {
                handleEvent(currentEventName, currentEventData)
            }
            currentEventName = null
            currentEventData = ''
            return
        }

        if (line.startsWith('event:')) {
            currentEventName = line.substring(6).trim()
        } else if (line.startsWith('data:')) {
            let val = line.substring(5)
            if (val.startsWith(' ')) val = val.substring(1)
            currentEventData += (currentEventData ? '\n' : '') + val
        }
    }

    const handleEvent = (evt, dataStr) => {
        if (!currentAssistantBubble.value) return

        if (evt === 'text_delta') {
            try {
                const d = JSON.parse(dataStr)
                processTextStream(d.content || '')
            } catch (e) {
                processTextStream(dataStr)
            }
        } else if (evt === 'step_update') {
            try {
                const d = JSON.parse(dataStr)
                handleStepUpdate(d)
            } catch (e) {
                console.error('Failed to parse step_update', e)
            }
        } else if (evt === 'artifact') {
            const d = JSON.parse(dataStr)
            handleArtifactEvent(d)
        } else if (evt === 'client_action') {
            try {
                const d = JSON.parse(dataStr)
                // Trigger registered callbacks
                if (clientActionHandler.value) {
                    clientActionHandler.value(d)
                }
            } catch (e) {
                console.error('Failed to parse client_action', e)
            }
        } else if (evt === 'title_update') {
            // Handle conversation title update from backend
            try {
                const d = JSON.parse(dataStr)
                if (titleUpdateHandler.value && d.title) {
                    titleUpdateHandler.value(d.title)
                }
            } catch (e) {
                console.error('Failed to parse title_update', e)
            }
        } else if (evt === 'bubble_end' || evt === 'error') {
            // Flush any remaining content in parserBuffer before ending
            flushRemainingBuffer()
            currentAssistantBubble.value.isStreaming = false
            const thinking = currentAssistantBubble.value.thinking
            if (thinking.status === 'thinking') {
                thinking.status = 'done'
                // Only calculate if not already done (avoid overwriting)
                if (!thinking.duration || thinking.duration === 0) {
                    thinking.duration = (Date.now() - thinking.startTime) / 1000
                }
            }
            // Ensure error is visible
            if (evt === 'error') {
                const errMsg = dataStr || "Unknown Error"
                currentAssistantBubble.value.walkthrough += `\n\n> [!CAUTION]\n> **Error**: ${errMsg}\n`

                // FORCE UPDATE: Mark active tool as error if any
                if (activeProcessId) {
                    const proc = currentAssistantBubble.value.processes.find(p => p.id === activeProcessId)
                    if (proc && proc.items.length > 0) {
                        const lastItem = proc.items[proc.items.length - 1]
                        if (lastItem.type === 'tool' && lastItem.status === 'loading') {
                            lastItem.status = 'error'
                            lastItem.output += `\n[System Error: ${errMsg}]`
                        }
                    }
                }
            }
        }
        if (evt === 'bubble_end') isStreaming.value = false
    }

    const handleStepUpdate = (data) => {
        // data: { status: 'loading'|'done', message: '...' }
        const bubble = currentAssistantBubble.value
        if (!bubble) return

        // Ensure we have an active process to attach this step to
        // If no active process, create a "System Tools" process
        let proc = bubble.processes.find(p => p.id === activeProcessId)
        if (!proc) {
            // Create default process
            const pid = `proc-sys-${Date.now()}`
            proc = {
                id: pid,
                title: 'System Actions',
                isExpanded: true,
                steps: [],
                content: ''
            }
            bubble.processes.push(proc)
            activeProcessId = pid
            // Do NOT set activeTag='process' to avoid interfering with XML parser state if mixed
        }

        // Add or Update Step
        // Strategy: append new step for every update? Or update last step?
        // AgentOrchestrator sends: "Executing tools...", then "Tools executed."
        // We probably want 2 steps or 1 updated step.
        // Simple: Append new step
        proc.steps.push({
            status: data.status === 'done' ? 'done' : 'doing',
            text: data.message
        })

        // If done, maybe collapse? No, keep expanded.
    }

    // --- PARSER HELPERS ---

    // Flush any remaining content in parserBuffer (called when stream ends)
    const flushRemainingBuffer = () => {
        if (parserBuffer && parserBuffer.trim()) {
            console.log('[AgentStream] Flushing remaining buffer:', parserBuffer.length, 'chars')
            flushContent(parserBuffer)
            parserBuffer = ''
        }
    }

    const handleArtifactEvent = (evt) => {
        if (!currentAssistantBubble.value) return
        if (evt.operation === 'create') {
            currentAssistantBubble.value.artifacts.push({
                id: evt.id,
                type: evt.type,
                status: evt.status,
                data: evt.data,
                fileName: evt.name ? evt.name : (evt.type === 'task_list' ? 'Task List' : 'Plan')
            })
        }
    }

    const flushContent = (text) => {
        const bubble = currentAssistantBubble.value
        if (!bubble || !text) return

        if (activeTag === 'thinking') {
            // Check if we are inside a process -> Nested Thinking
            if (activeProcessId) {
                const proc = bubble.processes.find(p => p.id === activeProcessId)
                if (proc && proc.items.length > 0) {
                    const lastItem = proc.items[proc.items.length - 1]
                    if (lastItem.type === 'thinking') {
                        lastItem.content += text
                    }
                }
            } else {
                // If we have existing processes, this might be "Interim Thinking" between steps
                if (bubble.processes.length > 0) {
                    const lastProc = bubble.processes[bubble.processes.length - 1]
                    let lastItem = lastProc.items.length > 0 ? lastProc.items[lastProc.items.length - 1] : null

                    if (!lastItem || lastItem.type !== 'thinking' || lastItem.status === 'done') {
                        // Create new thinking item in this process
                        lastProc.items.push({
                            type: 'thinking',
                            status: 'thinking',
                            content: text,
                            startTime: Date.now()
                        })
                        activeProcessId = lastProc.id
                    } else {
                        lastItem.content += text
                    }
                } else {
                    // Root Level Thinking (Initial Ghost)
                    bubble.thinking.content += text
                }
            }
        } else if (activeTag === 'title') {
            bubble.title += text
        } else if (activeTag === 'process') {
            // Process tag itself has no content
        } else if (activeTag === 'step') {
            const currentProc = bubble.processes.find(p => p.id === activeProcessId)
            if (currentProc && currentProc.items.length > 0) {
                const lastItem = currentProc.items[currentProc.items.length - 1]
                if (lastItem.type === 'step') {
                    lastItem.text += text
                }
            }
        } else if (activeTag === 'tool_code') {
            const p = bubble.processes.find(x => x.id === activeProcessId)
            if (p && p.items.length > 0) {
                const lastItem = p.items[p.items.length - 1]
                if (lastItem.type === 'tool') {
                    lastItem.code += text
                }
            }
        } else if (activeTag === 'tool_output') {
            const p = bubble.processes.find(x => x.id === activeProcessId)
            if (p) {
                // Attach output to the LAST tool item
                // Use reverse search
                const toolItem = [...p.items].reverse().find(i => i.type === 'tool')
                if (toolItem) {
                    toolItem.output += text
                    // ONLY use heuristic if status wasn't set by backend (i.e., still 'loading')
                    // If backend already set status via <tool_output status="..."> attribute, do NOT override
                    if (toolItem.status === 'loading') {
                        // Fallback heuristic for legacy backends without status attribute
                        if (toolItem.output.includes('Error') || toolItem.output.includes('Exception')) {
                            toolItem.status = 'error'
                        }
                        // Do NOT set to 'success' here - wait for tag close or explicit status
                    }
                }
            }
        } else if (activeTag === 'walkthrough') {
            bubble.walkthrough += text
        } else if (activeTag === 'final') {
            bubble.content += text
        } else if (activeTag === 'question') {
            bubble.content += text
        } else if (activeTag === 'artifact') {
            const artifacts = bubble.artifacts
            if (artifacts.length > 0) {
                const lastArt = artifacts[artifacts.length - 1]
                if (!lastArt.data) lastArt.data = { content: '' }
                lastArt.data.content += text
            }
        } else {
            // Untagged text -> Main Content
            if (!bubble.content && !text.trim()) return
            bubble.content += text
        }
    }

    const handleTag = (tagName, isClose, attrs, fullTag) => {
        const bubble = currentAssistantBubble.value
        if (!bubble) return

        // Extract attributes
        let attributes = {}
        if (!isClose && fullTag) {
            const attrRegex = /(\w+)="([^"]*)"/g
            let match
            while ((match = attrRegex.exec(fullTag)) !== null) {
                attributes[match[1]] = match[2]
            }
        }

        if (tagName === 'thinking') {
            if (isClose) {
                // Close thinking
                if (activeProcessId) {
                    const proc = bubble.processes.find(p => p.id === activeProcessId)
                    if (proc) {
                        const lastItem = proc.items[proc.items.length - 1]
                        if (lastItem && lastItem.type === 'thinking') {
                            lastItem.status = 'done'
                            // Calculate duration for per-segment timing
                            lastItem.endTime = Date.now()
                            lastItem.duration = (Date.now() - lastItem.startTime) / 1000
                        }
                    }
                } else {
                    bubble.thinking.status = 'done'
                    // Calculate this segment's duration (not cumulative)
                    bubble.thinking.endTime = Date.now()
                    bubble.thinking.duration = (bubble.thinking.endTime - bubble.thinking.startTime) / 1000
                }
                activeTag = activeProcessId ? 'process' : null // Return to process scope or null
            } else {
                // Open thinking
                if (activeProcessId) {
                    const proc = bubble.processes.find(p => p.id === activeProcessId)
                    if (proc) {
                        proc.items.push({
                            type: 'thinking',
                            status: 'thinking',
                            content: '',
                            startTime: Date.now()
                        })
                    }
                    activeTag = 'thinking'
                } else if (bubble.processes.length > 0) {
                    // IMPORTANT: If processes exist, attach thinking to LAST process
                    // instead of root. This prevents root thinking from accumulating
                    // time from subsequent thinking phases.
                    const lastProc = bubble.processes[bubble.processes.length - 1]
                    lastProc.items.push({
                        type: 'thinking',
                        status: 'thinking',
                        content: '',
                        startTime: Date.now()
                    })
                    activeProcessId = lastProc.id
                    activeTag = 'thinking'
                } else {
                    // Only root thinking if NO processes exist yet
                    bubble.thinking.status = 'thinking'
                    bubble.thinking.startTime = Date.now()
                    activeTag = 'thinking'
                }
            }
        } else if (tagName === 'title') {
            if (isClose) activeTag = null
            else {
                activeTag = 'title'
                bubble.title = ''
            }
        } else if (tagName === 'process') {
            if (isClose) {
                // NOTE: 不要在这里自动标记工具为成功！
                // 后端在 process 关闭后才发送 <tool_output status="...">
                // tool_output handler 会正确更新状态

                activeTag = null
                activeProcessId = null
            } else {
                const pid = `proc-${Date.now()}`
                // Only collapse others if this is a NEW top-level process?
                // For now keep behavior: collapse others
                bubble.processes.forEach(p => p.isExpanded = false)

                const processTitle = attributes['name'] || 'Processing...'

                bubble.processes.push({
                    id: pid,
                    title: processTitle,
                    isExpanded: true,
                    items: [], // CHANGED: from steps -> items
                    content: ''
                })
                activeProcessId = pid
                activeTag = 'process'
            }
        } else if (tagName === 'step') {
            if (!isClose) {
                const currentProc = bubble.processes.find(p => p.id === activeProcessId)
                if (currentProc) {
                    // Push generic step item
                    currentProc.items.push({ type: 'step', status: 'doing', text: '' })
                }
                activeTag = 'step'
            } else {
                // Close step
                activeTag = 'process'
            }
        } else if (tagName === 'tool_code') {
            if (isClose) {
                activeTag = 'process'
            } else {
                const currentProc = bubble.processes.find(p => p.id === activeProcessId)
                if (currentProc) {
                    currentProc.items.push({
                        type: 'tool',
                        code: '',
                        output: '',
                        status: 'loading'
                    })
                }
                activeTag = 'tool_code'
            }
        } else if (tagName === 'tool_output') {
            if (isClose) {
                activeTag = 'process'
                // Check if tool output contains file creation success JSON (legacy check, keep for now)
                // Search in activeProcessId first, then fallback to all processes
                let toolItem = null
                const p = bubble.processes.find(x => x.id === activeProcessId)
                if (p) {
                    toolItem = [...p.items].reverse().find(i => i.type === 'tool')
                }
                // Fallback: search all processes for the last tool
                if (!toolItem) {
                    for (let i = bubble.processes.length - 1; i >= 0; i--) {
                        const lastTool = [...bubble.processes[i].items].reverse().find(item => item.type === 'tool')
                        if (lastTool) {
                            toolItem = lastTool
                            break
                        }
                    }
                }
                if (toolItem && toolItem.output) {
                    if (toolItem.output.includes('"wps_file_id":') && toolItem.output.includes('"status":"success"')) {
                        console.log('[AgentStream] Detected file creation')
                        if (clientActionHandler.value) clientActionHandler.value({ action: 'refresh_files' })
                    }
                }
            } else {
                // Open Tag: Parse Status Attribute
                const statusAttr = attributes['status'] // Expect "SUCCESS" or "FAILURE"

                // Find the tool item to update - first try activeProcessId, then search all
                let toolItem = null
                const p = bubble.processes.find(x => x.id === activeProcessId)
                if (p) {
                    toolItem = [...p.items].reverse().find(i => i.type === 'tool')
                }
                // Fallback: search all processes for the most recent tool
                // 工具可能还是 'loading' 或已被更新
                if (!toolItem) {
                    for (let i = bubble.processes.length - 1; i >= 0; i--) {
                        const recentTool = [...bubble.processes[i].items].reverse().find(
                            item => item.type === 'tool'
                        )
                        if (recentTool) {
                            toolItem = recentTool
                            activeProcessId = bubble.processes[i].id // Update activeProcessId for subsequent content
                            break
                        }
                    }
                }

                if (toolItem) {
                    if (statusAttr === 'SUCCESS') {
                        toolItem.status = 'success'
                    } else if (statusAttr === 'FAILURE') {
                        toolItem.status = 'error'
                    }
                    // If no status attribute, keep current status (loading) for heuristics/fallback
                }
                activeTag = 'tool_output'
            }
        } else if (tagName === 'walkthrough') {
            if (isClose) activeTag = null
            else activeTag = 'walkthrough'
        } else if (tagName === 'final') {
            if (isClose) activeTag = null
            else activeTag = 'final'
        } else if (tagName === 'question') {
            if (isClose) activeTag = null
            else activeTag = 'question'
        } else if (tagName === 'artifact') {
            if (!isClose) {
                const typeMatch = (attrs || '').match(/type="([^"]+)"/)
                const type = typeMatch ? typeMatch[1] : (attributes['type'] || 'unknown')
                const name = attributes['name'] || null
                activeTag = 'artifact'

                const aid = `art-${Date.now()}`
                handleArtifactEvent({ operation: 'create', id: aid, type, name, status: 'draft', data: { content: '' } })
            } else {
                activeTag = null
            }
        }
    }

    // --- XML STREAM PROCESSOR ---
    const processTextStream = (text) => {
        // FILTER: Detect and strip orphaned JSON content artifacts (e.g. {"content":""} or {"content":"..."})
        // This mitigates the issue where the model echoes the hidden JSON protocol
        if (text.trim().startsWith('{"content":') && text.trim().endsWith('}')) {
            try {
                const json = JSON.parse(text)
                // If it parsed, we use the inner content if present, or just drop it
                if (json.content !== undefined) {
                    text = json.content
                }
            } catch (e) {
                // Not valid JSON, let it pass or strip if it looks like the artifact
                // The artifact usually looks like: {"content":""} which is empty.
                if (text.includes('{"content":""}')) {
                    text = text.replace('{"content":""}', '')
                }
            }
        }

        parserBuffer += text

        // FILTER: Strip markdown code block wrappers
        parserBuffer = parserBuffer.replace(/^```(?:xml|html|markdown)?\s*\n?/gm, '')
        parserBuffer = parserBuffer.replace(/\n?```\s*$/gm, '')
        parserBuffer = parserBuffer.replace(/```(?:xml|html|markdown)?\s*\n/g, '')
        parserBuffer = parserBuffer.replace(/\n```/g, '')

        const tagRegex = /<(\/?)(thinking|title|process|step|tool_code|tool_output|walkthrough|final|question|artifact)(\s+[^>]*)?>/g

        while (true) {
            const match = tagRegex.exec(parserBuffer)
            if (!match) break

            const [fullTag, isSlash, tagName] = match
            const index = match.index

            // Emit text before tag
            if (index > 0) {
                flushContent(parserBuffer.substring(0, index))
            }

            handleTag(tagName, isSlash === '/', null, fullTag)

            // Slice buffer
            parserBuffer = parserBuffer.substring(index + fullTag.length)
            tagRegex.lastIndex = 0
        }
    }



    const clientActionHandler = ref(null)
    const titleUpdateHandler = ref(null)

    return {
        bubbles,
        isStreaming,
        sendMessage,
        abort,
        setConversationId: setConversationIdWithReset,
        resetSSE,
        clearBubbles,
        currentConversationId,
        onClientAction: (fn) => clientActionHandler.value = fn,
        onTitleUpdate: (fn) => titleUpdateHandler.value = fn
    }
}
