import { WEB_ORIGIN } from './web-origin';

export default function imageLoader({
  src,
}: {
  src: string;
  width: number;
  quality?: number;
}) {
  // Remote URLs — pass through unchanged
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  // Local static assets — serve from the web app's deployment
  return `${WEB_ORIGIN}${src}`;
}
