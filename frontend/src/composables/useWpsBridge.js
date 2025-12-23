/**
 * useWpsBridge.js
 * Spec v1.7 §6.3: WPS Safety Write Protocol
 * 
 * Handles WPS write commands from the AI agent with TrackRevisions support.
 */

import { ref } from 'vue'

export function useWpsBridge() {
    const isProcessing = ref(false)
    const lastError = ref(null)

    /**
     * Execute a WPS client action received from the AI agent
     * @param {Object} action - The client_action payload from SSE
     * @param {string} action.tool - Should be 'wps_write'
     * @param {string} action.action - 'insert' | 'replace' | 'append' etc.
     * @param {string} action.content - The content to write
     * @param {Object} action.options - Optional settings
     * @param {boolean} action.options.track_changes - Enable revision mode (default: true per spec)
     */
    const executeWpsAction = async (action) => {
        const { tool, action: actionType, content, options = {} } = action

        if (tool !== 'wps_write') {
            console.warn('[WpsBridge] Unknown tool:', tool)
            return { success: false, error: 'Unknown tool' }
        }

        isProcessing.value = true
        lastError.value = null

        try {
            // Spec v1.7 §6.3: Default to track_changes = true for safety
            const trackChanges = options.track_changes !== false

            // Get WPS instance from Electron preload or global
            const wps = window.wps || window.WpsInvoke

            if (!wps) {
                throw new Error('WPS not available')
            }

            // Enable revision mode BEFORE writing (Spec v1.7 §6.3)
            if (trackChanges) {
                try {
                    // Try different WPS API methods
                    if (wps.ActiveDocument?.TrackRevisions !== undefined) {
                        wps.ActiveDocument.TrackRevisions = true
                    } else if (typeof wps.setTrackRevisions === 'function') {
                        await wps.setTrackRevisions(true)
                    } else if (typeof wps.invoke === 'function') {
                        await wps.invoke('Document.TrackRevisions', true)
                    }
                    console.log('[WpsBridge] TrackRevisions enabled')
                } catch (e) {
                    console.warn('[WpsBridge] Could not enable TrackRevisions:', e)
                    // Continue anyway, don't block the write
                }
            }

            // Execute the action based on type
            switch (actionType) {
                case 'insert':
                    await insertText(wps, content)
                    break
                case 'replace':
                    await replaceSelection(wps, content)
                    break
                case 'append':
                    await appendText(wps, content)
                    break
                default:
                    throw new Error(`Unknown action type: ${actionType}`)
            }

            return { success: true }
        } catch (err) {
            console.error('[WpsBridge] Error:', err)
            lastError.value = err.message
            return { success: false, error: err.message }
        } finally {
            isProcessing.value = false
        }
    }

    // Internal helper: Insert text at cursor
    const insertText = async (wps, content) => {
        if (typeof wps.insertText === 'function') {
            await wps.insertText(content)
        } else if (typeof wps.invoke === 'function') {
            await wps.invoke('Selection.TypeText', content)
        } else if (wps.Selection?.TypeText) {
            wps.Selection.TypeText(content)
        } else {
            throw new Error('insertText not supported')
        }
    }

    // Internal helper: Replace current selection
    const replaceSelection = async (wps, content) => {
        if (typeof wps.replaceSelection === 'function') {
            await wps.replaceSelection(content)
        } else if (typeof wps.invoke === 'function') {
            await wps.invoke('Selection.Text', content)
        } else if (wps.Selection) {
            wps.Selection.Text = content
        } else {
            throw new Error('replaceSelection not supported')
        }
    }

    // Internal helper: Append text at end of document
    const appendText = async (wps, content) => {
        if (typeof wps.appendText === 'function') {
            await wps.appendText(content)
        } else if (typeof wps.invoke === 'function') {
            // Move to end of document then insert
            await wps.invoke('Selection.EndKey', 6) // wdStory = 6
            await wps.invoke('Selection.TypeText', content)
        } else {
            throw new Error('appendText not supported')
        }
    }

    return {
        executeWpsAction,
        isProcessing,
        lastError
    }
}
