FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY mini-services/realtime/package.json ./
RUN bun install --production

# Copy source
COPY mini-services/realtime/index.ts ./

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3003/health || exit 1

# Start
CMD ["bun", "run", "index.ts"]
