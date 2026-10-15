import { pwaWorker } from '@/lib/pwa-worker';

export const dynamic = 'force-static';

export function GET() {
  return new Response(pwaWorker(process.env.APP_BUILD_ID || 'dev'), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
