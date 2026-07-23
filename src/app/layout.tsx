import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "REME Painting Group Work Orders", template: "%s | REME Painting Group" },
  description: "Secure work-order scheduling, field completion and approval for REME Painting Group.",
  applicationName: "REME Painting Group",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/reme-painting-group-logo.jpg", apple: "/reme-painting-group-logo.jpg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "REME" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#003f70", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU" className={`${geistSans.variable} ${geistMono.variable} antialiased`}><body>{children}<PwaRegister /></body></html>;
}
