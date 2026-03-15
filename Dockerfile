FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY . .

ENTRYPOINT ["bun"]
CMD ["server.ts"]
