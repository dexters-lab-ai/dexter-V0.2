# Docker Setup for KATZ!life

This document provides instructions for setting up and running the KATZ!life application using Docker.

## Prerequisites

- Docker (v20.10.0 or later)
- Docker Compose (v2.0.0 or later)
- Node.js and npm (for local development without Docker)

## Environment Setup

1. Copy the example environment file and update it with your configuration:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file and fill in all required environment variables.

## Running with Docker Compose (Development)

1. Start all services:
   ```bash
   docker-compose up --build
   ```

2. Access the application:
   - Main app: http://localhost:3000
   - Admin dashboard: http://localhost:3090
   - Dashboard: http://localhost:4000
   - MongoDB Express (if enabled): http://localhost:8081

3. To run in detached mode:
   ```bash
   docker-compose up -d
   ```

4. View logs:
   ```bash
   docker-compose logs -f
   ```

## Building a Production Image

1. Build the Docker image:
   ```bash
   docker build -t katzlife:latest .
   ```

2. Run the container:
   ```bash
   docker run -d \
     --name katzlife \
     -p 3000:3000 \
     -p 3090:3090 \
     -p 4000:4000 \
     --env-file .env \
     katzlife:latest
   ```

## Environment Variables

See `.env.example` for a complete list of environment variables that can be set.

## Volumes

- MongoDB data is persisted in a Docker volume named `katzlife_mongodb_data`
- Redis data is persisted in a Docker volume named `katzlife_redis_data`

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000, 3090, 4000, 27017, and 6379 are available.
2. **Permission issues**: If you encounter permission issues with volumes, try:
   ```bash
   sudo chown -R $USER:$USER .
   ```
3. **Build failures**: Ensure all required build dependencies are installed in the Dockerfile.

### Viewing Logs

```bash
# View logs for all services
docker-compose logs

# View logs for a specific service
docker-compose logs <service_name>

# Follow logs in real-time
docker-compose logs -f
```

## Production Deployment on DigitalOcean

1. **Create a Droplet**:
   - Choose Ubuntu 22.04 LTS
   - Select at least 2GB RAM/1 CPU
   - Enable private networking

2. **Install Docker and Docker Compose**:
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   
   # Install Docker Compose
   sudo apt-get update
   sudo apt-get install docker-compose-plugin
   
   # Add current user to docker group
   sudo usermod -aG docker $USER
   newgrp docker
   ```

3. **Deploy the Application**:
   ```bash
   # Clone the repository
   git clone https://github.com/yourusername/your-repo.git
   cd your-repo
   
   # Set up environment variables
   cp .env.example .env
   nano .env  # Edit with your production values
   
   # Start the services
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

4. **Set Up Nginx as Reverse Proxy (Recommended)**:
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
       
       location /admin {
           proxy_pass http://localhost:3090;
           # Additional proxy settings...
       }
       
       location /dashboard {
           proxy_pass http://localhost:4000;
           # Additional proxy settings...
       }
   }
   ```

5. **Set Up SSL with Let's Encrypt**:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```

## Monitoring and Maintenance

### Backups

```bash
# Backup MongoDB
docker exec mongodb sh -c 'mongodump --archive' > backup.dump

# Restore MongoDB
docker exec -i mongodb sh -c 'mongorestore --archive' < backup.dump

# Backup Redis
docker exec redis redis-cli save
sudo cp /var/lib/docker/volumes/katzlife_redis_data/_data/dump.rdb /path/to/backup/
```

### Updating the Application

```bash
# Pull the latest changes
git pull

# Rebuild and restart the services
docker-compose up -d --build

# Run database migrations if needed
# (Add your migration commands here)
```

## Security Considerations

1. **Never commit sensitive data** to version control
2. Use strong passwords for all services
3. Enable firewall and only expose necessary ports
4. Regularly update your dependencies
5. Monitor your Docker containers and system resources
