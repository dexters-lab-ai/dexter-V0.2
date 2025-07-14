#!/bin/sh

# Stop the current process
pkill -f "node dist/index.js"

# Wait for process to terminate
echo "Waiting for process to terminate..."
sleep 2

# Start the application again
echo "Restarting application..."
node dist/index.js
