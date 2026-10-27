// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 项目类型与公司信息展示配置
// 说明：
// - 这里只做前端显示与表单配置，真正的字段含义和映射由后端接口负责。
// - 后续如果改为从后端读取配置，可以保持这份结构作为参考。

import { t } from '@/i18n'

export const PROJECT_TYPES = [
  {
    value: 'MAJOR_ASSET_RESTRUCTURING',
    get label() { return t('config.projectTypes.majorAssetRestructuring') },
    formFields: [
      {
        field: 'listedCompanyName',
        get label() { return t('config.projectFields.listedCompanyName') },
        required: true,
        get placeholder() { return t('config.projectFields.listedCompanyNamePlaceholder') },
      },
      {
        field: 'targetCompanyName',
        get label() { return t('config.projectFields.targetCompanyName') },
        required: true,
        get placeholder() { return t('config.projectFields.targetCompanyNamePlaceholder') },
      },
    ],
    companyDisplay: {
      LISTED: { get label() { return t('config.projectFields.listedCompanyInfo') }, fields: [], lists: [] },
      TARGET: { get label() { return t('config.projectFields.targetCompanyInfo') }, fields: [], lists: [] }
    }
  },
  {
    value: 'PRIVATE_PLACEMENT',
    get label() { return t('config.projectTypes.privatePlacement') },
    formFields: [
      {
        field: 'listedCompanyName',
        get label() { return t('config.projectFields.listedCompanyName') },
        required: true,
        get placeholder() { return t('config.projectFields.listedCompanyNamePlaceholder') },
      },
    ],
    companyDisplay: {
      LISTED: { get label() { return t('config.projectFields.listedCompanyInfo') }, fields: [], lists: [] },
      TARGET: null
    }
  },
  {
    value: 'PUBLIC_PLACEMENT',
    get label() { return t('config.projectTypes.publicPlacement') },
    formFields: [
      {
        field: 'listedCompanyName',
        get label() { return t('config.projectFields.listedCompanyName') },
        required: true,
        get placeholder() { return t('config.projectFields.listedCompanyNamePlaceholder') },
      },
    ],
    companyDisplay: {
      LISTED: { get label() { return t('config.projectFields.listedCompanyInfo') }, fields: [], lists: [] },
      TARGET: null
    }
  },
  {
    value: 'ACQUISITION',
    get label() { return t('config.projectTypes.acquisition') },
    formFields: [
      {
        field: 'listedCompanyName',
        get label() { return t('config.projectFields.listedCompanyName') },
        required: true,
        get placeholder() { return t('config.projectFields.listedCompanyNamePlaceholder') },
      },
      {
        field: 'targetCompanyName',
        get label() { return t('config.projectFields.targetCompanyName') },
        required: true,
        get placeholder() { return t('config.projectFields.targetCompanyNamePlaceholder') },
      },
    ],
    companyDisplay: {
      LISTED: { get label() { return t('config.projectFields.listedCompanyInfo') }, fields: [], lists: [] },
      TARGET: { get label() { return t('config.projectFields.targetCompanyInfo') }, fields: [], lists: [] }
    }
  },
  {
    value: 'BLANK',
    get label() { return t('config.projectTypes.blank') },
    formFields: [
        {
            field: 'name',
            get label() { return t('config.projectFields.projectName') },
            required: true,
            get placeholder() { return t('config.projectFields.projectNamePlaceholder') },
        }
    ],
    companyDisplay: null
  }
];

export const COMPANY_ROLES = {
  LISTED: 'LISTED',
  TARGET: 'TARGET',
};

/**
 * 根据项目类型值获取显示标签
 */
export function getProjectTypeLabel(projectType) {
  const typeConfig = PROJECT_TYPES.find(t => t.value === projectType)
  return typeConfig ? typeConfig.label : projectType
}


