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
import { recordAssetAudit } from '@/lib/asset-audit';
import { getDbPool } from '@/lib/db';
import { isSystemWideAdministrator } from '@/lib/roles';
import { parseEvidenceRequest } from '@/lib/workflow-evidence';
import type {
  AssetLifespanExtensionData,
  AssetOperationHistoryEntry,
  AssetOperationType,
  AssetTransferData,
  AssetVerificationData,
  HealthAsset,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

type AssetRow = HealthAsset & RowDataPacket;
type HistoryRow = AssetOperationHistoryEntry & RowDataPacket;
type DateRow = { new_end_date: string } & RowDataPacket;
const operationTypes: AssetOperationType[] = [
  'transfer',
  'verification',
  'lifespan_extension',
];
const conditions = ['Excellent', 'Good', 'Fair', 'Poor', 'Damaged'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.trim().length <= maxLength;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function historyTable(type: AssetOperationType): string {
  switch (type) {
    case 'transfer':
      return `SELECT id, 'transfer' AS operation_type, asset_id,
        asset_tag_snapshot, asset_name_snapshot,
        CONCAT(former_custodian_name, ' → ', new_custodian_name,
          ' (PERSAL ', new_custodian_persal_number, ') — ', reason) AS summary,
        evidence_file_name, transferer_name_snapshot AS actor_name,
        transferer_persal_number_snapshot AS actor_persal_number,
        created_at AS occurred_at
        FROM health_asset_transfers WHERE district_snapshot = ?`;
    case 'verification':
      return `SELECT id, 'verification' AS operation_type, asset_id,
        asset_tag_snapshot, asset_name_snapshot,
        CONCAT(IF(found = 1, 'Found', 'Not found'), ' — ', observed_condition,
          ' — ', observed_location,
          IF(custodian_confirmed = 1, ' — custodian confirmed', ' — custodian not confirmed'),
          IF(notes IS NULL OR notes = '', '', CONCAT(' — ', notes))) AS summary,
        evidence_file_name, verifier_name_snapshot AS actor_name,
        verifier_persal_number_snapshot AS actor_persal_number,
        verified_at AS occurred_at
        FROM health_asset_verifications WHERE district_snapshot = ?`;
    case 'lifespan_extension':
      return `SELECT id, 'lifespan_extension' AS operation_type, asset_id,
        asset_tag_snapshot, asset_name_snapshot,
        CONCAT(extension_months, ' months added after ', inspected_condition,
          ' inspection (', DATE_FORMAT(previous_end_date, '%Y-%m-%d'),
          ' → ', DATE_FORMAT(new_end_date, '%Y-%m-%d'), ') — ', reason) AS summary,
        evidence_file_name, extender_name_snapshot AS actor_name,
        extender_persal_number_snapshot AS actor_persal_number,
        created_at AS occurred_at
        FROM health_asset_lifespan_extensions WHERE district_snapshot = ?`;
  }
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before viewing asset operations.' },
      { status: 403 }
    );
  }

  const params = new URL(request.url).searchParams;
  const type = params.get('type') as AssetOperationType | null;
  const limit = Number(params.get('limit') ?? 50);
  const offset = Number(params.get('offset') ?? 0);
  if (
    !type ||
    !operationTypes.includes(type) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return NextResponse.json({ error: 'Invalid asset operation history request.' }, { status: 400 });
  }

  try {
    const district = isSystemWideAdministrator(auth.user.role)
      ? null
      : auth.user.district;
    const sql = historyTable(type);
    const [rows] = district
      ? await getDbPool().execute<HistoryRow[]>(
          `${sql} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
          [district, limit, offset]
        )
      : await getDbPool().query<HistoryRow[]>(
          `${sql.replace('WHERE district_snapshot = ?', '')} ORDER BY occurred_at DESC LIMIT ${limit} OFFSET ${offset}`
        );
    return NextResponse.json({ entries: rows });
  } catch (error) {
    console.error('Failed to load asset operation history:', error);
    return NextResponse.json(
      { error: 'Unable to load asset operation history.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const auth = await requireUser(
    request,
    'asset_manager',
    'supervisor',
    'admin_clerk',
    'chief_director'
  );
  if (auth.response) return auth.response;

  const parsed = await parseEvidenceRequest(request, 'operation');
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const body = parsed.body;
  if (!isRecord(body) || typeof body.asset_id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(body.asset_id) ||
      typeof body.type !== 'string' ||
      !operationTypes.includes(body.type as AssetOperationType) ||
      !isRecord(body.data)) {
    return NextResponse.json({ error: 'Invalid asset operation details.' }, { status: 400 });
  }
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before managing asset operations.' },
      { status: 403 }
    );
  }
  const type = body.type as AssetOperationType;
  if (type === 'lifespan_extension' && auth.user.role !== 'admin_clerk') {
    return NextResponse.json(
      { error: 'Only an Admin Clerk can extend an asset lifespan after inspection.' },
      { status: 403 }
    );
  }

  const rawData = body.data;
  let transferData: AssetTransferData | null = null;
  let verificationData: AssetVerificationData | null = null;
  let extensionData: AssetLifespanExtensionData | null = null;
  if (type === 'transfer') {
    if (
      !text(rawData.new_custodian_name, 255) ||
      typeof rawData.new_custodian_persal_number !== 'string' ||
      !/^\d{8}$/.test(rawData.new_custodian_persal_number) ||
      !validDate(rawData.transfer_date) ||
      !text(rawData.reason, 2000)
    ) {
      return NextResponse.json({ error: 'Complete all required asset operation details.' }, { status: 400 });
    }
    transferData = {
      new_custodian_name: rawData.new_custodian_name.trim(),
      new_custodian_persal_number: rawData.new_custodian_persal_number,
      transfer_date: rawData.transfer_date,
      reason: rawData.reason.trim(),
    };
  } else if (type === 'verification') {
    const hasCustodianDetails = [
      rawData.verified_custodian_name,
      rawData.verified_custodian_persal_number,
    ].some((value) => typeof value === 'string' && value.trim().length > 0);
    const correctCustodian = auth.user.role === 'admin_clerk' &&
      rawData.found === true && rawData.custodian_confirmed === false;
    if (
      typeof rawData.found !== 'boolean' ||
      typeof rawData.custodian_confirmed !== 'boolean' ||
      typeof rawData.observed_condition !== 'string' ||
      !conditions.includes(rawData.observed_condition) ||
      !text(rawData.observed_location, 255) ||
      (rawData.notes !== '' && rawData.notes !== null && !text(rawData.notes, 2000)) ||
      (hasCustodianDetails && !correctCustodian) ||
      (correctCustodian && (
        !text(rawData.verified_custodian_name, 255) ||
        typeof rawData.verified_custodian_persal_number !== 'string' ||
        !/^\d{8}$/.test(rawData.verified_custodian_persal_number)
      ))
    ) {
      return NextResponse.json({ error: 'Complete all required asset operation details.' }, { status: 400 });
    }
    verificationData = {
      found: rawData.found,
      custodian_confirmed: rawData.custodian_confirmed,
      observed_condition: rawData.observed_condition,
      observed_location: rawData.observed_location.trim(),
      ...(correctCustodian ? {
        verified_custodian_name: (rawData.verified_custodian_name as string).trim(),
        verified_custodian_persal_number: rawData.verified_custodian_persal_number as string,
      } : {}),
      notes: typeof rawData.notes === 'string' ? rawData.notes.trim() : '',
    };
  } else {
    if (
      typeof rawData.extension_months !== 'number' ||
      !Number.isInteger(rawData.extension_months) ||
      rawData.extension_months < 1 ||
      rawData.extension_months > 1200 ||
      (rawData.inspected_condition !== 'Excellent' && rawData.inspected_condition !== 'Good') ||
      !text(rawData.reason, 2000)
    ) {
      return NextResponse.json({ error: 'Complete all required asset operation details.' }, { status: 400 });
    }
    extensionData = {
      extension_months: rawData.extension_months,
      inspected_condition: rawData.inspected_condition,
      reason: rawData.reason.trim(),
    };
  }

  let connection: PoolConnection | undefined;
  try {
    connection = await getDbPool().getConnection();
    await connection.beginTransaction();
    const [assets] = await connection.execute<AssetRow[]>(
      'SELECT * FROM health_assets WHERE id = ? FOR UPDATE',
      [body.asset_id]
    );
    const asset = assets[0];
    if (!asset || !canAccessDistrict(auth.user, asset.district)) {
      await connection.rollback();
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    const forbiddenStatuses = [
      'Lost',
      'Loss Report Pending',
      'Decommission Pending',
      'Decommissioned',
      'Disposal Pending',
      'Disposed',
    ];
    if (forbiddenStatuses.includes(asset.status)) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'This asset cannot be changed through an asset operation while in its current workflow.' },
        { status: 409 }
      );
    }

    const id = randomUUID();
    const evidence = parsed.evidence;
    const actor = [
      auth.user.id,
      auth.user.display_name,
      auth.user.persal_number,
      auth.user.role,
      evidence.fileName,
      evidence.fileSize,
      evidence.fileContent,
    ];

    if (type === 'transfer' && transferData) {
      if (
        asset.status !== 'Active' ||
        !asset.custodian_name ||
        asset.persal_number === transferData.new_custodian_persal_number ||
        new Date(`${transferData.transfer_date}T00:00:00Z`) > new Date()
      ) {
        await connection.rollback();
        return NextResponse.json(
          { error: 'Transfers require an Active asset with a current custodian, a different PERSAL number, and a date no later than today.' },
          { status: 409 }
        );
      }
      await connection.execute(
        `INSERT INTO health_asset_transfers (
          id, asset_id, asset_tag_snapshot, asset_name_snapshot,
          former_custodian_name, former_custodian_persal_number,
          new_custodian_name, new_custodian_persal_number, transfer_date,
          reason, district_snapshot, sub_district_snapshot,
          facility_name_snapshot, transferred_by, transferer_name_snapshot,
          transferer_persal_number_snapshot, transferer_role_snapshot,
          evidence_file_name, evidence_file_size, evidence_file_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, asset.id, asset.asset_tag, asset.asset_name,
          asset.custodian_name, asset.persal_number,
          transferData.new_custodian_name, transferData.new_custodian_persal_number,
          transferData.transfer_date, transferData.reason, asset.district,
          asset.sub_district, asset.facility_name, ...actor,
        ]
      );
      await connection.execute(
        'UPDATE health_assets SET custodian_name = ?, persal_number = ? WHERE id = ?',
        [transferData.new_custodian_name, transferData.new_custodian_persal_number, asset.id]
      );
    } else if (type === 'verification' && verificationData) {
      if (asset.status !== 'Active' && asset.status !== 'In Maintenance') {
        await connection.rollback();
        return NextResponse.json(
          { error: 'Only active or in-maintenance assets can be physically verified.' },
          { status: 409 }
        );
      }
      if (
        verificationData.verified_custodian_name &&
        verificationData.verified_custodian_persal_number &&
        verificationData.verified_custodian_name === asset.custodian_name &&
        verificationData.verified_custodian_persal_number === asset.persal_number
      ) {
        await connection.rollback();
        return NextResponse.json(
          { error: 'The custodian details already match the asset register.' },
          { status: 409 }
        );
      }
      const verificationNotes = [
        verificationData.verified_custodian_name
          ? `Custodian corrected during verification: ${verificationData.verified_custodian_name} (PERSAL ${verificationData.verified_custodian_persal_number}).`
          : '',
        verificationData.notes,
      ].filter(Boolean).join(' ');
      await connection.execute(
        `INSERT INTO health_asset_verifications (
          id, asset_id, asset_tag_snapshot, asset_name_snapshot, found,
          observed_condition, observed_location, custodian_confirmed, notes,
          district_snapshot, sub_district_snapshot, facility_name_snapshot,
          verified_by, verifier_name_snapshot, verifier_persal_number_snapshot,
          verifier_role_snapshot, evidence_file_name, evidence_file_size,
          evidence_file_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, asset.id, asset.asset_tag, asset.asset_name, verificationData.found ? 1 : 0,
          verificationData.observed_condition, verificationData.observed_location,
          verificationData.custodian_confirmed ? 1 : 0, verificationNotes || null,
          asset.district, asset.sub_district, asset.facility_name, ...actor,
        ]
      );
      if (verificationData.verified_custodian_name && verificationData.verified_custodian_persal_number) {
        await connection.execute(
          'UPDATE health_assets SET custodian_name = ?, persal_number = ? WHERE id = ?',
          [verificationData.verified_custodian_name, verificationData.verified_custodian_persal_number, asset.id]
        );
        const [updatedAssets] = await connection.execute<AssetRow[]>(
          'SELECT * FROM health_assets WHERE id = ?',
          [asset.id]
        );
        const updatedAsset = updatedAssets[0];
        if (!updatedAsset) throw new Error('Updated asset could not be reloaded for audit.');
        await recordAssetAudit(
          connection,
          updatedAsset,
          'updated',
          auth.user.id,
          asset,
          updatedAsset
        );
      }
    } else {
      if (
        asset.status !== 'Active' ||
        !asset.useful_life_end_date ||
        !extensionData ||
        new Date(asset.useful_life_end_date) > new Date(new Date().toISOString().slice(0, 10))
      ) {
        await connection.rollback();
        return NextResponse.json(
          { error: 'Only active assets whose useful life has expired can receive an extension.' },
          { status: 409 }
        );
      }
      const [dates] = await connection.execute<DateRow[]>(
        'SELECT DATE_ADD(?, INTERVAL ? MONTH) AS new_end_date',
        [asset.useful_life_end_date, extensionData.extension_months]
      );
      if (!dates[0]?.new_end_date) throw new Error('The extended useful-life date could not be calculated.');
      await connection.execute(
        `INSERT INTO health_asset_lifespan_extensions (
          id, asset_id, asset_tag_snapshot, asset_name_snapshot,
          previous_end_date, new_end_date, extension_months,
          inspected_condition, reason, district_snapshot,
          sub_district_snapshot, facility_name_snapshot, extended_by,
          extender_name_snapshot, extender_persal_number_snapshot,
          extender_role_snapshot, evidence_file_name, evidence_file_size,
          evidence_file_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, asset.id, asset.asset_tag, asset.asset_name,
          asset.useful_life_end_date, dates[0].new_end_date, extensionData.extension_months,
          extensionData.inspected_condition, extensionData.reason, asset.district,
          asset.sub_district, asset.facility_name, ...actor,
        ]
      );
      await connection.execute(
        'UPDATE health_assets SET useful_life_end_date = ? WHERE id = ?',
        [dates[0].new_end_date, asset.id]
      );
    }

    if (type !== 'verification') {
      const [updatedAssets] = await connection.execute<AssetRow[]>(
        'SELECT * FROM health_assets WHERE id = ?',
        [asset.id]
      );
      const updatedAsset = updatedAssets[0];
      if (!updatedAsset) throw new Error('Updated asset could not be reloaded for audit.');
      await recordAssetAudit(
        connection,
        updatedAsset,
        'updated',
        auth.user.id,
        asset,
        updatedAsset
      );
    }
    await connection.commit();
    return NextResponse.json({ id, type }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Failed to record asset operation:', error);
    return NextResponse.json(
      { error: 'Failed to save the asset operation.' },
      { status: 500 }
    );
  } finally {
    connection?.release();
  }
}
