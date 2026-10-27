// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (global) {
  'use strict';
  const MAX_PLAIN = 6 * 1024 * 1024, MAX_ENVELOPE = 9 * 1024 * 1024;
  let publicKeyPromise, epoch = 0;
  const fail = () => new Error('安全连接失败，请刷新插件后重试；未自动重试写入');
  const encode = bytes => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(text);
  };
  const bytes = (text, limit) => {
    if (typeof text !== 'string' || text.length > limit) throw fail();
    return Uint8Array.from(atob(text), c => c.charCodeAt(0));
  };
  const bridge = async (action, value) => global.awd.tools.invoke('baoqingtian_action', { action, json: JSON.stringify(value) });
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  async function getKey() {
    if (!publicKeyPromise) publicKeyPromise = (async () => {
      const response = parse(await bridge('transport_key', {}));
      const value = response.ok === true ? response.data : response;
      if (value.v !== 1) throw fail();
      return global.crypto.subtle.importKey('spki', bytes(value.publicKey, 1024), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    })();
    return publicKeyPromise;
  }
  global.bqtSecure = {
    reset() { epoch++; publicKeyPromise = undefined; },
    async invoke(action, args = {}) {
      try {
        const started = epoch;
        const current = () => { if (epoch !== started) throw fail(); };
        if (!global.crypto?.subtle || !/^[a-z_]{1,40}$/.test(action) || ['secure', 'transport_key'].includes(action)) throw fail();
        const encoder = new TextEncoder(), subtle = global.crypto.subtle;
        const plain = encoder.encode(JSON.stringify({ action, args, expiresAt: Date.now() + 5 * 60 * 1000 }));
        if (plain.length >= MAX_PLAIN) throw fail();
        const publicKey = await getKey(); current();
        const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const nonce = encode(global.crypto.getRandomValues(new Uint8Array(32)));
        const iv = global.crypto.getRandomValues(new Uint8Array(12));
        const aad = direction => encoder.encode('bqt:v1:' + direction + ':' + nonce);
        const rawKey = new Uint8Array(await subtle.exportKey('raw', key));
        let wrapped;
        try { wrapped = await subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey); } finally { rawKey.fill(0); }
        let ciphertext;
        try { ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad('request') }, key, plain); } finally { plain.fill(0); }
        const envelope = { v: 1, nonce, key: encode(new Uint8Array(wrapped)), iv: encode(iv), data: encode(new Uint8Array(ciphertext)) };
        if (JSON.stringify(envelope).length >= MAX_ENVELOPE) throw fail();
        current();
        const raw = await bridge('secure', envelope);
        current();
        if (typeof raw === 'string' && raw.length >= MAX_ENVELOPE) throw fail();
        const outer = parse(raw), response = outer.ok === true ? outer.data : outer;
        if (response.v !== 1 || response.nonce !== nonce || response.iv === envelope.iv) throw fail();
        const responseIv = bytes(response.iv, 16), data = bytes(response.data, MAX_ENVELOPE);
        if (responseIv.length !== 12 || data.length >= MAX_PLAIN + 16) throw fail();
        const opened = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: responseIv, additionalData: aad('response') }, key, data));
        try { return new TextDecoder('utf-8', { fatal: true }).decode(opened); } finally { opened.fill(0); }
      } catch (_) { throw fail(); }
    }
  };
})(window);
