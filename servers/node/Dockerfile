# Build from the repo root:  docker build -f servers/node/Dockerfile -t site-review .
# Run:  docker run -p 8787:8787 -e REVIEW_PASSCODE=secret -v review-data:/app/data site-review
FROM node:22-alpine
WORKDIR /app
COPY servers/node/server.js servers/node/package.json ./
COPY client/review.js client/review.css ./
COPY demo/index.html ./
ENV PORT=8787 DATA_FILE=/app/data/review.json
EXPOSE 8787
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "server.js"]
