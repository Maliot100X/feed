import { FEED_MARK_PATH } from '@feed/shared';
import type { SVGProps } from 'react';

/** Peep's speech-bubble silhouette with transparent eyes. */
export function FeedMark(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <path d={FEED_MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </g>
  );
}
