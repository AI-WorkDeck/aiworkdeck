// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { text, decode, list } = window.bqtModel;
  let context = {}, connected = false, account = '', view = 'cases', page = 1, hasMore = false, pageData = null;
  let generation = 0, listRequest = 0, detailRequest = 0, statusRequest = 0, loading = false, saving = false;
  let selected = null, dirty = false, confirmation = null, previousFocus = null;
  let authBusy = false, cooldownUntil = 0, cooldownTimer = null, outcomeUnknown = false;
  let uploadCalls = [];
  const element = (tag, value, className) => { const node = document.createElement(tag); node.textContent = text(value); if (className) node.className = className; return node; };
  const stale = () => Object.assign(new Error('stale'), { stale: true });
  function feedback(message = '', error = false) { $('feedback').textContent = message; $('feedback').dataset.error = String(error); }
  function controls() {
    const unavailable = !context.projectId || !connected;
    const pendingMedia = selected?.newMedia && !!selected.operationId;
    const invalidMedia = selected?.newMedia && !mediaValidation().valid;
    for (const id of ['new-note', 'keyword', 'status-filter', 'reload']) $(id).disabled = unavailable || saving;
    $('search-form').querySelector('[type=submit]').disabled = unavailable || saving;
    $('check-account').disabled = !context.projectId || saving;
    $('previous').disabled = unavailable || loading || saving || page <= 1;
    $('next').disabled = unavailable || loading || saving || !hasMore;
    for (const id of ['save-draft', 'publish-note', 'delete-note']) $(id).disabled = unavailable || saving || outcomeUnknown || pendingMedia || invalidMedia;
    for (const id of ['note-title', 'note-content', 'note-visibility', 'note-business', 'close-editor']) $(id).disabled = saving || (pendingMedia && id !== 'close-editor');
    $('note-title').readOnly = $('note-content').readOnly = unavailable;
    $('note-visibility').disabled = $('note-business').disabled = unavailable || saving || pendingMedia;
    for (const id of ['media-type', 'media-files', 'video-cover']) $(id).disabled = unavailable || saving || pendingMedia;
    $('resume-upload').hidden = !pendingMedia; $('resume-upload').disabled = unavailable || saving;
    $('resume-upload').textContent = selected?.uploadId ? '继续上传同一篇笔记' : '恢复同一次创建';
    if (pendingMedia) $('delete-note').disabled = true;
    $('verify-save').hidden = (pendingMedia && !selected.uploadId) || (!outcomeUnknown && !pendingMedia); $('verify-save').disabled = unavailable || saving || loading;
    for (const id of ['nav-cases', 'nav-notes']) $(id).disabled = saving;
    $('list').setAttribute('aria-busy', String(loading));
    $('logout').hidden = !connected; $('logout').disabled = saving || authBusy;
    $('login').disabled = !context.projectId || authBusy || !$('agreement').checked;
    $('send-code').disabled = !context.projectId || authBusy || !$('agreement').checked || cooldownUntil > Date.now();
  }
  async function invoke(action, args = {}, token = generation) {
    if (token !== generation) throw stale();
    if (!window.bqtSecure?.invoke) throw new Error('安全传输未就绪，请重新打开插件后重试。');
    const raw = await window.bqtSecure.invoke(action, args);
    if (token !== generation) throw stale();
    return decode(raw);
  }
  function failure(error, noteWrite = false) {
    if (error.stale) return;
    if (error.code === 'auth_required') {
      connected = false; generation++; window.bqtSecure?.reset(); listRequest++; detailRequest++; loading = false; saving = false;
      $('list').replaceChildren(); $('detail').hidden = true; $('connection').hidden = false;
      $('account-status').textContent = '登录已过期'; $('empty').hidden = false; $('empty').textContent = '请重新登录包晴天。';
      $('connection-message').textContent = dirty ? '登录已过期，未保存的笔记仍保留在本页。请使用原账号重新登录后保存，或关闭编辑放弃修改。' : '登录已过期，请重新连接包晴天账号。';
      controls(); $('close-editor').disabled = saving;
    }
    if (noteWrite && (error.code === 'outcome_unknown' || !error.code)) {
      outcomeUnknown = true; dirty = true; controls();
      if (selected?.newMedia && selected.operationId && !selected.uploadId) {
        feedback('创建结果尚未确认，文件和本次操作标识仍保留。请点击「恢复同一次创建」核对并继续；未完成的暂存记录可能不显示在本人笔记列表中，请勿据此重新创建。', true);
        return;
      }
      feedback((error.message ? error.message + '。' : '') + '保存结果尚未确认，当前笔记已暂停写入，内容仍保留。请刷新本人笔记核对，再打开已保存的笔记继续编辑；确认未保存时，可关闭当前编辑后重新新建。', true);
      return;
    }
    feedback(error.message || '操作未完成，请重试。', true);
  }
  function ask(message, action) {
    confirmation = action; previousFocus = document.activeElement;
    $('confirm-message').textContent = message; $('confirmation').hidden = false; $('cancel-confirm').focus();
  }
  function closeConfirmation() { confirmation = null; $('confirmation').hidden = true; previousFocus?.focus?.(); }
  function withDraftGuard(action) { if (saving) return; if (dirty) ask(selected?.operationId && !selected.uploadId ? '这次创建尚未确认。离开会丢失本页恢复标识，请先恢复同一次创建；不能根据列表未显示判断未创建。仍要离开？' : selected?.uploadId ? '这篇笔记的媒体尚未完成。离开将丢失本页继续上传所需的文件，请先完成上传；确认放弃本页进度？' : '这篇笔记还有未保存的修改。确认放弃这些修改？', () => { dirty = false; action(); }); else action(); }
  function clearEditor() {
    selected = null; dirty = false; outcomeUnknown = false; $('verify-save').hidden = true; $('editor').hidden = true;
    $('note-title').value = ''; $('note-content').value = ''; $('note-images').replaceChildren(); $('media-files').value = ''; $('video-cover').value = ''; $('media-file-list').replaceChildren(); $('upload-progress').hidden = true; $('resume-upload').hidden = true;
  }
  function clearContent() {
    listRequest++; detailRequest++; loading = false; hasMore = false; pageData = null;
    $('list').replaceChildren(); $('detail').hidden = true; clearEditor();
    $('result-count').textContent = ''; $('empty').hidden = false; controls();
  }
  // 把当前视图与笔记状态同步给宿主左栏（宿主不支持时静默忽略）
  function syncSidebar() { try { const p = awd.call?.('sidebar.sync', { view, status: $('status-filter').value }); p?.catch?.(() => {}); } catch { /* old host */ } }
  function switchView(next) {
    generation++; view = next; page = 1; clearContent(); feedback();
    $('keyword').value = ''; $('status-filter').value = '';
    for (const name of ['cases', 'notes']) { if (name === view) $('nav-' + name).setAttribute('aria-current', 'page'); else $('nav-' + name).removeAttribute('aria-current'); }
    $('new-note').hidden = view !== 'notes'; $('status-filter-label').hidden = view !== 'notes';
    $('section-title').textContent = view === 'cases' ? '案源广场' : '我的笔记';
    $('section-caption').textContent = view === 'cases' ? '了解法律需求，找到合适的合作机会。' : '管理您在包晴天发布的图文笔记，也照顾尚在打磨的草稿。';
    $('keyword').placeholder = view === 'cases' ? '筛选本页案源标题或内容' : '搜索我的全部笔记标题或正文';
    $('search-submit').textContent = view === 'cases' ? '筛选本页' : '搜索';
    $('filter-scope').textContent = view === 'cases' ? '关键词仅筛选当前页案源；可翻页继续查找。' : '关键词搜索全部本人笔记的标题或文字正文；状态仅筛选当前页。';
    loadList(); syncSidebar();
  }
  function meta(item) { return [text(item.category), text(item.region), text(view === 'cases' ? item.createdAt : item.updatedAt)].filter(Boolean).join(' · '); }
  function renderList(data) {
    pageData = data;
    const keyword = $('keyword').value.trim().toLocaleLowerCase();
    const status = $('status-filter').value;
    const items = data.items.filter(item => view === 'cases'
      ? !keyword || [item.title, item.description, item.category, item.region].some(value => text(value).toLocaleLowerCase().includes(keyword))
      : !status || item.status === status);
    $('list').replaceChildren();
    for (const item of items) {
      const button = element('button', '', 'item'); button.type = 'button'; button.dataset.id = text(item.id); button.setAttribute('aria-pressed', 'false');
      const top = element('div', '', 'item-top'); top.append(element('h3', item.title || '未命名'));
      if (view === 'notes') top.append(element('span', item.status === 'draft' ? '草稿' : item.status === 'published' ? '公开发布' : item.status === 'private' ? '仅自己可见' : '其他状态', 'badge'));
      button.append(top, element('p', meta(item), 'muted'));
      if (view === 'cases' && text(item.budget)) button.append(element('p', item.budget, 'budget'));
      button.append(element('p', item.description || item.content, 'summary'));
      button.addEventListener('click', () => { if (!saving) withDraftGuard(() => openItem(item.id)); });
      $('list').append(button);
    }
    $('empty').hidden = items.length > 0;
    const localFilter = view === 'cases' ? !!keyword : !!status;
    $('empty').textContent = localFilter && (data.items.length > 0 || data.hasMore)
      ? '当前页没有匹配的内容，可翻页继续查看，或清除本页筛选。'
      : view === 'notes' && keyword ? '没有找到匹配的笔记，换个关键词试试。'
      : view === 'cases' ? '暂时没有案源，稍后再来看看。' : '还没有笔记。可以从一篇草稿开始。';
    const totalLabel = view === 'notes' && keyword ? '搜索结果共 ' : '平台共 ';
    $('result-count').textContent = (data.total === null ? '' : totalLabel + data.total + ' 条 · ') + '本页' + (localFilter ? '匹配 ' : ' ') + items.length + ' 条';
    $('page-label').textContent = '第 ' + page + ' 页'; hasMore = data.hasMore;
  }
  async function loadList() {
    if (!connected || !context.projectId) { $('empty').textContent = '连接包晴天账号后即可查看。'; controls(); return; }
    const token = generation, request = ++listRequest; loading = true; controls(); feedback('正在读取…');
    try {
      const data = list(await invoke(view, { page, ...(view === 'notes' ? { keyword: $('keyword').value.trim() } : {}) }, token));
      if (request !== listRequest) return;
      renderList(data); feedback(); return true;
    } catch (error) { if (request === listRequest && token === generation) { failure(error); if (!$('list').children.length) $('empty').textContent = '读取未完成，可点击「刷新」重试。'; } }
    finally { if (request === listRequest && token === generation) { loading = false; controls(); } }
  }
  async function openItem(id) {
    const token = generation, request = ++detailRequest;
    feedback('正在读取详情…');
    try {
      const data = await invoke(view === 'cases' ? 'case_detail' : 'note_detail', { id }, token);
      if (request !== detailRequest) return;
      if (!text(data.id)) throw new Error('详情数据不完整，请重试。');
      document.querySelectorAll('.item').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.id === text(id))));
      if (view === 'notes') editNote(data);
      else {
        $('detail').hidden = false; $('detail-title').textContent = text(data.title) || '案源详情';
        $('detail-meta').textContent = meta(data); $('detail-budget').textContent = text(data.budget);
        $('detail-content').textContent = text(data.description);
        $('detail-title').tabIndex = -1; $('detail-title').focus();
      }
      feedback();
    } catch (error) { if (token === generation && request === detailRequest) failure(error); }
  }
  function editNote(note = {}) {
    selected = note.id ? note : { ...note, newMedia: true, type: 'IMAGE', files: [], completed: [] }; dirty = false; outcomeUnknown = false; $('editor').hidden = false; $('detail').hidden = true;
    $('editor-heading').textContent = note.id ? '编辑笔记' : '新建笔记';
    $('media-picker').hidden = !!note.id; $('media-type').value = 'IMAGE'; $('media-files').value = ''; $('video-cover').value = ''; $('media-file-list').replaceChildren(); $('upload-progress').hidden = true; configureMedia(); $('media-validation').textContent = mediaValidation().message;
    $('note-title').value = text(note.title); $('note-content').value = text(note.content);
    document.querySelector('label[for="note-content"]').textContent = !note.id || ['IMAGE', 'VIDEO'].includes(note.type) ? '正文（可选）' : '正文';
    $('note-state').textContent = note.id ? (note.status === 'published' ? '公开发布' : note.status === 'private' ? '仅自己可见' : '草稿') : '尚未保存';
    $('note-visibility').value = note.status === 'private' ? 'private' : 'published';
    $('publish-note').textContent = note.status === 'published' || note.status === 'private' ? '保存发布修改' : '发布笔记';
    const mediaCount = Array.isArray(note.media) ? note.media.length : Number(note.mediaCount) || 0;
    $('note-images').hidden = !mediaCount && !['IMAGE', 'VIDEO'].includes(note.type);
    $('note-images').textContent = note.type === 'VIDEO' ? '原视频随笔记保留，本页仅编辑标题和正文。' : '原图片' + (mediaCount ? '（' + mediaCount + ' 张）' : '') + '随笔记保留，本页仅编辑标题和正文。';
    $('delete-note').hidden = !note.id; $('business-label').hidden = $('note-business').hidden = !!note.id;
    if (!note.id) loadBusinessTypes(); controls(); $('note-title').focus();
  }
  async function loadBusinessTypes() {
    const token = generation, note = selected;
    $('note-business').replaceChildren(element('option', '正在读取业务类别…')); $('note-business').firstChild.value = '';
    try {
      const data = await invoke('business_types', {}, token);
      if (selected !== note) return;
      if (!Array.isArray(data.items)) throw new Error('业务类别暂不可用，请稍后重试。');
      $('note-business').replaceChildren(element('option', '请选择业务类别')); $('note-business').firstChild.value = '';
      for (const item of data.items) { if (text(item.id) && text(item.name)) { const option = element('option', item.name); option.value = text(item.id); $('note-business').append(option); } }
    } catch (error) { if (token === generation && selected === note) { $('note-business').replaceChildren(element('option', '类别读取失败')); $('note-business').firstChild.value = ''; failure(error); } }
  }
  function mediaValidation() {
    if (!selected?.newMedia) return { valid: true, message: '' };
    const files = selected.files || [], video = selected.type === 'VIDEO';
    if (video ? files.length !== 2 : files.length < 1 || files.length > 9) return { valid: false, message: video ? '请选择一个视频和一张独立封面。' : '请选择 1–9 张图片。' };
    for (let i = 0; i < files.length; i++) {
      const file = files[i], isVideo = video && i === 0;
      if (!file || !file.size || file.size > (isVideo ? 50 : 10) * 1024 * 1024 || !(isVideo ? ['video/mp4', 'video/quicktime', 'video/webm'] : ['image/png', 'image/jpeg', 'image/webp', 'image/gif']).includes(file.type))
        return { valid: false, message: isVideo ? '视频须为 MP4/MOV/WebM，大小不超过 50 MiB。' : '图片须为 PNG/JPG/WebP/GIF，大小不超过 10 MiB。' };
    }
    return { valid: true, message: '文件已选择，保存时开始上传。' };
  }
  function configureMedia() {
    const video = $('media-type').value === 'VIDEO';
    $('media-files').accept = video ? 'video/mp4,video/quicktime,video/webm' : 'image/png,image/jpeg,image/webp,image/gif'; $('media-files').multiple = !video;
    $('media-files-label').textContent = video ? '视频（MP4/MOV/WebM，不超过 50 MiB）' : '图片（1–9 张，每张不超过 10 MiB）';
    $('video-cover').hidden = $('video-cover-label').hidden = !video;
  }
  function updateMedia() {
    if (!selected?.newMedia || selected.operationId) return;
    selected.type = $('media-type').value;
    const media = Array.from($('media-files').files || []), covers = Array.from($('video-cover').files || []);
    selected.files = selected.type === 'VIDEO' ? [media[0], covers[0]] : media;
    $('media-file-list').replaceChildren();
    selected.files.forEach((file, i) => { if (file) $('media-file-list').append(element('li', (selected.type === 'VIDEO' ? (i ? '封面：' : '视频：') : '') + file.name + ' · ' + (file.size / 1024 / 1024).toFixed(2) + ' MiB')); });
    const validation = mediaValidation(); $('media-validation').textContent = validation.message; $('media-validation').dataset.error = String(!validation.valid);
    dirty = true; controls();
  }
  function fileBase64(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('无法读取所选文件，请保留当前页面并重试。')); reader.readAsDataURL(file); });
  }
  function operationId() {
    const bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  async function saveMediaNote(status) {
    if (saving || !connected || !selected?.newMedia || (outcomeUnknown && !selected.operationId)) return;
    const note = selected, token = generation;
    if (!note.operationId) {
      if (!$('note-title').value.trim() || !$('note-business').value) { feedback('请填写标题并选择业务类别。', true); return; }
      const validation = mediaValidation(); if (!validation.valid) { feedback(validation.message, true); return; }
      try { note.operationId = operationId(); } catch { feedback('无法生成安全的上传标识，请重新打开插件后重试。', true); return; }
      note.completed = []; note.offsets = [];
      note.beginArgs = { operationId: note.operationId, title: $('note-title').value.trim(), content: $('note-content').value, status, businessId: $('note-business').value, type: note.type, files: note.files.map(file => ({ name: file.name, size: file.size, mime: file.type })), confirmed: true };
    }
    saving = true; dirty = true; controls(); $('upload-progress').hidden = false; $('note-state').textContent = '媒体上传中，尚未保存';
    let phase = 'begin';
    try {
      if (!note.uploadId) {
        $('upload-progress').textContent = '正在创建待上传笔记…';
        const begun = await invoke('note_begin', note.beginArgs, token);
        if (!text(begun.id) || !text(begun.uploadId)) throw Object.assign(new Error('未取得待上传笔记标识，请恢复同一次创建。'), { code: 'outcome_unknown' });
        note.id = begun.id; note.uploadId = begun.uploadId;
      }
      phase = 'upload';
      for (let index = 0; index < note.files.length; index++) {
        if (note.completed.includes(index)) continue;
        $('upload-progress').textContent = '正在上传文件 ' + (index + 1) + ' / ' + note.files.length + '，尚未完成保存。';
        const file = note.files[index];
        while (!note.completed.includes(index)) {
          uploadCalls = uploadCalls.filter(at => Date.now() - at < 60000);
          if (uploadCalls.length >= 35) {
            $('upload-progress').textContent = '正在等待上传配额恢复，请保持本页打开…';
            await new Promise(resolve => setTimeout(resolve, Math.max(1, 60000 - (Date.now() - uploadCalls[0]))));
            if (token !== generation) throw stale();
            continue;
          }
          const offset = note.offsets[index] || 0, end = Math.min(file.size, offset + 4 * 1024 * 1024);
          const base64 = await fileBase64(file.slice(offset, end));
          uploadCalls.push(Date.now());
          const uploaded = await invoke('media_upload', { uploadId: note.uploadId, index, offset, base64 }, token);
          if (uploaded.uploaded === true) { if (uploaded.received !== file.size) throw new Error('文件长度未确认，请继续上传同一篇笔记。'); note.completed.push(index); note.offsets[index] = file.size; }
          else if (Number.isInteger(uploaded.received) && uploaded.received === end && end < file.size) note.offsets[index] = end;
          else throw new Error('该文件上传尚未确认，请继续上传同一篇笔记。');
        }
      }
      phase = 'finish'; $('upload-progress').textContent = '正在确认笔记保存结果…';
      const finished = await invoke('note_finish', { uploadId: note.uploadId }, token);
      if (finished.saved !== true || text(finished.id) !== text(note.id)) throw Object.assign(new Error('平台尚未确认笔记已保存。'), { code: 'outcome_unknown' });
      const savedNote = { id: note.id, type: note.type, status: note.beginArgs.status, title: note.beginArgs.title, content: note.beginArgs.content, mediaCount: note.type === 'VIDEO' ? 1 : note.files.length };
      editNote(savedNote); $('note-state').textContent = savedNote.status === 'draft' ? '草稿已保存' : savedNote.status === 'private' ? '已保存，仅自己可见' : '已公开发布';
      await loadList(); if (token !== generation) return;
      feedback(savedNote.status === 'draft' ? '媒体上传完成，草稿已保存，尚未发布。' : '媒体上传完成，笔记已保存。');
    } catch (error) {
      if (token !== generation || error.stale) return;
      if (note.uploadId) {
        if (error.code === 'auth_required') failure(error);
        $('note-state').textContent = '媒体尚未完成，继续上传后才能保存';
        $('upload-progress').textContent = '上传尚未完成，已确认 ' + note.completed.length + ' / ' + note.files.length + ' 个文件。';
        feedback((error.message || '上传未完成。') + ' 请保留本页文件，核对后点击「继续上传同一篇笔记」。不会重新创建笔记。', true);
      } else if (error.code === 'outcome_unknown' || !error.code || phase !== 'begin' || outcomeUnknown) failure(error, true);
      else { note.operationId = null; note.beginArgs = null; failure(error); }
    } finally { if (token === generation) { saving = false; controls(); } }
  }
  async function saveNote(status) {
    if (saving || !connected || !selected || outcomeUnknown) return;
    if (selected.newMedia) { await saveMediaNote(status); return; }
    const title = $('note-title').value.trim(), content = $('note-content').value;
    const optionalBody = selected.id && ['IMAGE', 'VIDEO'].includes(selected.type);
    if (!title || (!optionalBody && !content.trim())) { feedback(optionalBody ? '请填写标题后再保存。' : '请填写标题和正文后再保存。', true); return; }
    const token = generation;
    if (!selected.id && !$('note-business').value) { feedback('请先选择业务类别，类别加载失败时可重新新建笔记重试。', true); return; }
    const args = { ...(selected.id ? { id: selected.id } : { businessId: $('note-business').value }), title, content, status, confirmed: true };
    saving = true; controls(); feedback(status === 'draft' ? '正在保存草稿…' : '正在发布…');
    try {
      const saved = await invoke('note_save', args, token);
      if (!text(saved.id)) throw Object.assign(new Error('服务未确认笔记已保存，请保留当前内容并刷新列表核对。'), { code: 'outcome_unknown' });
      selected = { ...selected, ...args, ...saved }; dirty = false;
      $('note-state').textContent = status === 'draft' ? '草稿已保存' : status === 'private' ? '已保存，仅自己可见' : '公开发布';
      $('editor-heading').textContent = '编辑笔记'; $('delete-note').hidden = false; $('business-label').hidden = $('note-business').hidden = true;
      $('publish-note').textContent = status === 'published' ? '更新已发布笔记' : '发布笔记';
      const refreshed = await loadList();
      if (token !== generation) return;
      const message = status === 'draft' ? '草稿已保存，尚未发布。' : status === 'private' ? '笔记已保存，仅自己可见。' : '笔记已公开发布。';
      feedback(message + (refreshed ? '' : '列表刷新未完成，请稍后刷新。'), !refreshed);
    } catch (error) { if (token === generation) failure(error, true); }
    finally { if (token === generation) { saving = false; controls(); } }
  }
  async function deleteNote() {
    if (saving || !selected?.id || outcomeUnknown) return;
    const token = generation; saving = true; controls(); feedback('正在删除…');
    try { await invoke('note_status', { id: selected.id, status: 'deleted', confirmed: true }, token); clearEditor(); await loadList(); feedback('笔记已删除。'); }
    catch (error) { if (token === generation) failure(error, true); }
    finally { if (token === generation) { saving = false; controls(); } }
  }
  async function checkAccount() {
    if (!context.projectId) { $('account-status').textContent = '请先打开项目'; $('connection').hidden = false; $('connection-message').textContent = '请先在 AI WorkDeck 打开项目，再连接包晴天。'; controls(); return; }
    const token = generation, request = ++statusRequest;
    $('account-status').textContent = '正在检查连接…';
    try {
      const data = await invoke('status', {}, token);
      if (request !== statusRequest) return;
      const identity = text(data.accountId), next = data.connected === true && !!identity;
      if (data.connected === true && !identity) throw new Error('服务未返回账号身份，请重新检查连接。');
      if (account && next && identity !== account) {
        if (dirty) {
          connected = false; generation++; window.bqtSecure?.reset(); listRequest++; detailRequest++; loading = false;
          $('list').replaceChildren(); $('detail').hidden = true; $('account-status').textContent = '账号已变更，待确认'; controls();
          ask('包晴天账号已变更。继续将放弃原账号尚未保存的笔记修改，确认继续？', () => { dirty = false; checkAccount(); });
          return;
        }
        generation++; window.bqtSecure?.reset(); clearContent(); closeConfirmation();
      }
      if (next) account = identity; connected = next;
      $('account-status').textContent = connected ? text(data.displayName) || '包晴天账号已连接' : '尚未连接包晴天';
      $('connection').hidden = connected; $('connection-message').textContent = '连接后，可以浏览案源广场，管理平台上的图文笔记和草稿。';
      controls(); if (connected) await loadList(); else { $('list').replaceChildren(); $('detail').hidden = true; $('empty').hidden = false; $('empty').textContent = '连接包晴天账号后即可查看。'; }
    } catch (error) { if (token === generation && request === statusRequest) { $('account-status').textContent = '连接检查未完成'; failure(error); } }
  }
  $('nav-cases').onclick = () => withDraftGuard(() => switchView('cases'));
  $('nav-notes').onclick = () => withDraftGuard(() => switchView('notes'));
  $('new-note').onclick = () => withDraftGuard(() => { detailRequest++; editNote(); feedback(); });
  $('close-editor').onclick = () => withDraftGuard(() => { detailRequest++; clearEditor(); });
  $('close-detail').onclick = () => { detailRequest++; $('detail').hidden = true; };
  $('note-title').oninput = $('note-content').oninput = $('note-visibility').onchange = () => { dirty = true; $('note-state').textContent = '有未保存的修改'; };
  $('search-form').onsubmit = event => {
    event.preventDefault();
    if (view === 'cases' && pageData) { renderList(pageData); feedback(); controls(); }
    else { page = 1; loadList(); }
  };
  $('status-filter').onchange = () => { if (pageData) { renderList(pageData); feedback(); controls(); } syncSidebar(); };
  $('reload').onclick = () => loadList();
  $('verify-save').onclick = async () => { if (await loadList()) feedback(selected?.uploadId ? '请核对列表。尚未完成时，点击「继续上传同一篇笔记」，使用原上传记录继续。' : '请核对列表中的笔记，打开已保存的笔记继续编辑。当前编辑仍暂停写入；确认未保存后，可关闭它再新建。'); };
  $('previous').onclick = () => { page--; loadList(); }; $('next').onclick = () => { page++; loadList(); };
  $('check-account').onclick = () => checkAccount();
  $('media-type').onchange = () => { $('media-files').value = ''; $('video-cover').value = ''; configureMedia(); updateMedia(); };
  $('media-files').onchange = $('video-cover').onchange = updateMedia;
  $('resume-upload').onclick = () => saveMediaNote(selected?.beginArgs?.status);
  $('save-draft').onclick = () => ['published', 'private'].includes(selected?.status) ? ask('保存为草稿会将这篇已发布笔记转为草稿，确认继续？', () => saveNote('draft')) : saveNote('draft');
  $('publish-note').onclick = () => { const visibility = $('note-visibility').value; ask(visibility === 'private' ? '确认将这篇笔记保存至包晴天，设为仅自己可见？' : '确认将这篇笔记公开发布到包晴天平台？', () => saveNote(visibility)); };
  $('delete-note').onclick = () => ask('确认删除这篇平台笔记？此操作不能通过关闭标签页撤销。', deleteNote);
  $('cancel-confirm').onclick = closeConfirmation;
  $('accept-confirm').onclick = () => { const action = confirmation; closeConfirmation(); action?.(); };
  document.addEventListener('keydown', event => {
    if ($('confirmation').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(); }
    if (event.key === 'Tab') { const cancel = $('cancel-confirm'), accept = $('accept-confirm'); if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); accept.focus(); } else if (!event.shiftKey && document.activeElement === accept) { event.preventDefault(); cancel.focus(); } }
  });
  window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });

  function phoneArgs() {
    if (!$('agreement').checked) throw new Error('请先阅读并同意包晴天用户协议和隐私政策。');
    const countryCode = $('country-code').value, mobile = $('mobile').value.trim();
    if (!(countryCode === '+852' ? /^\d{8}$/ : /^1\d{10}$/).test(mobile)) throw new Error('请检查手机号和区号。');
    return { mobile, countryCode };
  }
  function cooldown() {
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    $('send-code').textContent = seconds ? seconds + ' 秒后重发' : '获取验证码'; controls();
    if (seconds) cooldownTimer = setTimeout(cooldown, 1000);
  }
  async function authenticate(action) {
    if (authBusy || !context.projectId || (action === 'sms' && cooldownUntil > Date.now())) return;
    let args;
    try { args = phoneArgs(); if (action === 'login') { args.authCode = $('auth-code').value.trim(); if (!/^\d{4,8}$/.test(args.authCode)) throw new Error('请填写短信验证码。'); } } catch (error) { failure(error); return; }
    const token = generation; authBusy = true; controls(); feedback(action === 'sms' ? '正在请求验证码…' : '正在登录…');
    try {
      const data = await invoke(action, args, token);
      if (action === 'sms') { cooldownUntil = Date.now() + 60000; cooldown(); feedback('验证码已发送，请查看手机短信。'); }
      else {
        if (data.connected !== true) throw new Error('服务未确认登录成功，请重试。');
        $('auth-code').value = ''; $('mobile').value = ''; feedback(); await checkAccount();
      }
    } catch (error) { if (token === generation) failure(error); }
    finally { authBusy = false; controls(); }
  }
  document.querySelectorAll('[data-copy]').forEach(button => { button.onclick = async () => {
    const input = $(button.dataset.copy);
    try { if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable'); await navigator.clipboard.writeText(input.value); feedback('链接已复制，请在浏览器中打开阅读。'); }
    catch { input.focus(); input.select(); feedback('链接已选中，请手动复制到浏览器中阅读。'); }
  }; });
  $('agreement').onchange = controls;
  $('send-code').onclick = () => authenticate('sms');
  $('login-form').onsubmit = event => { event.preventDefault(); authenticate('login'); };
  $('logout').onclick = () => withDraftGuard(() => ask('退出本插件的包晴天账号？其他应用中的登录不受影响。', async () => {
    const token = generation; authBusy = true; controls();
    try { await invoke('logout', {}, token); generation++; window.bqtSecure?.reset(); connected = false; account = ''; clearContent(); $('mobile').value = ''; $('auth-code').value = ''; $('agreement').checked = false; await checkAccount(); }
    catch (error) { if (token === generation) failure(error); }
    finally { authBusy = false; controls(); }
  }));
  window.addEventListener('pagehide', () => { clearTimeout(cooldownTimer); $('mobile').value = ''; $('auth-code').value = ''; });

  controls();
  awd.ready().then(async current => {
    context = current || {};
    awd.events?.on('project.switched', async () => {
      generation++; window.bqtSecure?.reset(); statusRequest++; saving = false; connected = false; account = ''; clearContent(); closeConfirmation(); $('mobile').value = ''; $('auth-code').value = ''; $('agreement').checked = false;
      context = await awd.call('context.get'); await checkAccount();
    });
    awd.events?.on('sidebar.command', payload => {
      const cmd = payload?.command;
      if (!cmd || saving) return;
      if (cmd === 'switch-view' && (payload.view === 'cases' || payload.view === 'notes')) {
        withDraftGuard(() => switchView(payload.view));
        return;
      }
      if (cmd === 'filter-status') {
        withDraftGuard(() => {
          if (view !== 'notes') switchView('notes');
          $('status-filter').value = payload.status || '';
          if (pageData) renderList(pageData); else loadList();
        });
        return;
      }
      if (cmd === 'new-note') {
        withDraftGuard(() => {
          if (view !== 'notes') switchView('notes');
          if (connected && context.projectId) editNote();
        });
        return;
      }
      if (cmd === 'refresh') {
        withDraftGuard(() => { page = 1; loadList(); });
      }
    });
    await checkAccount();
  }).catch(error => { $('account-status').textContent = '工作台连接未完成'; failure(error); });
}());
