import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Marion Work Orders", template: "%s | Marion" },
  description: "Secure work-order scheduling, field completion and approval for Australian trade teams.",
  applicationName: "Marion",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Marion" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#173f45", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU" className={`${geistSans.variable} ${geistMono.variable} antialiased`}><body>{children}<PwaRegister /></body></html>;
}
