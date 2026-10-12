import type { ConnectionOptions } from 'node:tls';

export type PostgresTls = 'verify-full' | false | ConnectionOptions;

/** Remote production connections must verify the server's identity. */
export function postgresTlsMode(
  connectionUrl: string,
  production: boolean,
  cloudflare: boolean,
  caCert: string | undefined = process.env.DATABASE_CA_CERT
): PostgresTls {
  const url = new URL(connectionUrl);
  // Hyperdrive's Worker-local endpoint; Hyperdrive itself verifies TLS to the origin.
  if (url.hostname.endsWith('.hyperdrive.local')) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const ssl = url.searchParams.get('sslmode') ?? url.searchParams.get('ssl');
  const explicitTls = !!ssl && !['disable', 'false', '0'].includes(ssl);
  const managedHost = [
    'supabase.co',
    'db.bit.io',
    'postgres.database.azure.com',
    'rds.amazonaws.com',
  ].some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  );
  if (!(explicitTls || (!local && (production || cloudflare || managedHost)))) {
    return false;
  }
  // Railway issues a dedicated per-service CA whose certificate does not name the
  // public proxy host, so a pinned CA replaces hostname verification.
  if (caCert?.trim()) {
    return {
      ca: caCert,
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }
  return 'verify-full';
}
