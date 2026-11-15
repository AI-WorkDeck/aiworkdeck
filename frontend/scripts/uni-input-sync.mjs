// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// uni-app H5 的 <input>/<textarea> 把 v-model 的回写（update:modelValue）节流到 100 ms：一阵快速输入里
// 只有第一个字立刻回写，其余要等 100 ms 后的尾调用。确认按钮在这 100 ms 内读 v-model 就读到旧值——
// 「稿名只剩第一个字」（readiness UI-INPUT1；本机 macOS 听写、文本扩展这类一次塞进好几段字的输入
// 都会撞上）。失焦也不补发（只有输入法组字中失焦才强制回写）。
//
// 这里在构建时把那段节流换成同步回写：每次 input 事件立刻回写 v-model，与 Vue 原生 v-model 一致。
// 只改这一处；锚点对不上（uni-app 升级改了这段）就让构建失败，别让修复悄悄失效。
const TARGET = /@dcloudio[\\/]uni-h5[\\/]dist[\\/]uni-h5\.es\.js(\?.*)?$/
const ANCHOR = `  const triggerInputFn = throttle((event, detail) => {
    valueChangeFn.cancel();
    emit2("update:modelValue", detail.value);
    emit2("update:value", detail.value);
    trigger("input", event, detail);
  }, 100);`
const REPLACEMENT = `  // AI WorkDeck (scripts/uni-input-sync.mjs): write v-model back synchronously, no 100 ms throttle
  const triggerInputFn = Object.assign((event, detail) => {
    valueChangeFn.cancel();
    emit2("update:modelValue", detail.value);
    emit2("update:value", detail.value);
    trigger("input", event, detail);
  }, { cancel() {}, flush() {} });`

/** 纯函数：给 uni-h5 的源码打补丁；锚点不在就抛错。 */
export function patchUniInputSync(code) {
  if (!code.includes(ANCHOR)) {
    throw new Error('uni-input-sync: uni-h5 input throttle anchor not found — uni-app changed; re-check UI-INPUT1 (scripts/uni-input-sync.mjs)')
  }
  return code.replace(ANCHOR, REPLACEMENT)
}

export function uniInputSync() {
  return {
    name: 'awd-uni-input-sync',
    enforce: 'pre',
    transform(code, id) {
      if (!TARGET.test(id)) return null
      return { code: patchUniInputSync(code), map: null }
    },
  }
}
