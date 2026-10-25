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
import { parseAssetFormData } from '@/lib/asset-validation';
import { createAssetSearchFilter } from '@/lib/asset-search.mjs';
import { getDbPool } from '@/lib/db';
import { isSystemWideAdministrator } from '@/lib/roles';
import { resolveFacilityName } from '@/lib/facility-name';
import {
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  GAUTENG_DISTRICTS,
  GAUTENG_SUB_DISTRICTS,
  type AssetListResponse,
  type HealthAsset,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type AssetRow = HealthAsset & RowDataPacket;
type CountRow = { total: number } & RowDataPacket;
type SummaryRow = {
  total_assets: number;
  custodians: number;
  active_assets: number;
  needs_attention: number;
} & RowDataPacket;

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    if (!hasDistrictAssignment(auth.user)) {
      return NextResponse.json(
        { error: 'Your account needs a district assignment before you can access asset records.' },
        { status: 403 }
      );
    }
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') ?? DEFAULT_PAGE_SIZE);
    const offset = Number(params.get('offset') ?? 0);
    const search = (params.get('q') ?? '').trim();
    const district = params.get('district') ?? 'all';
    const subDistrict = params.get('subDistrict') ?? 'all';
    const status = params.get('status') ?? 'all';
    const facilityName = (params.get('facilityName') ?? '').trim();
    const facilityDistrict = params.get('facilityDistrict') ?? '';
    const facilitySubDistrict = params.get('facilitySubDistrict') ?? '';
    const isSuperAdministrator = isSystemWideAdministrator(auth.user.role);
    const scopedDistrict = isSuperAdministrator ? null : auth.user.district;

    if (
      (scopedDistrict &&
        district !== 'all' &&
        district !== scopedDistrict) ||
      (scopedDistrict &&
        facilityName &&
        facilityDistrict !== scopedDistrict)
    ) {
      return NextResponse.json(
        { error: 'You can only access assets in your assigned district.' },
        { status: 403 }
      );
    }
    const effectiveDistrict = scopedDistrict ?? district;

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_PAGE_SIZE ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1_000_000 ||
      search.length > 100 ||
      (district !== 'all' && !GAUTENG_DISTRICTS.includes(
        district as (typeof GAUTENG_DISTRICTS)[number]
      )) ||
      (subDistrict !== 'all' &&
        subDistrict !== 'unassigned' &&
        (!GAUTENG_DISTRICTS.includes(
          effectiveDistrict as (typeof GAUTENG_DISTRICTS)[number]
        ) ||
          !GAUTENG_SUB_DISTRICTS[effectiveDistrict]?.includes(subDistrict))) ||
      (status !== 'all' &&
        ![
          ...ASSET_STATUSES,
          'Need Attention',
          'Verification Due',
          'Lost',
          'Loss Report Pending',
          'Decommission Pending',
          'Decommissioned',
          'Disposal Pending',
          'Disposed',
        ].includes(status as (typeof ASSET_STATUSES)[number])) ||
      facilityName.length > 255 ||
      facilitySubDistrict.length > 255 ||
      (facilitySubDistrict &&
        (!facilityName ||
          !GAUTENG_SUB_DISTRICTS[facilityDistrict]?.includes(
            facilitySubDistrict
          ))) ||
      (facilityName && !GAUTENG_DISTRICTS.includes(
        facilityDistrict as (typeof GAUTENG_DISTRICTS)[number]
      ))
    ) {
      return NextResponse.json({ error: 'Invalid asset list filters.' }, { status: 400 });
    }

    const where: string[] = [];
    const values: (string | number)[] = [];
    if (search) {
      const searchFilter = createAssetSearchFilter(search);
      where.push(searchFilter.sql);
      values.push(...searchFilter.values);
    }
    if (effectiveDistrict !== 'all') {
      where.push('district = ?');
      values.push(effectiveDistrict);
    }
    if (subDistrict === 'unassigned') {
      where.push('sub_district IS NULL');
    } else if (subDistrict !== 'all') {
      where.push('sub_district = ?');
      values.push(subDistrict);
    }
    if (status !== 'all') {
      if (status === 'Need Attention') {
        where.push(
          "status = 'Active' AND useful_life_end_date IS NOT NULL AND useful_life_end_date <= CURDATE()"
        );
      } else if (status === 'Verification Due') {
        where.push(
          `status IN ('Active', 'In Maintenance') AND NOT EXISTS (
            SELECT 1 FROM health_asset_verifications v
            WHERE v.asset_id = health_assets.id
              AND v.verified_at > DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
          )`
        );
      } else {
        where.push('status = ?');
        values.push(status);
      }
    }
    if (facilityName) {
      where.push('district = ? AND LOWER(TRIM(facility_name)) = LOWER(TRIM(?))');
      values.push(facilityDistrict, facilityName);
      if (facilitySubDistrict) {
        where.push('sub_district = ?');
        values.push(facilitySubDistrict);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pool = getDbPool();
    const [countRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS total FROM health_assets ${whereSql}`,
      values
    );
    const [assets] = await pool.execute<AssetRow[]>(
      `SELECT health_assets.*,
        CASE WHEN status = 'Active' AND useful_life_end_date IS NOT NULL
          AND useful_life_end_date <= CURDATE()
          THEN 'Need Attention' ELSE status END AS display_status,
        (SELECT MAX(verified_at) FROM health_asset_verifications
          WHERE asset_id = health_assets.id) AS last_verified_at,
        CASE WHEN status IN ('Active', 'In Maintenance') AND NOT EXISTS (
          SELECT 1 FROM health_asset_verifications v
          WHERE v.asset_id = health_assets.id
            AND v.verified_at > DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        ) THEN TRUE ELSE FALSE END AS verification_due,
        (SELECT file_name FROM health_asset_evidence
          WHERE asset_id = health_assets.id LIMIT 1) AS evidence_file_name
      FROM health_assets ${whereSql}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    const summarySql = `SELECT COUNT(*) AS total_assets,
        COUNT(DISTINCT custodian_name) AS custodians,
        COUNT(CASE WHEN status = 'Active'
          AND (useful_life_end_date IS NULL OR useful_life_end_date > CURDATE())
          THEN 1 END) AS active_assets,
        COUNT(CASE WHEN \`condition\` IN ('Poor', 'Damaged')
          OR status = 'In Maintenance'
          OR (status = 'Active' AND useful_life_end_date IS NOT NULL
            AND useful_life_end_date <= CURDATE()) THEN 1 END) AS needs_attention
      FROM health_assets`;
    const [summaryRows] = scopedDistrict
      ? await pool.execute<SummaryRow[]>(
          `${summarySql} WHERE district = ?`,
          [scopedDistrict]
        )
      : await pool.query<SummaryRow[]>(summarySql);
    const summary = summaryRows[0];
    const result: AssetListResponse = {
      assets,
      total: Number(countRows[0].total),
      limit,
      offset,
      summary: {
        totalAssets: Number(summary.total_assets),
        custodians: Number(summary.custodians),
        activeAssets: Number(summary.active_assets),
        needsAttention: Number(summary.needs_attention),
      },
    };
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch health assets:', error);
    return NextResponse.json(
      { error: 'Failed to load assets. Check the database connection and schema.' },
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

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 11 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Evidence PDF must be no larger than 10 MB.' },
      { status: 413 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Submit the asset details with its required PDF evidence document.' },
      { status: 400 }
    );
  }

  const assetData = formData.get('asset');
  let body: unknown;
  if (typeof assetData !== 'string') {
    return NextResponse.json({ error: 'Invalid asset data.' }, { status: 400 });
  }
  try {
    body = JSON.parse(assetData) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid asset data.' }, { status: 400 });
  }
  const evidence = formData.get('evidence');
  if (!(evidence instanceof File)) {
    return NextResponse.json(
      { error: 'Attach the scanned barcode evidence document as a PDF.' },
      { status: 400 }
    );
  }
  const fileName = evidence.name
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  if (
    !fileName ||
    !fileName.toLocaleLowerCase().endsWith('.pdf') ||
    evidence.size === 0 ||
    evidence.size > 10 * 1024 * 1024
  ) {
    return NextResponse.json(
      { error: 'Evidence must be a PDF file no larger than 10 MB.' },
      { status: 400 }
    );
  }
  const fileContent = Buffer.from(await evidence.arrayBuffer());
  const fileEnd = fileContent
    .subarray(Math.max(0, fileContent.length - 1024))
    .toString('latin1');
  if (
    fileContent.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    !fileEnd.includes('%%EOF')
  ) {
    return NextResponse.json(
      { error: 'The attached file does not contain a valid PDF document.' },
      { status: 400 }
    );
  }

  const asset = parseAssetFormData(body);
  if (!asset) {
    return NextResponse.json({ error: 'Invalid asset data.' }, { status: 400 });
  }
  if (asset.status !== 'Active') {
    return NextResponse.json(
      { error: 'New assets must start as Active. Use the maintenance workflow for status changes.' },
      { status: 400 }
    );
  }
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before you can manage assets.' },
      { status: 403 }
    );
  }
  if (!canAccessDistrict(auth.user, asset.district)) {
    return NextResponse.json(
      { error: 'You can only register assets in your assigned district.' },
      { status: 403 }
    );
  }

  let connection: PoolConnection | undefined;
  try {
    connection = await getDbPool().getConnection();
    await connection.beginTransaction();
    const id = randomUUID();
    const facilityName = await resolveFacilityName(
      connection,
      asset.district,
      asset.sub_district,
      asset.facility_name
    );
    await connection.execute(
      `INSERT INTO health_assets (
        id, asset_tag, asset_name, facility_name, location, room_number,
        custodian_name, persal_number, serial_imei_number, district,
        sub_district, category, status, \`condition\`, acquisition_date,
        useful_life_months, useful_life_end_date, value, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? MONTH), ?, ?)`,
      [
        id,
        asset.asset_tag,
        asset.asset_name,
        facilityName,
        asset.location,
        asset.room_number,
        asset.custodian_name,
        asset.persal_number,
        asset.serial_imei_number,
        asset.district,
        asset.sub_district,
        asset.category,
        asset.status,
        asset.condition,
        asset.acquisition_date,
        asset.useful_life_months,
        asset.acquisition_date,
        asset.useful_life_months,
        asset.value,
        asset.notes,
      ]
    );
    await connection.execute(
      `INSERT INTO health_asset_evidence (
        asset_id, file_name, file_size, file_content, uploaded_by
      ) VALUES (?, ?, ?, ?, ?)`,
      [id, fileName, fileContent.length, fileContent, auth.user.id]
    );

    const [assets] = await connection.query<AssetRow[]>(
      'SELECT * FROM health_assets WHERE id = ?',
      [id]
    );
    if (!assets[0]) throw new Error('Created asset could not be reloaded for audit.');
    await recordAssetAudit(connection, assets[0], 'created', auth.user.id, null, assets[0]);
    await connection.commit();
    return NextResponse.json(assets[0], { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Failed to create health asset:', error);
    const duplicate = (error as { code?: string }).code === 'ER_DUP_ENTRY';
    return NextResponse.json(
      { error: duplicate ? 'An asset with this tag already exists.' : 'Failed to create asset.' },
      { status: duplicate ? 409 : 500 }
    );
  } finally {
    connection?.release();
  }
}
