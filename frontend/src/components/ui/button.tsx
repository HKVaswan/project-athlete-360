// src/components/ui/button.tsx
import React, { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "default" | "destructive" | "outline";
  size?: "sm" | "md" | "lg";
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = "default",
  size = "md",
  className,
  ...props
}) => {
  const baseStyles =
    "rounded-md font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2";

  const variantStyles = clsx({
    "bg-blue-600 text-white hover:bg-blue-700": variant === "default",
    "bg-red-500 text-white hover:bg-red-600": variant === "destructive",
    "bg-transparent border border-gray-400 text-gray-700 hover:bg-gray-100": variant === "outline",
  });

  const sizeStyles = clsx({
    "px-3 py-1 text-sm": size === "sm",
    "px-4 py-2 text-md": size === "md",
    "px-5 py-3 text-lg": size === "lg",
  });

  return (
    <button className={clsx(baseStyles, variantStyles, sizeStyles, className)} {...props}>
      {children}
    </button>
  );
};

export { Button };