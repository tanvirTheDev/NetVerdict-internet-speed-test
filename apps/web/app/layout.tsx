import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'NetVerdict — Don’t guess. Get the verdict on your connection.',
  description:
    'NetVerdict scores your ISP against what it promised: Promise Delivered %, peak-hour throttling, bufferbloat, and evidence reports you can send to your ISP.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
