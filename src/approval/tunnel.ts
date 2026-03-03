import localtunnel from 'localtunnel';

export interface TunnelInfo {
  url: string;
  close: () => Promise<void>;
}

export async function openTunnel(port: number): Promise<TunnelInfo> {
  const tunnel = await localtunnel({ port });

  tunnel.on('error', (err: Error) => {
    console.error('Tunnel error:', err.message);
  });

  return {
    url: tunnel.url,
    close: async () => {
      tunnel.close();
    },
  };
}
