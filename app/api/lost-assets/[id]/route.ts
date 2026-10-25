import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { canAccessDistrict, hasDistrictAssignment, isSameOriginRequest, requireUser } from '@/lib/auth';
import { recordAssetAudit } from '@/lib/asset-audit';
import { getDbPool } from '@/lib/db';
import {
  insertWorkflowEvidence,
  parseEvidenceRequest,
} from '@/lib/workflow-evidence';
import type { HealthAsset } from '@/lib/types';
import { isSystemWideAdministrator } from '@/lib/roles';

export const dynamic = 'force-dynamic';

type LossReportRow = {
  id: string;
  asset_id: string;
  requested_by: string;
  previous_status: string;
  status: 'Pending' | 'Confirmed Lost' | 'Recovered' | 'Rejected';
  district_snapshot: string;
} & RowDataPacket;
type AssetRow = HealthAsset & RowDataPacket;
type RouteContext = { params: Promise<{ id: string }> };
type ReviewDecision = 'approve' | 'reject' | 'recover';

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const parsedRequest = await parseEvidenceRequest(request);
  if (!parsedRequest.ok) {
    return NextResponse.json(
      { error: parsedRequest.error },
      { status: parsedRequest.status }
    );
  }
  const { body } = parsedRequest;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Choose a valid lost-asset action.' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const decision = input.decision;
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (
    !['approve', 'reject', 'recover'].includes(String(decision)) ||
    (input.notes !== undefined &&
      input.notes !== null &&
      (typeof input.notes !== 'string' || input.notes.trim().length > 4000))
  ) {
    return NextResponse.json({ error: 'Choose a valid lost-asset action.' }, { status: 400 });
  }
  if (
    (decision === 'reject' || decision === 'recover') &&
    notes.length < 10
  ) {
    return NextResponse.json(
      { error: 'Provide at least 10 characters explaining the decision.' },
      { status: 400 }
    );
  }

  const auth = await requireUser(
    request,
    'super_administrator',
    'asset_manager',
    'supervisor'
  );
  if (auth.response) return auth.response;
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before you can review lost-asset reports.' },
      { status: 403 }
    );
  }
  const districtScope =
    isSystemWideAdministrator(auth.user.role) ? null : auth.user.district;
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [reports] = await connection.execute<LossReportRow[]>(
      `SELECT id, asset_id, requested_by, previous_status, status, district_snapshot
      FROM health_asset_loss_reports
      WHERE id = ? ${districtScope ? 'AND district_snapshot = ?' : ''}
      FOR UPDATE`,
      districtScope ? [id, districtScope] : [id]
    );
    const report = reports[0];
    if (!report || !canAccessDistrict(auth.user, report.district_snapshot)) {
      await connection.rollback();
      return NextResponse.json({ error: 'Lost-asset report not found.' }, { status: 404 });
    }
    const expectedStatus = decision === 'recover' ? 'Confirmed Lost' : 'Pending';
    if (report.status !== expectedStatus) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'This lost-asset report has already changed and must be refreshed.' },
        { status: 409 }
      );
    }
    if (decision !== 'recover' && report.requested_by === auth.user.id) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The person who reported the asset cannot approve or reject that report.' },
        { status: 403 }
      );
    }
    const [assets] = await connection.execute<AssetRow[]>(
      'SELECT * FROM health_assets WHERE id = ? FOR UPDATE',
      [report.asset_id]
    );
    const asset = assets[0];
    const requiredAssetStatus =
      decision === 'recover' ? 'Lost' : 'Loss Report Pending';
    if (!asset || asset.status !== requiredAssetStatus) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The asset no longer matches this lost-asset report.' },
        { status: 409 }
      );
    }

    const reviewerName = `${auth.user.display_name}${auth.user.surname ? ` ${auth.user.surname}` : ''}`;
    if (decision === 'approve') {
      await connection.execute(
        `UPDATE health_asset_loss_reports SET status = 'Confirmed Lost',
          reviewed_by = ?, reviewer_name_snapshot = ?,
          reviewer_persal_number_snapshot = ?, reviewer_role_snapshot = ?,
          reviewed_at = UTC_TIMESTAMP(), review_notes = ?
        WHERE id = ?`,
        [
          auth.user.id,
          reviewerName,
          auth.user.persal_number,
          auth.user.role,
          notes || null,
          report.id,
        ]
      );
      await connection.execute(
        `UPDATE health_assets SET status = 'Lost' WHERE id = ?`,
        [asset.id]
      );
    } else if (decision === 'reject') {
      await connection.execute(
        `UPDATE health_asset_loss_reports SET status = 'Rejected',
          reviewed_by = ?, reviewer_name_snapshot = ?,
          reviewer_persal_number_snapshot = ?, reviewer_role_snapshot = ?,
          reviewed_at = UTC_TIMESTAMP(), review_notes = ?
        WHERE id = ?`,
        [
          auth.user.id,
          reviewerName,
          auth.user.persal_number,
          auth.user.role,
          notes,
          report.id,
        ]
      );
      await connection.execute(
        'UPDATE health_assets SET status = ? WHERE id = ?',
        [report.previous_status, asset.id]
      );
    } else {
      await connection.execute(
        `UPDATE health_asset_loss_reports SET status = 'Recovered',
          recovered_by = ?, recoverer_name_snapshot = ?,
          recoverer_persal_number_snapshot = ?, recovered_at = UTC_TIMESTAMP(),
          recovery_notes = ?
        WHERE id = ?`,
        [auth.user.id, reviewerName, auth.user.persal_number, notes, report.id]
      );
      await connection.execute(
        'UPDATE health_assets SET status = ? WHERE id = ?',
        [report.previous_status, asset.id]
      );
    }

    const [updatedAssets] = await connection.execute<AssetRow[]>(
      'SELECT * FROM health_assets WHERE id = ?',
      [asset.id]
    );
    if (!updatedAssets[0]) throw new Error('Updated asset could not be reloaded for audit.');
    await insertWorkflowEvidence(
      connection,
      'lost',
      report.id,
      decision === 'recover' ? 'recovery' : 'review',
      parsedRequest.evidence,
      auth.user.id
    );
    await recordAssetAudit(
      connection,
      updatedAssets[0],
      'updated',
      auth.user.id,
      asset,
      updatedAssets[0]
    );
    await connection.commit();
    const status =
      decision === 'approve'
        ? 'Confirmed Lost'
        : decision === 'reject'
          ? 'Rejected'
          : 'Recovered';
    return NextResponse.json({ success: true, status });
  } catch (error) {
    await connection.rollback();
    console.error('Failed to update lost-asset report:', error);
    return NextResponse.json({ error: 'Unable to update the lost-asset report.' }, { status: 500 });
  } finally {
    connection.release();
  }
}
