import React from 'react';
import { CheckCircle } from 'lucide-react';

const features = [
  {
    title: "Athlete Management",
    description: "Easily create, edit, and track athlete profiles in one place.",
  },
  {
    title: "Dashboard Insights",
    description: "Get a quick overview of athletes, performance, and growth metrics.",
  },
  {
    title: "Smart Record Keeping",
    description: "Maintain accurate and organized records for athletes’ careers.",
  },
  {
    title: "Secure Authentication",
    description: "Protected access with secure login and role-based permissions.",
  },
];

const FeaturesPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-6 lg:px-16">
      <h1 className="text-4xl font-bold text-center text-blue-800 mb-12">
        Platform Features
      </h1>
      <div className="max-w-5xl mx-auto grid gap-8 sm:grid-cols-2">
        {features.map((feature, idx) => (
          <div
            key={idx}
            className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition"
          >
            <div className="flex items-start space-x-4">
              <CheckCircle className="text-green-500 w-6 h-6 flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-xl font-semibold text-gray-800">
                  {feature.title}
                </h2>
                <p className="mt-2 text-gray-600">{feature.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FeaturesPage;