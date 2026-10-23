# DASHDUEL game server (+ optional static game files).  Build from the PROJECT ROOT:
#   docker build -t dashduel .
#   docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://your-frontend.example dashduel
# The server runs the game's own simulation files from js/, so js/ must be in the image.
FROM node:22-alpine
WORKDIR /app
COPY server ./server
COPY js ./js
# only used when SERVE_STATIC=1 (single-service hosting); harmless otherwise
COPY index.html ./
COPY css ./css
COPY vendor ./vendor
ENV NODE_ENV=production PORT=8787 TRUST_PROXY=1
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "server/server.js"]
