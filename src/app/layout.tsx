import type { Metadata, Viewport } from "next";
import { Inter, Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppAuthProvider } from "@/contexts/AppAuthContext";
import { SessionProvider } from "@/contexts/SessionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import GlobalLanguageSelector from "@/components/GlobalLanguageSelector";
import PrivacyBoundary from '@/components/privacy/PrivacyBoundary';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "H2TRAIN Dashboard",
  description: "Panel de administración para el seguimiento de la salud con tecnología H2TRAIN",
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563EB',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className={inter.className} suppressHydrationWarning>
        <LanguageProvider>
          <SessionProvider>
            <AuthProvider>
              <AppAuthProvider>
                <PrivacyBoundary>{children}</PrivacyBoundary>
                <GlobalLanguageSelector />
              </AppAuthProvider>
            </AuthProvider>
          </SessionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
