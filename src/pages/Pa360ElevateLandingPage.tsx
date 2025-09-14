// src/pages/Pa360ElevateLandingPage.tsx

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, BarChart3, ClipboardList, Users } from "lucide-react";
import { motion } from "framer-motion";

export default function Pa360ElevateLandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white py-20 px-6 text-center">
        <motion.h1
          className="text-4xl md:text-5xl font-bold mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Welcome to pa360 Elevate
        </motion.h1>
        <motion.p
          className="text-lg mb-8 max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          Track performance, manage sessions, and visualize progress — all in one platform powered by Project Athlete 360.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Button size="lg" asChild className="rounded-2xl shadow-lg">
            <a href="/dashboard">
              Enter pa360 Elevate
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </motion.div>
      </section>

      {/* Overview Section */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          <Card className="shadow-md rounded-2xl">
            <CardContent className="flex flex-col items-center text-center py-8">
              <Users className="h-10 w-10 text-blue-600 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Sessions</h3>
              <p className="text-gray-600">Organize and manage training sessions with ease.</p>
            </CardContent>
          </Card>

          <Card className="shadow-md rounded-2xl">
            <CardContent className="flex flex-col items-center text-center py-8">
              <ClipboardList className="h-10 w-10 text-indigo-600 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Assessments</h3>
              <p className="text-gray-600">Record athlete progress and track key performance data.</p>
            </CardContent>
          </Card>

          <Card className="shadow-md rounded-2xl">
            <CardContent className="flex flex-col items-center text-center py-8">
              <BarChart3 className="h-10 w-10 text-green-600 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Performance</h3>
              <p className="text-gray-600">Visualize growth and insights with intuitive charts.</p>
            </CardContent>
          </Card>
        </div>

        <div className="text-center mt-12">
          <a href="/features" className="text-blue-600 hover:underline">
            See full feature list →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto py-8 bg-gray-900 text-gray-400 text-center">
        <p className="mb-2">Need help? Contact support@projectathlete360.com</p>
        <p>
          <a href="/" className="hover:underline mr-4">Home</a>
          <a href="/privacy" className="hover:underline mr-4">Privacy</a>
          <a href="/terms" className="hover:underline">Terms</a>
        </p>
        <p className="mt-4 text-sm">#pa360Elevate · Powered by Project Athlete 360</p>
      </footer>
    </div>
  );
}
