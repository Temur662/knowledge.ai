"use client";

import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-bl from-white to-indigo-700 p-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white">KnowledgeAI</h1>
        <p className="mt-2 text-white/80">Create an account to start your AI learning journey</p>
      </div>
      
      <div className="w-full max-w-md">
        <SignUp 
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-white shadow-xl rounded-xl",
              headerTitle: "text-indigo-600 text-xl",
              headerSubtitle: "text-gray-600",
              socialButtonsBlockButton: "border border-gray-300 hover:bg-gray-50",
              formButtonPrimary: "bg-indigo-600 hover:bg-indigo-700",
              footerActionLink: "text-indigo-600 hover:text-indigo-800",
            },
          }}
          routing="path"
          path="/sign-up"
        />
      </div>
    </div>
  );
} 