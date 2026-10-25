import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import {
  canAccessDistrict,
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
import { inferFacilitySubDistrict } from '@/lib/facility-sub-district';
import type { AssetDisposal, DisposalRequestData } from '@/lib/types';
import { GAUTENG_DISTRICTS } from '@/lib/types';

export const dynamic = 'force-dynamic';

const disposalMethods = [
  'Recycling',
  'Auction',
  'Donation',
  'Destruction',
  'Return to supplier',
  'Other',
] as const;

type DisposalRow = AssetDisposal & RowDataPacket;
type DisposalDirectoryRow = DisposalRow & {
  facility_locality: string | null;
  facility_street_address: string | null;
};
type AssetCustodyRow = {
  id: string;
  district: string;
  sub_district: string | null;
  asset_tag: string;
  asset_name: string;
  facility_name: string;
  status: string;
  custodian_name: string | null;
  persal_number: string | null;
} & RowDataPacket;

function parseDisposalRequest(input: unknown): DisposalRequestData | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.disposal_method !== 'string' ||
    !disposalMethods.includes(value.disposal_method as (typeof disposalMethods)[number]) ||
    typeof value.disposal_reason !== 'string' ||
    value.disposal_reason.trim().length < 10 ||
    value.disposal_reason.trim().length > 4000 ||
    typeof value.disposal_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.disposal_date) ||
    typeof value.reference_number !== 'string' ||
    value.reference_number.trim().length < 3 ||
    value.reference_number.trim().length > 191
  ) {
    return null;
  }
  const [year, month, day] = value.disposal_date.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getTime() > Date.now()
  ) {
    return null;
  }
  return {
    disposal_method: value.disposal_method,
    disposal_reason: value.disposal_reason.trim(),
    disposal_date: value.disposal_date,
    reference_number: value.reference_number.trim(),
  };
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before you can access disposals.' },
      { status: 403 }
    );
  }
  const { searchParams } = new URL(request.url);
  const district = searchParams.get('district')?.trim() ?? '';
  const subDistrict = searchParams.get('subDistrict')?.trim() ?? '';
  const facilityName = searchParams.get('facilityName')?.trim() ?? '';
  if (
    !district ||
    !GAUTENG_DISTRICTS.includes(district as (typeof GAUTENG_DISTRICTS)[number]) ||
    !subDistrict ||
    !facilityName ||
    (subDistrict !== '__unassigned__' && subDistrict.length > 150) ||
    facilityName.length > 255
  ) {
    return NextResponse.json(
      { error: 'Select a district, sub-district, and facility to view disposal requests.' },
      { status: 400 }
    );
  }
  if (!canAccessDistrict(auth.user, district)) {
    return NextResponse.json({ error: 'You cannot access disposal records for that district.' }, { status: 403 });
  }
  try {
    const districtScope =
      isSystemWideAdministrator(auth.user.role) ? null : auth.user.district;
    const selectedDistrict = districtScope ?? district;
    const [disposals] = await getDbPool().execute<DisposalDirectoryRow[]>(
      `SELECT d.*, a.asset_tag, a.asset_name,
        COALESCE(d.district_snapshot, a.district) AS district_snapshot,
        COALESCE(d.sub_district_snapshot, a.sub_district, f.sub_district) AS sub_district_snapshot,
        COALESCE(d.facility_name_snapshot, a.facility_name) AS facility_name,
        f.locality AS facility_locality,
        f.street_address AS facility_street_address,
        COALESCE(d.requester_name_snapshot,
          CONCAT_WS(' ', requester.display_name, requester.surname)) AS requester_name,
        COALESCE(d.requester_persal_number_snapshot, requester.persal_number) AS requester_persal_number,
        COALESCE(d.requester_role_snapshot, requester.role) AS requester_role,
        CASE WHEN d.status = 'Approved' THEN
          COALESCE(d.reviewer_name_snapshot, CONCAT_WS(' ', reviewer.display_name, reviewer.surname))
        END AS approver_name,
        CASE WHEN d.status = 'Approved' THEN
          COALESCE(d.reviewer_persal_number_snapshot, reviewer.persal_number)
        END AS approver_persal_number,
        CASE WHEN d.status = 'Approved' THEN
          COALESCE(d.reviewer_role_snapshot, reviewer.role)
        END AS approver_role,
        CASE WHEN d.status = 'Rejected' THEN
          COALESCE(d.reviewer_name_snapshot, CONCAT_WS(' ', reviewer.display_name, reviewer.surname))
        END AS rejecter_name,
        CASE WHEN d.status = 'Rejected' THEN
          COALESCE(d.reviewer_persal_number_snapshot, reviewer.persal_number)
        END AS rejecter_persal_number,
        CASE WHEN d.status = 'Rejected' THEN
          COALESCE(d.reviewer_role_snapshot, reviewer.role)
        END AS rejecter_role
      FROM health_asset_disposals d
      JOIN health_assets a ON a.id = d.asset_id
      JOIN app_users requester ON requester.id = d.requested_by
      LEFT JOIN app_users reviewer
        ON reviewer.id = COALESCE(d.approved_by, d.rejected_by)
      LEFT JOIN (
        SELECT district, facility_name, MAX(sub_district) AS sub_district,
          MAX(locality) AS locality, MAX(street_address) AS street_address
        FROM health_facilities
        GROUP BY district, facility_name
      ) f ON f.district = COALESCE(d.district_snapshot, a.district)
        AND f.facility_name = COALESCE(d.facility_name_snapshot, a.facility_name)
      WHERE COALESCE(d.district_snapshot, a.district) = ?
        AND COALESCE(d.facility_name_snapshot, a.facility_name) = ?
      ORDER BY d.requested_at DESC`,
      [selectedDistrict, facilityName]
    );
    const matchingDisposals = disposals.filter((disposal) => {
      const resolvedSubDistrict =
        disposal.sub_district_snapshot ??
        inferFacilitySubDistrict(
          district,
          disposal.facility_locality,
          disposal.facility_street_address,
          disposal.facility_name
        );
      return subDistrict === '__unassigned__'
        ? resolvedSubDistrict === null
        : resolvedSubDistrict === subDistrict;
    });
    return NextResponse.json(
      matchingDisposals.map(
        ({ facility_locality, facility_street_address, ...disposal }) => disposal
      )
    );
  } catch (error) {
    console.error('Failed to load asset disposal records:', error);
    return NextResponse.json({ error: 'Unable to load disposal records.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const auth = await requireUser(
    request,
    'super_administrator',
    'asset_manager',
    'supervisor',
    'admin_clerk',
    'chief_director'
  );
  if (auth.response) return auth.response;
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before you can manage disposals.' },
      { status: 403 }
    );
  }

  const parsedRequest = await parseEvidenceRequest(request);
  if (!parsedRequest.ok) {
    return NextResponse.json(
      { error: parsedRequest.error },
      { status: parsedRequest.status }
    );
  }
  const { body } = parsedRequest;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('asset_id' in body) ||
    typeof body.asset_id !== 'string' ||
    !body.asset_id
  ) {
    return NextResponse.json({ error: 'Select an asset for disposal.' }, { status: 400 });
  }
  const data = parseDisposalRequest(body);
  if (!data) {
    return NextResponse.json(
      { error: 'Enter a valid method, reason, completed date, and reference number.' },
      { status: 400 }
    );
  }

  let connection: PoolConnection | undefined;
  try {
    connection = await getDbPool().getConnection();
    await connection.beginTransaction();
    const [assets] = await connection.execute<AssetCustodyRow[]>(
      `SELECT id, district, asset_tag, status, custodian_name, persal_number,
        sub_district, asset_name, facility_name
      FROM health_assets WHERE id = ? FOR UPDATE`,
      [body.asset_id]
    );
    const asset = assets[0];
    if (!asset) {
      await connection.rollback();
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    if (!canAccessDistrict(auth.user, asset.district)) {
      await connection.rollback();
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    if (
      [
        'Lost',
        'Loss Report Pending',
        'Decommission Pending',
        'Disposed',
        'Disposal Pending',
      ].includes(
        asset.status
      )
    ) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'This asset is already in a lost or disposal workflow.' },
        { status: 409 }
      );
    }
    const [openMaintenance] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM health_asset_maintenance_records
      WHERE asset_id = ? AND status = 'Open' LIMIT 1 FOR UPDATE`,
      [asset.id]
    );
    if (openMaintenance.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'Complete the open maintenance record before requesting disposal.' },
        { status: 409 }
      );
    }
    if (!asset.custodian_name) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The asset has no current custodian assignment to release.' },
        { status: 409 }
      );
    }
    const [pending] = await connection.execute<(RowDataPacket & { id: string })[]>(
      `SELECT id FROM health_asset_disposals
      WHERE asset_id = ? AND status = 'Pending' LIMIT 1 FOR UPDATE`,
      [asset.id]
    );
    if (pending.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'A disposal request is already awaiting review.' },
        { status: 409 }
      );
    }

    const disposalId = randomUUID();
    await connection.execute(
      `INSERT INTO health_asset_disposals (
        id, asset_id, former_custodian_name, former_custodian_persal_number,
        disposal_method, disposal_reason, disposal_date, reference_number,
        previous_status, requested_by, requester_name_snapshot,
        requester_persal_number_snapshot, requester_role_snapshot,
        district_snapshot, sub_district_snapshot, facility_name_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        disposalId,
        asset.id,
        asset.custodian_name,
        asset.persal_number,
        data.disposal_method,
        data.disposal_reason,
        data.disposal_date,
        data.reference_number,
        asset.status,
        auth.user.id,
        auth.user.display_name + (auth.user.surname ? ` ${auth.user.surname}` : ''),
        auth.user.persal_number,
        auth.user.role,
        asset.district,
        asset.sub_district,
        asset.facility_name,
      ]
    );
    await insertWorkflowEvidence(
      connection,
      'disposal',
      disposalId,
      'submission',
      parsedRequest.evidence,
      auth.user.id
    );
    await connection.execute(
      `UPDATE health_assets SET status = 'Disposal Pending' WHERE id = ?`,
      [asset.id]
    );
    await connection.commit();
    return NextResponse.json({ id: disposalId, status: 'Pending' }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Failed to submit asset disposal request:', error);
    return NextResponse.json({ error: 'Unable to submit the disposal request.' }, { status: 500 });
  } finally {
    connection?.release();
  }
}
