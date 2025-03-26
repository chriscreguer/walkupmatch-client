import './globals.css';
import type { Metadata } from 'next';
import { ClientProviders } from '@/providers/ClientProviders';

export const metadata: Metadata = {
  title: 'WalkUp Match - Connect Your Music to MLB Players',
  description: 'Create your MLB fantasy team based on your Spotify music taste and MLB players\' walkup songs.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}