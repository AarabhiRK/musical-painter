
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import SessionUser from "./_components/SessionUser";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Musical Painter",
  description: "Draw to Music - Interactive Whiteboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-800 font-sans`}
      >
        <SessionUser>
          {(user) => {
            let email = user?.email;
            if (!email && typeof window !== "undefined") {
              email = window.localStorage.getItem("demoEmail") || undefined;
            }
            return (
              <div className="w-full flex justify-end items-center px-8 py-4">
                {email ? (
                  <span className="text-sm text-blue-600 underline">{email}</span>
                ) : (
                  <a href="/auth/login" className="text-blue-600 underline text-sm">Login / Sign Up</a>
                )}
              </div>
            );
          }}
        </SessionUser>
        {children}
      </body>
    </html>
  );
}
