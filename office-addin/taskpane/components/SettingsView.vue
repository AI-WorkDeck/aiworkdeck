<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="settings">
    <section class="card">
      <h2>{{ mode === 'setup' ? t('savePassword') : resetMode ? t('resetPassword') : t('connectionTitle') }}</h2>

      <p v-if="token.trim()" class="summary">
        {{ t('connectedTo', { url: displayServerUrl }) }}
      </p>

      <p class="hint">
        {{ t('loginHint') }}
      </p>

      <!--
        首次验证/重置时，手机号用于大陆站，邮箱用于国际站——两个站各只认一种账号本体，
        由云后端的 captcha-config 带回 accountIdentity 告诉我们是哪一种（dev-board#766）。
        只剩一种时整行不渲染：给用户一个点不出别的东西的单选按钮没有意义；而把不支持的
        那个也画出来，就是把他往「填完号、等完一次发码往返、才被告知本站不支持」引——
        那正是这张卡的起因。拿不到配置（旧后端/网络不通）时两个都给，与改造前一致。
      -->
      <div v-if="mode !== 'password' && mode !== 'setup' && codeTabs.length > 1" class="tabs">
        <button
          v-for="tab in codeTabs"
          :key="tab"
          class="tab"
          :class="{ 'is-active': mode === tab }"
          :disabled="connecting || sendingCode"
          @click="switchMode(tab)"
        >{{ tab === 'phone' ? t('tabPhone') : t('tabEmail') }}</button>
      </div>

      <template v-if="mode === 'phone'">
        <label class="field">
          <span class="label">{{ t('phoneLabel') }}</span>
          <input v-model="phone" type="tel" :placeholder="t('phonePlaceholder')" spellcheck="false" autocomplete="tel" />
        </label>

        <!-- 不用 label 包住整行：label 的激活行为会把点在按钮上的一次点击转发给里面的 input -->
        <div class="field">
          <span class="label">{{ t('smsCodeLabel') }}</span>
          <div class="code-row">
            <input v-model="smsCode" type="text" :placeholder="t('smsCodePlaceholder')" spellcheck="false" autocomplete="one-time-code" />
            <button class="btn secondary code-btn" :disabled="sendingCode || cooldown > 0 || !phone.trim()" @click="sendCode('phone')">
              {{ codeBtnLabel }}
            </button>
          </div>
        </div>
      </template>

      <!-- International first-time verification or password recovery. -->
      <template v-else-if="mode === 'email'">
        <label class="field">
          <span class="label">{{ t('emailLabel') }}</span>
          <input v-model="email" type="email" :placeholder="t('emailPlaceholder')" spellcheck="false" autocomplete="email" />
        </label>

        <div class="field">
          <span class="label">{{ t('smsCodeLabel') }}</span>
          <div class="code-row">
            <input v-model="emailCode" type="text" :placeholder="t('smsCodePlaceholder')" spellcheck="false" autocomplete="one-time-code" />
            <button class="btn secondary code-btn" :disabled="sendingCode || cooldown > 0 || !email.trim()" @click="sendCode('email')">
              {{ codeBtnLabel }}
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="mode === 'password'">
        <label class="field">
          <span class="label">{{ t('accountLabel') }}</span>
          <input v-model="account" type="text" :placeholder="t('accountPlaceholder')" spellcheck="false" autocomplete="username" />
        </label>

        <label class="field">
          <span class="label">{{ t('passwordLabel') }}</span>
          <input v-model="password" type="password" :placeholder="t('passwordPlaceholder')" spellcheck="false" autocomplete="current-password" />
        </label>
      </template>

      <template v-if="mode === 'setup' || resetMode">
        <p class="hint">{{ mode === 'setup' ? t('passwordSetupHint') : t('passwordResetHint') }} {{ t('newPasswordHint') }}</p>
        <label class="field">
          <span class="label">{{ t('passwordLabel') }}</span>
          <input v-model="password" type="password" :placeholder="t('newPasswordHint')" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="label">{{ t('confirmPassword') }}</span>
          <input v-model="confirmPassword" type="password" :placeholder="t('confirmPassword')" autocomplete="new-password" />
        </label>
      </template>
      <!--
        口令那条路**不随站点隐藏**：站点只决定验证码走手机号还是邮箱，口令是两站存量账号
        共用的第三条路。所以这行链子常驻在表单下方，而不是像改造前那样挂在邮箱 tab 里面
        ——大陆站隐掉邮箱 tab 时，那样会把存量口令用户的入口一起埋掉。
      -->
      <div class="field login-method-links">
        <button class="linklike" :disabled="connecting || sendingCode" @click="togglePasswordMode">
          {{ mode === 'password' ? t('createPassword') : t('usePasswordInstead') }}
        </button>
        <button v-if="mode === 'password'" class="linklike" :disabled="connecting || sendingCode" @click="startReset">{{ t('forgotPassword') }}</button>
      </div>

      <!--
        人机验证控件的落点。阿里云是 popup 模式，平时不占位；`-trigger` 是 SDK 要求的
        触发元素，由 getToken() 代点，用户看不到它，所以藏起来但**必须留在文档里**
        （display:none 的节点仍可被 click()，移出文档就取不到 token 了）。

        **必须放在 v-if 分支之外**：控件在 onMounted 时按 id 认下这两个节点，之后一直
        持有它们。放进某个分支里，用户切一次 tab 节点就被 Vue 拆掉，SDK 攥着的是一个
        已经不在文档里的元素——弹不出滑块，也取不到 token，而且一声不响。
      -->
      <div id="login-captcha" class="captcha-holder" :class="{ 'captcha-inactive': mode === 'password' || mode === 'setup' || compatibleMode }"></div>
      <button id="login-captcha-trigger" type="button" class="captcha-trigger" aria-hidden="true" tabindex="-1"></button>

      <div v-if="mode === 'phone' || mode === 'email'" class="compatible-verification">
        <button class="linklike" :disabled="sendingCode || challengeLoading" @click="enableCompatible">{{ t('compatibleVerification') }}</button>
        <template v-if="compatibleMode">
          <p class="hint">{{ t('compatibleVerificationHint') }}</p>
          <div v-if="challenge" class="compatible-image-row">
            <img :src="challenge.image" :alt="t('compatibleImageAlt')" width="180" height="64" />
            <button class="linklike" :disabled="challengeLoading || sendingCode" @click="loadChallenge">{{ t('compatibleRefresh') }}</button>
          </div>
          <label class="field">
            <span>{{ t('compatibleAnswerLabel') }}</span>
            <input v-model="challengeAnswer" maxlength="6" autocomplete="off" :disabled="sendingCode" :placeholder="t('compatibleAnswerLabel')" />
          </label>
          <p v-if="challengeLoading" class="hint">{{ t('compatibleLoading') }}</p>
        </template>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="connecting" @click="connectWithAccount">
          {{ connecting ? t('connecting') : mode === 'setup' ? t('savePassword') : resetMode ? t('resetPassword') : mode === 'password' ? t('loginAndConnect') : t('verifyAndContinue') }}
        </button>
      </div>

      <p v-if="loginStatus" class="status" :class="loginStatusKind">{{ loginStatus }}</p>

      <!--
        注册入口（AppSource 1100.5.7.1：登录页必须能注册）。官网账户页就是注册页；
        两站又都是「验证码即登录」，所以验证码模式下直接登录也会自动建号，第二行把这点说出来。
        口令模式只能登录不能注册，第二行不显示。非官方后端（私有部署）没有官网，整块不渲染。
      -->
      <div v-if="signUpHref" class="signup">
        <p class="signup-line">{{ t('noAccountYet') }}<button class="linklike strong" :disabled="connecting || sendingCode" @click="switchMode(defaultMode(identity))">{{ t('signUpFree') }}</button></p>
        <p v-if="mode === 'email' && !resetMode" class="signup-line">{{ t('signUpByEmailCode') }}</p>
        <p v-else-if="mode === 'phone' && !resetMode" class="signup-line">{{ t('signUpByPhoneCode') }}</p>
        <p class="signup-line agree">{{ t('agreePrefix') }}<button class="linklike" @click="openExternal(termsHref)">{{ t('termsOfService') }}</button>{{ t('agreeMiddle') }}<button class="linklike" @click="openExternal(privacyHref)">{{ t('privacyPolicy') }}</button>{{ t('agreeSuffix') }}</p>
      </div>

      <details class="advanced">
        <summary>{{ t('advancedSettings') }}</summary>

        <p class="hint">
          {{ t('advancedHint') }}
        </p>

        <label class="field">
          <span class="label">{{ t('serverUrlLabel') }}</span>
          <input
            v-model="serverUrl"
            :disabled="connecting || sendingCode"
            type="text"
            :placeholder="t('serverUrlPlaceholder')"
            spellcheck="false"
          />
        </label>

        <label class="field">
          <span class="label">{{ t('awdkKeyLabel') }}</span>
          <input
            v-model="awdkKey"
            type="password"
            :placeholder="t('awdkKeyPlaceholder')"
            spellcheck="false"
            autocomplete="off"
          />
        </label>

        <div class="actions">
          <button class="btn secondary" :disabled="connecting" @click="connectWithKey">
            {{ connecting ? t('connecting') : t('connectWithKeyButton') }}
          </button>
        </div>

        <p v-if="keyStatus" class="status" :class="keyStatusKind">{{ keyStatus }}</p>

        <label class="field">
          <span class="label">{{ t('deviceTokenLabel') }}</span>
          <textarea
            v-model="token"
            rows="3"
            :placeholder="t('deviceTokenPlaceholder')"
            spellcheck="false"
          ></textarea>
        </label>

        <div class="actions">
          <button class="btn secondary" :disabled="testing" @click="testConnection">
            {{ testing ? t('testing') : t('testConnectionButton') }}
          </button>
          <button class="btn primary" @click="save">{{ t('save') }}</button>
        </div>

        <p v-if="status" class="status" :class="statusKind">{{ status }}</p>
      </details>
    </section>

  </div>
</template>

<script setup>
import { computed, watch, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  fetchMyProjects,
  getAccountLoginCaptchaConfig,
  postAccountLogin,
  postAccountPasswordOperation,
  postAccountLoginChallenge,
  postAccountLoginSendCode,
  postAccountLoginSendEmailCode,
  postAwdkLogin
} from '../lib/api.js'
import { setupCaptcha } from '../lib/captcha.js'
import { accountIdentityOf, defaultMode, isModeAvailable, visibleCodeTabs } from '../lib/loginTabs.js'
import { saveSettings, normalizeBaseUrl, DEFAULT_SERVER_URL } from '../lib/settings.js'
import { t } from '../lib/i18n.js'
import { legalUrl, openExternal, signUpUrl } from '../lib/site.js'

const props = defineProps({
  initialServerUrl: { type: String, default: '' },
  initialToken: { type: String, default: '' }
})
const emit = defineEmits(['saved'])

const serverUrl = ref(props.initialServerUrl || normalizeBaseUrl(DEFAULT_SERVER_URL))
const token = ref(props.initialToken)
const testing = ref(false)
const status = ref('')
const statusKind = ref('ok')
const awdkKey = ref('')
const connecting = ref(false)
const keyStatus = ref('')
const keyStatusKind = ref('ok')

// Password is the default. phone/email verify first-time ownership; setup is a restricted stage.
// resetMode reuses the identity form with a separate reset-code purpose.
// identity 是本服务器桥到的站点以什么为账号本体，由 captcha-config 带回；
// 空串 = 未知（旧后端/配置取不到），此时两个验证码 tab 都给，与改造前一致。
const mode = ref('password')
const resetMode = ref(false)
const setupToken = ref('')
const setupAccount = ref('')
const confirmPassword = ref('')
const identity = ref('')
const phone = ref('')
const smsCode = ref('')
const email = ref('')
const emailCode = ref('')
const account = ref('')
const password = ref('')
const sendingCode = ref(false)
const cooldown = ref(0)
const loginStatus = ref('')
const loginStatusKind = ref('ok')
const compatibleMode = ref(false)
const challenge = ref(null)
const challengeAnswer = ref('')
const challengeLoading = ref(false)
let challengeGeneration = 0
let disposed = false
let captchaFailed = false

function clearChallenge() {
  challengeGeneration += 1
  challenge.value = null
  challengeAnswer.value = ''
  challengeLoading.value = false
}
watch([phone, email, mode, resetMode, serverUrl], clearChallenge)

async function enableCompatible() {
  compatibleMode.value = true
  loginStatus.value = ''
  await loadChallenge()
}

async function loadChallenge() {
  clearChallenge()
  const generation = challengeGeneration
  const channel = mode.value === 'email' ? 'email' : 'phone'
  const identifier = (channel === 'email' ? email.value : phone.value).trim()
  if (!identifier) {
    loginStatusKind.value = 'error'
    loginStatus.value = t('compatibleIdentifierRequired')
    return
  }
  challengeLoading.value = true
  try {
    const result = await postAccountLoginChallenge({ serverUrl: serverUrl.value }, {
      [channel]: identifier, purpose: resetMode.value ? 'reset' : 'login'
    })
    if (disposed || generation !== challengeGeneration) return
    if (!result?.id || !result?.image?.startsWith('data:image/png;base64,')) throw new Error(t('compatibleLoadFailed'))
    challenge.value = result
    loginStatus.value = ''
  } catch (e) {
    if (!disposed && generation === challengeGeneration) {
      loginStatusKind.value = 'error'
      loginStatus.value = e.message || t('compatibleLoadFailed')
    }
  } finally {
    if (generation === challengeGeneration) challengeLoading.value = false
  }
}

watch(serverUrl, () => {
  setupToken.value = ''
  setupAccount.value = ''
  password.value = ''
  confirmPassword.value = ''
  mode.value = 'password'
  resetMode.value = false
})

let cooldownTimer = null

// 人机验证控件。null = 官网未启用（或配置拿不到），此时跳过控件直接发码。
let captcha = null
let captchaReady = null

/** 当前连接状态摘要：只读本地设置，不发请求 */
const displayServerUrl = computed(() => normalizeBaseUrl(serverUrl.value) || t('noAddressSet'))

/** 官网注册页与法律文件（仅官方两站；私有部署为空串，注册区块整块不渲染） */
const signUpHref = computed(() => signUpUrl(serverUrl.value))
const termsHref = computed(() => legalUrl(serverUrl.value, 'terms'))
const privacyHref = computed(() => legalUrl(serverUrl.value, 'privacy'))

/** 本站点支持的验证码 tab（未知时两个都给） */
const codeTabs = computed(() => visibleCodeTabs(identity.value))

const codeBtnLabel = computed(() => {
  if (cooldown.value > 0) return t('resendCountdown', { seconds: cooldown.value })
  return sendingCode.value ? t('sending') : t('getCode')
})

// 任务窗格切视图会卸载本组件：倒计时的定时器必须跟着停（否则回来时还在跑），
// 验证码控件也要拆掉（否则 SDK 还攥着已经不在文档里的节点）。
onBeforeUnmount(() => {
  disposed = true
  clearChallenge()
  stopCooldown()
  if (captcha && captcha.destroy) captcha.destroy()
  captcha = null
})

// 装控件要下载第三方脚本，放在挂载时预热；失败不打扰用户——真出问题会在发码那步
// 由官网给出可读的报错（「请先完成安全验证后再试」）。
onMounted(() => { captchaReady = ensureCaptcha() })

async function ensureCaptcha() {
  if (captcha) return captcha
  captchaFailed = false
  try {
    const config = await getAccountLoginCaptchaConfig({ serverUrl: serverUrl.value })
    // 同一份公开配置顺带告诉我们站点以什么为账号本体，不用再多一次往返
    applyIdentity(accountIdentityOf(config))
    captcha = await setupCaptcha(config, 'login-captcha')
  } catch (e) {
    console.warn('[settings] 人机验证控件装配失败:', e)
    captcha = null
    captchaFailed = true
  }
  return captcha
}

/**
 * 站点能力到达后落到界面上。
 *
 * 当前形态一旦在这个站点下不成立就立刻纠正——**不看用户是不是手动点过**：
 * 那个 tab 马上就要从界面上消失，留着它等于让用户对着一个没有退路的表单发呆
 * （配置是异步到的，在那一两秒里用户完全可能已经点过一下）。
 * identity 为空（未知）时两个 tab 都可用，这里什么也不会动。
 */
function applyIdentity(next) {
  identity.value = next
  if (mode.value !== 'setup' && !isModeAvailable(mode.value, next)) mode.value = defaultMode(next)
}

function stopCooldown() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
}

function startCooldown() {
  stopCooldown()
  cooldown.value = 60
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) stopCooldown()
  }, 1000)
}

function switchMode(next) {
  if (connecting.value || sendingCode.value) return
  compatibleMode.value = false
  clearChallenge()
  resetMode.value = false
  setupToken.value = ''
  setupAccount.value = ''
  password.value = ''
  confirmPassword.value = ''
  smsCode.value = ''
  emailCode.value = ''
  mode.value = next
  loginStatus.value = ''
}

function startReset() {
  switchMode(defaultMode(identity.value))
  resetMode.value = true
}

/** 验证码 ⇄ 口令。回来时落到本站点支持的那条验证码路上 */
function togglePasswordMode() {
  switchMode(mode.value === 'password' ? defaultMode(identity.value) : 'password')
}

/**
 * 发验证码。两个渠道（手机号 / 邮箱）走同一个云后端端点，由后端按填了哪个字段
 * 转发到官网的 sms-login 或 mail-login，人机验证与倒计时两边完全一致。
 *
 * @param channel 'phone' | 'email'
 */
async function sendCode(channel) {
  loginStatus.value = ''
  if (!serverUrl.value.trim()) {
    loginStatusKind.value = 'error'
    loginStatus.value = t('serverUrlEmptyHint')
    return
  }
  sendingCode.value = true
  try {
    // 先过人机验证再发码：官网把 verifyCaptcha 排在发信之前，不带 token 就是 403。
    // 官网未启用时 ensureCaptcha() 给 null，token 留空，行为与从前一致。
    let captchaToken = ''
    const widget = compatibleMode.value ? null : await (captchaReady || ensureCaptcha())
    if (compatibleMode.value) {
      if (!challenge.value || !challengeAnswer.value.trim()) {
        loginStatusKind.value = 'error'
        loginStatus.value = t('compatibleAnswerRequired')
        if (!challenge.value) await loadChallenge()
        return
      }
      captchaToken = `local:${challenge.value.id}:${challengeAnswer.value.trim()}`
      clearChallenge()
    } else if (captchaFailed) {
      loginStatusKind.value = 'error'
      loginStatus.value = t('compatibleUseOnFailure')
      return
    }
    if (widget) {
      captchaToken = await widget.getToken()
      if (!captchaToken) {
        loginStatusKind.value = 'error'
        loginStatus.value = t('captchaIncomplete')
        return
      }
    }
    if (resetMode.value) {
      await postAccountPasswordOperation({ serverUrl: serverUrl.value }, 'reset/send-code', { [channel]: (channel === 'email' ? email.value : phone.value).trim(), captchaToken })
    } else if (channel === 'email') {
      await postAccountLoginSendEmailCode({ serverUrl: serverUrl.value }, email.value, captchaToken)
    } else {
      await postAccountLoginSendCode({ serverUrl: serverUrl.value }, phone.value, captchaToken)
    }
    loginStatusKind.value = 'ok'
    loginStatus.value = channel === 'email' ? t('codeSentEmail') : t('codeSent')
    startCooldown()
  } catch (e) {
    loginStatusKind.value = 'error'
    loginStatus.value = e.message || t('codeSendFailed')
    if (compatibleMode.value) clearChallenge()
  } finally {
    sendingCode.value = false
  }
}

/**
 * 当前表单要送出的凭据形状，与官网 /api/auth/exchange-key 的三种一一对应。
 * 一并给出「填齐了没有」与没填齐时该说哪句话——三条分支的判定写在一处才不会漂。
 */
function currentCredentials() {
  if (mode.value === 'setup') return {credentials: {}, filled: true, hint: 'passwordSetupHint'}
  if (mode.value === 'phone') {
    const credentials = { phone: phone.value.trim(), code: smsCode.value.trim() }
    return { credentials, filled: !!(credentials.phone && credentials.code), hint: 'fillPhoneAndCode' }
  }
  if (mode.value === 'email') {
    const credentials = { email: email.value.trim(), code: emailCode.value.trim() }
    return { credentials, filled: !!(credentials.email && credentials.code), hint: 'fillEmailAndCode' }
  }
  const credentials = { account: account.value.trim(), password: password.value }
  return { credentials, filled: !!(credentials.account && credentials.password), hint: 'fillEmailAndPassword' }
}

/**
 * 账户登录：手机号+验证码 / 邮箱+验证码 / 账号+口令换取 awdt_ 设备令牌后保存并进入对话视图。
 * 凭据用完即弃（不落 localStorage，只有换回的 awdt_ 令牌被保存）。
 */
async function connectWithAccount() {
  loginStatus.value = ''
  if (!serverUrl.value.trim()) {
    loginStatusKind.value = 'error'
    loginStatus.value = t('serverUrlEmptyHint')
    return
  }
  const { credentials, filled, hint } = currentCredentials()
  if (!filled) {
    loginStatusKind.value = 'error'
    loginStatus.value = t(hint)
    return
  }
  if (mode.value === 'setup' || resetMode.value) {
    if (password.value.length < 8 || password.value.length > 72 || password.value !== confirmPassword.value) {
      loginStatusKind.value = 'error'
      loginStatus.value = t(password.value !== confirmPassword.value ? 'passwordMismatch' : 'newPasswordHint')
      return
    }
  }
  connecting.value = true
  try {
    const connection = { serverUrl: serverUrl.value }
    if (resetMode.value) {
      await postAccountPasswordOperation(connection, 'reset', {...credentials, password: password.value})
      connecting.value = false
      switchMode('password')
      loginStatusKind.value = 'ok'
      loginStatus.value = t('passwordResetDone')
      return
    }
    let awdtToken
    if (mode.value === 'setup') {
      await postAccountPasswordOperation(connection, 'setup', { setupToken: setupToken.value, password: password.value })
      setupToken.value = ''
      mode.value = 'password'
      account.value = setupAccount.value
      awdtToken = await postAccountLogin(connection, { account: setupAccount.value, password: password.value })
    } else awdtToken = await postAccountLogin(connection, credentials)
    if (awdtToken?.passwordSetupRequired) {
      setupToken.value = awdtToken.setupToken
      setupAccount.value = awdtToken.account || credentials.phone || credentials.email
      mode.value = 'setup'
      password.value = ''
      confirmPassword.value = ''
      smsCode.value = ''
      emailCode.value = ''
      return
    }
    smsCode.value = ''
    emailCode.value = ''
    password.value = ''
    applyToken(awdtToken)
    loginStatusKind.value = 'ok'
    loginStatus.value = t('connectSuccess')
  } catch (e) {
    loginStatusKind.value = 'error'
    loginStatus.value = e.message || t('accountConnectFailed')
  } finally {
    connecting.value = false
  }
}

/**
 * awdk_ 账户 Key 连接（高级设置）：私有部署与团队服务器仍要用这条。
 * Key 本身用完即弃（不落 localStorage，只有换回的 awdt_ 令牌被保存）。
 */
async function connectWithKey() {
  keyStatus.value = ''
  if (!serverUrl.value.trim()) {
    keyStatusKind.value = 'error'
    keyStatus.value = t('serverUrlEmptySimple')
    return
  }
  const key = awdkKey.value.trim()
  if (!key) {
    keyStatusKind.value = 'error'
    keyStatus.value = t('awdkKeyEmpty')
    return
  }
  connecting.value = true
  try {
    const awdtToken = await postAwdkLogin({ serverUrl: serverUrl.value }, key)
    awdkKey.value = ''
    applyToken(awdtToken)
    keyStatusKind.value = 'ok'
    keyStatus.value = t('connectSuccessWithToken')
  } catch (e) {
    keyStatusKind.value = 'error'
    keyStatus.value = e.message || t('directConnectFailed')
  } finally {
    connecting.value = false
  }
}

/** 两条换令牌的路径共用的收尾：落盘 + 通知外层切到对话视图。 */
function applyToken(awdtToken) {
  token.value = awdtToken
  saveSettings({ serverUrl: serverUrl.value, token: awdtToken })
  emit('saved', { serverUrl: normalizeBaseUrl(serverUrl.value), token: awdtToken })
}

async function testConnection() {
  status.value = ''
  if (!serverUrl.value.trim() || !token.value.trim()) {
    statusKind.value = 'error'
    status.value = t('serverAndTokenEmpty')
    return
  }
  testing.value = true
  try {
    const projects = await fetchMyProjects({ serverUrl: serverUrl.value, token: token.value.trim() })
    statusKind.value = 'ok'
    status.value = t('connectSuccessWithProjects', { count: projects.length })
  } catch (e) {
    statusKind.value = 'error'
    status.value = e.message || t('connectFailed')
  } finally {
    testing.value = false
  }
}

function save() {
  if (!serverUrl.value.trim() || !token.value.trim()) {
    statusKind.value = 'error'
    status.value = t('serverAndTokenEmpty')
    return
  }
  saveSettings({ serverUrl: serverUrl.value, token: token.value })
  emit('saved', { serverUrl: normalizeBaseUrl(serverUrl.value), token: token.value.trim() })
}
</script>

<style scoped>
.field.login-method-links { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }

.captcha-inactive { display: none !important; }
.compatible-verification { margin: 12px 0; }
.compatible-verification .hint { font-size: 12px; line-height: 1.6; }
.compatible-image-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.compatible-image-row img { max-width: 100%; object-fit: contain; }
.settings {
  padding: 12px;
  overflow-y: auto;
}

.card {
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  box-shadow: var(--awd-shadow-soft);
  padding: 14px;
}


.summary {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--awd-text-secondary);
  word-break: break-all;
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.tab {
  padding: 5px 12px;
  font-size: 12px;
  border: 1px solid var(--awd-border);
  border-radius: 4px;
  background: var(--awd-surface);
  color: var(--awd-text-secondary);
  cursor: pointer;
}

.tab.is-active {
  border-color: var(--awd-primary);
  color: var(--awd-primary);
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-row input { flex: 1; }

/* 邮箱 tab 内的二级切换：是个按钮（要能键盘聚焦），画成一行次要文字链 */
.linklike {
  padding: 0;
  border: 0;
  background: none;
  color: var(--awd-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.linklike:hover { color: var(--awd-primary); }

.linklike.strong { color: var(--awd-primary); }

.signup {
  margin-top: 12px;
}

.signup-line {
  margin: 0 0 6px;
  color: var(--awd-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.signup-line .linklike { vertical-align: baseline; padding: 0; }

.signup-line.agree { font-size: 11px; }

.code-btn {
  flex: none;
  white-space: nowrap;
}

/*
  阿里云是 popup 模式，控件本身不占位，这个 div 平时是空的。turnstile 那条分支会把控件
  渲染进来：居中 + 与上下表单同一档间距（dev-board#766，改前它是贴着左边的一块外来方块）。

  **刻意不给它画边框/底色**：turnstile 用的是 appearance:'interaction-only'，要不要显示
  由 Cloudflare 决定，我们控制不了；框一画上去，它不显示的时候就变成表单里凭空多出的
  一个空框。间距与居中已经足够把它归进版面，边框反而是拿确定的副作用换不确定的好处。

  **不要给它 display:none**：turnstile 渲染进不可见容器会拿不到尺寸而不出现。
*/
.captcha-holder:not(:empty) {
  display: flex;
  justify-content: center;
  margin-top: 8px;
  margin-bottom: 12px;
}

/*
  SDK 要求的触发元素，由 getToken() 代点，用户不该看见也不该 Tab 到。
  用 position:absolute + 0 尺寸而不是 display:none——两者都能被 click()，
  但前者对个别 WebView 更保险（隐藏元素的合成点击在 WKWebView 上有过不触发的先例）。
*/
.captcha-trigger {
  position: absolute;
  width: 0;
  height: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.advanced {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--awd-border);
}

.advanced > summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--awd-text-secondary);
  user-select: none;
}

.advanced > summary:hover { color: var(--awd-primary); }

.advanced .hint { margin-top: 10px; }




h2 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}

.hint {
  margin: 0 0 12px;
  color: var(--awd-text-secondary);
  font-size: 12px;
}

.field {
  display: block;
  margin-bottom: 12px;
}

.label {
  display: block;
  margin-bottom: 4px;
  color: var(--awd-text-secondary);
  font-size: 12px;
}

input, textarea {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  resize: vertical;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

input:focus, textarea:focus {
  outline: none;
  border-color: var(--awd-accent);
  box-shadow: 0 0 0 3px rgba(137, 168, 160, 0.18);
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  border-radius: var(--awd-radius-sm);
  border: 1px solid var(--awd-border);
  transition: background 0.2s ease, transform 0.1s ease;
}

.btn:active { transform: translateY(1px); }

.btn.primary {
  background: var(--awd-primary);
  border-color: var(--awd-primary);
  color: #fff;
}

.btn.primary:hover { background: var(--awd-primary-hover); }

.btn.secondary {
  background: var(--awd-surface);
  color: var(--awd-text);
}

.btn:disabled { opacity: 0.6; cursor: default; }

.status {
  margin: 10px 0 0;
  font-size: 12px;
}

.status.ok { color: var(--awd-accent); }
.status.error { color: var(--awd-danger); }
.status.warn { color: var(--awd-text-secondary); }
</style>
