# Stage 1: Build the application
FROM node:16-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package.json yarn.lock tsoa.json ./

# Install all dependencies including devDependencies
RUN yarn install --frozen-lockfile --network-timeout 1000000

# Copy source code
COPY . .

# Build the application
RUN yarn run build

# Stage 2: Production image
FROM node:16-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile --network-timeout 1000000

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Copy necessary files
COPY tsoa.json ./

# Set environment to production
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "dist/server.js"]
