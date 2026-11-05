// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// 把 uni 的同步存储包成可传递的对象（dev-board#1713）。
// uni-h5 构建只替换 `uni.xxx` 成员访问；裸 `uni` 在浏览器里是空壳 {}，
// 所以 loadXxx(uni) / storage: uni 这种传法读写会全部静默失效，必须传这个对象。
export const uniStorage = {
  getStorageSync(key) {
    try { return uni.getStorageSync(key) } catch (e) { return '' }
  },
  setStorageSync(key, value) {
    try { uni.setStorageSync(key, value) } catch (e) { /* ignore */ }
  },
  removeStorageSync(key) {
    try { uni.removeStorageSync(key) } catch (e) { /* ignore */ }
  },
}
