'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  Download,
  Package,
  ShieldAlert,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Header } from '@/components/header';
import { isSystemWideAdministrator } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchFacilities } from '@/lib/facilities';
import {
  GAUTENG_DISTRICTS,
  GAUTENG_SUB_DISTRICTS,
  type FacilityDirectoryEntry,
} from '@/lib/types';
import type { AuthenticatedUser } from '@/lib/auth';

type ReportBreakdown = {
  label: string;
  assetCount: number;
  bookValue: number;
};

type FacilityReportRow = {
  facilityName: string;
  district: string;
  subDistrict: string;
  assetCount: number;
  bookValue: number;
  activeAssets: number;
  needsAttention: number;
  verificationDue: number;
};

type AssetReport = {
  filters: {
    district: string;
    subDistrict: string;
    facilityName: string | null;
  };
  summary: {
    totalAssets: number;
    totalValue: number;
    valuedAssets: number;
    activeAssets: number;
    needsAttention: number;
    verificationDue: number;
    custodians: number;
  };
  status: ReportBreakdown[];
  categories: ReportBreakdown[];
  conditions: ReportBreakdown[];
  districts: ReportBreakdown[];
  subDistricts: ReportBreakdown[];
  facilities: FacilityReportRow[];
  acquisitions: Array<{
    year: number;
    assetCount: number;
    bookValue: number;
  }>;
};

const CHART_COLORS = [
  '#147d73',
  '#2563eb',
  '#f59e0b',
  '#9333ea',
  '#0891b2',
  '#e11d48',
  '#65a30d',
  '#64748b',
];

const integerFormatter = new Intl.NumberFormat('en-ZA');
const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 2,
});

function formatNumber(value: number): string {
  return integerFormatter.format(value);
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function formatCsvCell(value: string | number): string {
  const text = String(value);
  const safeText = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export default function AssetReportsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [facilities, setFacilities] = useState<FacilityDirectoryEntry[]>([]);
  const [report, setReport] = useState<AssetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [district, setDistrict] = useState('all');
  const [subDistrict, setSubDistrict] = useState('all');
  const [facilityId, setFacilityId] = useState('all');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch('/api/auth/me'), fetchFacilities()])
      .then(async ([userResponse, facilityEntries]) => {
        if (userResponse.status === 401) {
          router.replace('/login');
          return;
        }
        if (!userResponse.ok) {
          throw new Error('Unable to verify report access.');
        }
        const result = (await userResponse.json()) as { user: AuthenticatedUser };
        if (result.user.role === 'admin_clerk') {
          router.replace('/');
          return;
        }
        if (cancelled) return;
        setUser(result.user);
        setFacilities(facilityEntries);
        if (!isSystemWideAdministrator(result.user.role) && result.user.district) {
          setDistrict(result.user.district);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load report access and facilities.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const availableSubDistricts = useMemo(() => {
    if (district !== 'all') return GAUTENG_SUB_DISTRICTS[district] ?? [];
    return Array.from(new Set(Object.values(GAUTENG_SUB_DISTRICTS).flat())).sort();
  }, [district]);

  const availableFacilities = useMemo(
    () =>
      facilities.filter(
        (entry) =>
          (district === 'all' || entry.district === district) &&
          (subDistrict === 'all' || entry.sub_district === subDistrict)
      ),
    [district, facilities, subDistrict]
  );

  const selectedFacility = availableFacilities.find(
    (entry) => entry.id === facilityId
  );

  const loadReport = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      district,
      subDistrict,
    });
    if (selectedFacility) {
      params.set('facilityName', selectedFacility.facility_name);
      params.set('facilityDistrict', selectedFacility.district);
      if (selectedFacility.sub_district) {
        params.set('facilitySubDistrict', selectedFacility.sub_district);
      }
    }

    try {
      const response = await fetch(`/api/reports/assets?${params.toString()}`, {
        cache: 'no-store',
      });
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (response.status === 403) {
        router.replace('/');
        return;
      }
      const result = (await response.json()) as AssetReport | { error?: string };
      if (!response.ok || !('summary' in result)) {
        throw new Error(
          'error' in result && result.error
            ? result.error
            : 'Unable to load the asset report.'
        );
      }
      setReport(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load the asset report.'
      );
    } finally {
      setLoading(false);
    }
  }, [district, router, selectedFacility, subDistrict, user]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const exportCsv = () => {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const headers = [
        'District',
        'Sub-district',
        'Facility',
        'Asset count',
        'Active assets',
        'Book value (ZAR)',
        'Needs attention',
        'Verification due',
      ];
      const rows = report.facilities.map((facility) => [
        facility.district,
        facility.subDistrict,
        facility.facilityName,
        facility.assetCount,
        facility.activeAssets,
        facility.bookValue.toFixed(2),
        facility.needsAttention,
        facility.verificationDue,
      ]);
      const content = [headers, ...rows]
        .map((row) => row.map(formatCsvCell).join(','))
        .join('\r\n');
      const file = new Blob(['\uFEFF', content], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gauteng-health-asset-report.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? `Report export failed: ${exportError.message}`
          : 'Report export failed.'
      );
    } finally {
      setExporting(false);
    }
  };

  const summaries = report
    ? [
        {
          label: 'Registered assets',
          value: formatNumber(report.summary.totalAssets),
          detail: `${formatNumber(report.summary.valuedAssets)} with recorded value`,
          icon: Package,
          accent: 'text-primary bg-accent',
        },
        {
          label: 'Recorded book value',
          value: formatCurrency(report.summary.totalValue),
          detail: 'Sum of recorded asset values',
          icon: Building2,
          accent: 'text-success bg-success/10',
        },
        {
          label: 'Active assets',
          value: formatNumber(report.summary.activeAssets),
          detail: `${formatNumber(report.summary.custodians)} named custodians`,
          icon: Users,
          accent: 'text-info bg-info/10',
        },
        {
          label: 'Needs attention',
          value: formatNumber(report.summary.needsAttention),
          detail: `${formatNumber(report.summary.verificationDue)} verification due`,
          icon: AlertTriangle,
          accent: 'text-destructive bg-destructive/10',
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Asset register
              </Link>
            </Button>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Asset intelligence
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              A complete view of recorded inventory, estimated book value,
              condition, verification, and regional distribution.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={!report || loading || exporting || report.facilities.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? 'Preparing report…' : 'Export facility report'}
          </Button>
        </div>

        <Card className="p-4">
          <div className="mb-3">
            <h3 className="font-semibold text-foreground">Report scope</h3>
            <p className="text-xs text-muted-foreground">
              Narrow the report from district to sub-district and facility.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              value={district}
              onValueChange={(value) => {
                setDistrict(value);
                setSubDistrict('all');
                setFacilityId('all');
              }}
              disabled={initializing || !user || !isSystemWideAdministrator(user.role)}
            >
              <SelectTrigger aria-label="Report district">
                <SelectValue placeholder="Select district" />
              </SelectTrigger>
              <SelectContent>
                {user && isSystemWideAdministrator(user.role) && (
                  <SelectItem value="all">All Gauteng districts</SelectItem>
                )}
                {GAUTENG_DISTRICTS.filter(
                  (entry) =>
                    (user && isSystemWideAdministrator(user.role)) ||
                    entry === user?.district
                ).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={subDistrict}
              onValueChange={(value) => {
                setSubDistrict(value);
                setFacilityId('all');
              }}
              disabled={initializing || availableSubDistricts.length === 0}
            >
              <SelectTrigger aria-label="Report sub-district">
                <SelectValue placeholder="All sub-districts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sub-districts</SelectItem>
                {availableSubDistricts.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={facilityId}
              onValueChange={setFacilityId}
              disabled={initializing || availableFacilities.length === 0}
            >
              <SelectTrigger aria-label="Report facility">
                <SelectValue placeholder="All facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All facilities</SelectItem>
                {availableFacilities.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.facility_name} · {entry.sub_district ?? entry.district}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>

        {error && (
          <Card
            role="alert"
            className="border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error}
          </Card>
        )}

        {loading && !report ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Building the asset report…
          </Card>
        ) : report ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaries.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.label} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          {item.label}
                        </p>
                        <p className="mt-2 truncate text-xl font-bold text-foreground sm:text-2xl">
                          {item.value}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.detail}
                        </p>
                      </div>
                      <span className={`rounded-lg p-2 ${item.accent}`}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="font-semibold text-foreground">Inventory by status</h3>
                  <p className="text-xs text-muted-foreground">
                    Count of all registered assets in the selected scope.
                  </p>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.status} layout="vertical" margin={{ left: 8, right: 18 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tickFormatter={(value) => formatNumber(Number(value))} />
                      <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value) => formatNumber(Number(value))} />
                      <Bar dataKey="assetCount" name="Assets" fill="#147d73" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <BreakdownTable rows={report.status} />
              </Card>

              <Card className="p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="font-semibold text-foreground">Condition profile</h3>
                  <p className="text-xs text-muted-foreground">
                    Recorded condition distribution for this selection.
                  </p>
                </div>
                {report.conditions.length ? (
                  <>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={report.conditions}
                            dataKey="assetCount"
                            nameKey="label"
                            innerRadius={58}
                            outerRadius={92}
                            paddingAngle={3}
                          >
                            {report.conditions.map((entry, index) => (
                              <Cell
                                key={entry.label}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => formatNumber(Number(value))} />
                          <Legend verticalAlign="bottom" height={40} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <BreakdownTable rows={report.conditions} />
                  </>
                ) : (
                  <EmptyChart />
                )}
              </Card>

              <Card className="p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="font-semibold text-foreground">Assets by category</h3>
                  <p className="text-xs text-muted-foreground">
                    Category counts with the related recorded book values.
                  </p>
                </div>
                {report.categories.length ? (
                  <>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={report.categories} margin={{ left: 0, right: 12, bottom: 30 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={68} tick={{ fontSize: 10 }} />
                          <YAxis allowDecimals={false} tickFormatter={(value) => formatNumber(Number(value))} />
                          <Tooltip formatter={(value) => formatNumber(Number(value))} />
                          <Bar dataKey="assetCount" name="Assets" fill="#2563eb" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <BreakdownTable rows={report.categories} />
                  </>
                ) : (
                  <EmptyChart />
                )}
              </Card>

              <Card className="p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="font-semibold text-foreground">Acquisition timeline</h3>
                  <p className="text-xs text-muted-foreground">
                    Assets grouped by recorded acquisition year.
                  </p>
                </div>
                {report.acquisitions.length ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.acquisitions} margin={{ left: 0, right: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tickFormatter={(value) => formatNumber(Number(value))} />
                        <Tooltip formatter={(value) => formatNumber(Number(value))} />
                        <Bar dataKey="assetCount" name="Assets acquired" fill="#9333ea" radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChart message="No acquisition dates are recorded for this selection." />
                )}
              </Card>
            </div>

            {(district === 'all' || subDistrict === 'all') && (
              <div className="grid gap-4 lg:grid-cols-2">
                {district === 'all' && (
                  <BreakdownCard title="District comparison" rows={report.districts} />
                )}
                {subDistrict === 'all' && (
                  <BreakdownCard title="Sub-district comparison" rows={report.subDistricts} />
                )}
              </div>
            )}

            <Card className="overflow-hidden p-0">
              <div className="flex flex-col justify-between gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:p-5">
                <div>
                  <h3 className="font-semibold text-foreground">Facility asset register</h3>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(report.facilities.length)} facility groups · book value, condition alerts, and verification workload.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5 text-success" /> Active assets</span>
                  <span className="flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5 text-destructive" /> Verification due</span>
                </div>
              </div>
              {report.facilities.length ? (
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Facility</th>
                        <th className="px-4 py-3 font-medium">Sub-district / District</th>
                        <th className="px-4 py-3 text-right font-medium">Assets</th>
                        <th className="px-4 py-3 text-right font-medium">Book value</th>
                        <th className="px-4 py-3 text-right font-medium">Active</th>
                        <th className="px-4 py-3 text-right font-medium">Needs attention</th>
                        <th className="px-4 py-3 text-right font-medium">Verification due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.facilities.map((facility) => (
                        <tr
                          key={`${facility.district}|${facility.subDistrict}|${facility.facilityName}`}
                          className="border-t border-border hover:bg-muted/40"
                        >
                          <td className="px-4 py-3 font-medium text-foreground">
                            {facility.facilityName}
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {facility.district}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{facility.subDistrict}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(facility.assetCount)}</td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(facility.bookValue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(facility.activeAssets)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(facility.needsAttention)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(facility.verificationDue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-6 text-sm text-muted-foreground">
                  No registered assets match this report scope.
                </p>
              )}
            </Card>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Book value is the sum of recorded asset values; assets without a recorded value contribute zero. Report totals reflect registered asset records in the selected scope. Verify financial and regional assignments against source records before formal submission.
            </p>
          </>
        ) : !error && !initializing ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No report data is available for this scope.
          </Card>
        ) : null}
      </main>
    </div>
  );
}

function EmptyChart({ message = 'No data is available for this scope.' }: { message?: string }) {
  return (
    <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: ReportBreakdown[];
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">Asset count and recorded book value.</p>
      </div>
      {rows.length ? (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 28 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tickFormatter={(value) => formatNumber(Number(value))}
                />
                <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => formatNumber(Number(value))} />
                <Bar dataKey="assetCount" name="Assets" fill="#147d73" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <BreakdownTable rows={rows} />
        </>
      ) : (
        <EmptyChart />
      )}
    </Card>
  );
}

function BreakdownTable({ rows }: { rows: ReportBreakdown[] }) {
  return (
    <div className="mt-3 max-h-44 overflow-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Group</th>
            <th className="px-3 py-2 text-right font-medium">Assets</th>
            <th className="px-3 py-2 text-right font-medium">Book value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="px-3 py-2">{row.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.assetCount)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.bookValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
