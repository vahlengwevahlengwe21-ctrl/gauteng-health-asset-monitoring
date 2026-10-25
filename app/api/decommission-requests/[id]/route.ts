import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import {
  canAccessDistrict,
  hasDistrictAssignment,
  isSameOriginRequest,
  requireUser,
} from '@/lib/auth';
import { recordAssetAudit } from '@/lib/asset-audit';
import { getDbPool } from '@/lib/db';
import {
  insertWorkflowEvidence,
  parseEvidenceRequest,
} from '@/lib/workflow-evidence';
import type { AssetDecommissionRequest, HealthAsset } from '@/lib/types';
import { isSystemWideAdministrator } from '@/lib/roles';

export const dynamic = 'force-dynamic';

type DecommissionRequestRow = Pick<
  AssetDecommissionRequest,
  'id' | 'asset_id' | 'requested_by' | 'previous_status' | 'status' | 'district_snapshot'
> &
  RowDataPacket;
type AssetRow = HealthAsset & RowDataPacket;
type RouteContext = { params: Promise<{ id: string }> };

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
    return NextResponse.json({ error: 'Choose a valid decommission review decision.' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const decision = input.decision;
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (
    (decision !== 'approve' && decision !== 'reject') ||
    (input.notes !== undefined &&
      input.notes !== null &&
      (typeof input.notes !== 'string' || input.notes.trim().length > 4000))
  ) {
    return NextResponse.json({ error: 'Choose a valid decommission review decision.' }, { status: 400 });
  }
  if (decision === 'reject' && notes.length < 10) {
    return NextResponse.json(
      { error: 'Provide at least 10 characters explaining why this request is returned.' },
      { status: 400 }
    );
  }

  const auth = await requireUser(
    request,
    'super_administrator',
    'asset_manager',
    'supervisor',
    'chief_director'
  );
  if (auth.response) return auth.response;
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before reviewing decommission requests.' },
      { status: 403 }
    );
  }
  const districtScope =
    isSystemWideAdministrator(auth.user.role) ? null : auth.user.district;
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [requests] = await connection.execute<DecommissionRequestRow[]>(
      `SELECT id, asset_id, requested_by, previous_status, status, district_snapshot
      FROM health_asset_decommission_requests
      WHERE id = ? ${districtScope ? 'AND district_snapshot = ?' : ''}
      FOR UPDATE`,
      districtScope ? [id, districtScope] : [id]
    );
    const decommissionRequest = requests[0];
    if (
      !decommissionRequest ||
      !canAccessDistrict(auth.user, decommissionRequest.district_snapshot)
    ) {
      await connection.rollback();
      return NextResponse.json({ error: 'Decommission request not found.' }, { status: 404 });
    }
    if (decommissionRequest.status !== 'Pending') {
      await connection.rollback();
      return NextResponse.json(
        { error: 'This decommission request has already been reviewed.' },
        { status: 409 }
      );
    }
    if (decommissionRequest.requested_by === auth.user.id) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The person who requested decommissioning cannot approve or reject it.' },
        { status: 403 }
      );
    }
    const [assets] = await connection.execute<AssetRow[]>(
      'SELECT * FROM health_assets WHERE id = ? FOR UPDATE',
      [decommissionRequest.asset_id]
    );
    const asset = assets[0];
    if (!asset || asset.status !== 'Decommission Pending') {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The asset no longer matches this pending decommission request.' },
        { status: 409 }
      );
    }

    const reviewerName =
      `${auth.user.display_name}${auth.user.surname ? ` ${auth.user.surname}` : ''}`;
    await connection.execute(
      `UPDATE health_asset_decommission_requests SET status = ?,
        reviewed_by = ?, reviewer_name_snapshot = ?,
        reviewer_persal_number_snapshot = ?, reviewer_role_snapshot = ?,
        reviewed_at = UTC_TIMESTAMP(), review_notes = ?
      WHERE id = ?`,
      [
        decision === 'approve' ? 'Approved' : 'Rejected',
        auth.user.id,
        reviewerName,
        auth.user.persal_number,
        auth.user.role,
        notes || null,
        decommissionRequest.id,
      ]
    );
    await connection.execute(
      'UPDATE health_assets SET status = ? WHERE id = ?',
      [decision === 'approve' ? 'Decommissioned' : decommissionRequest.previous_status, asset.id]
    );
    await insertWorkflowEvidence(
      connection,
      'decommission',
      decommissionRequest.id,
      'review',
      parsedRequest.evidence,
      auth.user.id
    );
    const [updatedAssets] = await connection.execute<AssetRow[]>(
      'SELECT * FROM health_assets WHERE id = ?',
      [asset.id]
    );
    if (!updatedAssets[0]) throw new Error('Updated asset could not be reloaded for audit.');
    await recordAssetAudit(
      connection,
      updatedAssets[0],
      'updated',
      auth.user.id,
      asset,
      updatedAssets[0]
    );
    await connection.commit();
    return NextResponse.json({
      success: true,
      status: decision === 'approve' ? 'Approved' : 'Rejected',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Failed to review decommission request:', error);
    return NextResponse.json(
      { error: 'Unable to review the decommission request.' },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
