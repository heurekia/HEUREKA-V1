import { type ButtonHTMLAttributes, forwardRef } from "react";

const variants = {
  default: "bg-heureka-600 text-white hover:bg-heureka-700 shadow-sm",
  secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
  outline: "border border-gray-300 bg-white hover:bg-gray-50",
  ghost: "hover:bg-gray-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;

const sizes = {
  sm: "h-8 px-3 text-sm",
  default: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-heureka-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = "Button";
