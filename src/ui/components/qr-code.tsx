import qrcode from "qrcode-generator";
import { cx } from "@/ui/cx";

/** Four modules of white on every side, which decoders need to find the code at all. */
const QUIET_ZONE = 4;

type QrCodeProps = {
  value: string;
  /** Rendered size in pixels. The SVG itself is resolution-independent. */
  size?: number;
  label: string;
  className?: string;
};

/**
 * A QR code as inline SVG. A pure function of its props, so it renders wherever it's
 * used and never puts the value into an image request that a proxy or log could keep.
 *
 * Deliberately black on white rather than theme tokens: this is a target for a camera,
 * not a piece of chrome, and a low-contrast or inverted code is one a phone squints at
 * in a dim classroom. It sits on its own white card in both light and dark mode.
 */
export function QrCode({ value, size = 224, label, className }: QrCodeProps) {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();

  const modules = code.getModuleCount();
  const span = modules + QUIET_ZONE * 2;
  const offset = QUIET_ZONE;

  let path = "";
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (code.isDark(row, column)) path += `M${column + offset} ${row + offset}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cx("rounded-lg", className)}
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
