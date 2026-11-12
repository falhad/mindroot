# Mindroot relay. Build:  docker build -t mindroot-relay server/relay
# Run (bound to this machine only; put a TLS reverse proxy in front):
#   docker run -d --name mindroot-relay --restart unless-stopped \
#     -e SECRET="$(openssl rand -hex 32)" -v mindroot-relay-data:/data \
#     -p 127.0.0.1:8787:8787 mindroot-relay
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
