# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
# Cloud Run injects PORT (default 8080); nginx's envsubst renders it into the config.
ENV PORT=8080
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/docker-entrypoint.sh /docker-entrypoint.d/40-app-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
