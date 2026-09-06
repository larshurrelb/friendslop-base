// ICE credentials are intentionally public client configuration.
export function healthConfig() {
  return {
    ok: true,
    ...(process.env.ICE_SERVERS ? { iceServers: JSON.parse(process.env.ICE_SERVERS) } : {}),
  };
}
