/**
 * Cloudflare server build only: @elizaos/core's Node bundle loads `process`
 * through `createRequire(import.meta.url)`, which workerd cannot resolve
 * ("No such module node:process"). Workers expose `process` as a global
 * under nodejs_compat, so use it directly.
 */
module.exports = function elizaosProcessLoader(source) {
  return source.replaceAll('__require("process")', 'globalThis.process');
};
