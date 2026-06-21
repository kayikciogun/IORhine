# syntax=docker/dockerfile:1

# 1. Runtime Base (Minimal Alpine)
# Sadece runtime'da gereken kütüphaneleri içerir (Production image size küçültmek için)
FROM node:20-alpine AS runtime-base
RUN apk add --no-cache \
    libgomp \
    libstdc++

# 2. Build Base (Compiler Tools)
# Derleme işlemleri için gereken araçları içerir
FROM runtime-base AS build-base
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cmake \
    libc6-compat

# 3. Dependencies (tek npm ci — OCL kaynağını değiştirmiyoruz; npm’teki hazır .node kullanılır)
# Kaynak derlemesi gerekirse: docker build --build-arg OCL_NATIVE_REBUILD=1 ...
FROM build-base AS deps
ARG OCL_NATIVE_REBUILD=0
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps --ignore-scripts && \
    if [ "$OCL_NATIVE_REBUILD" = "1" ]; then \
      echo "Rebuilding @opencamlib/opencamlib from source..." && \
      npm rebuild @opencamlib/opencamlib; \
    fi

# 4. Builder Stage (Next.js Build)
FROM build-base AS builder
WORKDIR /app

# P1-23: Eski Dockerfile, Firebase/Gemini/RECAPTCHA secret'larını build ARG
# olarak alıp ENV'ye set ediyordu → ``docker history`` ile secret'lar sızıyordu.
# Bu secret'lar artık kullanılmıyor (P1-22: genkit/firebase bağımlılıkları
# kaldırıldı). Sadece public, secret-olmayan ENV'leri tutuyoruz.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_RUNTIME_URL

# Environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_RUNTIME_URL=$NEXT_PUBLIC_RUNTIME_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js Build (Cache mount kaldırıldı - Export süresini düşürmek için)
RUN npm run build

# 5. Production Runner Stage
FROM runtime-base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src ./src

# OCL native modülünü de taşı (Runtime'da server-side için gerekli)
COPY --from=builder /app/node_modules/@opencamlib ./node_modules/@opencamlib

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
