import type {Metadata, Viewport} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { SelectionProvider } from '@/components/dxf-viewer/useSelection';
import { DxfProvider } from "@/contexts/DxfContext";
import { PickPlaceProvider } from "@/contexts/PickPlaceContext";

export const metadata: Metadata = {
  title: 'IO-CAM Pick & Place',
  description: 'DXF tabanlı taş dizim donanım kontrol arayüzü',
  applicationName: 'IO-CAM Pick&Place',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="font-body antialiased">
        <SelectionProvider>
          <DxfProvider>
            <PickPlaceProvider>
              {children}
            </PickPlaceProvider>
          </DxfProvider>
        </SelectionProvider>
        <Toaster />
      </body>
    </html>
  );
}
