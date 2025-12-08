// 项目类型与公司信息展示配置
// 说明：
// - 这里只做前端显示与表单配置，真正的字段含义和映射由后端接口负责。
// - 后续如果改为从后端读取配置，可以保持这份结构作为参考。

export const PROJECT_TYPES = [
  {
    value: 'MAJOR_ASSET_RESTRUCTURING',
    label: '上市公司重大资产重组',
    // 不同项目类型需要填写的基础表单字段（仅前端表现）
    formFields: [
      {
        field: 'listedCompanyName',
        label: '上市公司名称',
        required: true,
        placeholder: '请输入上市公司全称或简称进行检索',
      },
      {
        field: 'targetCompanyName',
        label: '标的公司名称',
        required: true,
        placeholder: '请输入标的公司全称进行检索',
      },
    ],
    // 不同角色公司在前端展示哪些字段，由配置控制
    companyDisplay: {
      LISTED: {
        label: '上市公司基础信息',
        fields: [
          { key: 'stockCode', label: '证券代码' },
          { key: 'fullName', label: '公司全称' },
          { key: 'shortName', label: '公司简称' },
          { key: 'board', label: '所属板块' },
          { key: 'totalShares', label: '股份总数' },
          { key: 'latestClosePrice', label: '最新收盘价' },
        ],
        // 复杂列表类字段
        lists: [
          {
            key: 'top10Shareholders',
            label: '前十大股东',
            columns: [
              { key: 'name', label: '股东名称' },
              { key: 'shareholdingRatio', label: '持股比例' },
              { key: 'shares', label: '持股数量' },
            ],
          },
          {
            key: 'executives',
            label: '董监高',
            columns: [
              { key: 'name', label: '姓名' },
              { key: 'position', label: '职务' },
              { key: 'term', label: '任期' },
            ],
          },
        ],
      },
      TARGET: {
        label: '标的公司基础信息',
        fields: [
          { key: 'name', label: '公司名称' },
          { key: 'registeredAddress', label: '注册地址' },
          { key: 'registeredCapital', label: '注册资本' },
          { key: 'equityStructureRemark', label: '股权结构说明' },
        ],
        lists: [
          {
            key: 'shareholders',
            label: '股东方及持股情况',
            columns: [
              { key: 'name', label: '股东名称' },
              { key: 'shareholdingRatio', label: '持股比例' },
              {
                key: 'contribution',
                label: '出资额 / 持股数量',
              },
            ],
          },
        ],
      },
    },
  },
];

export const COMPANY_ROLES = {
  LISTED: 'LISTED',
  TARGET: 'TARGET',
};


