FROM node:22-alpine AS builder
WORKDIR /app

ARG NODE_AUTH_TOKEN
RUN echo "@wyre-technology:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc

COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production AUTH_MODE=gateway MCP_HTTP_PORT=8080 MCP_TRANSPORT=http
RUN addgroup -g 1001 -S mcp && adduser -u 1001 -S mcp -G mcp
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
LABEL org.opencontainers.image.source=https://github.com/wyre-technology/clio-mcp
LABEL org.opencontainers.image.description="MCP server for Clio Manage -- matters, contacts, activities, communications, tasks, documents, calendar entries, and bills"
LABEL org.opencontainers.image.licenses="Apache-2.0"
USER mcp
EXPOSE 8080
CMD ["node", "dist/index.js"]
