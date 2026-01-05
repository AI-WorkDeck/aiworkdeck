import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/utils';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  onClose,
  duration = 3000,
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircle size={20} />,
    error: <AlertCircle size={20} />,
    info: <Info size={20} />,
  };

  const styles = {
    success: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-gray-900 text-white',
  };

  return (
    <div
      className={cn(
        'fixed top-4 right-4 z-50',
        'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg',
        'animate-in slide-in-from-right',
        styles[type]
      )}
    >
      {icons[type]}
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="hover:opacity-75 transition-opacity"
      >
        <X size={18} />
      </button>
    </div>
  );
};

// Toast 管理器
export const useToast = () => {
  const [toasts, setToasts] = React.useState<Array<{ id: string; props: Omit<ToastProps, 'onClose'> }>>([]);

  const show = (props: Omit<ToastProps, 'onClose'>) => {
    const id = Math.random().toString(36);
    setToasts((prev) => [...prev, { id, props }]);
  };

  const remove = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return {
    show,
    ToastContainer: () => (
      <>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast.props}
            onClose={() => remove(toast.id)}
          />
        ))}
      </>
    ),
  };
};

