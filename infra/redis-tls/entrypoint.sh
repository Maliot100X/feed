#!/bin/sh
# Required: REDIS_PASSWORD, REDIS_TLS_DOMAIN, CLOUDFLARE_DNS_API_TOKEN (DNS:Edit on the zone), ACME_EMAIL.
set -eu
: "${REDIS_PASSWORD:?}" "${REDIS_TLS_DOMAIN:?}" "${CLOUDFLARE_DNS_API_TOKEN:?}" "${ACME_EMAIL:?}"

DATA="${RAILWAY_VOLUME_MOUNT_PATH:-/data}"
LEGO_PATH="$DATA/lego"
CERT="$LEGO_PATH/certificates/$REDIS_TLS_DOMAIN.crt"
KEY="$LEGO_PATH/certificates/$REDIS_TLS_DOMAIN.key"
SOCKET=/tmp/redis.sock
rm -rf "$DATA/lost+found"

issue() {
  CF_DNS_API_TOKEN="$CLOUDFLARE_DNS_API_TOKEN" lego run --accept-tos \
    --email "$ACME_EMAIL" --dns cloudflare --dns.propagation.wait 45s \
    --domains "$REDIS_TLS_DOMAIN" --path "$LEGO_PATH" --log.format text "$@"
}

# A failed DNS-01 attempt leaves a cached challenge TXT record; wait out its TTL before retrying.
attempt=1
until issue; do
  if [ "$attempt" -ge 5 ]; then
    echo "certificate issuance failed after $attempt attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 180
done
# lego writes root-only files; redis-server drops privileges to the redis user.
chown -R redis:redis "$LEGO_PATH"

# Renew daily; lego only replaces the files when renewal is due, and Redis re-reads them on CONFIG SET.
(
  while sleep 86400; do
    if issue --no-random-sleep; then
      chown -R redis:redis "$LEGO_PATH"
      REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -s "$SOCKET" \
        CONFIG SET tls-cert-file "$CERT" tls-key-file "$KEY" >/dev/null \
        || echo "TLS certificate reload failed" >&2
    else
      echo "certificate renewal attempt failed" >&2
    fi
  done
) &

exec docker-entrypoint.sh redis-server \
  --port 0 \
  --tls-port 6380 \
  --tls-cert-file "$CERT" \
  --tls-key-file "$KEY" \
  --tls-auth-clients no \
  --unixsocket "$SOCKET" \
  --unixsocketperm 700 \
  --requirepass "$REDIS_PASSWORD" \
  --save 60 1 \
  --dir "$DATA"
