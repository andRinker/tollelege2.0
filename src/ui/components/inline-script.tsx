/** A script that runs while the HTML is parsed, before first paint. */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      // Avoids React's dev warning about <script> tags when the tree re-renders on the client.
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
