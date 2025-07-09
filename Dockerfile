# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application if needed
# RUN npm run build

# Stage 2: Production image with Ngrok
FROM node:20-alpine

WORKDIR /usr/src/app

# Install system dependencies for canvas and other native modules
RUN apk add --no-cache --virtual .gyp \
    python3 \
    make \
    g++ \
    gcc \
    giflib-dev \
    libjpeg-turbo-dev \
    libpng-dev \
    libtool \
    pkgconfig \
    pango-dev \
    jpeg-dev \
    cairo-dev \
    giflib-dev \
    librsvg \
    # Fix library symlinks for canvas compatibility
    && ln -s /usr/lib/libgif.so.7 /usr/lib/libgif.so.6 \
    && ln -s /usr/lib/libjpeg.so.8 /usr/lib/libjpeg.so.6

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Remove build dependencies
RUN apk del .gyp

# Copy built application from builder
COPY --from=builder /usr/src/app/dist ./dist
# Copy other necessary files (adjust as needed)
COPY --from=builder /usr/src/app/src ./src
COPY --from=builder /usr/src/app/public ./public

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /usr/src/app
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
CMD ["node", "src/index.js"]

# Stage 3: Development image
FROM node:20-alpine AS development

WORKDIR /usr/src/app

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

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
