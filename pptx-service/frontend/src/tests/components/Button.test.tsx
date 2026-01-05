/**
 * Button 组件测试
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/shared/Button'

describe('Button Component', () => {
  it('renders button with text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('calls onClick handler when clicked', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    
    fireEvent.click(screen.getByText('Click'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByText('Disabled')).toBeDisabled()
  })

  it('applies gradient styles for primary variant', () => {
    render(<Button>Primary</Button>)
    const button = screen.getByText('Primary')
    // 实际使用gradient样式
    expect(button).toHaveClass('bg-gradient-to-r')
  })

  it('applies border styles for secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>)
    const button = screen.getByText('Secondary')
    // secondary使用border样式
    expect(button).toHaveClass('border-banana-500')
  })

  it('shows loading state and disables button', () => {
    render(<Button loading>Loading</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    // 应该有loading spinner
    expect(button.querySelector('svg')).toBeInTheDocument()
  })

  it('renders with custom className', () => {
    render(<Button className="custom-class">Custom</Button>)
    const button = screen.getByText('Custom')
    expect(button).toHaveClass('custom-class')
  })

  it('renders icon when provided', () => {
    const TestIcon = () => <span data-testid="test-icon">★</span>
    render(<Button icon={<TestIcon />}>With Icon</Button>)
    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })
})

