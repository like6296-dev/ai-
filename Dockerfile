FROM node:22-alpine
RUN apk add --no-cache tar iputils-ping iproute2
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV PORT=3000 DATA_DIR=/data HOST=0.0.0.0
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
