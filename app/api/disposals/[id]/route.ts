import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import {
  hasDistrictAssignment,
  isSameOriginRequest,
  requireUser,
} from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import { isSystemWideAdministrator } from '@/lib/roles';
import {
  insertWorkflowEvidence,
  parseEvidenceRequest,
} from '@/lib/workflow-evidence';
import type { AppRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

type DisposalReviewRow = {
  id: string;
  asset_id: string;
  requested_by: string;
  requester_role: AppRole;
  former_custodian_name: string;
  previous_status: string;
  status: 'Pending' | 'Approved' | 'Rejected';
} & RowDataPacket;
type AssetReviewRow = {
  status: string;
  custodian_name: string | null;
} & RowDataPacket;
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
    return NextResponse.json({ error: 'Choose a valid disposal review decision.' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (
    (input.decision !== 'approve' && input.decision !== 'reject') ||
    (input.notes !== undefined &&
      input.notes !== null &&
      (typeof input.notes !== 'string' || input.notes.trim().length > 4000))
  ) {
    return NextResponse.json({ error: 'Choose a valid disposal review decision.' }, { status: 400 });
  }
  const decision = input.decision;
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (decision === 'reject' && notes.length < 10) {
    return NextResponse.json(
      { error: 'Provide at least 10 characters explaining why this request is returned.' },
      { status: 400 }
    );
  }
  const auth = await requireUser(
    request,
    'asset_manager',
    'supervisor',
    'super_administrator',
    'chief_director'
  );
  if (auth.response) return auth.response;
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before you can review disposals.' },
      { status: 403 }
    );
  }
  const districtScope =
    isSystemWideAdministrator(auth.user.role) ? null : auth.user.district;

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [requests] = await connection.execute<DisposalReviewRow[]>(
      `SELECT d.id, d.asset_id, d.requested_by,
        COALESCE(d.requester_role_snapshot, requester.role) AS requester_role,
        d.former_custodian_name, d.previous_status, d.status
      FROM health_asset_disposals d
      JOIN app_users requester ON requester.id = d.requested_by
      JOIN health_assets a ON a.id = d.asset_id
      WHERE d.id = ? ${
        districtScope
          ? 'AND COALESCE(d.district_snapshot, a.district) = ?'
          : ''
      } FOR UPDATE`,
      districtScope ? [id, districtScope] : [id]
    );
    const disposal = requests[0];
    if (!disposal) {
      await connection.rollback();
      return NextResponse.json({ error: 'Disposal request not found.' }, { status: 404 });
    }
    if (disposal.status !== 'Pending') {
      await connection.rollback();
      return NextResponse.json(
        { error: 'This disposal request has already been reviewed.' },
        { status: 409 }
      );
    }
    if (disposal.requested_by === auth.user.id) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The person who requested disposal cannot approve or reject it.' },
        { status: 403 }
      );
    }
    if (
      disposal.requester_role === 'admin_clerk' &&
      auth.user.role !== 'supervisor' &&
      auth.user.role !== 'asset_manager' &&
      !isSystemWideAdministrator(auth.user.role)
    ) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'Disposal requests submitted by an Admin Clerk must be reviewed by a Supervisor or Asset Manager.' },
        { status: 403 }
      );
    }
    const [assets] = await connection.execute<AssetReviewRow[]>(
      'SELECT status, custodian_name FROM health_assets WHERE id = ? FOR UPDATE',
      [disposal.asset_id]
    );
    const asset = assets[0];
    if (!asset || asset.status !== 'Disposal Pending') {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The asset no longer matches this pending disposal request.' },
        { status: 409 }
      );
    }

    if (decision === 'approve') {
      if (asset.custodian_name !== disposal.former_custodian_name) {
        await connection.rollback();
        return NextResponse.json(
          { error: 'The custodian assignment changed; review the asset before approving.' },
          { status: 409 }
        );
      }
      await connection.execute(
        `UPDATE health_asset_disposals SET status = 'Approved',
          approved_by = ?, approved_at = UTC_TIMESTAMP(), approver_notes = ?,
          reviewer_name_snapshot = ?, reviewer_persal_number_snapshot = ?,
          reviewer_role_snapshot = ?
        WHERE id = ?`,
        [
          auth.user.id,
          notes || null,
          auth.user.display_name + (auth.user.surname ? ` ${auth.user.surname}` : ''),
          auth.user.persal_number,
          auth.user.role,
          disposal.id,
        ]
      );
      await connection.execute(
        `UPDATE health_assets SET status = 'Disposed', custodian_name = NULL,
          persal_number = NULL
        WHERE id = ?`,
        [disposal.asset_id]
      );
    } else {
      await connection.execute(
        `UPDATE health_asset_disposals SET status = 'Rejected',
          rejected_by = ?, rejected_at = UTC_TIMESTAMP(), approver_notes = ?,
          reviewer_name_snapshot = ?, reviewer_persal_number_snapshot = ?,
          reviewer_role_snapshot = ?
        WHERE id = ?`,
        [
          auth.user.id,
          notes,
          auth.user.display_name + (auth.user.surname ? ` ${auth.user.surname}` : ''),
          auth.user.persal_number,
          auth.user.role,
          disposal.id,
        ]
      );
      await connection.execute(
        'UPDATE health_assets SET status = ? WHERE id = ?',
        [disposal.previous_status, disposal.asset_id]
      );
    }

    await insertWorkflowEvidence(
      connection,
      'disposal',
      disposal.id,
      'review',
      parsedRequest.evidence,
      auth.user.id
    );
    await connection.commit();
    return NextResponse.json({ success: true, status: decision === 'approve' ? 'Approved' : 'Rejected' });
  } catch (error) {
    await connection.rollback();
    console.error('Failed to review asset disposal:', error);
    return NextResponse.json({ error: 'Unable to review this disposal request.' }, { status: 500 });
  } finally {
    connection.release();
  }
}
