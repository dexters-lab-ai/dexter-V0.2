#!/bin/sh
set -e

# Set default values if not provided
NGROK_ENABLED=${NGROK_ENABLED:-false}
NGROK_PORT=${NGROK_PORT:-3000}
NGROK_AUTH_TOKEN=${NGROK_AUTH_TOKEN:-}
NGROK_REGION=${NGROK_REGION:-us}
NGROK_SUBDOMAIN=${NGROK_SUBDOMAIN:-}

# Function to start ngrok
start_ngrok() {
    echo "🚀 Starting Ngrok tunnel..."
    
    # Set the auth token if provided
    if [ -n "$NGROK_AUTH_TOKEN" ]; then
        ngrok config add-authtoken "$NGROK_AUTH_TOKEN"
    fi
    
    # Build the ngrok command
    CMD="ngrok http --log=stdout --log-level=error"
    
    # Add region if specified
    if [ -n "$NGROK_REGION" ]; then
        CMD="$CMD --region=$NGROK_REGION"
    fi
    
    # Add subdomain if specified
    if [ -n "$NGROK_SUBDOMAIN" ]; then
        CMD="$CMD --subdomain=$NGROK_SUBDOMAIN"
    fi
    
    # Add the port
    CMD="$CMD $NGROK_PORT"
    
    # Run ngrok in the background
    eval "$CMD" &
    
    # Store ngrok's PID
    NGROK_PID=$!
    
    # Wait for ngrok to start and get the public URL
    echo "⏳ Waiting for Ngrok to start..."
    sleep 5
    
    # Get the public URL from ngrok's API
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
    
    if [ -n "$NGROK_URL" ]; then
        echo "✅ Ngrok tunnel established at: $NGROK_URL"
        export NGROK_PUBLIC_URL=$NGROK_URL
    else
        echo "⚠️  Failed to get Ngrok URL. Check the logs for errors."
    fi
}

# Start ngrok if enabled
if [ "$NGROK_ENABLED" = "true" ]; then
    start_ngrok
fi

# Start the main application
echo "🚀 Starting application..."
exec "$@"

# Cleanup function
cleanup() {
    echo "🛑 Shutting down..."
    if [ -n "$NGROK_PID" ]; then
        echo "🛑 Stopping Ngrok..."
        kill $NGROK_PID 2>/dev/null || true
    fi
    exit 0
}

# Trap SIGTERM and SIGINT
trap cleanup SIGTERM SIGINT

# Wait for all background processes
wait
