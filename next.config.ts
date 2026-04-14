import type {NextConfig} from 'next';
import path from 'path';

// Render/Docker için varsayılan: standalone. Yerelde "Iterator result 0 is not an object" vb. trace
// hatalarında denemek için: NEXT_STANDALONE=0 npm run build
const useStandalone = process.env.NEXT_STANDALONE !== '0';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Production security headers
  headers: async () => {
    const headerConfig = [];
    
    // Security headers (production only)
    if (process.env.NODE_ENV === 'production') {
      headerConfig.push({
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      });
    }
    
    // WASM dosyaları için MIME type headers (her zaman)
    headerConfig.push({
      source: '/:path*.wasm',
      headers: [
        {
          key: 'Content-Type',
          value: 'application/wasm',
        },
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    });
    
    return headerConfig;
  },

  // Disable source maps in production
  productionBrowserSourceMaps: false,
  
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  
  // Production optimizations for Render (NEXT_STANDALONE=0 ile kapatılabilir)
  ...(useStandalone ? { output: 'standalone' as const } : {}),
  
  // Mobil cihazlardan geliştirme sunucusuna erişim için (sadece development)
  ...(process.env.NODE_ENV === 'development' && {
    allowedDevOrigins: ['192.168.1.37', '*.local'],
  }),
  
  // Server external packages
  serverExternalPackages: [],
  
  // webVitalsAttribution deneysel; bazı ortamlarda build finalize/trace ile çakışabiliyor.
  // Açmak için: NEXT_WEB_VITALS_ATTRIBUTION=1 npm run build
  experimental: {
    ...(process.env.NEXT_WEB_VITALS_ATTRIBUTION === '1'
      ? { webVitalsAttribution: ['CLS' as const, 'LCP' as const] }
      : {}),
  },
  
  // Turbopack configuration (Next.js 15)
  turbopack: {
    root: __dirname,
    // Alias resolution (mirror of webpack alias)
    resolveAlias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Keep default resolve extensions (no override)
  },

  // Webpack configuration for compatibility when not using Turbopack
  webpack: (config) => {
    // WASM support (CavalierContours)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Path aliases
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, './src'),
    };

    return config;
  },
};

export default nextConfig;
