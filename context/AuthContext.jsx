'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('eleve_user');
      setUser(stored ? JSON.parse(stored) : null);
    } catch {
      localStorage.removeItem('eleve_user');
      setUser(null);
    }
    setToken(localStorage.getItem('eleve_token'));
    setIsLoading(false);
  }, []);

  const login = (newToken, userData) => {
    localStorage.setItem('eleve_token', newToken);
    localStorage.setItem('eleve_user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('eleve_token');
    localStorage.removeItem('eleve_user');
    setToken(null);
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
