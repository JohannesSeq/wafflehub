import { createApp, type Bindings } from './app';
import { assets } from './worker-assets';
const app = createApp();
app.get('*', c => {
  const path = new URL(c.req.url).pathname;
  const asset = assets[path] ?? (!path.startsWith('/api/') && !path.split('/').pop()?.includes('.') ? assets['/index.html'] : undefined);
  if (!asset) return c.notFound();
  const bytes = Uint8Array.from(atob(asset.data), char => char.charCodeAt(0));
  return new Response(bytes, { headers: { 'Content-Type': asset.type, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
});
export default { fetch: (request: Request, env: Bindings) => app.fetch(request, env) };
