<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  文档属性里的产品标识开关（可溯源性设计规范附录 B4）。默认开：Word / WPS /
  LibreOffice 保存文档时都会写这个标准字段，我们此前是唯一不写的那个。
  只写产品名与版本，不写作者/单位/机器名——所以它不是隐私项，是「交付前
  要不要清元数据」的开关。

  原在「个人资料与登录」（PersonalSettingsPanel），2026-11 起随隐私项一并收进设置「隐私与数据」。
  读写走原来的 getDocumentGeneratorSettings / updateDocumentGeneratorSettings，行为不变。
-->
<template>
  <SettingsSection :title="$t('account.docGeneratorGroupTitle')">
    <SettingsRow :label="$t('account.docGeneratorLabel')">
      <AwdSwitch
        :checked="docGeneratorEnabled"
        :disabled="docGeneratorBusy"
        @change="onToggleDocGenerator"
      />
    </SettingsRow>
    <text class="bind-tip">{{ $t('account.docGeneratorHint') }}</text>
    <text v-if="docGeneratorEnabled && docGeneratorApplication" class="bind-tip">
      {{ $t('account.docGeneratorCurrent', { application: docGeneratorApplication }) }}
    </text>
  </SettingsSection>
</template>

<script>
import { getDocumentGeneratorSettings, updateDocumentGeneratorSettings } from '@/services/api.js'
import { resetDocumentStampCache } from '@/utils/documentGeneratorSetting.js'
import AwdSwitch from '@/components/AwdSwitch.vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import SettingsRow from '@/components/settings/SettingsRow.vue'

export default {
  name: 'DocGeneratorSetting',
  components: { AwdSwitch, SettingsSection, SettingsRow },
  data() {
    return {
      // 默认按「开」渲染，拉到后端值再纠正——缺省就是开，先画成关会在加载瞬间闪一下。
      docGeneratorEnabled: true,
      docGeneratorApplication: '',
      docGeneratorBusy: false,
    }
  },
  mounted() {
    this.loadDocGeneratorSetting()
  },
  methods: {
    async loadDocGeneratorSetting() {
      try {
        const res = await getDocumentGeneratorSettings()
        if (res && res.code === 0) {
          this.docGeneratorEnabled = res.enabled !== false
          this.docGeneratorApplication = res.application || ''
        }
      } catch (e) {
        // 读不到就保持默认显示，不打扰用户：这个开关不影响任何正在进行的工作
      }
    },
    async onToggleDocGenerator(next) {
      if (this.docGeneratorBusy) return
      const prev = this.docGeneratorEnabled
      this.docGeneratorBusy = true
      this.docGeneratorEnabled = next
      try {
        const res = await updateDocumentGeneratorSettings({ enabled: next })
        if (!res || res.code !== 0) throw new Error('save failed')
        this.docGeneratorEnabled = res.enabled !== false
        this.docGeneratorApplication = res.application || this.docGeneratorApplication
        // 编辑器的保存路径按会话缓存这个开关，改完必须让它重取，否则要等下次启动才生效
        resetDocumentStampCache()
      } catch (e) {
        this.docGeneratorEnabled = prev
        uni.showToast({ title: this.$t('account.docGeneratorSaveFailed'), icon: 'none' })
      } finally {
        this.docGeneratorBusy = false
      }
    },
  },
}
</script>

<style lang="scss" scoped>
.bind-tip {
  display: block;
  margin-top: 8px;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
}
</style>
