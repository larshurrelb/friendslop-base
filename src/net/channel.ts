export type Channel = {
  readonly open: boolean;
  readonly bufferedAmount: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onmessage: ((data: string | ArrayBuffer) => void) | null;
  onclose: (() => void) | null;
};
export type ChannelKind = "game" | "voice";

// No early exit based on contents. Tokens are fixed-length ASCII hex strings.
export function safeToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (v) =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[v % 32],
  ).join("");
}
