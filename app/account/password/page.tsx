'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  isStrongPassword,
  STRONG_PASSWORD_REQUIREMENTS,
} from '@/lib/password-policy.mjs';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (newPassword !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }
    if (!isStrongPassword(newPassword)) {
      setError(STRONG_PASSWORD_REQUIREMENTS);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to change password.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setMessage('Password updated. Other active sessions have been signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <Card className="p-6">
          <h2 className="text-xl font-bold">Change password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {STRONG_PASSWORD_REQUIREMENTS} Changing it signs out your other active
            sessions.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="rounded-md bg-success/10 p-3 text-sm text-success">
                {message}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="current_password">Current password</Label>
              <Input
                id="current_password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_password">Confirm new password</Label>
              <Input
                id="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Updating…' : 'Update password'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/')}>
                Back to register
              </Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
