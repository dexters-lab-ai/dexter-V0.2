# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies for canvas and sharp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    pkgconfig \
    pixman-dev \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    vips-dev \
    curl

# Copy package files for caching
COPY package*.json ./

# Install sharp explicitly for linuxmusl-x64, then other dependencies
RUN npm install --platform=linuxmusl --arch=x64 --legacy-peer-deps sharp@0.33.5 \
    && npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Install production dependencies in a separate directory
RUN mkdir /prod_deps && \
    cp package*.json /prod_deps/ && \
    cd /prod_deps && \
    npm install --platform=linuxmusl --arch=x64 --omit=dev --no-package-lock sharp@0.33.5 && \
    npm install --omit=dev --no-package-lock

# Stage 2: Production image
FROM node:22-alpine

WORKDIR /usr/src/app

# Install runtime dependencies for canvas and sharp
RUN apk add --no-cache \
    cairo \
    pango \
    jpeg \
    giflib \
    pixman \
    vips \
    curl 

# Copy built application and production node_modules
COPY --from=builder /usr/src/app/dist/ ./dist/
COPY --from=builder /prod_deps/node_modules/ ./node_modules/

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /usr/src/app
USER appuser

# Expose ports
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS=--max_old_space_size=4096
ENV BASE_URL=http://localhost:3000
ENV GOOGLE_CLIENT_REDIRECT=http://localhost:3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if(r.statusCode !== 200) throw new Error()}).on('error', (e) => {process.exit(1)})"

# Stage 3: Development image
FROM node:22-alpine AS development

WORKDIR /usr/src/app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    pkgconfig \
    pixman-dev \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    vips-dev

# Copy package files
COPY package*.json ./

# Install sharp explicitly for linuxmusl-x64, then other dependencies
RUN npm install --platform=linuxmusl --arch=x64 --legacy-peer-deps sharp@0.33.5 \
    && npm install --legacy-peer-deps

# Copy application code
COPY . .

# Expose ports for development
EXPOSE 3000 3090 4000 9229

# Set environment variables for development
ENV NODE_ENV=development
ENV PORT=3000
ENV NODE_OPTIONS=--max_old_space_size=4096

# Command to run the development server
CMD ["npm", "run", "dev"]