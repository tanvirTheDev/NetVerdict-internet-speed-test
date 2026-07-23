import { NextResponse } from 'next/server';

/** Liveness only — confirms the process is up and serving requests. */
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
