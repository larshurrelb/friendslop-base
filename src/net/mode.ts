export const DEFAULT_ICE: RTCIceServer[] = [{
  urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
}];
export type NetworkConfig = {
  mode: "server" | "p2p";
  iceServers: RTCIceServer[];
  broker?: { host?: string; port?: number; path?: string; key?: string; secure?: boolean };
};
async function json(url: string) {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export async function detect(params: URLSearchParams): Promise<NetworkConfig> {
  const probe = await json(new URL("healthz", document.baseURI).href);
  const forced = params.get("net");
  const mode = forced === "p2p" || forced === "server"
    ? forced : probe?.ok === true ? "server" : "p2p";
  const config = probe?.ok === true ? probe : await json(new URL("config.json", document.baseURI).href);
  return { mode, iceServers: config?.iceServers ?? DEFAULT_ICE, broker: config?.broker };
}
