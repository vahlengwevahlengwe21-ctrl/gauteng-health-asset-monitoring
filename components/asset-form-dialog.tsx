'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Camera, FileText, Loader2 } from 'lucide-react';
import { AssetTagCameraScanner } from '@/components/asset-tag-camera-scanner';
import {
  GAUTENG_DISTRICTS,
  GAUTENG_SUB_DISTRICTS,
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  type HealthAsset,
  type AssetFormData,
  type FacilityDirectoryEntry,
} from '@/lib/types';

type AssetFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: AssetFormData, evidence?: File) => Promise<void>;
  editingAsset?: HealthAsset | null;
  facilities: FacilityDirectoryEntry[];
  assignedDistrict?: string | null;
};

const emptyForm: AssetFormData = {
  asset_tag: '',
  asset_name: '',
  facility_name: '',
  location: '',
  room_number: '',
  custodian_name: '',
  persal_number: '',
  serial_imei_number: '',
  district: '',
  sub_district: '',
  category: '',
  status: 'Active',
  condition: 'Good',
  acquisition_date: '',
  useful_life_months: null,
  useful_life_end_date: null,
  value: null,
  notes: '',
};

export function AssetFormDialog({
  open,
  onOpenChange,
  onSave,
  editingAsset,
  facilities,
  assignedDistrict,
}: AssetFormDialogProps) {
  const [form, setForm] = useState<AssetFormData>(
    editingAsset
      ? { ...editingAsset, acquisition_date: editingAsset.acquisition_date ?? '', value: editingAsset.value ?? null }
      : { ...emptyForm, district: assignedDistrict ?? '' }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facilityOther, setFacilityOther] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [scanningAssetTag, setScanningAssetTag] = useState(false);
  const [assetTagScanNotice, setAssetTagScanNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      editingAsset
        ? {
            ...editingAsset,
            acquisition_date: editingAsset.acquisition_date ?? '',
            value: editingAsset.value ?? null,
          }
        : { ...emptyForm, district: assignedDistrict ?? '' }
    );
    setError(null);
    setFacilityOther(false);
    setEvidenceFile(null);
    setScanningAssetTag(false);
    setAssetTagScanNotice(null);
  }, [open, editingAsset, assignedDistrict]);

  const availableSubDistricts = form.district
    ? GAUTENG_SUB_DISTRICTS[form.district] ?? []
    : [];
  const availableFacilities = facilities.filter(
    (facility) =>
      facility.district === form.district &&
      (!form.sub_district ||
        facility.sub_district === form.sub_district)
  );
  const existingFacility = availableFacilities.find(
    (facility) =>
      facility.facility_name.trim().toLocaleLowerCase() ===
      form.facility_name.trim().toLocaleLowerCase()
  );
  const facilitySelectValue = facilityOther
    ? '__other__'
    : existingFacility
      ? existingFacility.id
      : form.facility_name
        ? '__other__'
        : undefined;
  const facilityNameCounts = new Map<string, number>();
  for (const facility of availableFacilities) {
    const name = facility.facility_name.trim().toLocaleLowerCase();
    facilityNameCounts.set(name, (facilityNameCounts.get(name) ?? 0) + 1);
  }

  const isEditing = !!editingAsset;

  const update = <K extends keyof AssetFormData>(key: K, value: AssetFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (
      !form.asset_tag.trim() ||
      !form.asset_name.trim() ||
      !form.facility_name.trim() ||
      !form.location.trim() ||
      !form.room_number?.trim() ||
      !form.custodian_name?.trim() ||
      !/^\d{8}$/.test(form.persal_number?.trim() ?? '') ||
      !form.district.trim() ||
      !form.sub_district?.trim() ||
      !form.category?.trim() ||
      !form.status.trim() ||
      !form.condition.trim() ||
      !form.acquisition_date ||
      !Number.isInteger(form.useful_life_months) ||
      !form.useful_life_months ||
      form.useful_life_months < 1 ||
      form.useful_life_months > 1200 ||
      form.value === null ||
      !Number.isFinite(form.value) ||
      form.value < 0
    ) {
      setError('Please complete all required fields. PERSAL Number must contain exactly 8 digits.');
      return;
    }
    if (!isEditing && !evidenceFile) {
      setError('Attach the scanned PDF evidence document used when barcoding this asset.');
      return;
    }
    if (
      evidenceFile &&
      (!evidenceFile.name.toLocaleLowerCase().endsWith('.pdf') ||
        evidenceFile.size === 0 ||
        evidenceFile.size > 10 * 1024 * 1024)
    ) {
      setError('Evidence must be a PDF file no larger than 10 MB.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...form,
        asset_tag: form.asset_tag.trim(),
        asset_name: form.asset_name.trim(),
        facility_name: form.facility_name.trim(),
        location: form.location.trim(),
        custodian_name: form.custodian_name?.trim() || '',
        persal_number: form.persal_number?.trim() || '',
        serial_imei_number: form.serial_imei_number?.trim() || null,
        sub_district: form.sub_district.trim(),
        room_number: form.room_number.trim(),
        notes: form.notes?.trim() || null,
        acquisition_date: form.acquisition_date,
        value: form.value,
      }, evidenceFile ?? undefined);
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save asset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setError(null);
          setForm(
            editingAsset
              ? {
                  ...editingAsset,
                  acquisition_date: editingAsset.acquisition_date ?? '',
                  value: editingAsset.value ?? null,
                }
              : { ...emptyForm, district: assignedDistrict ?? '' }
          );
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Asset' : 'Register New Asset'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the asset details below.'
              : 'Enter the details for the new health asset.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="asset_tag">
                Asset Tag <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="asset_tag"
                  className="min-w-0"
                  placeholder="Type or photograph printed asset tag, e.g. TDHS-00000"
                  value={form.asset_tag}
                  onChange={(e) => {
                    update('asset_tag', e.target.value);
                    setAssetTagScanNotice(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  aria-label="Read printed asset tag with camera"
                  onClick={() => {
                    setAssetTagScanNotice(null);
                    setScanningAssetTag(true);
                  }}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Read tag
                </Button>
              </div>
              <AssetTagCameraScanner
                active={scanningAssetTag}
                onDetected={(value) => {
                  const assetTag = value.trim();
                  if (!assetTag) {
                    setAssetTagScanNotice('No printed text was detected. Try capturing it again.');
                    setScanningAssetTag(false);
                    return;
                  }
                  update('asset_tag', assetTag);
                  setAssetTagScanNotice('Printed text copied. Verify the asset tag before saving.');
                  setScanningAssetTag(false);
                }}
                onClose={() => setScanningAssetTag(false)}
              />
              {assetTagScanNotice && (
                <p className="text-sm text-muted-foreground" role="status">
                  {assetTagScanNotice}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Type the tag or take a clear photo of its printed text. Free Google Gemini processing may use submissions to improve Google services, and human reviewers may process them. Do not photograph confidential or personal information. The app does not save the photo; check the transcription before saving.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset_name">
                Asset Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="asset_name"
                placeholder="e.g. Patient Monitor"
                value={form.asset_name}
                onChange={(e) => update('asset_name', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="facility_name_select">
                Facility Name <span className="text-destructive">*</span>
              </Label>
              <Select
                value={facilitySelectValue}
                onValueChange={(value) => {
                  if (value === '__other__') {
                    setFacilityOther(true);
                    if (existingFacility) update('facility_name', '');
                    return;
                  }
                  setFacilityOther(false);
                  const facility = availableFacilities.find(
                    (entry) => entry.id === value
                  );
                  if (!facility) return;
                  update('facility_name', facility.facility_name);
                  if (facility?.sub_district) {
                    update('sub_district', facility.sub_district);
                  }
                }}
                disabled={!form.district}
              >
                <SelectTrigger id="facility_name_select">
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {availableFacilities.map((facility) => (
                    <SelectItem key={facility.id} value={facility.id}>
                      {facility.facility_name}
                      {(facilityNameCounts.get(
                        facility.facility_name.trim().toLocaleLowerCase()
                      ) ?? 0) > 1
                        ? ` — ${facility.sub_district ?? 'Sub-district not recorded'}`
                        : ''}
                    </SelectItem>
                  ))}
                  <SelectItem value="__other__">
                    Other — enter facility name
                  </SelectItem>
                </SelectContent>
              </Select>
              {facilitySelectValue === '__other__' && (
                <Input
                  id="facility_name"
                  placeholder="Enter facility name"
                  value={form.facility_name}
                  onChange={(e) => update('facility_name', e.target.value)}
                  required
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="district">
                District <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.district || undefined}
                onValueChange={(v) => {
                  update('district', v);
                  update('sub_district', '');
                  update('facility_name', '');
                  setFacilityOther(false);
                }}
                disabled={Boolean(assignedDistrict)}
              >
                <SelectTrigger id="district">
                  <SelectValue placeholder="Select district" />
                </SelectTrigger>
                <SelectContent>
                  {(assignedDistrict ? [assignedDistrict] : GAUTENG_DISTRICTS).map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sub_district">
                Sub-District <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.sub_district || undefined}
                onValueChange={(v) => {
                  update('sub_district', v);
                  update('facility_name', '');
                  setFacilityOther(false);
                }}
                disabled={availableSubDistricts.length === 0}
              >
                <SelectTrigger id="sub_district">
                  <SelectValue
                    placeholder={
                      availableSubDistricts.length === 0
                        ? 'Select a district first'
                        : 'Select sub-district'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableSubDistricts.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="location">
                Location <span className="text-destructive">*</span>
              </Label>
              <Input
                id="location"
                placeholder="e.g. Ward 3, ICU"
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room_number">
                Room Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="room_number"
                placeholder="e.g. R-204"
                value={form.room_number ?? ''}
                onChange={(e) => update('room_number', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custodian_name">
              Custodian Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="custodian_name"
              placeholder="e.g. Dr. N. Mthembu"
              value={form.custodian_name ?? ''}
              onChange={(e) => update('custodian_name', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="persal_number">
                PERSAL Number (8 digits) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="persal_number"
                placeholder="e.g. 01234567"
                inputMode="numeric"
                maxLength={8}
                pattern="[0-9]{8}"
                title="Enter exactly 8 digits."
                value={form.persal_number ?? ''}
                onChange={(e) => update('persal_number', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serial_imei_number">
                Serial Number / IMEI Number <span className="text-muted-foreground">(Optional)</span>
              </Label>
              <Input
                id="serial_imei_number"
                placeholder="Type or scan serial number / IMEI"
                value={form.serial_imei_number ?? ''}
                onChange={(e) => update('serial_imei_number', e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Optional. No scanner required: type the serial number or IMEI, or scan the device label. Scanner Enter will not submit the form.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>
                Category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.category || undefined}
                onValueChange={(v) => update('category', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {form.status}
              </div>
              <p className="text-xs text-muted-foreground">
                Update lifecycle status through the maintenance or approval workflow.
              </p>
            </div>
            <div className="space-y-2">
              <Label>
                Condition <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.condition}
                onValueChange={(v) => update('condition', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="acquisition_date">
                Acquisition Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="acquisition_date"
                type="date"
                value={form.acquisition_date ?? ''}
                onChange={(e) => update('acquisition_date', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="useful_life_months">
                Useful life (months) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="useful_life_months"
                type="number"
                min={1}
                max={1200}
                step={1}
                value={form.useful_life_months ?? ''}
                disabled={isEditing && form.useful_life_months !== null}
                onChange={(e) =>
                  update(
                    'useful_life_months',
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                The end date is calculated from acquisition. After registration, use the lifespan review to extend it.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">
                Value (R) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="value"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.value ?? ''}
                required
                onChange={(e) =>
                  update('value', e.target.value ? parseFloat(e.target.value) : null)
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes about this asset..."
              value={form.notes ?? ''}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
            />
          </div>

          {!isEditing && (
            <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
              <Label htmlFor="asset-evidence">
                Barcode evidence document (PDF) <span className="text-destructive">*</span>
              </Label>
              <p className="text-sm text-muted-foreground">
                Scan and attach the document used when you go to barcode this asset. PDF only, maximum 10 MB.
              </p>
              <Input
                id="asset-evidence"
                type="file"
                accept="application/pdf,.pdf"
                required
                onChange={(event) =>
                  setEvidenceFile(event.target.files?.[0] ?? null)
                }
              />
              {evidenceFile && (
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <FileText className="h-4 w-4 text-primary" />
                  {evidenceFile.name}
                </p>
              )}
            </div>
          )}
          {isEditing && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Barcode evidence</p>
              {editingAsset?.evidence_file_name ? (
                <a
                  className="mt-1 inline-block text-primary underline underline-offset-4"
                  href={`/api/assets/${encodeURIComponent(editingAsset.id)}/evidence`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View {editingAsset.evidence_file_name}
                </a>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  No registration evidence is attached to this existing asset.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Update Asset' : 'Register Asset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
