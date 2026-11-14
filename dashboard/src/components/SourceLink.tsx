import { hostOf } from "../lib/format";

/** A cited source: a link when it is a URL, plain text when the engine stored a note instead. */
export default function SourceLink({ src }: { src: string }) {
  const host = hostOf(src);
  if (!host) return <>{src}</>;
  return (
    <a href={src} target="_blank" rel="noreferrer">
      {host}
    </a>
  );
}
