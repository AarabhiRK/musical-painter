import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    BEATOVEN_API_KEY: process.env.BEATOVEN_API_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
  },
};

export default nextConfig;
