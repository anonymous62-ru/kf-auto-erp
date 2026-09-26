import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KF Auto ERP',
  description: 'Gestion commerciale KF Auto SARL',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="text-gray-900 antialiased min-h-screen">{children}</body>
    </html>
  );
}
