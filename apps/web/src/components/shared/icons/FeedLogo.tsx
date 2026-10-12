import { FEED_DOMAIN_PATHS, FEED_WORDMARK_PATHS } from '@feed/shared';
import type { SVGProps } from 'react';
import { FeedMark } from './FeedMark';

/** Peep + the custom feed wordmark, inheriting the surrounding text color. */
export function FeedFullLogo({
  className,
  domain = false,
  ...props
}: SVGProps<SVGSVGElement> & { domain?: boolean }) {
  const letters = domain
    ? [...FEED_WORDMARK_PATHS, ...FEED_DOMAIN_PATHS]
    : FEED_WORDMARK_PATHS;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${domain ? 549 : 353} 108`}
      className={className}
      aria-hidden="true"
      {...props}
    >
      <FeedMark transform="translate(4 9) scale(.88)" />
      <g
        transform="translate(110 8)"
        fill="none"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {letters.map(({ x, d }) => (
          <path key={x} transform={`translate(${x} 0)`} d={d} />
        ))}
        {domain && (
          <circle cx="238" cy="78" r="6" fill="currentColor" stroke="none" />
        )}
      </g>
    </svg>
  );
}
