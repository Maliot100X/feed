/**
 * Alias of `/.well-known/agent-card.json` for clients that omit the extension.
 * Shares the canonical handler so headers (incl. CORS) stay identical.
 */
export { GET } from '../agent-card.json/route';

export const dynamic = 'force-dynamic';
