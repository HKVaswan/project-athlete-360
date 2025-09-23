// src/components/SEO.tsx
import React from "react";
import { Helmet, HelmetProvider } from "react-helmet-async";

interface SEOProps {
  title: string;
  description?: string;
  url?: string;
  image?: string;
}

const SEO: React.FC<SEOProps> = ({ title, description, url, image }) => {
  const siteTitle = "Project Athlete 360 - Elevate";
  const pageTitle = title ? `${title} | ${siteTitle}` : siteTitle;
  const pageDescription = description || "A sports growth platform to manage athletes, sessions, and performance.";
  const pageUrl = url || window.location.href;
  const pageImage = image || "/favicon.png";

  return (
    <HelmetProvider>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta name="robots" content="index, follow" />
        
        {/* Open Graph */}
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:image" content={pageImage} />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={pageImage} />
      </Helmet>
    </HelmetProvider>
  );
};

export default SEO;