# Ngrok with Docker on DigitalOcean Deployment Guide

This guide explains how to deploy your application with Ngrok in a Docker container on DigitalOcean.

## Prerequisites

1. Docker and Docker Compose installed on your DigitalOcean Droplet
2. Ngrok account with an auth token
3. Domain name (optional, for custom subdomains)

## Setup Instructions

### 1. Configure Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# Required
NGROK_AUTH_TOKEN=your_ngrok_auth_token
NGROK_REGION=us  # or your preferred region (us, eu, au, ap, sa, jp, in)

# Optional
NGROK_SUBDOMAIN=your-subdomain  # If you want a custom subdomain

# Other required environment variables
MONGO_URI=your_mongodb_connection_string
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

### 2. Build and Start Containers

```bash
# Build the Docker image
docker-compose -f docker-compose.ngrok.yml build

# Start the services
docker-compose -f docker-compose.ngrok.yml up -d
```

### 3. Verify the Setup

Check the logs to ensure everything is running:

```bash
docker-compose -f docker-compose.ngrok.yml logs -f
```

You should see output indicating that both your application and Ngrok have started successfully.

### 4. Access Your Application

1. **Ngrok Web Interface**: Access the Ngrok web interface at `http://your-droplet-ip:4040`
2. **Public URL**: The public URL will be shown in the application logs. You can also find it in the Ngrok web interface.

### 5. Update DNS (Optional)

If you're using a custom domain:

1. Go to your domain registrar
2. Add a CNAME record pointing your subdomain to `your-subdomain.ngrok.io`
3. Wait for DNS propagation (may take a few minutes to hours)

## Updating the Application

To update your application:

```bash
# Pull the latest changes
git pull

# Rebuild and restart the containers
docker-compose -f docker-compose.ngrok.yml down
docker-compose -f docker-compose.ngrok.yml build --no-cache
docker-compose -f docker-compose.ngrok.yml up -d
```

## Troubleshooting

### Ngrok Not Starting
- Verify your `NGROK_AUTH_TOKEN` is correct
- Check if port 4040 is accessible from the internet
- Check Docker logs: `docker-compose -f docker-compose.ngrok.yml logs app`

### Application Not Accessible
- Verify the application is running: `docker ps`
- Check application logs: `docker-compose -f docker-compose.ngrok.yml logs app`
- Ensure the application is binding to `0.0.0.0` and the correct port

### High Memory Usage
- The default setup includes development tools. For production, consider:
  - Using a more minimal base image
  - Removing build dependencies in the final image
  - Adjusting Node.js memory limits

## Security Considerations

1. **Ngrok Auth Token**: Keep your Ngrok auth token secure. Never commit it to version control.
2. **Firewall**: Configure your DigitalOcean firewall to only allow necessary ports (3000, 4040).
3. **HTTPS**: Use Ngrok's built-in HTTPS or set up a reverse proxy with SSL termination.
4. **Authentication**: Implement authentication for your application endpoints.

## Backup and Monitoring

1. **Backup MongoDB**: Set up regular backups of your MongoDB data.
2. **Logs**: Configure log rotation and monitoring for your containers.
3. **Uptime Monitoring**: Use a service to monitor your Ngrok endpoints.

## Scaling

For production traffic, consider:
1. Using DigitalOcean's load balancer
2. Setting up multiple Ngrok tunnels
3. Implementing a proper reverse proxy (like Nginx)
4. Using DigitalOcean's managed databases instead of containerized databases
