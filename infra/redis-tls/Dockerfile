# Redis for Cloudflare Workers: TLS-only with a publicly trusted Let's Encrypt
# certificate (DNS-01 via Cloudflare), renewed in place and hot-reloaded.
FROM redis:8.2

ARG LEGO_VERSION=5.5.2
ARG LEGO_SHA256=2a35505089e7772c92e1e9ac144df91151ef2eca8568630db0ff91fca06d9bef

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/lego.tgz "https://github.com/go-acme/lego/releases/download/v${LEGO_VERSION}/lego_v${LEGO_VERSION}_linux_amd64.tar.gz" \
  && echo "${LEGO_SHA256}  /tmp/lego.tgz" | sha256sum -c - \
  && tar -xzf /tmp/lego.tgz -C /usr/local/bin lego \
  && rm /tmp/lego.tgz \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/redis-tls-entrypoint.sh
RUN chmod 0755 /usr/local/bin/redis-tls-entrypoint.sh

EXPOSE 6380
ENTRYPOINT ["/usr/local/bin/redis-tls-entrypoint.sh"]
