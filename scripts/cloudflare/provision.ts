#!/usr/bin/env bun
const environment = process.argv[2];
if (environment !== 'staging' && environment !== 'production')
  throw new Error('Specify staging or production');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token)
  throw new Error(
    'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required'
  );

interface ApiResult<T> {
  success: boolean;
  result: T;
  result_info?: { total_pages?: number };
}
async function api<T>(path: string, body?: object): Promise<ApiResult<T>> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  // Do not print response bodies: provisioning errors can include credentials.
  if (!response.ok)
    throw new Error(`Cloudflare ${path} returned HTTP ${response.status}`);
  const result = (await response.json()) as ApiResult<T>;
  if (!result.success) throw new Error(`Cloudflare ${path} failed`);
  return result;
}
const buckets = (await api<{ buckets: Array<{ name: string }> }>('r2/buckets'))
  .result.buckets;
for (const name of [
  `feed-next-cache-${environment}`,
  `feed-uploads-${environment}`,
  `feed-training-${environment}`,
]) {
  if (!buckets.some((bucket) => bucket.name === name))
    await api('r2/buckets', { name });
  console.info(`R2 bucket ready: ${name}`);
}
const queues: Array<{ queue_name: string }> = [];
for (let page = 1; ; page++) {
  const result = await api<Array<{ queue_name: string }>>(
    `queues?page=${page}&per_page=100`
  );
  queues.push(...result.result);
  if (page >= (result.result_info?.total_pages ?? 1)) break;
}
for (const queue_name of [
  `feed-cron-${environment}`,
  `feed-cron-${environment}-failed`,
]) {
  if (!queues.some((queue) => queue.queue_name === queue_name))
    await api('queues', { queue_name });
  console.info(`Queue ready: ${queue_name}`);
}
