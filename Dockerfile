# Use Node.js LTS with Debian base for better Puppeteer support
FROM node:20-bullseye-slim

# Install necessary system dependencies for Google Chrome
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create data directory for persistence
RUN mkdir -p /app/data && \
    ln -sf /app/data/listings.json /app/listings.json && \
    ln -sf /app/data/market_values.json /app/market_values.json && \
    ln -sf /app/data/scored_listings.json /app/scored_listings.json && \
    ln -sf /app/data/notified_deals.json /app/notified_deals.json && \
    ln -sf /app/data/cookies.json /app/cookies.json

# Run as non-root user for security
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

USER pptruser

# Default command (can be overridden)
CMD ["node", "scraper_agent.js"]
