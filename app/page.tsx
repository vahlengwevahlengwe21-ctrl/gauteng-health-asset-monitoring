'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Header } from '@/components/header';
import { StatsCards } from '@/components/stats-cards';
import { AssetTable } from '@/components/asset-table';
import { AssetFormDialog } from '@/components/asset-form-dialog';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { DisposalRequestDialog } from '@/components/disposal-request-dialog';
import { DecommissionRequestDialog } from '@/components/decommission-request-dialog';
import { LostAssetReportDialog } from '@/components/lost-asset-report-dialog';
import { MaintenanceStartDialog } from '@/components/maintenance-start-dialog';
import { DecommissionRequestPanel } from '@/components/decommission-request-panel';
import { MaintenanceRecordPanel } from '@/components/maintenance-record-panel';
import { LostAssetPanel } from '@/components/lost-asset-panel';
import { DisposalPanel } from '@/components/disposal-panel';
import { AssetOperationDialog } from '@/components/asset-operation-dialog';
import { AssetTagCameraScanner } from '@/components/asset-tag-camera-scanner';
import { AssetOperationsPanel } from '@/components/asset-operations-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Camera, Plus, Search, Loader2, X, Download, ShieldCheck, ScanSearch } from 'lucide-react';
import { fetchAssets, createAsset, updateAsset, deleteAsset } from '@/lib/assets';
import { fetchFacilities } from '@/lib/facilities';
import { createDisposalRequest } from '@/lib/disposals';
import { createDecommissionRequest } from '@/lib/decommission-requests';
import { createLostAssetReport } from '@/lib/lost-assets';
import { createMaintenanceRecord } from '@/lib/maintenance-records';
import { createAssetOperation } from '@/lib/asset-operations';
import type { AuthenticatedUser } from '@/lib/auth';
import {
  GAUTENG_DISTRICTS,
  GAUTENG_SUB_DISTRICTS,
  type FacilityDirectoryEntry,
  type HealthAsset,
  type AssetFormData,
  type DisposalRequestData,
  type DecommissionRequestData,
  type LostAssetReportData,
  type MaintenanceStartData,
  type AssetOperationType,
} from '@/lib/types';

export default function Home() {
  const [assets, setAssets] = useState<HealthAsset[]>([]);
  const [facilities, setFacilities] = useState<FacilityDirectoryEntry[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchingAssetCount, setMatchingAssetCount] = useState(0);
  const [assetSummary, setAssetSummary] = useState({
    totalAssets: 0,
    custodians: 0,
    activeAssets: 0,
    needsAttention: 0,
  });
  const [pageOffset, setPageOffset] = useState(0);
  const assetLoadSequence = useRef(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchCameraOpen, setSearchCameraOpen] = useState(false);
  const [filterDistrict, setFilterDistrict] = useState('all');
  const [filterSubDistrict, setFilterSubDistrict] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFacility, setFilterFacility] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<HealthAsset | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<HealthAsset | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [disposalTarget, setDisposalTarget] = useState<HealthAsset | null>(null);
  const [disposalOpen, setDisposalOpen] = useState(false);
  const [disposalVersion, setDisposalVersion] = useState(0);
  const [decommissionVersion, setDecommissionVersion] = useState(0);
  const [decommissionTarget, setDecommissionTarget] = useState<HealthAsset | null>(null);
  const [decommissionOpen, setDecommissionOpen] = useState(false);
  const [lostReportVersion, setLostReportVersion] = useState(0);
  const [lostReportTarget, setLostReportTarget] = useState<HealthAsset | null>(null);
  const [lostReportOpen, setLostReportOpen] = useState(false);
  const [maintenanceVersion, setMaintenanceVersion] = useState(0);
  const [maintenanceTarget, setMaintenanceTarget] = useState<HealthAsset | null>(null);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [operationTarget, setOperationTarget] = useState<HealthAsset | null>(null);
  const [operationType, setOperationType] = useState<AssetOperationType | null>(null);
  const [operationOpen, setOperationOpen] = useState(false);
  const [operationVersion, setOperationVersion] = useState(0);

  const availableSubDistricts =
    filterDistrict !== 'all'
      ? GAUTENG_SUB_DISTRICTS[filterDistrict] ?? []
      : [];
  const visibleDistricts =
    currentUser?.role === 'super_administrator'
      ? GAUTENG_DISTRICTS
      : currentUser?.district
        ? [currentUser.district]
        : [];

  const availableFacilities = useMemo(
    () =>
      facilities.filter(
        (facility) =>
          (filterDistrict === 'all' || facility.district === filterDistrict) &&
          (filterSubDistrict === 'all' ||
            facility.sub_district === filterSubDistrict)
      ),
    [facilities, filterDistrict, filterSubDistrict]
  );
  const duplicateFacilityNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const facility of availableFacilities) {
      const name = facility.facility_name.trim().toLocaleLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts)
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    );
  }, [availableFacilities]);

  const selectedFacility = facilities.find(
    (facility) => facility.id === filterFacility
  );

  const createAssetQuery = useCallback(
    (offset: number, limit: number) => {
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        q: debouncedSearch,
        district: filterDistrict,
        subDistrict: filterSubDistrict,
        status: filterStatus,
      });
      if (selectedFacility) {
        query.set('facilityName', selectedFacility.facility_name);
        query.set('facilityDistrict', selectedFacility.district);
        if (selectedFacility.sub_district) {
          query.set('facilitySubDistrict', selectedFacility.sub_district);
        }
      }
      return query;
    },
    [
      debouncedSearch,
      filterDistrict,
      filterSubDistrict,
      filterStatus,
      selectedFacility,
    ]
  );

  const loadAssets = useCallback(async () => {
    const requestSequence = ++assetLoadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAssets(createAssetQuery(pageOffset, 50));
      if (requestSequence !== assetLoadSequence.current) return;
      setAssets(result.assets);
      setMatchingAssetCount(result.total);
      setAssetSummary(result.summary);
      if (pageOffset >= result.total && result.total > 0) {
        setPageOffset(Math.floor((result.total - 1) / 50) * 50);
      }
    } catch (err) {
      if (requestSequence === assetLoadSequence.current) {
        setError(err instanceof Error ? err.message : 'Failed to load assets.');
      }
    } finally {
      if (requestSequence === assetLoadSequence.current) setLoading(false);
    }
  }, [createAssetQuery, pageOffset]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchFacilities(), fetch('/api/auth/me')])
      .then(async ([facilityData, userResponse]) => {
        if (!userResponse.ok) {
          throw new Error('Your session could not be verified. Sign in again.');
        }
        const { user } = (await userResponse.json()) as {
          user: AuthenticatedUser;
        };
        if (!cancelled) {
          setFacilities(facilityData);
          setCurrentUser(user);
          if (
            user.role !== 'super_administrator' &&
            user.district
          ) {
            setFilterDistrict(user.district);
          }
          if (user.role !== 'super_administrator' && !user.district) {
            setError(
              'Your account has no district assigned. Ask the Super Administrator to assign one in User management.'
            );
          }
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load app access and facilities.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const hasFullOperationalAccess =
    currentUser?.role === 'super_administrator' ||
    currentUser?.role === 'asset_manager' ||
    currentUser?.role === 'supervisor' ||
    currentUser?.role === 'chief_director';
  const canManageAssets =
    hasFullOperationalAccess || currentUser?.role === 'admin_clerk';
  const canRequestDisposal = canManageAssets;
  const canReviewDisposal = hasFullOperationalAccess;
  const canReviewLostReports =
    currentUser?.role === 'super_administrator' ||
    currentUser?.role === 'asset_manager' ||
    currentUser?.role === 'supervisor';
  const canReviewDecommissionRequests =
    currentUser?.role === 'super_administrator' ||
    currentUser?.role === 'asset_manager' ||
    currentUser?.role === 'supervisor' ||
    currentUser?.role === 'chief_director';

  const filteredAssets = assets;

  const handleSave = async (data: AssetFormData, evidence?: File) => {
    if (editingAsset) {
      await updateAsset(editingAsset.id, data);
    } else {
      if (!evidence) throw new Error('Attach the required barcode evidence PDF.');
      await createAsset(data, evidence);
    }
    await loadAssets();
    setEditingAsset(null);
  };

  const handleDisposalSubmit = async (data: DisposalRequestData, evidence: File) => {
    if (!disposalTarget) return;
    await createDisposalRequest(disposalTarget.id, data, evidence);
    setDisposalOpen(false);
    setDisposalTarget(null);
    await loadAssets();
    setDisposalVersion((version) => version + 1);
  };

  const handleLostReportSubmit = async (data: LostAssetReportData, evidence: File) => {
    if (!lostReportTarget) return;
    await createLostAssetReport(lostReportTarget.id, data, evidence);
    setLostReportOpen(false);
    setLostReportTarget(null);
    await loadAssets();
    setLostReportVersion((version) => version + 1);
  };

  const handleDecommissionSubmit = async (data: DecommissionRequestData, evidence: File) => {
    if (!decommissionTarget) return;
    await createDecommissionRequest(decommissionTarget.id, data, evidence);
    setDecommissionOpen(false);
    setDecommissionTarget(null);
    await loadAssets();
    setDecommissionVersion((version) => version + 1);
  };

  const handleMaintenanceSubmit = async (data: MaintenanceStartData, evidence: File) => {
    if (!maintenanceTarget) return;
    await createMaintenanceRecord(maintenanceTarget.id, data, evidence);
    setMaintenanceOpen(false);
    setMaintenanceTarget(null);
    await loadAssets();
    setMaintenanceVersion((version) => version + 1);
  };

  const handleAssetOperationSubmit = async (
    type: AssetOperationType,
    data: Record<string, string | number | boolean>,
    evidence: File
  ) => {
    if (!operationTarget) return;
    await createAssetOperation(operationTarget.id, type, data, evidence);
    setOperationOpen(false);
    setOperationTarget(null);
    setOperationType(null);
    await loadAssets();
    setOperationVersion((version) => version + 1);
  };

  const openAssetOperation = (asset: HealthAsset, type: AssetOperationType) => {
    setOperationTarget(asset);
    setOperationType(type);
    setOperationOpen(true);
  };

  const handleEdit = (asset: HealthAsset) => {
    setEditingAsset(asset);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditingAsset(null);
    setFormOpen(true);
  };

  const handleDeleteClick = (asset: HealthAsset) => {
    setDeleteTarget(asset);
    setDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAsset(deleteTarget.id);
      await loadAssets();
    } catch (err: any) {
      setError(err.message || 'Failed to delete asset.');
    } finally {
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const hasFilters =
    search ||
    filterDistrict !== 'all' ||
    filterSubDistrict !== 'all' ||
    filterStatus !== 'all' ||
    filterFacility !== 'all';

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setFilterDistrict(
      currentUser?.role === 'super_administrator'
        ? 'all'
        : currentUser?.district ?? 'all'
    );
    setFilterSubDistrict('all');
    setFilterStatus('all');
    setFilterFacility('all');
    setPageOffset(0);
  };

  const exportCSV = async () => {
    const headers = ['Asset Tag', 'Asset Name', 'Facility', 'District', 'Sub-District', 'Location', 'Room', 'Custodian', 'PERSAL Number', 'Serial Number / IMEI Number', 'Category', 'Status', 'Condition', 'Acquisition Date', 'Useful Life (Months)', 'Useful Life Ends', 'Verification Due', 'Last Verified', 'Value', 'Notes'];
    const rows: (string | number | null)[][] = [];
    const totalToExport = matchingAssetCount;
    setExportingCSV(true);
    try {
      for (let offset = 0; offset < totalToExport; offset += 100) {
        const page = await fetchAssets(createAssetQuery(offset, 100));
        rows.push(
          ...page.assets.map((a) => [
            a.asset_tag,
            a.asset_name,
            a.facility_name,
            a.district,
            a.sub_district ?? '',
            a.location,
            a.room_number ?? '',
            a.custodian_name,
            a.persal_number ?? '',
            a.serial_imei_number ?? '',
            a.category ?? '',
            a.display_status ?? a.status,
            a.condition,
            a.acquisition_date ?? '',
            a.useful_life_months ?? '',
            a.useful_life_end_date ?? '',
            a.verification_due ? 'Yes' : 'No',
            a.last_verified_at ?? '',
            a.value ?? '',
            a.notes,
          ])
        );
        if (page.assets.length === 0) break;
      }
      if (rows.length !== totalToExport) {
        throw new Error('The asset list changed while the CSV was being generated. Refresh the register and try again.');
      }
      const escapeCell = (value: string | number | null) => {
        const cell = String(value ?? '');
        const safeCell =
          typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(cell)
            ? `'${cell}`
            : cell;
        return `"${safeCell.replace(/"/g, '""')}"`;
      };
      const csv = [headers, ...rows]
        .map((row) => row.map(escapeCell).join(','))
        .join('\r\n');
      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date();
      const date = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-');
      a.download = `gauteng-health-assets-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? `CSV export failed: ${exportError.message}`
          : 'CSV export failed.'
      );
    } finally {
      setExportingCSV(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Page title and actions */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground sm:text-2xl">
              Asset Register
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {currentUser?.role === 'super_administrator'
                ? 'Track and manage health facility assets across Gauteng province.'
                : 'Track and manage health facility assets in your assigned district.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageAssets && (
              <Button
                variant={filterStatus === 'Verification Due' ? 'default' : 'outline'}
                onClick={() => {
                  setFilterStatus((status) =>
                    status === 'Verification Due' ? 'all' : 'Verification Due'
                  );
                  setPageOffset(0);
                }}
                aria-pressed={filterStatus === 'Verification Due'}
              >
                <ScanSearch className="mr-2 h-4 w-4" />
                {filterStatus === 'Verification Due'
                  ? 'Show all assets'
                  : 'Verification due'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={exportCSV}
              disabled={loading || exportingCSV || matchingAssetCount === 0}
            >
              {exportingCSV
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Download className="mr-2 h-4 w-4" />}
              {exportingCSV ? 'Exporting...' : `Export CSV (${matchingAssetCount})`}
            </Button>
            {canManageAssets && (
              <Button onClick={handleAdd}>
                <Plus className="mr-2 h-4 w-4" />
                Register Asset
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        {!loading && !error && (
          <StatsCards facilities={facilities} summary={assetSummary} />
        )}

        {/* Error banner */}
        {error && (
          <Card className="border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </Card>
        )}

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Type or scan asset tag, serial number, or IMEI..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPageOffset(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        setDebouncedSearch(search.trim());
                        setPageOffset(0);
                      }
                    }}
                    className="pl-10"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2 px-3"
                  aria-label="Scan asset tag to search"
                  onClick={() => setSearchCameraOpen(true)}
                >
                  <Camera className="h-4 w-4" />
                  Scan
                </Button>
              </div>
              <AssetTagCameraScanner
                active={searchCameraOpen}
                onDetected={(value) => {
                  const assetTag = value.trim();
                  if (!assetTag) return;
                  setSearch(assetTag);
                  setDebouncedSearch(assetTag);
                  setPageOffset(0);
                  setSearchCameraOpen(false);
                }}
                onClose={() => setSearchCameraOpen(false)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Select
                value={filterDistrict}
                onValueChange={(v) => {
                  setFilterDistrict(v);
                  setFilterSubDistrict('all');
                  setFilterFacility('all');
                  setPageOffset(0);
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Assigned district" />
                </SelectTrigger>
                <SelectContent>
                  {currentUser?.role === 'super_administrator' && (
                    <SelectItem value="all">All districts</SelectItem>
                  )}
                  {visibleDistricts.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterSubDistrict}
                onValueChange={(v) => {
                  setFilterSubDistrict(v);
                  setFilterFacility('all');
                  setPageOffset(0);
                }}
                disabled={availableSubDistricts.length === 0}
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue
                    placeholder={
                      availableSubDistricts.length === 0
                        ? 'All sub-districts'
                        : 'All sub-districts'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sub-districts</SelectItem>
                  {availableSubDistricts.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterFacility}
                onValueChange={(value) => {
                  setFilterFacility(value);
                  setPageOffset(0);
                }}
                disabled={loading}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="All facilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All facilities</SelectItem>
                  {availableFacilities.map((facility) => (
                    <SelectItem key={facility.id} value={facility.id}>
                      {facility.facility_name}
                      {duplicateFacilityNames.has(
                        facility.facility_name.trim().toLocaleLowerCase()
                      )
                        ? ` — ${facility.sub_district ?? 'Sub-district not recorded'}`
                        : ''}
                      {facility.asset_count > 0
                        ? ` (${facility.asset_count} assets)`
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterStatus}
                onValueChange={(value) => {
                  setFilterStatus(value);
                  setPageOffset(0);
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Need Attention">Need Attention</SelectItem>
                  <SelectItem value="Verification Due">Verification Due</SelectItem>
                  <SelectItem value="In Maintenance">In Maintenance</SelectItem>
                  <SelectItem value="Decommissioned">Decommissioned</SelectItem>
                  <SelectItem value="Decommission Pending">Decommission Pending</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                  <SelectItem value="Loss Report Pending">Loss Report Pending</SelectItem>
                  <SelectItem value="Disposal Pending">Disposal Pending</SelectItem>
                  <SelectItem value="Disposed">Disposed</SelectItem>
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" onClick={clearFilters} className="shrink-0">
                  <X className="mr-1 h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            {matchingAssetCount === 0
              ? 'Showing 0 assets'
              : `Showing ${pageOffset + 1}–${pageOffset + filteredAssets.length} of ${matchingAssetCount} matching assets`}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Facility directory includes mapped OpenStreetMap data and registered
            asset locations. Coverage and regional assignments may be incomplete.
          </p>
        </Card>

        {/* Table */}
        <Card className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Loading assets...</p>
            </div>
          ) : (
            <AssetTable
              assets={filteredAssets}
              onEdit={canManageAssets ? handleEdit : undefined}
              onDelete={hasFullOperationalAccess ? handleDeleteClick : undefined}
              onDispose={
                canRequestDisposal
                  ? (asset) => {
                      setDisposalTarget(asset);
                      setDisposalOpen(true);
                    }
                  : undefined
              }
              onReportLost={
                canManageAssets
                  ? (asset) => {
                      setLostReportTarget(asset);
                      setLostReportOpen(true);
                    }
                  : undefined
              }
              onDecommission={
                canManageAssets
                  ? (asset) => {
                      setDecommissionTarget(asset);
                      setDecommissionOpen(true);
                    }
                  : undefined
              }
              onStartMaintenance={
                canManageAssets
                  ? (asset) => {
                      setMaintenanceTarget(asset);
                      setMaintenanceOpen(true);
                    }
                  : undefined
              }
              onTransfer={
                  canManageAssets
                    ? (asset) => openAssetOperation(asset, 'transfer')
                    : undefined
              }
              onVerify={
                  canManageAssets
                    ? (asset) => openAssetOperation(asset, 'verification')
                    : undefined
              }
              onExtendLifespan={
                  currentUser?.role === 'admin_clerk'
                    ? (asset) => openAssetOperation(asset, 'lifespan_extension')
                    : undefined
              }
            />
          )}
        </Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {matchingAssetCount === 0 ? 0 : Math.floor(pageOffset / 50) + 1}
            {' '}of {Math.ceil(matchingAssetCount / 50)}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={loading || pageOffset === 0}
              onClick={() => setPageOffset(Math.max(0, pageOffset - 50))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={loading || pageOffset + filteredAssets.length >= matchingAssetCount}
              onClick={() => setPageOffset(pageOffset + 50)}
            >
              Next
            </Button>
          </div>
        </div>
        {currentUser && (
          <LostAssetPanel
            key={`lost-${lostReportVersion}`}
            canReview={canReviewLostReports}
            currentUserId={currentUser.id}
            currentUserRole={currentUser.role}
            currentUserDistrict={currentUser.district}
            onUpdated={loadAssets}
          />
        )}
        {currentUser && (
          <DecommissionRequestPanel
            key={`decommission-${decommissionVersion}`}
            canReview={canReviewDecommissionRequests}
            currentUserId={currentUser.id}
            currentUserRole={currentUser.role}
            currentUserDistrict={currentUser.district}
            onUpdated={loadAssets}
          />
        )}
        {currentUser && (
          <DisposalPanel
            key={`disposal-${disposalVersion}`}
            canReview={canReviewDisposal}
            currentUserId={currentUser.id}
            currentUserRole={currentUser.role}
            currentUserDistrict={currentUser.district}
            onReviewed={loadAssets}
          />
        )}
        {currentUser && (
          <MaintenanceRecordPanel
            key={`maintenance-${maintenanceVersion}`}
            canManage={canManageAssets}
            currentUserRole={currentUser.role}
            currentUserDistrict={currentUser.district}
            onUpdated={loadAssets}
          />
        )}
        {currentUser && (
          <AssetOperationsPanel refreshKey={operationVersion} />
        )}
      </main>

      <footer className="border-t border-border px-4 py-6 sm:px-6">
        <p className="text-center text-xs text-muted-foreground">
          Gauteng Department of Health — Asset Management System
        </p>
        <div className="mx-auto mt-4 flex max-w-3xl items-start justify-center gap-2 rounded-lg border border-primary/15 bg-primary/[0.04] px-4 py-3 text-left">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Security notice:</span>{' '}
            Authorized use only. Access to this system is restricted to approved
            users. Unauthorized access, use, or disclosure is prohibited and may
            result in disciplinary and legal action.
          </p>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Facility directory data ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            OpenStreetMap contributors
          </a>{' '}
          (ODbL).
        </p>
      </footer>

      <AssetFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSave={handleSave}
        editingAsset={editingAsset}
        facilities={facilities}
        assignedDistrict={
          currentUser?.role === 'super_administrator'
            ? null
            : currentUser?.district
        }
      />

      <DeleteConfirmDialog
        asset={deleteTarget}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDeleteConfirm}
      />
      <AssetOperationDialog
        asset={operationTarget}
        type={operationType}
        isAdminClerk={currentUser?.role === 'admin_clerk'}
        open={operationOpen}
        onOpenChange={(open) => {
          setOperationOpen(open);
          if (!open) {
            setOperationTarget(null);
            setOperationType(null);
          }
        }}
        onSubmit={handleAssetOperationSubmit}
      />
      <DisposalRequestDialog
        asset={disposalTarget}
        open={disposalOpen}
        onOpenChange={(open) => {
          setDisposalOpen(open);
          if (!open) setDisposalTarget(null);
        }}
        onSubmit={handleDisposalSubmit}
      />
      <LostAssetReportDialog
        asset={lostReportTarget}
        open={lostReportOpen}
        onOpenChange={(open) => {
          setLostReportOpen(open);
          if (!open) setLostReportTarget(null);
        }}
        onSubmit={handleLostReportSubmit}
      />
      <DecommissionRequestDialog
        asset={decommissionTarget}
        open={decommissionOpen}
        onOpenChange={(open) => {
          setDecommissionOpen(open);
          if (!open) setDecommissionTarget(null);
        }}
        onSubmit={handleDecommissionSubmit}
      />
      <MaintenanceStartDialog
        asset={maintenanceTarget}
        open={maintenanceOpen}
        onOpenChange={(open) => {
          setMaintenanceOpen(open);
          if (!open) setMaintenanceTarget(null);
        }}
        onSubmit={handleMaintenanceSubmit}
      />
    </div>
  );
}
