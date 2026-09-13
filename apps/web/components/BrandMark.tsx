import { brandPaths } from "@axiom/shared/brand";

/** Decorative beside the wordmark or an already-named navigation control. */
export default function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg
        viewBox="0 0 48 48"
        focusable="false"
        data-brand="connected-knowledge"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {brandPaths.map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>
        <circle cx="24" cy="25" r="3.8" fill="currentColor" />
      </svg>
    </span>
  );
}
