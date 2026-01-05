import { getImageUrl } from '@/api/client';
import type { Project } from '@/types';

/**
 * 获取项目标题
 */
export const getProjectTitle = (project: Project): string => {
  // 如果有 idea_prompt，优先使用
  if (project.idea_prompt) {
    return project.idea_prompt;
  }
  
  // 如果没有 idea_prompt，尝试从第一个页面获取标题
  if (project.pages && project.pages.length > 0) {
    // 按 order_index 排序，找到第一个页面
    const sortedPages = [...project.pages].sort((a, b) => 
      (a.order_index || 0) - (b.order_index || 0)
    );
    const firstPage = sortedPages[0];
    
    // 如果第一个页面有 outline_content 和 title，使用它
    if (firstPage?.outline_content?.title) {
      return firstPage.outline_content.title;
    }
  }
  
  // 默认返回未命名项目
  return '未命名项目';
};

/**
 * 获取第一页图片URL
 */
export const getFirstPageImage = (project: Project): string | null => {
  if (!project.pages || project.pages.length === 0) {
    return null;
  }
  
  // 找到第一页有图片的页面
  const firstPageWithImage = project.pages.find(p => p.generated_image_path);
  if (firstPageWithImage?.generated_image_path) {
    return getImageUrl(firstPageWithImage.generated_image_path, firstPageWithImage.updated_at);
  }
  
  return null;
};

/**
 * 格式化日期
 */
export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * 获取项目状态文本
 */
export const getStatusText = (project: Project): string => {
  if (!project.pages || project.pages.length === 0) {
    return '未开始';
  }
  const hasImages = project.pages.some(p => p.generated_image_path);
  if (hasImages) {
    return '已完成';
  }
  const hasDescriptions = project.pages.some(p => p.description_content);
  if (hasDescriptions) {
    return '待生成图片';
  }
  return '待生成描述';
};

/**
 * 获取项目状态颜色样式
 */
export const getStatusColor = (project: Project): string => {
  const status = getStatusText(project);
  if (status === '已完成') return 'text-green-600 bg-green-50';
  if (status === '待生成图片') return 'text-yellow-600 bg-yellow-50';
  if (status === '待生成描述') return 'text-blue-600 bg-blue-50';
  return 'text-gray-600 bg-gray-50';
};

/**
 * 获取项目路由路径
 */
export const getProjectRoute = (project: Project): string => {
  const projectId = project.id || project.project_id;
  if (!projectId) return '/';
  
  if (project.pages && project.pages.length > 0) {
    const hasImages = project.pages.some(p => p.generated_image_path);
    if (hasImages) {
      return `/project/${projectId}/preview`;
    }
    const hasDescriptions = project.pages.some(p => p.description_content);
    if (hasDescriptions) {
      return `/project/${projectId}/detail`;
    }
    return `/project/${projectId}/outline`;
  }
  return `/project/${projectId}/outline`;
};

