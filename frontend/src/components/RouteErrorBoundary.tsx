// src/components/RouteErrorBoundary.tsx
import React from 'react';

class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Route error caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen text-center">
          <h2 className="text-2xl font-semibold mb-2">Oops! Something went wrong in this page.</h2>
          <p className="text-gray-600">Try refreshing or go back to the dashboard.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;