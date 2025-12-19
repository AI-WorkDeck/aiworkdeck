// 项目类型与公司信息展示配置
// 说明：
// - 这里只做前端显示与表单配置，真正的字段含义和映射由后端接口负责。
// - 后续如果改为从后端读取配置，可以保持这份结构作为参考。

export const PROJECT_TYPES = [
  {
    value: 'MAJOR_ASSET_RESTRUCTURING',
    label: '上市公司重大资产重组',
    formFields: [
      {
        field: 'listedCompanyName',
        label: '上市公司名称',
        required: true,
        placeholder: '请输入上市公司全称或简称',
      },
      {
        field: 'targetCompanyName',
        label: '标的公司名称',
        required: true,
        placeholder: '请输入标的公司全称',
      },
    ],
    companyDisplay: {
      LISTED: { label: '上市公司基础信息', fields: [], lists: [] },
      TARGET: { label: '标的公司基础信息', fields: [], lists: [] }
    }
  },
  {
    value: 'PRIVATE_PLACEMENT',
    label: '上市公司向特定对象发行股份',
    formFields: [
      {
        field: 'listedCompanyName',
        label: '上市公司名称',
        required: true,
        placeholder: '请输入上市公司全称或简称',
      },
    ],
    companyDisplay: {
      LISTED: { label: '上市公司基础信息', fields: [], lists: [] },
      TARGET: null
    }
  },
  {
    value: 'PUBLIC_PLACEMENT',
    label: '上市公司向不特定对象发行股份',
    formFields: [
      {
        field: 'listedCompanyName',
        label: '上市公司名称',
        required: true,
        placeholder: '请输入上市公司全称或简称',
      },
    ],
    companyDisplay: {
      LISTED: { label: '上市公司基础信息', fields: [], lists: [] },
      TARGET: null
    }
  },
  {
    value: 'ACQUISITION',
    label: '上市公司控制权收购',
    formFields: [
      {
        field: 'listedCompanyName',
        label: '上市公司名称',
        required: true,
        placeholder: '请输入上市公司全称或简称',
      },
      {
        field: 'targetCompanyName',
        label: '标的公司名称',
        required: true,
        placeholder: '请输入标的公司全称',
      },
    ],
    companyDisplay: {
      LISTED: { label: '上市公司基础信息', fields: [], lists: [] },
      TARGET: { label: '标的公司基础信息', fields: [], lists: [] }
    }
  },
  {
    value: 'BLANK',
    label: '空白项目',
    formFields: [
        {
            field: 'name',
            label: '项目名称',
            required: true,
            placeholder: '请输入项目名称',
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


