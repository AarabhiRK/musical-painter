"use client";
import { useState, useEffect } from 'react';

export default function Header() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for user session
    const checkUser = async () => {
      try {
        const response = await fetch('/api/user/profile', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          // Check localStorage for demo email
          const demoEmail = localStorage.getItem('demoEmail');
          if (demoEmail) {
            setUser({ email: demoEmail });
          }
        }
      } catch (error) {
        // Check localStorage for demo email as fallback
        const demoEmail = localStorage.getItem('demoEmail');
        if (demoEmail) {
          setUser({ email: demoEmail });
        }
      } finally {
        setLoading(false);
      }
    };

    checkUser();
  }, []);

  const handleSignOut = () => {
    // Clear cookie
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    // Clear localStorage
    localStorage.removeItem('demoEmail');
    // Reset user state
    setUser(null);
    // Redirect to home
    window.location.href = '/';
  };

  if (loading) {
    return (
      <header className="w-full bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="container mx-auto px-6 py-4 md:px-8">
          <div className="flex justify-between items-center">
            {/* Logo/Brand */}
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2M7 4h10M7 4l-2 16h14l-2-16M10 9v6M14 9v6" />
                </svg>
              </div>
              <span className="text-lg font-light text-gray-900 tracking-tight">Musical Painter</span>
            </div>
            
            {/* Loading state */}
            <div className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="w-full bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
      <div className="container mx-auto px-6 py-4 md:px-8">
        <div className="flex justify-between items-center">
          {/* Logo/Brand */}
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2M7 4h10M7 4l-2 16h14l-2-16M10 9v6M14 9v6" />
              </svg>
            </div>
            <span className="text-lg font-light text-gray-900 tracking-tight">Musical Painter</span>
          </div>
          
          {/* Auth Section */}
          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center">
                  <span className="text-xs font-medium text-gray-600">
                    {user.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-light text-gray-700">{user.email}</p>
                  <p className="text-xs text-gray-500">Signed in</p>
                </div>
                <button 
                  onClick={handleSignOut}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <a 
                  href="/auth/login" 
                  className="px-4 py-2 text-sm font-light text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Sign In
                </a>
                <a 
                  href="/auth/signup" 
                  className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 rounded-lg transition-all shadow-sm hover:shadow-md"
                >
                  Get Started
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
