#!/bin/sh
set -e

# Podstawia BACKEND_URL w szablonie nginx i uruchamia serwer.
# Używa unikalnego placeholdera __BACKEND_URL__ zamiast $var, żeby
# nie kolidować ze zmiennymi nginx ($host, $http_upgrade itp.).
BACKEND_URL="${BACKEND_URL:-http://host.docker.internal:8080}"

sed "s|__BACKEND_URL__|${BACKEND_URL}|g" \
    /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "nginx: BACKEND_URL=${BACKEND_URL}"
exec nginx -g "daemon off;"
