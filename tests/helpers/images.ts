/** The start of a JPEG: just enough for its size to be read. */
export function jpegOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255]);
  return bytes;
}
