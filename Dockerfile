# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies including canvas and sharp system deps
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
    vips-dev \  # Added for sharp (libvips dependency)

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies including devDependencies for building
# Force sharp to build for linuxmusl-x64
RUN npm install --legacy-peer-deps --build-from-source --sharp-libvips-binary-host="https://github.com/lovell/sharp-libvips/releases/download"

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Install only production dependencies in a separate directory
RUN mkdir /prod_deps && \
    cp package*.json /prod_deps/ && \
    cd /prod_deps && \
    npm install --omit=dev --no-package-lock --build-from-source --sharp-libvips-binary-host="https://github.com/lovell/sharp-libvips/releases/download"

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
    vips  # Added for sharp runtime (libvips)

# Copy built application from builder
COPY --from=builder /usr/src/app/dist/ ./dist/

# Copy production node_modules from builder
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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if(r.statusCode !== 200) throw new Error()}).on('error', (e) => {process.exit(1)})"

# Command to run the application
CMD ["node", "dist/index.js"]

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
    vips-dev  # Added for sharp

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install --legacy-peer-deps

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