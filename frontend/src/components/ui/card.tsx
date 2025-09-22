// src/components/ui/card.tsx
import * as React from "react";
import clsx from "clsx";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          "bg-white shadow-md rounded-2xl p-4 transition-all hover:shadow-lg",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = "Card";

const CardContent = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div ref={ref} className={clsx("w-full", className)} {...props}>
        {children}
      </div>
    );
  }
);
CardContent.displayName = "CardContent";

export { Card, CardContent };