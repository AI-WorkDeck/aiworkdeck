import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// We'll install class-variance-authority and radix-ui/react-slot as they are standard for this pattern
// npm install class-variance-authority @radix-ui/react-slot

/* 
  Button Variants based on King Forest Design System
  Primary: King Forest Green
  Secondary: Neutral or Outline
  Accent: King Mint
*/

const buttonVariants = cva(
    'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-all duration-200 cursor-pointer',
    {
        variants: {
            variant: {
                default: 'bg-king-forest text-white hover:bg-king-forest-lighter shadow-md hover:shadow-lg',
                destructive: 'bg-red-600 text-neutral-white hover:bg-red-700',
                outline:
                    'border border-neutral-gray-light bg-background hover:bg-neutral-gray-pale hover:text-neutral-gray-dark',
                secondary:
                    'bg-neutral-gray-pale text-neutral-gray-dark hover:bg-neutral-gray-light',
                ghost: 'hover:bg-neutral-gray-pale hover:text-neutral-gray-dark',
                link: 'text-king-forest underline-offset-4 hover:underline',
                accent: 'bg-king-mint text-king-forest hover:bg-king-mint-lighter shadow-md hover:shadow-lg font-bold',
            },
            size: {
                default: 'h-10 px-4 py-2',
                sm: 'h-9 rounded-md px-3',
                lg: 'h-12 rounded-md px-8 text-base',
                icon: 'h-10 w-10',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button';
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        );
    }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
