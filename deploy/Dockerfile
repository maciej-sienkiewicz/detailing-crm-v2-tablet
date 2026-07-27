FROM node:current-alpine AS build-stage

ARG BUILD_DATE
ARG GIT_COMMIT

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production=false

COPY . .

RUN echo "Building tablet with date: ${BUILD_DATE:-unknown}" && \
    npm run build

RUN echo "Build date: ${BUILD_DATE:-$(date)}" > /app/dist/build-info.txt && \
    echo "Git commit: ${GIT_COMMIT:-unknown}" >> /app/dist/build-info.txt

FROM nginx:alpine AS production-stage

COPY --from=build-stage /app/dist /usr/share/nginx/html
# Szablon nginx — BACKEND_URL podstawiany przez entrypoint.sh w chwili startu kontenera
COPY ./deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf.template
COPY ./deploy/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

CMD ["/entrypoint.sh"]
