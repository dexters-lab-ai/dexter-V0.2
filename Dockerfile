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
FROM node:22-alpine AS production

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

# Copy built application, config directory, and production node_modules
COPY --from=builder /usr/src/app/dist/ ./dist/
COPY --from=builder /prod_deps/node_modules/ ./node_modules/

# Create directory for Google TTS credential file
RUN mkdir -p /usr/src/app/config

# Create the Google TTS key file during build with actual credentials
RUN echo '{"type":"service_account","project_id":"katz-446913","private_key_id":"b94403913665f62ee1dc9097c537836189568e5a","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC0R3aXJuhoNtg6\\ntsBLcYgc9qkPM2WCcedqT0LPonv66gSOFq3WaI4AMvCGmKeI97qop800iY0MQhTY\\npCd2CQ9ng1VSUNVP+9wsdPGRM+UwM4G+CAOKBXphOcGks942kSzAcLz7H1TPJlek\\nCG328wsQCnLUSkLwTbHxCgdyJjySpRM/wgCeDgoI6VafsOXG5W3waRoNwxI1kpHe\\nYF1BKeipdJLB7vE+dWFhwe86mkPBya+PijWnlu1MsBrjC4x+Bb0oZhD0XgdLrind\\nxvhjInPW+gKXzV9VOyZCU1rYj/4Umxpbr3TalXUSG5DQvCSqoFzKyh/L/pSiTdzs\\nhevjQkLLAgMBAAECggEAQD6zYVxJOFJLLmlQD9Kuufug9bzQMPNcj8MdQRdbbWiW\\nJPiqDJ2H9UQx+RVPpvz5dP8Pnuhh7ntiKG4fbe3+olnoPwR1cCKGLQWjzKYcx9ej\\nJdB/SmF3YkyN2J8M0o9bzlyezDM3Kvc0Bk3GulmUmKvQjhzEzBQ0FH0JeEFuFqfJ\\nlrM9SxmOc5HRH5qt3he11JwGiBHK3CV6Y8twwb+QG6uXGa2h/tCcmvVmm8n+EGvi\\nlC8vcElr9BAdqeMr8/fk2rlrbyiwm9ONItybEhDy6gsrYmn+X31pYtbnkx7oK0mx\\n2+cftpBDIJs54mqUB3HTxPIz7CynzuXPNPRD2haR+QKBgQDpZO1b45SKPKGqgnuI\\nr+DKGxdY98pieIDA4aCGXIdyMM+S2GsSf867DYWOha8qWRlVRXaYuSbBz4+bPU4i\\nWg4lTnoLcQ4F0OEp0BosBYpPQq08/kjLPg0bU1FOI2GGOYN9+4r1hOwz8DVuVD+w\\npx36y0fl9kZ3GyrwyzUOJgegZwKBgQDFvYh5S9VZM7fln4dnRoHDc/aOGqBcixfy\\n4zCJdfSTOFaTDZSfWdVtf+qW860G/VAihIvn6YHTaOnkhhXq4PwROre+308Wa8Vq\\nWeFkILGB50leg4DoprsSTsuRU9+LRB0Lx3an+3uz7lgl9DX3q0XXat/bvUTvSYnT\\nUQOaOZc7/QKBgQCJI/no7ZABrmDcXTGTfq0adNLCP0/XjrExJSL68HHSImZGBg7c\\nXuctuGNK/LiRrKsbFOb8FId2iKz8bgh0XPBE8Zj7EiJIPpWfyR0n0tWTfz1mQpCp\\nhDuVW97BiD6s7SyboWvkmodkeXgb7TtDZN9T15DWymBbakZQGUeCmcwPbwKBgB3N\\nG8VUFXpVHhEAQvLgoGvpjS4Le0GXQOu9K7J70Xlik0GkWVLOwii3j45ieSBFiw84\\ntLEl8wf+lsl3H9R/Rd3+4HRmyU+SvHTzyNFDUB1I0zjoTsRBZI40y99CKb2ebVY6\\nIHrent0WPbiynnOOH3+Avu4qDzqU9a2gVw+mQFGtAoGAWLvNMKwmEpaOSDXpIpdy\\n+z88PtAGHv2G9B9ZYD7xu1n6uQEHAon+PNH38O/1rFOpSuxz8YgGDztTpSUYdnFc\\nmGo1WtQEdVuU7skyCmUdHf5vRgMAEpxNjvudHpOHWEPee7LO9fBDzttrR+FifrUo\\nUy4zrNle8UQ6dFZVol6mz2Y=\\n-----END PRIVATE KEY-----\\n","client_email":"katzvoicetranscripter@katz-446913.iam.gserviceaccount.com","client_id":"103643753675784733416","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/katzvoicetranscripter%40katz-446913.iam.gserviceaccount.com","universe_domain":"googleapis.com"}' > /usr/src/app/config/katz-speech-to-text-key.json

# Verify the key file was created successfully and set proper permissions
RUN ls -la /usr/src/app/config/katz-speech-to-text-key.json && \
    chmod 600 /usr/src/app/config/katz-speech-to-text-key.json && \
    echo "✅ Google TTS key file created and secured successfully"

# Create a backup copy in case the file is accidentally deleted or not found at runtime
RUN cp /usr/src/app/config/katz-speech-to-text-key.json /usr/src/app/katz-speech-to-text-key.json && \
    echo "✅ Created backup key file"

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
ENV GOOGLE_API_KEY_FILE=/usr/src/app/config/katz-speech-to-text-key.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if(r.statusCode !== 200) throw new Error()}).on('error', (e) => {process.exit(1)})"

# Start the server only once
CMD ["node", "dist/main.js"]

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

# Command to run the development server with debugging
CMD ["npx", "nodemon", "--inspect=0.0.0.0:9229", "src/index.js"]