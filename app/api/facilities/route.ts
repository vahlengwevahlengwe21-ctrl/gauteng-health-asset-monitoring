import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { hasDistrictAssignment, requireUser } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import { isSystemWideAdministrator } from '@/lib/roles';
import type { FacilityDirectoryEntry } from '@/lib/types';
import { inferFacilitySubDistrict } from '@/lib/facility-sub-district';

export const dynamic = 'force-dynamic';

type FacilityRow = FacilityDirectoryEntry & RowDataPacket;
type AssetFacilityRow = {
  facility_name: string;
  district: string;
  sub_district: string | null;
  asset_count: number;
} & RowDataPacket;

function facilityKey(
  facility: Pick<FacilityDirectoryEntry, 'district' | 'facility_name' | 'sub_district'>
): string {
  return [
    facility.district.trim().toLocaleLowerCase(),
    facility.facility_name.trim().toLocaleLowerCase(),
    facility.sub_district?.trim().toLocaleLowerCase() ?? '',
  ].join('|');
}

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    if (!hasDistrictAssignment(auth.user)) {
      return NextResponse.json(
        { error: 'Your account needs a district assignment before you can access facilities.' },
        { status: 403 }
      );
    }
    const pool = getDbPool();
    const districtScope =
      isSystemWideAdministrator(auth.user.role) ? null : auth.user.district;
    const directorySql = `SELECT
        f.id, f.facility_name, f.facility_type, f.district, f.sub_district,
        f.locality, f.street_address, f.operator_name, f.source_name
      FROM health_facilities f
      ${districtScope ? 'WHERE f.district = ?' : ''}
      ORDER BY f.district, f.facility_name`;
    const [directoryRows] = districtScope
      ? await pool.execute<FacilityRow[]>(directorySql, [districtScope])
      : await pool.query<FacilityRow[]>(directorySql);
    const assetFacilitySql = `SELECT facility_name, district, sub_district,
        COUNT(*) AS asset_count
      FROM health_assets
      ${districtScope ? 'WHERE district = ?' : ''}
      GROUP BY facility_name, district, sub_district`;
    const [assetFacilityRows] = districtScope
      ? await pool.execute<AssetFacilityRow[]>(assetFacilitySql, [
          districtScope,
        ])
      : await pool.query<AssetFacilityRow[]>(assetFacilitySql);

    const assetCounts = new Map<string, number>();
    for (const facility of assetFacilityRows) {
      const key = facilityKey(facility);
      assetCounts.set(
        key,
        (assetCounts.get(key) ?? 0) + Number(facility.asset_count)
      );
    }
    const normalizedDirectoryRows = directoryRows
      .map((facility) => ({
        ...facility,
        id: String(facility.id),
        sub_district:
          facility.sub_district ??
          inferFacilitySubDistrict(
            facility.district,
            facility.locality,
            facility.street_address,
            facility.facility_name
          ),
      }))
      .filter(
        (facility) =>
          Boolean(facility.district.trim()) &&
          Boolean(facility.sub_district?.trim())
      );
    const mappedKeys = new Set(
      normalizedDirectoryRows.map((facility) => facilityKey(facility))
    );
    const assetOnlyFacilities: FacilityDirectoryEntry[] = assetFacilityRows
      .filter(
        (facility) =>
          Boolean(facility.district.trim()) &&
          Boolean(facility.sub_district?.trim()) &&
          !mappedKeys.has(facilityKey(facility))
      )
      .map((facility) => ({
        id: `asset:${facilityKey(facility)}`,
        facility_name: facility.facility_name,
        facility_type: 'Registered facility',
        district: facility.district,
        sub_district: facility.sub_district,
        locality: null,
        street_address: null,
        operator_name: null,
        source_name: 'Asset register',
        asset_count: Number(facility.asset_count),
      }));

    const directoryFacilities = new Map<string, FacilityDirectoryEntry>();
    for (const facility of normalizedDirectoryRows) {
      const entry = {
        ...facility,
        asset_count: assetCounts.get(facilityKey(facility)) ?? 0,
      };
      const key = facilityKey(entry);
      const existing = directoryFacilities.get(key);
      const entryCompleteness =
        Number(Boolean(entry.sub_district)) * 4 +
        Number(Boolean(entry.locality)) * 2 +
        Number(Boolean(entry.street_address));
      const existingCompleteness = existing
        ? Number(Boolean(existing.sub_district)) * 4 +
          Number(Boolean(existing.locality)) * 2 +
          Number(Boolean(existing.street_address))
        : -1;
      if (entryCompleteness > existingCompleteness) {
        directoryFacilities.set(key, entry);
      }
    }

    const facilities = [
      ...Array.from(directoryFacilities.values()),
      ...assetOnlyFacilities,
    ];

    return NextResponse.json(facilities);
  } catch (error) {
    console.error('Failed to fetch facility directory:', error);
    return NextResponse.json(
      { error: 'Failed to load the facility directory. Check the database schema and connection.' },
      { status: 500 }
    );
  }
}
