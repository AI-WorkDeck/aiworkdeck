import React, { useState } from 'react';
import { X, FileText, Settings as SettingsIcon } from 'lucide-react';
import { Button, Textarea } from '@/components/shared';
import { Settings } from '@/pages/Settings';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // 项目设置
  extraRequirements: string;
  templateStyle: string;
  onExtraRequirementsChange: (value: string) => void;
  onTemplateStyleChange: (value: string) => void;
  onSaveExtraRequirements: () => void;
  onSaveTemplateStyle: () => void;
  isSavingRequirements: boolean;
  isSavingTemplateStyle: boolean;
}

type SettingsTab = 'project' | 'global';

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  isOpen,
  onClose,
  extraRequirements,
  templateStyle,
  onExtraRequirementsChange,
  onTemplateStyleChange,
  onSaveExtraRequirements,
  onSaveTemplateStyle,
  isSavingRequirements,
  isSavingTemplateStyle,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('project');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">设置</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 左侧导航栏 */}
          <aside className="w-64 bg-gray-50 border-r border-gray-200 flex-shrink-0">
            <nav className="p-4 space-y-2">
              <button
                onClick={() => setActiveTab('project')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  activeTab === 'project'
                    ? 'bg-banana-500 text-white shadow-md'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <FileText size={20} />
                <span className="font-medium">项目设置</span>
              </button>
              <button
                onClick={() => setActiveTab('global')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  activeTab === 'global'
                    ? 'bg-banana-500 text-white shadow-md'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <SettingsIcon size={20} />
                <span className="font-medium">全局设置</span>
              </button>
            </nav>
          </aside>

          {/* 右侧内容区 */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'project' ? (
              <div className="max-w-3xl space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">项目级配置</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    这些设置仅应用于当前项目，不影响其他项目
                  </p>
                </div>

                {/* 额外要求 */}
                <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 mb-2">额外要求</h4>
                    <p className="text-sm text-gray-600">
                      在生成每个页面时，AI 会参考这些额外要求
                    </p>
                  </div>
                  <Textarea
                    value={extraRequirements}
                    onChange={(e) => onExtraRequirementsChange(e.target.value)}
                    placeholder="例如：使用紧凑的布局，顶部展示一级大纲标题，加入更丰富的PPT插图..."
                    rows={4}
                    className="text-sm"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onSaveExtraRequirements}
                    disabled={isSavingRequirements}
                    className="w-full sm:w-auto"
                  >
                    {isSavingRequirements ? '保存中...' : '保存额外要求'}
                  </Button>
                </div>

                {/* 风格描述 */}
                <div className="bg-blue-50 rounded-lg p-6 space-y-4">
                  <div>
                    <h4 className="text-base font-semibold text-gray-900 mb-2">风格描述</h4>
                    <p className="text-sm text-gray-600">
                      描述您期望的 PPT 整体风格，AI 将根据描述生成相应风格的页面
                    </p>
                  </div>
                  <Textarea
                    value={templateStyle}
                    onChange={(e) => onTemplateStyleChange(e.target.value)}
                    placeholder="例如：简约商务风格，使用深蓝色和白色配色，字体清晰大方，布局整洁..."
                    rows={5}
                    className="text-sm"
                  />
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onSaveTemplateStyle}
                      disabled={isSavingTemplateStyle}
                      className="w-full sm:w-auto"
                    >
                      {isSavingTemplateStyle ? '保存中...' : '保存风格描述'}
                    </Button>
                  </div>
                  <div className="bg-blue-100 rounded-md p-3">
                    <p className="text-xs text-blue-900">
                      💡 <strong>提示：</strong>风格描述会在生成图片时自动添加到提示词中。
                      如果同时上传了模板图片，风格描述会作为补充说明。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-4xl">
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">全局设置</h3>
                  <p className="text-sm text-gray-600">
                    这些设置应用于所有项目
                  </p>
                </div>
                {/* 复用 Settings 组件的内容 */}
                <Settings />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

