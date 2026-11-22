// Message text: fragments in backticks show as code.
export function Rich({ text }: { text: string }) {
  return (
    <>{text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>))}</>
  );
}
