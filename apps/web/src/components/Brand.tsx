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
