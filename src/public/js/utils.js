// Utility functions

// NanoID implementation (URL-safe, 21 chars default)
export function nanoid(size = 21) {
  const urlAlphabet =
    "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (let i = 0; i < size; i++) {
    id += urlAlphabet[bytes[i] % 64];
  }
  return id;
}
