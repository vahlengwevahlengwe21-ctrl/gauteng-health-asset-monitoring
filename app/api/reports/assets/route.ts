import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { hasDistrictAssignment, requireUser } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import { isSystemWideAdministrator } from '@/lib/roles';
import {
  GAUTENG_DISTRICTS,
  GAUTENG_SUB_DISTRICTS,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

type SummaryRow = {
  total_assets: number;
  total_value: number | string | null;
  valued_assets: number;
  active_assets: number;
  needs_attention: number;
  verification_due: number;
  custodians: number;
} & RowDataPacket;

type BreakdownRow = {
  label: string | null;
  asset_count: number;
  book_value: number | string | null;
} & RowDataPacket;

type FacilityBreakdownRow = {
  facility_name: string;
  district: string;
  sub_district: string | null;
  asset_count: number;
  book_value: number | string | null;
  active_assets: number;
  needs_attention: number;
  verification_due: number;
} & RowDataPacket;

type AcquisitionRow = {
  year: number;
  asset_count: number;
  book_value: number | string | null;
} & RowDataPacket;

function numeric(value: number | string | null): number {
  return Number(value ?? 0);
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (auth.user.role === 'admin_clerk') {
    return NextResponse.json(
      { error: 'Reports are not available to Admin Clerk accounts.' },
      { status: 403 }
    );
  }
  if (!hasDistrictAssignment(auth.user)) {
    return NextResponse.json(
      { error: 'Your account needs a district assignment before you can access reports.' },
      { status: 403 }
    );
  }

  const params = new URL(request.url).searchParams;
  const requestedDistrict = params.get('district') ?? 'all';
  const subDistrict = params.get('subDistrict') ?? 'all';
  const facilityName = (params.get('facilityName') ?? '').trim();
  const facilityDistrict = params.get('facilityDistrict') ?? '';
  const facilitySubDistrict = params.get('facilitySubDistrict') ?? '';
  const isSuperAdministrator = isSystemWideAdministrator(auth.user.role);
  const assignedDistrict = isSuperAdministrator ? null : auth.user.district;
  const district = assignedDistrict ?? requestedDistrict;

  if (
    (assignedDistrict &&
      requestedDistrict !== 'all' &&
      requestedDistrict !== assignedDistrict) ||
    (district !== 'all' &&
      !GAUTENG_DISTRICTS.includes(
        district as (typeof GAUTENG_DISTRICTS)[number]
      )) ||
    (subDistrict !== 'all' &&
      !(district === 'all'
        ? Object.values(GAUTENG_SUB_DISTRICTS).some((entries) =>
            entries.includes(subDistrict)
          )
        : GAUTENG_SUB_DISTRICTS[district]?.includes(subDistrict))) ||
    facilityName.length > 255 ||
    (facilityName &&
      ((district !== 'all' && facilityDistrict !== district) ||
        !GAUTENG_DISTRICTS.includes(
          facilityDistrict as (typeof GAUTENG_DISTRICTS)[number]
        ) ||
        (facilitySubDistrict &&
          !GAUTENG_SUB_DISTRICTS[facilityDistrict]?.includes(
            facilitySubDistrict
          )) ||
        (facilitySubDistrict &&
          facilitySubDistrict !== subDistrict &&
          subDistrict !== 'all'))) ||
    (!facilityName && (facilityDistrict || facilitySubDistrict))
  ) {
    return NextResponse.json(
      { error: 'Invalid report filters.' },
      { status: 400 }
    );
  }

  const where: string[] = [];
  const values: string[] = [];
  if (district !== 'all') {
    where.push('district = ?');
    values.push(district);
  }
  if (subDistrict !== 'all') {
    where.push('sub_district = ?');
    values.push(subDistrict);
  }
  if (facilityName) {
    if (district === 'all') {
      where.push('district = ?');
      values.push(facilityDistrict);
    }
    where.push('LOWER(TRIM(facility_name)) = LOWER(TRIM(?))');
    values.push(facilityName);
    if (facilitySubDistrict) {
      where.push('sub_district = ?');
      values.push(facilitySubDistrict);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const database = getDbPool();

  try {
    const [
      [summaryRows],
      [statusRows],
      [categoryRows],
      [conditionRows],
      [districtRows],
      [subDistrictRows],
      [facilityRows],
      [acquisitionRows],
    ] = await Promise.all([
      database.execute<SummaryRow[]>(
        `SELECT COUNT(*) AS total_assets,
          COALESCE(SUM(value), 0) AS total_value,
          COUNT(value) AS valued_assets,
          COUNT(CASE WHEN status = 'Active' THEN 1 END) AS active_assets,
          COUNT(CASE WHEN \`condition\` IN ('Poor', 'Damaged')
            OR status = 'In Maintenance'
            OR (status = 'Active' AND useful_life_end_date IS NOT NULL
              AND useful_life_end_date <= CURDATE()) THEN 1 END) AS needs_attention,
          COUNT(CASE WHEN status IN ('Active', 'In Maintenance')
            AND NOT EXISTS (
              SELECT 1 FROM health_asset_verifications v
              WHERE v.asset_id = health_assets.id
                AND v.verified_at > DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            ) THEN 1 END) AS verification_due,
          COUNT(DISTINCT NULLIF(TRIM(custodian_name), '')) AS custodians
        FROM health_assets ${whereSql}`,
        values
      ),
      database.execute<BreakdownRow[]>(
        `SELECT status AS label, COUNT(*) AS asset_count,
          COALESCE(SUM(value), 0) AS book_value
        FROM health_assets ${whereSql}
        GROUP BY status ORDER BY asset_count DESC, status`,
        values
      ),
      database.execute<BreakdownRow[]>(
        `SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS label,
          COUNT(*) AS asset_count, COALESCE(SUM(value), 0) AS book_value
        FROM health_assets ${whereSql}
        GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
        ORDER BY asset_count DESC, label`,
        values
      ),
      database.execute<BreakdownRow[]>(
        `SELECT \`condition\` AS label, COUNT(*) AS asset_count,
          COALESCE(SUM(value), 0) AS book_value
        FROM health_assets ${whereSql}
        GROUP BY \`condition\` ORDER BY asset_count DESC, label`,
        values
      ),
      database.execute<BreakdownRow[]>(
        `SELECT district AS label, COUNT(*) AS asset_count,
          COALESCE(SUM(value), 0) AS book_value
        FROM health_assets ${whereSql}
        GROUP BY district ORDER BY asset_count DESC, label`,
        values
      ),
      database.execute<BreakdownRow[]>(
        `SELECT COALESCE(NULLIF(TRIM(sub_district), ''), 'Unassigned') AS label,
          COUNT(*) AS asset_count, COALESCE(SUM(value), 0) AS book_value
        FROM health_assets ${whereSql}
        GROUP BY COALESCE(NULLIF(TRIM(sub_district), ''), 'Unassigned')
        ORDER BY asset_count DESC, label`,
        values
      ),
      database.execute<FacilityBreakdownRow[]>(
        `SELECT facility_name, district,
          COALESCE(NULLIF(TRIM(sub_district), ''), NULL) AS sub_district,
          COUNT(*) AS asset_count, COALESCE(SUM(value), 0) AS book_value,
          COUNT(CASE WHEN status = 'Active' THEN 1 END) AS active_assets,
          COUNT(CASE WHEN \`condition\` IN ('Poor', 'Damaged')
            OR status = 'In Maintenance'
            OR (status = 'Active' AND useful_life_end_date IS NOT NULL
              AND useful_life_end_date <= CURDATE()) THEN 1 END) AS needs_attention,
          COUNT(CASE WHEN status IN ('Active', 'In Maintenance')
            AND NOT EXISTS (
              SELECT 1 FROM health_asset_verifications v
              WHERE v.asset_id = health_assets.id
                AND v.verified_at > DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            ) THEN 1 END) AS verification_due
        FROM health_assets ${whereSql}
        GROUP BY facility_name, district, sub_district
        ORDER BY book_value DESC, asset_count DESC, facility_name`,
        values
      ),
      database.execute<AcquisitionRow[]>(
        `SELECT YEAR(acquisition_date) AS year, COUNT(*) AS asset_count,
          COALESCE(SUM(value), 0) AS book_value
        FROM health_assets ${whereSql}${whereSql ? ' AND' : 'WHERE'}
          acquisition_date IS NOT NULL
        GROUP BY YEAR(acquisition_date) ORDER BY year`,
        values
      ),
    ]);

    const summary = summaryRows[0];
    const normalizeBreakdown = (rows: BreakdownRow[]) =>
      rows.map((row) => ({
        label: row.label ?? 'Unassigned',
        assetCount: Number(row.asset_count),
        bookValue: numeric(row.book_value),
      }));

    return NextResponse.json(
      {
        filters: {
          district,
          subDistrict,
          facilityName: facilityName || null,
        },
        summary: {
          totalAssets: Number(summary.total_assets),
          totalValue: numeric(summary.total_value),
          valuedAssets: Number(summary.valued_assets),
          activeAssets: Number(summary.active_assets),
          needsAttention: Number(summary.needs_attention),
          verificationDue: Number(summary.verification_due),
          custodians: Number(summary.custodians),
        },
        status: normalizeBreakdown(statusRows),
        categories: normalizeBreakdown(categoryRows),
        conditions: normalizeBreakdown(conditionRows),
        districts: normalizeBreakdown(districtRows),
        subDistricts: normalizeBreakdown(subDistrictRows),
        facilities: facilityRows.map((row) => ({
          facilityName: row.facility_name,
          district: row.district,
          subDistrict: row.sub_district ?? 'Unassigned',
          assetCount: Number(row.asset_count),
          bookValue: numeric(row.book_value),
          activeAssets: Number(row.active_assets),
          needsAttention: Number(row.needs_attention),
          verificationDue: Number(row.verification_due),
        })),
        acquisitions: acquisitionRows.map((row) => ({
          year: Number(row.year),
          assetCount: Number(row.asset_count),
          bookValue: numeric(row.book_value),
        })),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Failed to generate asset reports:', error);
    return NextResponse.json(
      { error: 'Unable to generate the asset report. Check the database connection and schema.' },
      { status: 500 }
    );
  }
}
