import React from 'react';
import { cn } from '@/utils';

interface LoadingProps {
  fullscreen?: boolean;
  message?: string;
  progress?: { total: number; completed: number };
}

export const Loading: React.FC<LoadingProps> = ({
  fullscreen = false,
  message = '加载中...',
  progress,
}) => {
  const content = (
    <div className="flex flex-col items-center justify-center">
      {/* 加载图标 */}
      <div className="relative w-12 h-12 mb-4">
        <div className="absolute inset-0 border-4 border-banana-100 rounded-full" />
        <div className="absolute inset-0 border-4 border-banana-500 rounded-full border-t-transparent animate-spin" />
      </div>
      
      {/* 消息 */}
      <p className="text-lg text-gray-700 mb-4">{message}</p>
      
      {/* 进度条 */}
      {progress && (
        <div className="w-64">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>已完成 {progress.completed}/{progress.total} 页</span>
            <span>{Math.round((progress.completed / progress.total) * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-banana-500 to-banana-600 transition-all duration-300"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-50">
        {content}
      </div>
    );
  }

  return content;
};

// 骨架屏组件
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      className={cn(
        'animate-shimmer bg-gradient-to-r from-gray-200 via-banana-50 to-gray-200',
        'bg-[length:200%_100%]',
        className
      )}
    />
  );
};

