import { NextResponse } from 'next/server';
import { serverConfig } from '../../../server/config';

/**
 * Readiness: will check Neon + Upstash reachability once Phase 4 wires
 * persistence in. Until then it confirms the typed config module (§2.6)
 * loads and parses successfully — there is nothing downstream yet for
 * this route to be "not ready" for.
 */
export function GET() {
  return NextResponse.json({ status: 'ok', env: serverConfig.NODE_ENV });
}
