/**
 * useWpsBridge.js
 * Spec v1.7 §6.3: WPS Safety Write Protocol
 * 
 * 增强版 - 支持 AI Agent 与 WPS 文档的深度交互：
 * - 获取选区信息
 * - 查找和替换文本
 * - 定位光标
 * - 段落操作
 * - 文档大纲
 */

import { ref } from 'vue'

export function useWpsBridge() {
    const isProcessing = ref(false)
    const lastError = ref(null)

    // ==================== 调试辅助 ====================

    /**
     * 记录 WPS 当前状态（调试用）
     */
    const logWpsState = async (tag, wpsApp) => {
        try {
            const doc = await wpsApp.ActiveDocument
            const win = await doc.ActiveWindow
            const view = await win.View

            const state = {
                protectionType: await doc.ProtectionType,
                trackRevisions: await doc.TrackRevisions,
                showRevisionsAndComments: await view.ShowRevisionsAndComments,
                revisionsView: 'unknown'
            }

            try {
                // wdRevisionsViewFinal = 0, wdRevisionsViewOriginal = 1
                state.revisionsView = await view.RevisionsView
            } catch (e) {
                // RevisionsView property might not exist in some versions
            }

            console.log(`[WpsDebug] [${tag}] State:`, state)
            return state
        } catch (e) {
            console.warn(`[WpsDebug] [${tag}] Failed to log state:`, e)
        }
    }

    /**
     * 强制刷新视图
     * 尝试切换视图类型或重置 RevisionsView 以触发重绘
     */
    const forceViewRefresh = async (wpsApp) => {
        try {
            const doc = await wpsApp.ActiveDocument
            const win = await doc.ActiveWindow
            const view = await win.View

            // 1. 强制显示最终状态 (Final)
            // wdRevisionsViewFinal = 0
            try {
                view.RevisionsView = 0
                console.log('[WpsDebug] Set RevisionsView = 0 (Final)')
            } catch (e) {
                console.warn('[WpsDebug] Failed to set RevisionsView:', e)
            }

            // 2. 确保显示修订
            view.ShowRevisionsAndComments = true

            // 3. 触发重绘 hacks (toggle screen updating or view type)
            // wpsApp.ScreenUpdating = false
            // wpsApp.ScreenUpdating = true

        } catch (e) {
            console.warn('[WpsDebug] forceViewRefresh failed:', e)
        }
    }


    // ==================== 获取 WPS 实例 ====================

    /**
     * 辅助函数：延迟指定毫秒
     */
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    /**
     * 检测是否为跨域错误（WPS SDK 内部 iframe 通信失败）
     * 这种错误通常是暂时性的，可以通过重试解决
     */
    const isCrossOriginError = (e) => {
        if (!e) return false
        return (
            e.name === 'DOMException' ||
            (e.message && e.message.includes('cross-origin')) ||
            (e.message && e.message.includes('__wo_client_api__')) ||
            (e.message && e.message.includes('Blocked a frame'))
        )
    }

    /**
     * 封装 WPS 操作，自动处理跨域错误
     * @param {Function} operation - 要执行的异步操作
     * @param {string} operationName - 操作名称（用于日志）
     * @param {Object} options - 选项
     * @param {number} options.maxRetries - 最大重试次数（默认 2）
     * @param {number} options.retryDelay - 重试延迟毫秒（默认 150）
     * @param {any} options.fallbackValue - 失败时的回退值（如果设置，则不抛异常）
     * @returns {Promise<any>} 操作结果
     */
    const wrapWpsOperation = async (operation, operationName = 'WPS operation', options = {}) => {
        const { maxRetries = 2, retryDelay = 150, fallbackValue = undefined } = options
        let operationError = null

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation()
            } catch (e) {
                operationError = e
                if (isCrossOriginError(e) && attempt < maxRetries) {
                    console.warn(
                        `[WpsBridge] ${operationName}: Cross-origin error (attempt ${attempt + 1}/${maxRetries + 1}). ` +
                        `Retrying in ${retryDelay}ms...`
                    )
                    await delay(retryDelay)
                } else {
                    break
                }
            }
        }

        // 重试耗尽
        if (fallbackValue !== undefined) {
            console.warn(`[WpsBridge] ${operationName}: Failed after retries, using fallback value`)
            return fallbackValue
        }

        throw operationError
    }

    /**
     * 获取当前 WPS 实例
     * 
     * 注意：WPS WebOffice SDK 使用 iframe 跨域通信，有时会出现以下错误：
     * "Failed to read a named property '__wo_client_api__xxx' from 'Window': 
     *  Blocked a frame with origin 'https://o.wpsgo.com' from accessing a cross-origin frame."
     * 
     * 这是 WPS SDK 内部通信机制的暂时性问题，通常在重试后可恢复。
     * 
     * @param {Object} wpsInstance - 可选的外部传入的 WPS 实例
     * @param {number} retryCount - 内部重试计数（不要手动传入）
     * @returns {Promise<Object>} WPS Application 对象
     */
    const getWpsInstance = async (wpsInstance = null, retryCount = 0) => {
        const MAX_RETRIES = 3
        const RETRY_DELAY_MS = 200

        try {
            // 优先使用传入的实例
            if (wpsInstance) {
                // 如果是 WPS SDK 实例，需要获取 Application
                if (wpsInstance.Application) {
                    return await wpsInstance.Application
                }
                return wpsInstance
            }

            // 尝试从全局获取
            const wps = window.wps || window.WpsInvoke || window.__wpsInstance
            if (!wps) {
                throw new Error('WPS 编辑器未就绪，请先打开文档')
            }

            if (wps.Application) {
                return await wps.Application
            }
            return wps
        } catch (e) {
            // 使用共享的跨域错误检测函数
            if (isCrossOriginError(e) && retryCount < MAX_RETRIES) {
                console.warn(
                    `[WpsBridge] Cross-origin frame access failed (attempt ${retryCount + 1}/${MAX_RETRIES}). ` +
                    `Retrying in ${RETRY_DELAY_MS}ms...`
                )
                await delay(RETRY_DELAY_MS)
                return await getWpsInstance(wpsInstance, retryCount + 1)
            }

            // 重试耗尽或非跨域错误，向上抛出
            console.error('[WpsBridge] getWpsInstance failed:', e)
            throw e
        }
    }

    /**
     * 确保修订模式开启
     */
    const ensureTrackRevisions = async (wpsApp) => {
        try {
            await logWpsState('Pre-EnsureTrackRevisions', wpsApp)

            const doc = await wpsApp.ActiveDocument
            if (doc) {
                const view = await doc.ActiveWindow.View
                view.ShowRevisionsAndComments = true

                // 强制设置为 Final 视图 (wdRevisionsViewFinal = 0)
                // 这样用户能看到 "最终" 的效果，而不是 "原始" 或 "带标记"
                try {
                    view.RevisionsView = 0
                } catch (e) {
                    console.log('RevisionsView not supported, skipping')
                }

                doc.TrackRevisions = true
                console.log('[WpsBridge] TrackRevisions enabled, RevisionsView set to Final')
            }

            await logWpsState('Post-EnsureTrackRevisions', wpsApp)
        } catch (e) {
            console.warn('[WpsBridge] Could not enable TrackRevisions/View:', e)
        }
    }

    /**
     * 获取 Selection 对象
     * 官方文档推荐路径：app.ActiveDocument.ActiveWindow.Selection
     * 参考：https://solution.wps.cn/docs/client/api/Word/Selection.html
     */
    const getSelection = async (wpsApp) => {
        const doc = await wpsApp.ActiveDocument
        const win = await doc.ActiveWindow
        return await win.Selection
    }

    // ==================== 修订辅助函数 ====================

    /**
     * 获取所有被标记为已删除的范围
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Revisions.html
     * Revision.Type: 0=无修改, 1=插入, 2=删除
     * @param {Object} doc - ActiveDocument 对象
     * @returns {Promise<Array>} 已删除范围数组 [{ start, end }]
     */
    const getDeletedRanges = async (doc) => {
        const deletedRanges = []
        try {
            const revisions = await doc.Revisions
            const count = await revisions.Count
            console.log('[WpsBridge] Total revisions count:', count)

            for (let i = 1; i <= count; i++) {
                const revision = await revisions.Item(i)
                const type = await revision.Type
                if (type === 2) { // 2 = 删除类型
                    const range = await revision.Range

                    // 直接获取范围信息（移除不支持的 StoryType 检查）
                    const start = await range.Start
                    const end = await range.End
                    deletedRanges.push({ start, end })
                    console.log(`[WpsBridge] Found deleted range: ${start}-${end}`)
                }
            }
        } catch (e) {
            console.warn('[WpsBridge] getDeletedRanges error:', e)
        }
        return deletedRanges
    }

    /**
     * 检查位置是否在已删除范围内
     * @param {number} pos - 字符位置
     * @param {Array} deletedRanges - 已删除范围数组
     * @returns {boolean} 是否在已删除范围内
     */
    const isPositionInDeletedRange = (pos, deletedRanges) => {
        return deletedRanges.some(r => pos >= r.start && pos < r.end)
    }

    // ==================== 选区和光标操作 ====================

    /**
     * 获取当前选区信息
     * @param {Object} wpsInstance - WPS 实例
     * @returns {Promise<Object>} { text, start, end }
     */
    const getSelectionInfo = async (wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            // 官方推荐路径：app.ActiveDocument.ActiveWindow.Selection
            const sel = await getSelection(wpsApp)
            const range = await sel.Range

            const text = await range.Text
            const start = await range.Start
            const end = await range.End

            return {
                success: true,
                text: text || '',
                start,
                end,
                length: end - start
            }
        } catch (e) {
            console.error('[WpsBridge] getSelectionInfo error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 移动光标到指定位置
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Selection.html
     * 注意：GoTo() 方法可能不完全支持所有 VBA 参数
     * @param {string} type - 定位类型: paragraph/bookmark/start/end/line
     * @param {string} target - 目标值
     * @param {Object} wpsInstance - WPS 实例
     */
    const goToPosition = async (type, target, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            // 官方推荐路径：app.ActiveDocument.ActiveWindow.Selection
            const sel = await getSelection(wpsApp)

            switch (type) {
                case 'paragraph':
                    // 使用官方推荐的对象参数格式 { What, Which, Count, Name }
                    // WdGoToItem: wdGoToParagraph = 4
                    // WdGoToDirection: wdGoToAbsolute = 1
                    try {
                        await sel.GoTo({ What: 4, Which: 1, Count: parseInt(target) })
                    } catch (gotoError) {
                        console.warn('[WpsBridge] GoTo paragraph failed, trying alternative:', gotoError)
                    }
                    break
                case 'bookmark':
                    // 使用官方推荐的对象参数格式
                    // WdGoToItem: wdGoToBookmark = -1
                    try {
                        await sel.GoTo({ What: -1, Name: target })
                    } catch (gotoError) {
                        console.warn('[WpsBridge] GoTo bookmark failed:', gotoError)
                        // 备选方案：通过 Bookmarks 集合定位
                        const doc = await wpsApp.ActiveDocument
                        const bookmarks = await doc.Bookmarks
                        const bookmark = await bookmarks.Item(target)
                        const range = await bookmark.Range
                        const start = await range.Start
                        sel.Start = start
                        sel.End = start
                    }
                    break
                case 'start':
                    // 移动到文档开头，同时更新可视 Selection
                    const rangeStart = await sel.Range
                    await rangeStart.SetRange(0, 0)
                    // 确保可视选区同步更新
                    try {
                        const doc = await wpsApp.ActiveDocument
                        await doc.ActiveWindow.ScrollIntoView(rangeStart)
                    } catch (e) {
                        console.warn('[WpsBridge] ScrollIntoView failed for start:', e)
                    }
                    break
                case 'end':
                    // 移动到文档末尾
                    // 修复：EndKey 方法可能不存在，通过 Content.End 获取
                    try {
                        const doc = await wpsApp.ActiveDocument
                        const content = await doc.Content
                        const endPos = await content.End
                        const rangeEnd = await sel.Range
                        await rangeEnd.SetRange(endPos, endPos)
                    } catch (e) {
                        console.warn('[WpsBridge] Failed to get content end:', e)
                    }
                    break
                case 'line':
                    // 使用官方推荐的对象参数格式
                    // WdGoToItem: wdGoToLine = 3
                    try {
                        await sel.GoTo({ What: 3, Which: 1, Count: parseInt(target) })
                        // GoTo 后折叠光标 - 使用 Range.SetRange
                        const selRange = await sel.Range
                        const newStart = await selRange.Start
                        await selRange.SetRange(newStart, newStart)
                    } catch (gotoError) {
                        console.warn('[WpsBridge] GoTo line failed:', gotoError)
                        return { success: false, error: 'WebOffice SDK 可能不支持按行号跳转' }
                    }
                    break
                default:
                    throw new Error(`Unknown goto type: ${type}`)
            }

            const finalRange = await sel.Range
            const position = await finalRange.Start
            return { success: true, position }
        } catch (e) {
            console.error('[WpsBridge] goToPosition error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 设置选区范围
     * 
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Selection.html#setrange
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Range.html#setrange
     * 
     * 正确用法：
     * - Range.SetRange(Start, End)
     * - 注意：WPS SDK 中没有 Range.Select() 方法
     * 
     * @param {number} start - 开始位置
     * @param {number} end - 结束位置
     * @param {Object} wpsInstance - WPS 实例
     */

    /**
     * 设置选区范围
     * 
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Range.html#setrange
     * 
     * 官方示例：
     *   // 获取选中区域
     *   const range = await app.ActiveDocument.Range(0, 10)
     *   // 设置区域范围
     *   await range.SetRange(10, 20)
     * 
     * 重要：必须先用 doc.Range(start, end) 获取 Range 对象，才能调用 SetRange！
     * 
     * @param {number} start - 开始位置
     * @param {number} end - 结束位置
     * @param {Object} wpsInstance - WPS 实例
     */
    const setSelectionRange = async (start, end, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const startNum = parseInt(start)
            const endNum = parseInt(end)

            console.log(`[WpsBridge] setSelectionRange: Start=${startNum}, End=${endNum}`)

            const doc = await wpsApp.ActiveDocument

            // 官方示例：先获取一个 Range 对象，再调用 SetRange
            // Step 1: 获取一个初始 Range (可以是任意范围)
            console.log(`[WpsBridge] Step 1: Getting initial Range via doc.Range(0, 0)`)
            const range = await doc.Range(0, 0)

            // Step 2: 调用 SetRange 设置实际的范围
            console.log(`[WpsBridge] Step 2: Calling range.SetRange(${startNum}, ${endNum})`)
            await range.SetRange(startNum, endNum)

            // Step 2.5: 直接设置 Selection.Start 和 Selection.End 移动光标
            // 重要：sel.Range.SetRange() 只修改 Range 对象，不会移动实际光标！
            // 必须直接设置 sel.Start 和 sel.End 属性
            try {
                console.log(`[WpsBridge] Visual update: Setting Selection.Start/End to ${startNum}-${endNum}`)
                const sel = await wpsApp.ActiveDocument.ActiveWindow.Selection

                // 直接设置 Selection 的 Start 和 End 属性（可写属性）
                sel.Start = startNum
                sel.End = endNum

                // 等待属性生效
                await new Promise(r => setTimeout(r, 50))

                // 确保可视
                console.log(`[WpsBridge] Scrolling into view...`)
                await wpsApp.ActiveDocument.ActiveWindow.ScrollIntoView(range)
            } catch (visualErr) {
                console.warn(`[WpsBridge] Visual selection update failed:`, visualErr)
            }

            // Step 3: 验证 - 检查 range 的 Start/End
            const verifyStart = await range.Start
            const verifyEnd = await range.End
            const verifyText = await range.Text

            console.log(`[WpsBridge] Selection verification:`)
            console.log(`[WpsBridge]   - Expected: ${startNum}-${endNum}`)
            console.log(`[WpsBridge]   - Actual: ${verifyStart}-${verifyEnd}`)
            console.log(`[WpsBridge]   - Text: "${verifyText}"`)

            // 检查范围是否设置成功
            if (verifyStart !== startNum || verifyEnd !== endNum) {
                console.warn(`[WpsBridge] Warning: Range mismatch. Expected ${startNum}-${endNum}, got ${verifyStart}-${verifyEnd}`)
                return {
                    success: false,
                    error: `范围设置失败：期望 ${startNum}-${endNum}，实际 ${verifyStart}-${verifyEnd}`,
                    start: verifyStart,
                    end: verifyEnd,
                    text: verifyText
                }
            }

            return {
                success: true,
                range: range,  // 返回 range 对象供后续操作使用
                start: verifyStart,
                end: verifyEnd,
                text: verifyText,
                message: `范围已设置为 ${verifyStart}-${verifyEnd}`
            }
        } catch (e) {
            console.error('[WpsBridge] setSelectionRange error:', e)
            return { success: false, error: e.message }
        }
    }


    /**
     * Delete current selection using strict SDK method
     * @param {Object} wpsApp
     */
    const executeDelete = async (wpsApp) => {
        console.log(`[WpsBridge] executeDelete: Starting...`)

        const sel = await wpsApp.ActiveDocument.ActiveWindow.Selection
        const range = await sel.Range
        const rangeToCheck = await sel.Range
        const currentSelText = await rangeToCheck.Text

        // 获取选区信息
        const start = await range.Start
        const end = await range.End
        const count = end - start

        console.log(`[WpsBridge] executeDelete: Selection: ${start}-${end}, Text: "${currentSelText}"`)

        // 检查选区是否有效
        if (count <= 0) {
            console.warn(`[WpsBridge] executeDelete: Selection is empty or collapsed! count=${count}`)
            // Don't throw, just return, trying to delete empty selection crashes some SDKs or does nothing.
            // But if user insists on calling delete(1), we call it.
        }

        try {
            // 执行删除
            // 官方文档：Selection.Delete(Unit, Count)
            // WdUnits: wdCharacter = 1
            console.log(`[WpsBridge] executeDelete: Calling Selection.Delete(1)`)
            const deleteResult = await sel.Delete(1)
            console.log(`[WpsBridge] executeDelete: Delete call returned:`, deleteResult)

            // 6. 验证删除结果
            console.log(`[WpsBridge] Step 7: Verifying delete result`)
            const postSel = await getSelection(wpsApp)
            const postRange = await postSel.Range
            const postStart = await postRange.Start
            const postEnd = await postRange.End
            console.log(`[WpsBridge] Post-delete selection: ${postStart}-${postEnd}`)

            if (postStart !== start || postEnd !== start) {
                console.warn(`[WpsBridge] executeDelete: Selection did not collapse to start position after delete. Expected ${start}-${start}, got ${postStart}-${postEnd}`)
            }

            console.log('[WpsBridge] executeDelete: Delete call completed')
        } catch (e) {
            console.error('[WpsBridge] executeDelete failed:', e)
            throw e
        }
    }

    /**
     * 替换当前选区文本
     * 
     * 官方文档：
     * - Selection.Delete(): https://solution.wps.cn/docs/client/api/Word/Selection.html#delete
     * - Range.Text: 通过 Range 选定区域获取和设置具体的文本内容信息
     * 
     * @param {string} text - 新文本
     * @param {Object} range - 由 setSelectionRange 返回的 Range 对象
     * @param {Object} wpsInstance - WPS 实例
     */
    const replaceSelection = async (text, range, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // 获取传入 range 的坐标信息，确保是纯数字
            const startRaw = await range.Start
            const endRaw = await range.End
            const start = parseInt(startRaw)
            const end = parseInt(endRaw)
            const oldText = await range.Text

            console.log(`[WpsBridge] Replacing range ${start}-${end} ("${oldText}") with "${text}"`)
            console.log(`[WpsBridge] Parameter types: start=${typeof start}(${start}), end=${typeof end}(${end}), text=${typeof text}`)

            // 官方文档推荐模式：
            // 1. 获取一个初始 Range (例如 doc.Range(0, 0))
            // 2. 使用 SetRange 调整到目标位置
            // 3. 操作 Text
            console.log(`[WpsBridge] Step 1: Create initial range doc.Range(0, 0)`)
            const freshRange = await doc.Range(0, 0)

            console.log(`[WpsBridge] Step 2: SetRange(${start}, ${end})`)
            await freshRange.SetRange(start, end)

            // 验证 Range 位置
            const verifyStart = await freshRange.Start
            const verifyEnd = await freshRange.End
            console.log(`[WpsBridge] Range ready at: ${verifyStart}-${verifyEnd}`)

            // 确保替换操作可视
            try {
                console.log(`[WpsBridge] Scrolling freshRange into view before replace...`)
                await wpsApp.ActiveDocument.ActiveWindow.ScrollIntoView(freshRange)
            } catch (e) {
                console.warn(`[WpsBridge] ScrollIntoView failed in replaceSelection`, e)
            }

            // 在新 Range 上设置文本
            const textStr = String(text)
            console.log(`[WpsBridge] Step 3: Setting freshRange.Text = '${textStr}'`)

            // 官方示例：range.Text = 'WebOffice' (无 await)
            const freshRangeText = await freshRange.Text
            freshRange.Text = textStr

            // 尝试捕获赋值操作的返回值（如果有）
            // 延迟一点点，确保异步生效
            // await new Promise(r => setTimeout(r, 50))

            // 验证替换结果
            const newText = await freshRange.Text
            console.log(`[WpsBridge] After assignment, freshRange.Text = "${newText}"`)

            // 检查是否真的替换成功
            const replacementSuccess = (newText === textStr)
            console.log(`[WpsBridge] Replacement success: ${replacementSuccess}`)

            return {
                success: replacementSuccess,
                replaced: replacementSuccess,
                message: replacementSuccess
                    ? `已将 "${oldText}" 替换为 "${textStr}"`
                    : `替换失败：期望 "${textStr}"，实际 "${newText}"`
            }
        } catch (e) {
            console.error('[WpsBridge] replaceSelection error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 查找文本的所有位置
     * 
     * 官方推荐方式：使用 Find.Execute() 返回 [{ pos, len }]
     * 参考：https://solution.wps.cn/docs/demo/word/move-cursor.html
     * 
     * Find.Execute 返回格式：[{ pos: 16, len: 2 }, ...]
     * 
     * @param {string} keyword - 关键词
     * @param {boolean} highlight - 是否高亮匹配结果
     * @param {Object} wpsInstance - WPS 实例
     */
    const findTextLocations = async (keyword, highlight = false, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            console.log(`[WpsBridge] findTextLocations: keyword="${keyword}"`)

            const doc = await wpsApp.ActiveDocument

            // 使用官方 Find.Execute API 获取准确位置
            // 返回格式：[{ pos: 16, len: 2 }, ...]
            console.log(`[WpsBridge] Calling Find.Execute('${keyword}', ${highlight})`)
            const findResult = await doc.Find.Execute(keyword, highlight)

            console.log(`[WpsBridge] Find.Execute returned:`, findResult)

            if (!findResult || !Array.isArray(findResult) || findResult.length === 0) {
                return { success: true, count: 0, positions: [], message: '未找到匹配' }
            }

            // 转换为统一格式 { start, end }
            const positions = findResult.map(item => ({
                start: item.pos,
                end: item.pos + item.len
            }))

            console.log(`[WpsBridge] Found ${positions.length} matches via Find.Execute`)

            return {
                success: true,
                count: positions.length,
                positions: positions,
                message: `找到 ${positions.length} 处匹配`
            }

        } catch (e) {
            console.error('[WpsBridge] findTextLocations error:', e)
            return { success: false, error: e.message }
        }
    }



    /**
     * 查找并替换文本
     * 
     * 使用 Selection-based API 实现查找替换：
     * - Selection.Start/End - 选中目标文本
     * - Selection.Delete() - 删除选中内容
     * - Selection.InsertAfter(text) - 插入替换文本
     * 
     * 这种方式比 Document.ReplaceText 更可靠，与 insertAtCursor 使用相同的底层 API
     * 
     * @param {string} findTextStr - 要查找的文本
     * @param {string} replaceTextStr - 要替换的文本
     * @param {boolean} replaceAll - 是否替换所有
     * @param {Object} wpsInstance - WPS 实例
     */
    /**
     * 查找并替换文本 (Macro-style)
     * 利用 atomic methods 实现，保证一致性
     */
    const findAndReplace = async (findTextStr, replaceTextStr, replaceAll = true, wpsInstance = null) => {
        try {
            console.log(`[WpsBridge] findAndReplace called: find='${findTextStr}', replace='${replaceTextStr}', all=${replaceAll}`)

            const wpsApp = await getWpsInstance(wpsInstance)

            // 0. Ensure revision state ONCE at the start
            await ensureTrackRevisions(wpsApp)

            // 1. 查找所有位置
            const findResult = await findTextLocations(findTextStr, false, wpsApp)
            if (!findResult.success || findResult.count === 0) {
                return { success: false, error: `文档中未找到 "${findTextStr}"` }
            }

            // 2. 决定要替换哪些
            // replaceAll: reverse array to replace from end (keeping indices valid)
            // replaceFirst: just the first one
            let targets = []
            if (replaceAll) {
                targets = [...findResult.positions].reverse()
            } else {
                targets = [findResult.positions[0]]
            }

            // 3. 执行替换
            let replacedCount = 0
            for (const pos of targets) {
                const result = await setSelectionRange(pos.start, pos.end, wpsInstance)
                if (result.success && result.range) {
                    // 使用 setSelectionRange 返回的 range 对象进行替换
                    const replaceRes = await replaceSelection(replaceTextStr, result.range, wpsInstance)
                    if (replaceRes.success) {
                        replacedCount++
                    }
                }
            }

            // 检查是否有成功的替换
            if (replacedCount === 0) {
                return {
                    success: false,
                    replaced: false,
                    count: 0,
                    message: `未能替换任何 "${findTextStr}"，选区设置可能失败`
                }
            }

            return {
                success: true,
                replaced: true,
                count: replacedCount,
                message: `已成功将 ${replacedCount} 处 "${findTextStr}" 替换为 "${replaceTextStr}"`
            }

        } catch (e) {
            console.error('[WpsBridge] findAndReplace error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 删除文本
     * 专门的删除工具，本质上是查找并替换为空字符串，通过独立的工具暴露给 Agent
     * @param {string} text - 要删除的文本
     * @param {boolean} deleteAll - 是否删除所有匹配项
     * @param {Object} wpsInstance - WPS 实例
     */
    const deleteText = async (text, deleteAll = true, wpsInstance = null) => {
        try {
            console.log(`[WpsBridge] deleteText called: text='${text}', all=${deleteAll}`)
            const wpsApp = await getWpsInstance(wpsInstance)

            // 1. Find
            const findResult = await findTextLocations(text, false, wpsApp)
            if (!findResult.success || findResult.count === 0) {
                return { success: false, error: `文档中未找到 "${text}"` }
            }

            let positions = findResult.positions
            if (!deleteAll) {
                positions = [positions[0]] // Just the first one
            } else {
                positions = [...positions].reverse() // Delete from end to keep indices valid
            }

            let deletedCount = 0
            const doc = await wpsApp.ActiveDocument

            for (const pos of positions) {
                try {
                    // 确保修订模式
                    await ensureTrackRevisions(wpsApp)

                    // 使用 Range 直接删除（避免 Selection 定位问题）
                    const range = await doc.Range(pos.start, pos.end)
                    const rangeText = await range.Text
                    console.log(`[WpsBridge] deleteText: Deleting at ${pos.start}-${pos.end}, text="${rangeText}"`)

                    // 设置 Range.Text = '' 来删除
                    range.Text = ''
                    await new Promise(r => setTimeout(r, 50))

                    deletedCount++
                } catch (e) {
                    console.warn(`[WpsBridge] Failed to delete match at ${pos.start}:`, e)
                }
            }

            return {
                success: true,
                deleted: true,
                count: deletedCount,
                message: `已成功删除 ${deletedCount} 处 "${text}"`
            }
        } catch (e) {
            console.error('[WpsBridge] deleteText error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 在指定位置替换文本
     * 
     * 官方文档推荐方式：直接设置 Range.Text
     * https://solution.wps.cn/docs/client/api/Word/Range.html#text
     * 
     * 示例：
     *   const range = await app.ActiveDocument.Range(0, 10)
     *   range.Text = 'newContent'
     * 
     * @param {number} start - 开始位置（字符索引）
     * @param {number} end - 结束位置（字符索引）
     * @param {string} newText - 替换后的文本
     * @param {Object} wpsInstance - WPS 实例
     */
    const replaceAtPosition = async (start, end, newText, wpsInstance = null) => {
        try {
            console.log(`[WpsBridge] replaceAtPosition: ${start}-${end} => "${newText}"`)
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // 1. 检查文档保护
            try {
                const protectionType = await doc.ProtectionType
                if (protectionType === 3) return { success: false, error: '文档处于只读保护模式' }
            } catch (e) { }

            // 2. 确保修订模式
            await ensureTrackRevisions(wpsApp)

            // ========== 第一步：获取目标选区的起点和终点位置 ==========
            const targetStart = parseInt(start)
            const targetEnd = parseInt(end)
            console.log(`[WpsBridge] Step 1: Target position = ${targetStart}-${targetEnd}`)

            // 验证目标位置的文本（可选，用于调试）
            const verifyRange = await doc.Range(targetStart, targetEnd)
            const oldText = await verifyRange.Text
            console.log(`[WpsBridge] Step 1: Target text = "${oldText}"`)

            // ========== 第二步：按官方示例，先获取任意 Range，再用 SetRange 定位 ==========
            // 官方示例：
            // const range = await app.ActiveDocument.Range(0, 10)
            // await range.SetRange(10, 20)
            console.log(`[WpsBridge] Step 2: Creating fresh range via doc.Range(0, 0)`)
            const range = await doc.Range(0, 0)

            console.log(`[WpsBridge] Step 2: Calling range.SetRange(${targetStart}, ${targetEnd})`)
            await range.SetRange(targetStart, targetEnd)

            // 验证 Range 设置正确
            const rangeStart = await range.Start
            const rangeEnd = await range.End
            const rangeText = await range.Text
            console.log(`[WpsBridge] Step 2: Range after SetRange = ${rangeStart}-${rangeEnd}, text="${rangeText}"`)

            // 检查 Range 是否设置成功
            if (rangeStart !== targetStart || rangeEnd !== targetEnd) {
                console.error(`[WpsBridge] Range.SetRange failed! Expected ${targetStart}-${targetEnd}, got ${rangeStart}-${rangeEnd}`)
                return { success: false, error: `Range 设置失败：期望 ${targetStart}-${targetEnd}，实际 ${rangeStart}-${rangeEnd}` }
            }

            // ========== 第三步：直接使用 Range 对象进行删除和插入 ==========
            // 重要发现：Selection.Start = value 只修改 JS 对象属性，不会移动 WPS 光标！
            // 解决方案：使用 Step 2 中已正确定位的 Range 对象直接操作
            // 官方文档：https://solution.wps.cn/docs/client/api/Word/Range.html

            console.log(`[WpsBridge] Step 3: Using Range object directly (bypassing Selection)`)
            console.log(`[WpsBridge] Step 3: Range is at ${rangeStart}-${rangeEnd}, text="${rangeText}"`)

            // 方法1：直接设置 Range.Text（官方示例方式）
            // 这会删除原内容并插入新内容
            console.log(`[WpsBridge] Step 3: Setting range.Text = "${newText}"`)
            range.Text = newText

            // 等待操作完成
            await new Promise(r => setTimeout(r, 100))

            // 验证替换结果
            // 注意：替换后 range 的范围会改变，需要重新获取
            const postReplaceRange = await doc.Range(targetStart, targetStart + newText.length)
            const postReplaceText = await postReplaceRange.Text
            console.log(`[WpsBridge] Step 3: After replacement, text at ${targetStart}-${targetStart + newText.length} = "${postReplaceText}"`)

            // 详细调试：检查原 range 对象的状态
            const rangeAfterAssign = await range.Text
            const rangeStartAfter = await range.Start
            const rangeEndAfter = await range.End
            console.log(`[WpsBridge] Step 3: Original range object after assignment:`)
            console.log(`[WpsBridge]   - Start: ${rangeStartAfter}, End: ${rangeEndAfter}`)
            console.log(`[WpsBridge]   - Text: "${rangeAfterAssign}"`)

            // 检查是否替换成功
            if (postReplaceText !== newText) {
                console.error(`[WpsBridge] Step 3: Range.Text assignment FAILED!`)
                console.error(`[WpsBridge]   - Expected: "${newText}"`)
                console.error(`[WpsBridge]   - Got: "${postReplaceText}"`)
                console.error(`[WpsBridge]   - This may be a WPS SDK limitation. Range.Text assignment might not work.`)

                // 不使用 fallback，直接返回失败以便调试
                return {
                    success: false,
                    error: `Range.Text 赋值失败：期望 "${newText}"，实际 "${postReplaceText}"`,
                    debug: {
                        targetStart,
                        targetEnd,
                        oldText,
                        newText,
                        postReplaceText,
                        rangeAfterAssign
                    }
                }
            }

            // 滚动到可见位置
            try {
                await doc.ActiveWindow.ScrollIntoView(range)
            } catch (e) {
                console.warn('[WpsBridge] ScrollIntoView failed:', e)
            }

            return {
                success: true,
                replaced: true,
                start: targetStart,
                end: targetEnd,
                newText,
                message: `已将位置 ${targetStart}-${targetEnd} 的内容 "${oldText}" 替换为 "${newText}"`
            }
        } catch (e) {
            console.error('[WpsBridge] replaceAtPosition error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 替换第 N 个可见匹配
     * 重要：只计算用户可见的匹配（排除修订模式下被删除的内容）
     * 
     * @param {string} findStr - 要查找的文本
     * @param {string} replaceStr - 替换为的文本
     * @param {number} matchIndex - 第几个（从 1 开始）
     * @param {Object} wpsInstance - WPS 实例
     */
    const replaceNthMatch = async (findStr, replaceStr, matchIndex, wpsInstance = null) => {
        try {
            console.log(`[WpsBridge] replaceNthMatch: find='${findStr}', replace='${replaceStr}', index=${matchIndex}`)

            const wpsApp = await getWpsInstance(wpsInstance)

            // 1. Find
            const findResult = await findTextLocations(findStr, false, wpsApp)
            if (!findResult.success) return findResult

            // 2. Locate
            const visiblePositions = findResult.positions
            if (matchIndex > visiblePositions.length) {
                return { success: false, error: `只找到 ${visiblePositions.length} 个匹配，无法替换第 ${matchIndex} 个` }
            }
            const targetPos = visiblePositions[matchIndex - 1]

            // 3. Replace using strict position logic
            // Use replaceAtPosition which now uses Selection/Delete/Insert
            return await replaceAtPosition(targetPos.start, targetPos.end, replaceStr, wpsApp)

        } catch (e) {
            console.error('[WpsBridge] replaceNthMatch error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 删除第 N 个可见匹配
     * 使用 Range.Delete() 直接删除，避免 Selection 定位问题
     * 
     * @param {string} findStr - 要查找的文本
     * @param {number} matchIndex - 第几个（从 1 开始）
     * @param {Object} wpsInstance - WPS 实例
     */
    const deleteMatch = async (findStr, matchIndex, wpsInstance = null) => {
        try {
            console.log(`[WpsBridge] deleteMatch: find='${findStr}', index=${matchIndex}`)
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // 1. 确保修订模式
            await ensureTrackRevisions(wpsApp)

            // 2. Find
            const findResult = await findTextLocations(findStr, false, wpsApp)
            if (!findResult.success) return findResult

            const visiblePositions = findResult.positions
            if (matchIndex > visiblePositions.length) {
                return { success: false, error: `只找到 ${visiblePositions.length} 个匹配，无法删除第 ${matchIndex} 个` }
            }
            const targetPos = visiblePositions[matchIndex - 1]

            console.log(`[WpsBridge] deleteMatch: Target position = ${targetPos.start}-${targetPos.end}`)

            // 3. 使用 Range 直接删除（避免 Selection 定位问题）
            const range = await doc.Range(targetPos.start, targetPos.end)
            const rangeText = await range.Text
            console.log(`[WpsBridge] deleteMatch: Range text = "${rangeText}"`)

            // 验证是否选中了正确的文本
            if (rangeText !== findStr) {
                console.warn(`[WpsBridge] deleteMatch: Range text mismatch! Expected "${findStr}", got "${rangeText}"`)
            }

            // 方法1：设置 Range.Text = '' 来删除
            console.log(`[WpsBridge] deleteMatch: Setting range.Text = ''`)
            range.Text = ''

            await new Promise(r => setTimeout(r, 100))

            // 验证删除结果
            const verifyRange = await doc.Range(targetPos.start, targetPos.start + findStr.length)
            const verifyText = await verifyRange.Text
            console.log(`[WpsBridge] deleteMatch: After delete, text at position = "${verifyText}"`)

            // 如果 Range.Text = '' 无效，尝试 Range.Delete()
            if (verifyText === findStr) {
                console.warn(`[WpsBridge] deleteMatch: Range.Text = '' failed, trying range.Delete()`)
                const freshRange = await doc.Range(targetPos.start, targetPos.end)
                await freshRange.Delete()
                await new Promise(r => setTimeout(r, 100))
            }

            return {
                success: true,
                deleted: true,
                message: `已删除第 ${matchIndex} 个 "${findStr}"`
            }

        } catch (e) {
            console.error('[WpsBridge] deleteMatch error:', e)
            return { success: false, error: e.message }
        }
    }

    // ==================== 插入和修改 ====================

    /**
     * 在光标位置插入文本
     * 注意：WPS WebOffice SDK 不支持 TypeText()，使用 InsertAfter() 代替
     * 官方 API: https://solution.wps.cn/docs/client/api/Word/Selection.html#insertafter
     * @param {string} text - 要插入的文本
     * @param {Object} wpsInstance - WPS 实例
     */
    const insertAtCursor = async (text, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)

            // 1. 检查文档保护状态
            // 官方文档: https://solution.wps.cn/docs/client/api/Word/Document.html#protect-password-type
            try {
                const doc = await wpsApp.ActiveDocument
                const protectionType = await doc.ProtectionType
                if (protectionType !== -1 && protectionType !== 0) {
                    console.warn('[WpsBridge] Document is protected, type:', protectionType)
                    if (protectionType === 3) {
                        return { success: false, error: '文档处于只读保护模式，无法插入内容' }
                    }
                }
            } catch (e) {
                console.warn('[WpsBridge] Check protection failed:', e)
            }

            // 2. 确保开启修订模式，并设置视图可见性
            await ensureTrackRevisions(wpsApp)
            try {
                const doc = await wpsApp.ActiveDocument
                const view = await doc.ActiveWindow.View
                view.ShowRevisionsAndComments = true
                // 0=Final, 1=Original, 2=FinalShowingMarkup
                // 设置为 2 确保用户能看到修改标记，或者 0 看到最终结果
                // 这里我们设为 true 应该足够，但为了保险可以设置 RevisionsView
                // view.RevisionsView = 0 
                console.log('[WpsBridge] Set ShowRevisionsAndComments = true')
            } catch (viewErr) {
                console.warn('[WpsBridge] Failed to set View preferences:', viewErr)
            }

            // 3. 获取选区并使用 InsertAfter 插入
            // 官方文档: https://solution.wps.cn/docs/client/api/Word/Selection.html
            const sel = await getSelection(wpsApp)
            const range = await sel.Range
            const startPos = await range.Start

            console.log('[WpsBridge] Inserting at cursor via InsertAfter:', { start: startPos, textLen: text.length })

            // 核心修复：使用 InsertAfter 方法，这是 WebOffice SDK 中插入文本的官方推荐方式
            // Range.Text 赋值虽然不报错，但在某些环境下可能无效（静默失败）
            await sel.InsertAfter(text)

            // InsertAfter 会将文本插入到选区/光标之后
            // 插入后，我们需要确认光标位置。
            // 通常 InsertAfter 后 selection 会包含新插入的文本，或者在文本之后。
            // 为保险起见，获取新的 End，并将 Start 设置为 End (折叠到末尾)

            const newRange = await sel.Range
            const newEnd = await newRange.End
            await newRange.SetRange(newEnd, newEnd) // 折叠到末尾

            console.log('[WpsBridge] Insertion Result:', {
                success: true,
                insertedAt: newEnd,
                movedDistance: newEnd - startPos
            })

            return { success: true, insertedAt: newEnd }
        } catch (e) {
            console.error('[WpsBridge] insertAtCursor error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 在光标位置删除字符
     * 使用 Selection.TypeBackspace() 删除光标前的字符
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Selection.html#typebackspace
     * 
     * @param {number} count - 删除的字符数（默认1）
     * @param {Object} wpsInstance - WPS 实例
     */
    const deleteAtCursor = async (count = 1, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const deleteCount = parseInt(count) || 1

            console.log(`[WpsBridge] deleteAtCursor: count=${deleteCount}`)

            // 确保修订模式
            await ensureTrackRevisions(wpsApp)

            // 获取 Selection
            const sel = await getSelection(wpsApp)

            // 记录删除前位置
            const beforeRange = await sel.Range
            const beforeStart = await beforeRange.Start
            console.log(`[WpsBridge] deleteAtCursor: Cursor before delete at position ${beforeStart}`)

            // 使用 TypeBackspace 删除光标前的字符
            // 如果需要删除多个字符，循环调用
            for (let i = 0; i < deleteCount; i++) {
                console.log(`[WpsBridge] deleteAtCursor: Calling TypeBackspace (${i + 1}/${deleteCount})`)
                await sel.TypeBackspace()
            }

            // 记录删除后位置
            const afterRange = await sel.Range
            const afterStart = await afterRange.Start
            console.log(`[WpsBridge] deleteAtCursor: Cursor after delete at position ${afterStart}`)

            return {
                success: true,
                deletedCount: deleteCount,
                cursorBefore: beforeStart,
                cursorAfter: afterStart,
                message: `已删除 ${deleteCount} 个字符`
            }
        } catch (e) {
            console.error('[WpsBridge] deleteAtCursor error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 获取指定段落的文本
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Paragraphs.html
     * 注意：需要通过 Range.Paragraphs 访问段落，而非 doc.Paragraphs
     * @param {number} index - 段落索引（从1开始）
     * @param {Object} wpsInstance - WPS 实例
     */
    const getParagraph = async (index, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // ========== 方式1：使用 Content.Paragraphs (推荐) ==========
            // 官方文档：ActiveDocument.Content 返回代表全文的 Range 对象
            // 然后通过 Range.Paragraphs 获取段落集合
            let paras = null
            let count = 0

            try {
                const content = await doc.Content
                paras = await content.Paragraphs
                count = await paras.Count
                console.log('[WpsBridge] getParagraph via Content.Paragraphs, count:', count)
            } catch (e1) {
                console.warn('[WpsBridge] Content.Paragraphs failed, trying Range:', e1)

                // ========== 方式2：使用 Range(0, 大数).Paragraphs ==========
                // 官方文档示例：ActiveDocument.Range(0, 100).Paragraphs
                try {
                    const fullRange = await doc.Range(0, 99999999)  // 使用大范围覆盖全文
                    paras = await fullRange.Paragraphs
                    count = await paras.Count
                    console.log('[WpsBridge] getParagraph via Range().Paragraphs, count:', count)
                } catch (e2) {
                    console.warn('[WpsBridge] Range().Paragraphs failed, trying GetDocumentRange:', e2)

                    // ========== 方式3：使用 GetDocumentRange().Paragraphs ==========
                    const docRange = await doc.GetDocumentRange()
                    paras = await docRange.Paragraphs
                    count = await paras.Count
                    console.log('[WpsBridge] getParagraph via GetDocumentRange().Paragraphs, count:', count)
                }
            }

            if (!paras || count === 0) {
                return { success: false, error: '无法获取文档段落集合' }
            }

            if (index < 1 || index > count) {
                return { success: false, error: `段落索引超出范围 (1-${count})` }
            }

            const para = await paras.Item(index)
            const range = await para.Range

            const text = await range.Text
            const start = await range.Start
            const end = await range.End

            return {
                success: true,
                text: text ? text.trim() : '',
                start,
                end,
                paragraphIndex: index,
                totalParagraphs: count
            }
        } catch (e) {
            console.error('[WpsBridge] getParagraph error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 修改指定段落的文本
     * 使用 Selection API 实现修改（与 findAndReplace 保持一致）
     * @param {number} index - 段落索引（从1开始）
     * @param {string} newText - 新的段落文本
     * @param {Object} wpsInstance - WPS 实例
     */
    const modifyParagraph = async (index, newText, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // 确保开启修订模式
            await ensureTrackRevisions(wpsApp)

            // 通过 Content.Paragraphs 获取段落集合
            let paras = null
            let count = 0

            try {
                const content = await doc.Content
                paras = await content.Paragraphs
                count = await paras.Count
            } catch (e1) {
                console.warn('[WpsBridge] modifyParagraph: Content.Paragraphs failed, trying Range:', e1)
                try {
                    const fullRange = await doc.Range(0, 99999999)
                    paras = await fullRange.Paragraphs
                    count = await paras.Count
                } catch (e2) {
                    const docRange = await doc.GetDocumentRange()
                    paras = await docRange.Paragraphs
                    count = await paras.Count
                }
            }

            if (!paras || count === 0) {
                return { success: false, error: '无法获取文档段落集合' }
            }

            if (index < 1 || index > count) {
                return { success: false, error: `段落索引超出范围 (1-${count})` }
            }

            const para = await paras.Item(index)
            const range = await para.Range

            // 获取段落的起止位置
            const startPos = await range.Start
            const endPos = await range.End

            // 使用可靠的 Selection.Delete + InsertAfter 模式替代 Range.Text 赋值
            // Range.Text 赋值在某些环境下会静默失败
            const sel = await wpsApp.ActiveDocument.ActiveWindow.Selection

            // 直接设置 Selection.Start/End 移动光标（保留段落标记）
            sel.Start = startPos
            sel.End = endPos - 1

            // 等待属性生效
            await new Promise(r => setTimeout(r, 50))

            // 删除并插入新文本
            await sel.Delete(1)
            await sel.InsertAfter(newText)

            return { success: true, paragraphIndex: index }
        } catch (e) {
            console.error('[WpsBridge] modifyParagraph error:', e)
            return { success: false, error: e.message }
        }
    }

    // ==================== 文档结构 ====================

    /**
     * 获取文档大纲结构
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Paragraphs.html
     * @param {Object} wpsInstance - WPS 实例
     */
    const getDocumentOutline = async (wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // 通过 Content.Paragraphs 获取段落集合
            let paras = null
            let count = 0

            try {
                const content = await doc.Content
                paras = await content.Paragraphs
                count = await paras.Count
                console.log('[WpsBridge] getDocumentOutline via Content.Paragraphs, count:', count)
            } catch (e1) {
                console.warn('[WpsBridge] getDocumentOutline: Content.Paragraphs failed, trying Range:', e1)
                try {
                    const fullRange = await doc.Range(0, 99999999)
                    paras = await fullRange.Paragraphs
                    count = await paras.Count
                    console.log('[WpsBridge] getDocumentOutline via Range().Paragraphs, count:', count)
                } catch (e2) {
                    console.warn('[WpsBridge] getDocumentOutline: Range().Paragraphs failed, trying GetDocumentRange:', e2)
                    const docRange = await doc.GetDocumentRange()
                    paras = await docRange.Paragraphs
                    count = await paras.Count
                    console.log('[WpsBridge] getDocumentOutline via GetDocumentRange().Paragraphs, count:', count)
                }
            }

            if (!paras || count === 0) {
                return { success: false, error: '无法获取文档段落集合' }
            }

            const outline = []

            for (let i = 1; i <= count && i <= 500; i++) { // 限制最多500段
                try {
                    const para = await paras.Item(i)
                    const style = await para.Style

                    // 获取样式名称，尝试多种属性
                    let styleName = ''
                    try {
                        styleName = await style.NameLocal
                    } catch (e) {
                        try {
                            styleName = await style.Name
                        } catch (e2) {
                            // 忽略
                        }
                    }

                    // 检查是否是标题样式
                    if (styleName && (styleName.includes('标题') || styleName.includes('Heading') || styleName.includes('heading'))) {
                        const range = await para.Range
                        const text = await range.Text

                        // 提取标题级别
                        let level = 1
                        const levelMatch = styleName.match(/\d/)
                        if (levelMatch) {
                            level = parseInt(levelMatch[0])
                        }

                        const start = await range.Start

                        outline.push({
                            title: text ? text.trim() : '',
                            level,
                            paragraphIndex: i,
                            position: start
                        })
                    }
                } catch (paraError) {
                    // 跳过无法读取的段落
                    console.warn(`[WpsBridge] getDocumentOutline: Skip para ${i}:`, paraError)
                }
            }

            return { success: true, outline, totalHeadings: outline.length, totalParagraphs: count }
        } catch (e) {
            console.error('[WpsBridge] getDocumentOutline error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 在指定标题下方插入内容
     * 官方文档：https://solution.wps.cn/docs/client/api/Word/Find.html
     * 注意：Find.Execute() 只支持 2 个参数 (Text, ShowHighlight)
     * @param {string} headingText - 标题文本（用于定位）
     * @param {string} content - 要插入的内容
     * @param {Object} wpsInstance - WPS 实例
     */
    const insertUnderHeading = async (headingText, content, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const doc = await wpsApp.ActiveDocument

            // 确保开启修订模式
            await ensureTrackRevisions(wpsApp)

            // ========== 方式1：使用 Selection.Find ==========
            // 官方推荐路径：app.ActiveDocument.ActiveWindow.Selection
            const sel = await getSelection(wpsApp)

            // 移动到文档开头 (修复 HomeKey)
            try {
                // Get range to start
                const startRange = await sel.Range
                await startRange.SetRange(0, 0)
            } catch (e) {
                // 某些版本可能不支持，尝试其他方式
                console.warn('[WpsBridge] Set Start/End failed:', e)
            }

            // 使用 ActiveDocument.Find 而非 Selection.Find（官方推荐）
            // Find.Execute 返回 [{ pos, len }, ...] 数组，不是布尔值
            const found = await doc.Find.Execute(headingText, false)

            if (!found || !Array.isArray(found) || found.length === 0) {
                return { success: false, error: `未找到标题: ${headingText}` }
            }

            // 移动到标题段落末尾 (修复 EndKey)
            try {
                // 获取当前找到的标题的 Range
                const titleRange = await sel.Range
                const titleEnd = await titleRange.End
                // 移动光标到标题末尾
                const selRange = await sel.Range
                await selRange.SetRange(titleEnd, titleEnd)
            } catch (e) {
                console.warn('[WpsBridge] Move to title end failed:', e)
            }

            try {
                // 移动到下一行开头 (修复 MoveRight -> 属性控制)
                // 简单地插入一个换行符，然后光标自然在换行符后
                // 或者可以直接 InsertAfter('\n' + content)
            } catch (e) {
                console.warn('[WpsBridge] MoveRight failed:', e)
            }

            // 插入内容 (使用 InsertAfter 更稳健)
            await sel.InsertAfter('\n' + content)

            // 折叠光标到新内容之后
            // 折叠光标到新内容之后
            const rangeAfter = await sel.Range
            const newEnd = await rangeAfter.End
            await rangeAfter.SetRange(newEnd, newEnd)

            const position = await rangeAfter.Start
            return { success: true, insertedAt: position }
        } catch (e) {
            console.error('[WpsBridge] insertUnderHeading error:', e)
            return { success: false, error: e.message }
        }
    }

    // ==================== PPT 操作方法 ====================
    // 注意：PPT 不支持原生修订模式，使用视觉标记替代：
    // - 新增内容：用【】括起来
    // - 删除内容：用【】括起来 + 标记 (由于 PPT API 限制，实际删除时会添加标记)

    /**
     * 检测当前是否为 PPT 文档
     * @param {Object} wpsInstance - WPS 实例
     */
    const isPptDocument = async (wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            // 尝试访问 ActivePresentation，如果成功则是 PPT
            const pres = await wpsApp.ActivePresentation
            return !!pres
        } catch (e) {
            return false
        }
    }

    /**
     * 获取 PPT 演示文稿信息
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_getPresentationInfo = async (wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const slides = await pres.Slides
            const count = await slides.Count

            // 尝试获取只读状态
            let readOnly = false
            try {
                readOnly = await pres.ReadOnly
            } catch (e) {
                // 某些版本可能不支持
            }

            return {
                success: true,
                slidesCount: count,
                readOnly: readOnly,
                message: `当前 PPT 共 ${count} 页`
            }
        } catch (e) {
            console.error('[WpsBridge] ppt_getPresentationInfo error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 获取幻灯片内容（所有文本形状）
     * @param {number} slideIndex - 幻灯片索引（从1开始）
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_getSlideContent = async (slideIndex, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const slides = await pres.Slides

            const totalSlides = await slides.Count
            if (slideIndex < 1 || slideIndex > totalSlides) {
                return { success: false, error: `幻灯片索引超出范围 (1-${totalSlides})` }
            }

            const slide = await slides.Item(slideIndex)
            const shapes = await slide.Shapes
            const shapeCount = await shapes.Count

            const contents = []
            for (let i = 1; i <= shapeCount; i++) {
                try {
                    const shape = await shapes.Item(i)
                    const hasTextFrame = await shape.HasTextFrame

                    if (hasTextFrame) {
                        const textFrame = await shape.TextFrame
                        const textRange = await textFrame.TextRange
                        const text = await textRange.Text

                        // 尝试获取形状类型信息
                        let shapeType = 'unknown'
                        try {
                            const type = await shape.Type
                            // 常见类型: 1=AutoShape, 14=Placeholder, 17=TextBox
                            if (type === 14) shapeType = 'placeholder'
                            else if (type === 17) shapeType = 'textbox'
                            else shapeType = 'shape'
                        } catch (e) { }

                        if (text && text.trim()) {
                            contents.push({
                                shapeIndex: i,
                                shapeType: shapeType,
                                text: text.trim()
                            })
                        }
                    }
                } catch (shapeErr) {
                    // 跳过无法读取的形状
                    console.warn(`[WpsBridge] Skip shape ${i}:`, shapeErr)
                }
            }

            return {
                success: true,
                slideIndex,
                totalSlides,
                shapeCount,
                contents,
                message: `第 ${slideIndex} 页共有 ${contents.length} 个文本区域`
            }
        } catch (e) {
            console.error('[WpsBridge] ppt_getSlideContent error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 修改幻灯片中的文本（带修订标记）
     * 由于 PPT 不支持原生修订模式，新内容会用【】标记
     * @param {number} slideIndex - 幻灯片索引
     * @param {number} shapeIndex - 形状索引
     * @param {string} newText - 新文本
     * @param {boolean} markAsRevision - 是否添加修订标记（默认 true）
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_modifySlideText = async (slideIndex, shapeIndex, newText, markAsRevision = true, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const slides = await pres.Slides

            const totalSlides = await slides.Count
            if (slideIndex < 1 || slideIndex > totalSlides) {
                return { success: false, error: `幻灯片索引超出范围 (1-${totalSlides})` }
            }

            const slide = await slides.Item(slideIndex)
            const shapes = await slide.Shapes
            const shapeCount = await shapes.Count

            if (shapeIndex < 1 || shapeIndex > shapeCount) {
                return { success: false, error: `形状索引超出范围 (1-${shapeCount})` }
            }

            const shape = await shapes.Item(shapeIndex)
            const hasTextFrame = await shape.HasTextFrame

            if (!hasTextFrame) {
                return { success: false, error: '该形状不包含文本框' }
            }

            const textFrame = await shape.TextFrame
            const textRange = await textFrame.TextRange
            const oldText = await textRange.Text

            // 如果需要标记修订，用【】包裹新内容
            let finalText = newText
            if (markAsRevision && newText !== oldText) {
                finalText = `【${newText}】`
            }

            textRange.Text = finalText

            return {
                success: true,
                slideIndex,
                shapeIndex,
                oldText: oldText,
                newText: finalText,
                message: markAsRevision ?
                    '文本已修改并添加【】修订标记' :
                    '文本已修改'
            }
        } catch (e) {
            console.error('[WpsBridge] ppt_modifySlideText error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 在幻灯片中插入文本（带修订标记）
     * @param {number} slideIndex - 幻灯片索引
     * @param {number} shapeIndex - 形状索引
     * @param {string} insertText - 要插入的文本
     * @param {string} position - 插入位置: 'start' | 'end' | 'replace'
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_insertText = async (slideIndex, shapeIndex, insertText, position = 'end', wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const slides = await pres.Slides
            const slide = await slides.Item(slideIndex)
            const shapes = await slide.Shapes
            const shape = await shapes.Item(shapeIndex)
            const textFrame = await shape.TextFrame
            const textRange = await textFrame.TextRange
            const oldText = await textRange.Text || ''

            // 新增内容用【】标记
            const markedText = `【${insertText}】`

            let finalText
            switch (position) {
                case 'start':
                    finalText = markedText + oldText
                    break
                case 'replace':
                    finalText = markedText
                    break
                case 'end':
                default:
                    finalText = oldText + markedText
                    break
            }

            textRange.Text = finalText

            return {
                success: true,
                message: `已在第 ${slideIndex} 页插入文本并添加【】修订标记`
            }
        } catch (e) {
            console.error('[WpsBridge] ppt_insertText error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 标记删除文本（PPT 不直接删除，而是添加删除标记）
     * 删除的内容会被【】包裹并添加特殊标记
     * @param {number} slideIndex - 幻灯片索引
     * @param {number} shapeIndex - 形状索引
     * @param {string} textToDelete - 要删除的文本（会被标记而非真正删除）
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_markDeleteText = async (slideIndex, shapeIndex, textToDelete, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const slides = await pres.Slides
            const slide = await slides.Item(slideIndex)
            const shapes = await slide.Shapes
            const shape = await shapes.Item(shapeIndex)
            const textFrame = await shape.TextFrame
            const textRange = await textFrame.TextRange
            const currentText = await textRange.Text || ''

            if (!currentText.includes(textToDelete)) {
                return { success: false, error: '未找到要删除的文本' }
            }

            // 用特殊标记包裹要删除的内容：【删除：xxx】
            const markedText = currentText.replace(
                textToDelete,
                `【删除：${textToDelete}】`
            )

            textRange.Text = markedText

            return {
                success: true,
                message: `已标记删除内容：【删除：${textToDelete.substring(0, 20)}...】`
            }
        } catch (e) {
            console.error('[WpsBridge] ppt_markDeleteText error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 保存 PPT 文件
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_save = async (wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const result = await pres.Save()

            return {
                success: true,
                result: result,
                message: 'PPT 已保存'
            }
        } catch (e) {
            console.error('[WpsBridge] ppt_save error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 导出幻灯片为图片
     * 用于智能修改功能 - 当页面是纯图片时需要截图发给 AI 编辑
     * @param {number} slideIndex - 幻灯片索引（从1开始）
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_exportSlideImage = async (slideIndex, wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation
            const slides = await pres.Slides

            const totalSlides = await slides.Count
            if (slideIndex < 1 || slideIndex > totalSlides) {
                return { success: false, error: `幻灯片索引超出范围 (1-${totalSlides})` }
            }

            // 获取当前幻灯片
            const slide = await slides.Item(slideIndex)

            // 尝试使用 ExportAsFixedFormat 导出为图片
            // 注意：这个 API 可能在不同版本的 WPS WebOffice 中表现不同
            try {
                // 先尝试整页导出为 PNG
                const exportResult = await pres.ExportAsFixedFormat({
                    FixedFormatType: 2, // PNG
                    RangeType: 1, // 指定页面范围
                    SlideFrom: slideIndex,
                    SlideTo: slideIndex,
                    Intent: 1 // Print quality
                })

                if (exportResult && exportResult.url) {
                    return {
                        success: true,
                        imagePath: exportResult.url,
                        message: `已导出第 ${slideIndex} 页为图片`
                    }
                }
            } catch (exportErr) {
                console.warn('[WpsBridge] ExportAsFixedFormat failed, trying alternative method:', exportErr)
            }

            // 备选方案：尝试使用 GetPPTInfo 获取页面信息（如果有缩略图）
            try {
                const pptInfo = await pres.GetPPTInfo()
                if (pptInfo && pptInfo.slides && pptInfo.slides[slideIndex - 1]) {
                    const slideInfo = pptInfo.slides[slideIndex - 1]
                    if (slideInfo.thumbnail || slideInfo.imageUrl) {
                        return {
                            success: true,
                            imagePath: slideInfo.thumbnail || slideInfo.imageUrl,
                            message: `获取第 ${slideIndex} 页缩略图`
                        }
                    }
                }
            } catch (infoErr) {
                console.warn('[WpsBridge] GetPPTInfo failed:', infoErr)
            }

            // 如果上述方法都失败，返回错误但提供有用信息
            return {
                success: false,
                error: '当前 WPS 版本不支持幻灯片导出为图片功能。请手动截图或使用 AI 生成的 PPT 编辑工具。',
                suggestion: '如果此 PPT 是通过 pptx_generate 生成的，可以使用 pptx_edit_page 工具进行 AI 编辑。'
            }

        } catch (e) {
            console.error('[WpsBridge] ppt_exportSlideImage error:', e)
            return { success: false, error: e.message }
        }
    }

    /**
     * 获取 PPT 当前选区信息
     * @param {Object} wpsInstance - WPS 实例
     */
    const ppt_getSelection = async (wpsInstance = null) => {
        try {
            const wpsApp = await getWpsInstance(wpsInstance)
            const pres = await wpsApp.ActivePresentation

            // 尝试获取活动窗口的选区
            const activeWindow = await wpsApp.ActiveWindow
            const selection = await activeWindow.Selection
            const selType = await selection.Type

            // SelectionType: 0=None, 1=Slides, 2=Shapes, 3=Text
            if (selType === 3) {
                // 文本选区
                const textRange = await selection.TextRange
                const text = await textRange.Text
                return {
                    success: true,
                    type: 'text',
                    text: text,
                    message: `选中了文本: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`
                }
            } else if (selType === 2) {
                // 形状选区
                const shapeRange = await selection.ShapeRange
                const count = await shapeRange.Count
                return {
                    success: true,
                    type: 'shapes',
                    count: count,
                    message: `选中了 ${count} 个形状`
                }
            } else if (selType === 1) {
                // 幻灯片选区
                const slideRange = await selection.SlideRange
                const count = await slideRange.Count
                return {
                    success: true,
                    type: 'slides',
                    count: count,
                    message: `选中了 ${count} 张幻灯片`
                }
            }

            return { success: true, type: 'none', message: '没有选中任何内容' }
        } catch (e) {
            console.error('[WpsBridge] ppt_getSelection error:', e)
            return { success: false, error: e.message }
        }
    }

    // ==================== 统一命令执行器 ====================

    /**
     * 执行来自后端的 WPS 命令
     * @param {string} action - 操作类型
     * @param {Object} params - 操作参数
     * @param {Object} wpsInstance - WPS 实例
     * @returns {Promise<Object>} 执行结果
     */
    const executeCommand = async (action, params = {}, wpsInstance = null) => {
        console.log('[WpsBridge] ========== executeCommand Start ==========')
        console.log('[WpsBridge] executeCommand:', action, JSON.stringify(params))
        console.log('[WpsBridge] wpsInstance received:', !!wpsInstance, 'type:', typeof wpsInstance)

        isProcessing.value = true
        lastError.value = null

        try {
            let result

            switch (action) {
                case 'get_selection':
                    result = await getSelectionInfo(wpsInstance)
                    break

                case 'goto':
                    result = await goToPosition(params.type, params.target, wpsInstance)
                    break

                case 'set_selection':
                    result = await setSelectionRange(params.start, params.end, wpsInstance)
                    break

                case 'replace_selection':
                    // 先设置选区获取 range 对象，再执行替换
                    const selRangeResult = await setSelectionRange(params.start, params.end, wpsInstance)
                    if (selRangeResult.success && selRangeResult.range) {
                        result = await replaceSelection(params.text, selRangeResult.range, wpsInstance)
                    } else {
                        result = { success: false, error: selRangeResult.error || 'Failed to set selection range' }
                    }
                    break

                case 'find_text_locations':
                    // 第二个参数是 highlight，不是 matchCase
                    result = await findTextLocations(params.keyword, params.highlight || false, wpsInstance)
                    break



                case 'find_replace':
                    result = await findAndReplace(
                        params.findText,
                        params.replaceText,
                        params.replaceAll !== false,
                        wpsInstance
                    )
                    break

                case 'replace_at_position':
                    result = await replaceAtPosition(
                        params.start,
                        params.end,
                        params.newText,
                        wpsInstance
                    )
                    break

                case 'replace_nth_match':
                    result = await replaceNthMatch(
                        params.findText,
                        params.replaceText,
                        params.matchIndex,
                        wpsInstance
                    )
                    break

                case 'delete_match':
                    result = await deleteMatch(
                        params.findText,
                        params.matchIndex,
                        wpsInstance
                    )
                    break

                case 'delete_text':
                    result = await deleteText(
                        params.text,
                        params.deleteAll !== false,
                        wpsInstance
                    )
                    break

                case 'insert_at_cursor':
                    result = await insertAtCursor(params.text, wpsInstance)
                    break

                case 'delete_at_cursor':
                    result = await deleteAtCursor(params.count || 1, wpsInstance)
                    break

                case 'get_paragraph':
                    result = await getParagraph(params.index, wpsInstance)
                    break

                case 'modify_paragraph':
                    result = await modifyParagraph(params.index, params.newText, wpsInstance)
                    break

                case 'get_outline':
                    result = await getDocumentOutline(wpsInstance)
                    break

                case 'insert_under_heading':
                    result = await insertUnderHeading(params.headingText, params.content, wpsInstance)
                    break

                // ==================== PPT 命令 ====================
                case 'ppt_get_presentation_info':
                    result = await ppt_getPresentationInfo(wpsInstance)
                    break

                case 'ppt_get_slide_content':
                    result = await ppt_getSlideContent(params.slideIndex, wpsInstance)
                    break

                case 'ppt_modify_slide_text':
                    result = await ppt_modifySlideText(
                        params.slideIndex,
                        params.shapeIndex,
                        params.newText,
                        params.markAsRevision !== false,
                        wpsInstance
                    )
                    break

                case 'ppt_insert_text':
                    result = await ppt_insertText(
                        params.slideIndex,
                        params.shapeIndex,
                        params.text,
                        params.position || 'end',
                        wpsInstance
                    )
                    break

                case 'ppt_mark_delete_text':
                    result = await ppt_markDeleteText(
                        params.slideIndex,
                        params.shapeIndex,
                        params.textToDelete,
                        wpsInstance
                    )
                    break

                case 'ppt_get_selection':
                    result = await ppt_getSelection(wpsInstance)
                    break

                case 'ppt_save':
                    result = await ppt_save(wpsInstance)
                    break

                case 'ppt_export_slide_image':
                    result = await ppt_exportSlideImage(params.slideIndex, wpsInstance)
                    break

                default:
                    result = { success: false, error: `未知命令: ${action}` }
            }

            return result

        } catch (e) {
            console.error('[WpsBridge] executeCommand error:', e)
            lastError.value = e.message
            return { success: false, error: e.message }
        } finally {
            isProcessing.value = false
        }
    }

    // ==================== 旧版兼容 ====================

    /**
     * 执行旧版 WPS 写入操作（保持向后兼容）
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
            const trackChanges = options.track_changes !== false
            const wps = window.wps || window.WpsInvoke

            if (!wps) {
                throw new Error('WPS not available')
            }

            if (trackChanges) {
                try {
                    if (wps.ActiveDocument?.TrackRevisions !== undefined) {
                        wps.ActiveDocument.TrackRevisions = true
                    } else if (typeof wps.setTrackRevisions === 'function') {
                        await wps.setTrackRevisions(true)
                    } else if (typeof wps.invoke === 'function') {
                        await wps.invoke('Document.TrackRevisions', true)
                    }
                } catch (e) {
                    console.warn('[WpsBridge] Could not enable TrackRevisions:', e)
                }
            }

            switch (actionType) {
                case 'insert':
                    await insertAtCursor(content)
                    break
                case 'replace':
                    // 使用可靠的 Delete + InsertAfter 模式替代 Range.Text 赋值
                    const wpsAppReplace = await getWpsInstance()
                    const selReplace = await getSelection(wpsAppReplace)
                    await selReplace.Delete(1)
                    await selReplace.InsertAfter(content)
                    break
                case 'append':
                    const wpsAppAppend = await getWpsInstance()
                    // 使用 Content.End + Range.SetRange 代替 EndKey
                    // 使用 InsertAfter 代替 TypeText
                    const docAppend = await wpsAppAppend.ActiveDocument
                    const contentRange = await docAppend.Content
                    const endPos = await contentRange.End
                    const selAppend = await getSelection(wpsAppAppend)
                    const appendRange = await selAppend.Range
                    await appendRange.SetRange(endPos, endPos)
                    await selAppend.InsertAfter(content)
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


    // ==================== 流式写入 ====================

    /**
     * 当前流式写入状态 - 闭包变量
     */
    const streamState = {
        buffer: '', // 当前行缓冲区
        isFirstLine: true,
        lastStyle: 'Normal'
    }

    /**
     * 处理后端传来的 WPS 流式数据 (Markdown片段)
     * 分行解析，检测 Markdown 标记 (#, ##, etc.) 并应用样式
     * 
     * @param {string} token - 新接收到的字符片段
     * @param {Object} wpsInstance - WPS 实例 (可选)
     */
    const handleWpsStreamData = async (token, wpsInstance = null) => {
        try {
            // console.log(`[WpsStream] Received token: "${token.replace(/\n/g, '\\n')}"`)
            streamState.buffer += token

            // 检查是否有换行符
            if (streamState.buffer.includes('\n')) {
                const lines = streamState.buffer.split('\n')
                //最后一部分可能是不完整的行，留给下一次
                streamState.buffer = lines.pop()

                const wpsApp = await getWpsInstance(wpsInstance)
                const doc = await wpsApp.ActiveDocument
                const sel = await wpsApp.ActiveDocument.ActiveWindow.Selection

                // 确保光标在文档末尾 (或者当前流式输出的位置)
                // 暂时假设是在末尾追加
                // const docEnd = await doc.Content.End
                // const selRange = await sel.Range
                // await selRange.SetRange(docEnd, docEnd)

                for (const line of lines) {
                    await processStreamLine(line, sel)
                }
            }
        } catch (e) {
            console.error('[WpsStream] Error handling stream data:', e)
        }
    }

    /**
     * 处理单行流式内容
     */
    const processStreamLine = async (line, sel) => {
        const trimmed = line.trim()
        let textToInsert = line
        let styleToApply = 'Normal' // wdStyleNormal
        let isHeading = false

        // console.log(`[WpsStream] Processing line: "${line}"`)

        // 1. Detect Markdown Headers
        if (trimmed.startsWith('# ')) {
            styleToApply = 'Heading 1' // wdStyleHeading1
            textToInsert = trimmed.substring(2)
            isHeading = true
        } else if (trimmed.startsWith('## ')) {
            styleToApply = 'Heading 2' // wdStyleHeading2
            textToInsert = trimmed.substring(3)
            isHeading = true
        } else if (trimmed.startsWith('### ')) {
            styleToApply = 'Heading 3' // wdStyleHeading3
            textToInsert = trimmed.substring(4)
            isHeading = true
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            // List item (Simple implementation: just insert bullet char)
            // Or try to apply ListBullet style if available
            // textToInsert = '• ' + trimmed.substring(2)
            // styleToApply = 'List Paragraph' 
        }

        // 2. Insert Text
        // 插入文本 + 换行
        // 注意：InsertAfter 不会自动换行，我们需要在行末加 \r 或 \n，或者用 TypeParagraph
        if (textToInsert) {
            await sel.InsertAfter(textToInsert)
            // Move selection to end of inserted text
            const range = await sel.Range
            await range.SetRange(await range.End, await range.End)
        }

        // 3. Apply Style (if needed)
        if (isHeading) {
            try {
                // Select back the paragraph we just inserted? 
                // Easier: Just set the style of the paragraph at the insertion point *before* hitting enter?
                // Or after?
                // Let's try: Selection.Style = ... applies to current paragraph
                sel.Style = styleToApply
            } catch (e) {
                console.warn(`[WpsStream] Failed to apply style ${styleToApply}:`, e)
            }
        }

        // 4. Newline (Paragraph Break)
        await sel.TypeParagraph()

        // Reset style to Normal for next paragraph if we just wrote a heading
        if (isHeading) {
            try {
                sel.Style = 'Normal' // Reset
            } catch (e) { }
        }
    }

    return {
        // 状态
        isProcessing,
        lastError,

        // 核心方法
        getWpsInstance,
        executeCommand,

        // Word 选区和光标
        getSelectionInfo,
        setSelectionRange, // New
        goToPosition,

        // Word 查找和替换
        findTextLocations, // New

        findAndReplace,
        replaceSelection, // New
        replaceAtPosition,
        replaceNthMatch,
        deleteMatch,
        deleteText,

        // Word 插入和修改
        insertAtCursor,
        deleteAtCursor,
        getParagraph,
        modifyParagraph,

        // Word 文档结构
        getDocumentOutline,
        insertUnderHeading,

        // PPT 操作方法
        isPptDocument,
        ppt_getPresentationInfo,
        ppt_getSlideContent,
        ppt_modifySlideText,
        ppt_insertText,
        ppt_markDeleteText,
        ppt_getSelection,
        ppt_save,
        ppt_exportSlideImage,

        // 流式写入
        handleWpsStreamData,

        // 旧版兼容
        executeWpsAction
    }
}
