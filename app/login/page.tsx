'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [persalNumber, setPersalNumber] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordResetRequired, setPasswordResetRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (passwordResetRequired && newPassword !== confirmPassword) {
        setError('The new passwords do not match.');
        return;
      }
      const response = await fetch(
        passwordResetRequired
          ? '/api/auth/reset-inactive-password'
          : '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            passwordResetRequired
              ? {
                  persal_number: persalNumber,
                  current_password: password,
                  new_password: newPassword,
                }
              : { persal_number: persalNumber, password }
          ),
        }
      );
      const result = (await response.json()) as {
        error?: string;
        passwordResetRequired?: boolean;
      };
      if (!response.ok) {
        setError(
          'Login failed. If you have made five unsuccessful attempts or cannot remember your password, contact your administrator to unlock your account or issue a temporary password. You can sign in as soon as they confirm the change.'
        );
        return;
      }
      if (result.passwordResetRequired) {
        setPasswordResetRequired(true);
        setError(null);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Unable to reach the sign-in service. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/health-logo.avif"
            alt="Gauteng Department of Health logo"
            width={160}
            height={64}
            priority
            className="mb-4 h-16 w-40 object-cover"
          />
          <h1 className="text-xl font-bold text-foreground">
            Gauteng Health Assets Control
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {passwordResetRequired
              ? 'Your temporary password must be replaced before you can continue.'
              : 'Authorized personnel sign in to continue.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="persal_number">PERSAL number</Label>
            <Input
              id="persal_number"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              autoComplete="username"
              value={persalNumber}
              onChange={(event) =>
                setPersalNumber(event.target.value.replace(/\D/g, '').slice(0, 8))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Current password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {passwordResetRequired && (
            <>
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                Enter your temporary password above, then create a new password to continue.
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
                <Label htmlFor="confirm_new_password">Confirm new password</Label>
                <Input
                  id="confirm_new_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
            </>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting
              ? passwordResetRequired ? 'Resetting password…' : 'Signing in…'
              : passwordResetRequired ? 'Reset password and continue' : 'Sign in securely'}
          </Button>
        </form>

        <p className="mt-6 flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Access is restricted to approved users. Activity is subject to audit
          and unauthorized access is prohibited.
        </p>
      </Card>
    </main>
  );
}
