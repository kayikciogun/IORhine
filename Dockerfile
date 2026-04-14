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

# Arguments
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_CLIENT_EMAIL
ARG FIREBASE_PRIVATE_KEY
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_DATABASE_URL
ARG GEMINI_API_KEY
ARG RECAPTCHA_SECRET_KEY
ARG NEXT_PUBLIC_RECAPTCHA_SITE_KEY
ARG NEXT_PUBLIC_API_URL

# Environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID
ENV FIREBASE_CLIENT_EMAIL=$FIREBASE_CLIENT_EMAIL
ENV FIREBASE_PRIVATE_KEY=$FIREBASE_PRIVATE_KEY
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_DATABASE_URL=$NEXT_PUBLIC_FIREBASE_DATABASE_URL
ENV GEMINI_API_KEY=$GEMINI_API_KEY
ENV RECAPTCHA_SECRET_KEY=$RECAPTCHA_SECRET_KEY
ENV NEXT_PUBLIC_RECAPTCHA_SITE_KEY=$NEXT_PUBLIC_RECAPTCHA_SITE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

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
