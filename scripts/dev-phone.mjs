// Runs the dev server over HTTPS on this machine's LAN address, so a phone on the same
// wifi can reach it. Camera APIs need a secure context, and a plain http:// LAN address
// is not one — which is why `npm run dev` works on the desktop but not on a phone.
//
// The certificate only covers the hostname the server is started with, so the LAN IP is
// passed explicitly with -H. BETTER_AUTH_URL has to match that origin too, or sign-in
// redirects bounce back to localhost and fail on the phone.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

const host = lanAddress();
if (!host) {
  console.error("No wifi or ethernet address found — is this machine on a network?");
  process.exit(1);
}

const origin = `https://${host}:${PORT}`;
console.log(`\n  Open this on your phone (same wifi):\n\n    ${origin}\n`);
console.log("  Your phone will warn that the certificate isn't trusted.");
console.log("  That is expected: tap Advanced, then Proceed.\n");

const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--experimental-https",
    "-H",
    host,
    "-p",
    PORT,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, BETTER_AUTH_URL: origin },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
