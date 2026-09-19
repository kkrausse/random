import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof BaseButton> & { variant?: 'primary' | 'secondary' | 'danger' }

export const Button = ({ className = '', variant = 'secondary', ...props }: Props) => (
  <BaseButton className={`button button-${variant} ${className}`} {...props} />
)
