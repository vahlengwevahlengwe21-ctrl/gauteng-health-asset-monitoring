import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await getDbPool().query('SELECT 1 AS healthy', { timeout: 5000 });
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Database health check failed:', error);
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
