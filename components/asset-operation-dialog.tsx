'use client';

import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EvidencePdfField } from '@/components/evidence-pdf-field';
import { AssetTagCameraScanner } from '@/components/asset-tag-camera-scanner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ASSET_CONDITIONS, type AssetOperationType, type HealthAsset } from '@/lib/types';

type AssetOperationDialogProps = {
  asset: HealthAsset | null;
  type: AssetOperationType | null;
  isAdminClerk: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (type: AssetOperationType, data: Record<string, string | number | boolean>, evidence: File) => Promise<void>;
};

const titles: Record<AssetOperationType, string> = {
  transfer: 'Transfer Asset to New Custodian',
  verification: 'Verify Asset',
  lifespan_extension: 'Review Asset Lifespan',
};

export function AssetOperationDialog({
  asset,
  type,
  isAdminClerk,
  open,
  onOpenChange,
  onSubmit,
}: AssetOperationDialogProps) {
  const [form, setForm] = useState<Record<string, string | number | boolean>>({});
  const [extensionValue, setExtensionValue] = useState('1');
  const [extensionUnit, setExtensionUnit] = useState<'months' | 'years'>('years');
  const [evidence, setEvidence] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verificationScannerOpen, setVerificationScannerOpen] = useState(false);
  const [verificationTagMessage, setVerificationTagMessage] = useState<{
    matches: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !type) return;
    setForm(type === 'transfer'
      ? { new_custodian_name: '', new_custodian_persal_number: '', transfer_date: new Date().toISOString().slice(0, 10), reason: '' }
      : type === 'verification'
        ? { found: true, observed_condition: asset?.condition ?? 'Good', observed_location: asset?.location ?? '', custodian_confirmed: true, notes: '' }
        : { inspected_condition: 'Good', reason: '' });
    setExtensionValue('1');
    setExtensionUnit('years');
    setEvidence(null);
    setError(null);
    setVerificationScannerOpen(false);
    setVerificationTagMessage(null);
  }, [open, type, asset]);

  const setValue = (key: string, value: string | number | boolean) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!type || !asset || !evidence) {
      setError('Complete the form and attach the required scanned PDF.');
      return;
    }
    if (
      type === 'lifespan_extension' &&
      (!/^\d+$/.test(extensionValue) ||
        Number(extensionValue) < 1 ||
        Number(extensionValue) * (extensionUnit === 'years' ? 12 : 1) > 1200)
    ) {
      setError('Enter an extension from 1 month to 100 years.');
      return;
    }
    setSaving(true);
    try {
      const data = type === 'lifespan_extension'
        ? { ...form, extension_months: Number(extensionValue) * (extensionUnit === 'years' ? 12 : 1) }
        : form;
      await onSubmit(type, data, evidence);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save the asset operation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{type ? titles[type] : 'Asset operation'}</DialogTitle>
          <DialogDescription>
            {asset ? `${asset.asset_tag} — ${asset.asset_name}` : 'Record an auditable asset operation.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

          {type === 'transfer' && (
            <>
              <div className="rounded-lg bg-muted p-3 text-sm">
                Current custodian: <strong>{asset?.custodian_name}</strong>
                {' · '}PERSAL: <strong>{asset?.persal_number}</strong>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="transfer_new_custodian">New custodian name *</Label>
                  <Input id="transfer_new_custodian" value={String(form.new_custodian_name ?? '')} onChange={(event) => setValue('new_custodian_name', event.target.value)} required maxLength={255} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transfer_new_persal">New custodian PERSAL *</Label>
                  <Input id="transfer_new_persal" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={String(form.new_custodian_persal_number ?? '')} onChange={(event) => setValue('new_custodian_persal_number', event.target.value.replace(/\D/g, '').slice(0, 8))} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer_date">Transfer date *</Label>
                <Input id="transfer_date" type="date" max={new Date().toISOString().slice(0, 10)} value={String(form.transfer_date ?? '')} onChange={(event) => setValue('transfer_date', event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer_reason">Reason for transfer *</Label>
                <Textarea id="transfer_reason" value={String(form.reason ?? '')} onChange={(event) => setValue('reason', event.target.value)} required maxLength={2000} rows={3} />
              </div>
            </>
          )}

          {type === 'verification' && (
            <>
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Confirm printed asset tag</p>
                    <p className="text-xs text-muted-foreground">
                      Expected tag: {asset?.asset_tag}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setVerificationTagMessage(null);
                      setVerificationScannerOpen(true);
                    }}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Read tag
                  </Button>
                </div>
                <AssetTagCameraScanner
                  active={verificationScannerOpen}
                  onDetected={(value) => {
                    const scannedTag = value.trim();
                    const matches = scannedTag.toLocaleUpperCase() ===
                      asset?.asset_tag.trim().toLocaleUpperCase();
                    setVerificationTagMessage({
                      matches,
                      text: matches
                        ? `Asset tag ${scannedTag} confirmed.`
                        : `Scanned ${scannedTag}, which does not match ${asset?.asset_tag}. Check the asset and scan again.`,
                    });
                    setVerificationScannerOpen(false);
                  }}
                  onClose={() => setVerificationScannerOpen(false)}
                />
                {verificationTagMessage && (
                  <p
                    className={`text-sm ${verificationTagMessage.matches ? 'text-green-700 dark:text-green-400' : 'text-destructive'}`}
                    role={verificationTagMessage.matches ? 'status' : 'alert'}
                  >
                    {verificationTagMessage.text}
                  </p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Asset found at verification? *</Label>
                  <Select value={String(form.found)} onValueChange={(value) => {
                    const found = value === 'true';
                    setValue('found', found);
                    if (!found) {
                      setValue('verified_custodian_name', '');
                      setValue('verified_custodian_persal_number', '');
                    }
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="true">Found</SelectItem><SelectItem value="false">Not found</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Observed condition *</Label>
                  <Select value={String(form.observed_condition ?? '')} onValueChange={(value) => setValue('observed_condition', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ASSET_CONDITIONS.map((condition) => <SelectItem key={condition} value={condition}>{condition}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="verification_location">Observed location *</Label>
                <Input id="verification_location" value={String(form.observed_location ?? '')} onChange={(event) => setValue('observed_location', event.target.value)} required maxLength={255} />
              </div>
              <div className="space-y-2">
                <Label>Current custodian confirmed? *</Label>
                <Select value={String(form.custodian_confirmed)} onValueChange={(value) => {
                  const confirmed = value === 'true';
                  setValue('custodian_confirmed', confirmed);
                  if (confirmed) {
                    setValue('verified_custodian_name', '');
                    setValue('verified_custodian_persal_number', '');
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="true">Confirmed</SelectItem><SelectItem value="false">Not confirmed</SelectItem></SelectContent>
                </Select>
              </div>
              {isAdminClerk && form.found === true && form.custodian_confirmed === false && (
                <>
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                    Enter the person found responsible for the asset. This updates the official custodian during verification and is recorded in the asset audit history; no separate transfer document is required.
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="verification_custodian_name">Custodian found with asset *</Label>
                      <Input id="verification_custodian_name" value={String(form.verified_custodian_name ?? '')} onChange={(event) => setValue('verified_custodian_name', event.target.value)} required maxLength={255} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verification_custodian_persal">Custodian PERSAL *</Label>
                      <Input id="verification_custodian_persal" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={String(form.verified_custodian_persal_number ?? '')} onChange={(event) => setValue('verified_custodian_persal_number', event.target.value.replace(/\D/g, '').slice(0, 8))} required />
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="verification_notes">Verification notes</Label>
                <Textarea id="verification_notes" value={String(form.notes ?? '')} onChange={(event) => setValue('notes', event.target.value)} maxLength={2000} rows={3} />
              </div>
              <p className="text-xs text-muted-foreground">Use the Lost Asset workflow to formally report a missing asset. During verification, only an Admin Clerk can correct the custodian details; other asset register details are not changed.</p>
            </>
          )}

          {type === 'lifespan_extension' && (
            <>
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                Useful life expired on <strong>{asset?.useful_life_end_date?.slice(0, 10)}</strong>. Extension is permitted only after a good-condition inspection.
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="extension_value">Additional useful life *</Label>
                  <Input id="extension_value" type="number" min={1} max={extensionUnit === 'years' ? 100 : 1200} step={1} value={extensionValue} onChange={(event) => setExtensionValue(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Unit *</Label>
                  <Select value={extensionUnit} onValueChange={(value: 'months' | 'years') => setExtensionUnit(value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="months">Months</SelectItem><SelectItem value="years">Years</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Inspection condition *</Label>
                <Select value={String(form.inspected_condition ?? 'Good')} onValueChange={(value) => setValue('inspected_condition', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Excellent">Excellent</SelectItem><SelectItem value="Good">Good</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="extension_reason">Inspection and extension justification *</Label>
                <Textarea id="extension_reason" value={String(form.reason ?? '')} onChange={(event) => setValue('reason', event.target.value)} required maxLength={2000} rows={3} />
              </div>
            </>
          )}

          <EvidencePdfField id="asset_operation_evidence" file={evidence} onChange={setEvidence} title="Scanned evidence (PDF)" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !type}>{saving ? 'Saving...' : type === 'transfer' ? 'Transfer custodian' : type === 'verification' ? 'Record verification' : 'Extend useful life'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
