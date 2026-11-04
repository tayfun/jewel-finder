/** The "Stock & List" wordmark: the ampersand in the logo's coral, slightly tilted. */
export function Wordmark() {
  return (
    <span className="wordmark">
      Stock<span className="amp">&amp;</span>List
    </span>
  );
}

/** Logo mark plus wordmark, as used in headers. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <>
      <img src="/favicon.svg" alt="" width={size} height={size} className="logo-mark" />
      <Wordmark />
    </>
  );
}

/** Three cards, like the logo; they fan out when their button is hovered. */
export function FanIcon() {
  return (
    <svg className="fan-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect x="6" y="3" width="8" height="13" rx="2" fill="#b9a2ff" />
      <rect x="6" y="3" width="8" height="13" rx="2" fill="#ffc53d" />
      <rect x="6" y="3" width="8" height="13" rx="2" fill="#ff6b57" />
    </svg>
  );
}
