'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { APP_ROLES, ROLE_DETAILS } from '@/lib/roles';
import { GAUTENG_DISTRICTS } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AppRole } from '@/lib/auth';

type ManagedUser = {
  id: string;
  display_name: string;
  surname: string | null;
  persal_number: string;
  email: string | null;
  contact_number: string | null;
  district: string | null;
  role: AppRole;
  is_active: number;
  is_protected: number;
  failed_login_attempts: number;
  is_locked: number;
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isSuperAdministrator, setIsSuperAdministrator] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [surname, setSurname] = useState('');
  const [persalNumber, setPersalNumber] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole | ''>('');
  const [district, setDistrict] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<{
    userId: string;
    value: string;
  } | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [unlockingUserId, setUnlockingUserId] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    display_name: '',
    surname: '',
    email: '',
    contact_number: '',
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/users');
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (response.status === 403) {
        router.replace('/');
        return;
      }
      const result = (await response.json()) as
        | ManagedUser[]
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          !Array.isArray(result) ? result.error || 'Unable to load users.' : 'Unable to load users.'
        );
      }
      setUsers(result as ManagedUser[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to verify your account role.');
        const result = (await response.json()) as {
          user: { role: AppRole };
        };
        setIsSuperAdministrator(
          result.user.role === 'super_administrator'
        );
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to verify your account role.'
        );
      });
    loadUsers();
  }, [loadUsers]);

  const addUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (
      displayName.trim().length < 2 ||
      surname.trim().length < 2 ||
      !/^\d{8}$/.test(persalNumber) ||
      !email.trim() ||
      !contactNumber.trim() ||
      password.length < 12 ||
      !role ||
      !GAUTENG_DISTRICTS.includes(
        district as (typeof GAUTENG_DISTRICTS)[number]
      )
    ) {
      setError('Complete every required field before creating the account.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          surname,
          persal_number: persalNumber,
          email,
          contact_number: contactNumber,
          password,
          role,
          district,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to add user.');
      setDisplayName('');
      setSurname('');
      setPersalNumber('');
      setEmail('');
      setContactNumber('');
      setPassword('');
      setRole('');
      setDistrict('');
      setMessage('User account created.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add user.');
    } finally {
      setSaving(false);
    }
  };

  const editUserProfile = (user: ManagedUser) => {
    setEditingUserId(user.id);
    setProfileDraft({
      display_name: user.display_name,
      surname: user.surname ?? '',
      email: user.email ?? '',
      contact_number: user.contact_number ?? '',
    });
  };

  const saveUserProfile = async (user: ManagedUser) => {
    if (
      profileDraft.display_name.trim().length < 2 ||
      profileDraft.surname.trim().length < 2 ||
      !profileDraft.email.trim() ||
      !profileDraft.contact_number.trim() ||
      !user.district
    ) {
      setError('Complete the profile fields and assign a district before saving.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: user.role,
            is_active: Boolean(user.is_active),
            district: user.district,
            ...profileDraft,
          }),
        }
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to update the user profile.');
      }
      setEditingUserId(null);
      setMessage('User profile updated.');
      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to update the user profile.'
      );
    }
  };

  const updateUser = async (
    user: ManagedUser,
    nextRole: AppRole,
    isActive: boolean,
    nextDistrict: string | null = user.district
  ) => {
    if (
      !nextDistrict ||
      !GAUTENG_DISTRICTS.includes(
        nextDistrict as (typeof GAUTENG_DISTRICTS)[number]
      )
    ) {
      setError('Assign a district to this account before changing its access.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: nextRole,
          is_active: isActive,
          district: nextDistrict,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to update user.');
      setMessage('User permissions updated.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user.');
    }
  };

  const resetUserPassword = async (user: ManagedUser) => {
    if (
      !window.confirm(
        `Reset the password for ${user.display_name} ${user.surname || ''}? Their current sessions will be signed out.`
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setTemporaryPassword(null);
    setResettingUserId(user.id);
    setResettingPassword(true);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.id)}/reset-password`,
        { method: 'POST' }
      );
      const result = (await response.json()) as {
        error?: string;
        temporaryPassword?: string;
      };
      if (!response.ok || !result.temporaryPassword) {
        throw new Error(result.error || 'Unable to reset the user password.');
      }
      setTemporaryPassword({ userId: user.id, value: result.temporaryPassword });
      setMessage(
        'Password reset. Share the temporary password securely; the user must replace it at their next sign-in.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset the user password.');
    } finally {
      setResettingPassword(false);
      setResettingUserId(null);
    }
  };

  const copyTemporaryPassword = async () => {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword.value);
      setMessage('Temporary password copied. Share it securely with the user.');
    } catch {
      setError('Unable to copy the temporary password. Select and copy it manually.');
    }
  };

  const unlockUser = async (user: ManagedUser) => {
    setError(null);
    setMessage(null);
    setUnlockingUserId(user.id);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.id)}/unlock`,
        { method: 'POST' }
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to unlock the user account.');
      }
      setMessage(`${user.display_name}'s account is unlocked.`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to unlock the user account.');
    } finally {
      setUnlockingUserId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div>
          <h2 className="text-2xl font-bold text-foreground">User management</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All fields are required. Each staff account is restricted to its assigned
            district; only the Super Administrator can access all districts.
          </p>
        </div>
        {(error || message) && (
          <Card
            role={error ? 'alert' : 'status'}
            className={`p-4 text-sm ${error ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'text-success'}`}
          >
            {error || message}
          </Card>
        )}
        <Card className="p-5">
          <h3 className="font-semibold">Add a user</h3>
          <form onSubmit={addUser} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="display_name">First name</Label>
              <Input
                id="display_name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={150}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_work_email">Work email address</Label>
              <Input
                id="user_work_email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_contact_number">Contact number</Label>
              <Input
                id="user_contact_number"
                type="tel"
                autoComplete="tel"
                value={contactNumber}
                onChange={(event) => setContactNumber(event.target.value)}
                required
                minLength={7}
                maxLength={30}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_surname">Surname</Label>
              <Input
                id="user_surname"
                value={surname}
                onChange={(event) => setSurname(event.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_persal_number">PERSAL number</Label>
              <Input
                id="user_persal_number"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{8}"
                maxLength={8}
                value={persalNumber}
                onChange={(event) =>
                  setPersalNumber(event.target.value.replace(/\D/g, '').slice(0, 8))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_password">Temporary password</Label>
              <Input
                id="user_password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={12}
                maxLength={128}
              />
              <p className="text-xs text-muted-foreground">
                Use at least 12 characters and share it securely. The user will be required to set a new password at first sign-in.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_role">System role and permissions</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as AppRole)}
                disabled={!isSuperAdministrator}
              >
                <SelectTrigger id="user_role" aria-required="true">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {APP_ROLES.filter(
                    (item) =>
                      item !== 'super_administrator' ||
                      isSuperAdministrator
                  ).map((item) => (
                    <SelectItem key={item} value={item}>
                      {ROLE_DETAILS[item].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {role ? `${ROLE_DETAILS[role].label}: ` : ''}
                </span>
                  {role ? ROLE_DETAILS[role].description : 'Select a role to view its permissions.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user_district">District</Label>
              <Select value={district} onValueChange={setDistrict}>
                  <SelectTrigger id="user_district" aria-required="true">
                    <SelectValue placeholder="Select a district" />
                  </SelectTrigger>
                  <SelectContent>
                    {GAUTENG_DISTRICTS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={saving || !isSuperAdministrator}
              >
                {saving ? 'Creating…' : 'Create account'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h3 className="font-semibold">Current access</h3>
          </div>
          {loading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading users…</p>
          ) : (
            <div className="divide-y divide-border">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {user.display_name} {user.surname || ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      District: {user.district || 'Not assigned'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      PERSAL: <span className="font-mono">{user.persal_number}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Work email: {user.email || 'Not provided'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Contact: {user.contact_number || 'Not provided'}
                    </p>
                    <p className="mt-1 text-xs font-medium text-primary">
                      {ROLE_DETAILS[user.role].label}
                    </p>
                    {Boolean(user.is_protected) && (
                      <p className="mt-1 text-xs font-semibold text-warning">
                        Protected administrator account
                      </p>
                    )}
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      {ROLE_DETAILS[user.role].description}
                    </p>
                    {Boolean(user.is_locked) && (
                      <p className="mt-2 text-sm font-semibold text-destructive">
                        Locked after 5 failed login attempts
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {isSuperAdministrator && !user.is_protected && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetUserPassword(user)}
                        disabled={resettingPassword}
                      >
                        {resettingUserId === user.id
                          ? 'Resetting…'
                          : 'Reset password'}
                      </Button>
                    )}
                    {isSuperAdministrator && Boolean(user.is_locked) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => unlockUser(user)}
                        disabled={unlockingUserId !== null}
                      >
                        {unlockingUserId === user.id ? 'Unlocking…' : 'Unlock account'}
                      </Button>
                    )}
                    {!user.is_protected && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (editingUserId === user.id) {
                              setEditingUserId(null);
                            } else {
                              editUserProfile(user);
                            }
                          }}
                        >
                          {editingUserId === user.id ? 'Cancel profile edit' : 'Edit profile'}
                        </Button>
                        <Select
                          value={user.role}
                          onValueChange={(nextRole) =>
                            updateUser(user, nextRole as AppRole, Boolean(user.is_active))
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {APP_ROLES.map((item) => (
                              <SelectItem key={item} value={item}>
                                {ROLE_DETAILS[item].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={user.district ?? undefined}
                          onValueChange={(nextDistrict) =>
                            updateUser(user, user.role, Boolean(user.is_active), nextDistrict)
                          }
                        >
                          <SelectTrigger className="w-48" aria-label="Assign district">
                            <SelectValue placeholder="Assign district" />
                          </SelectTrigger>
                          <SelectContent>
                            {GAUTENG_DISTRICTS.map((item) => (
                              <SelectItem key={item} value={item}>
                                {item}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant={user.is_active ? 'outline' : 'destructive'}
                          size="sm"
                          onClick={() =>
                            updateUser(user, user.role, !Boolean(user.is_active))
                          }
                        >
                          {user.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </>
                    )}
                  </div>
                  {!user.is_protected && temporaryPassword?.userId === user.id && (
                    <div className="grid gap-3 rounded-md border border-warning/40 bg-warning/10 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                      <div className="space-y-2">
                        <Label htmlFor={`temporary-password-${user.id}`}>
                          One-time temporary password
                        </Label>
                        <Input
                          id={`temporary-password-${user.id}`}
                          value={temporaryPassword.value}
                          readOnly
                          onFocus={(event) => event.currentTarget.select()}
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          This is shown only now. Give it to the user securely;
                          their next sign-in will require a new password.
                        </p>
                      </div>
                      <Button type="button" variant="outline" onClick={copyTemporaryPassword}>
                        Copy temporary password
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setTemporaryPassword(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {editingUserId === user.id && (
                    <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`edit-first-name-${user.id}`}>First name</Label>
                        <Input
                          id={`edit-first-name-${user.id}`}
                          value={profileDraft.display_name}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              display_name: event.target.value,
                            })
                          }
                          required
                          maxLength={150}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`edit-surname-${user.id}`}>Surname</Label>
                        <Input
                          id={`edit-surname-${user.id}`}
                          value={profileDraft.surname}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              surname: event.target.value,
                            })
                          }
                          required
                          maxLength={100}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`edit-email-${user.id}`}>Work email address</Label>
                        <Input
                          id={`edit-email-${user.id}`}
                          type="email"
                          value={profileDraft.email}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              email: event.target.value,
                            })
                          }
                          required
                          maxLength={254}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`edit-contact-${user.id}`}>Contact number</Label>
                        <Input
                          id={`edit-contact-${user.id}`}
                          type="tel"
                          value={profileDraft.contact_number}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              contact_number: event.target.value,
                            })
                          }
                          required
                          minLength={7}
                          maxLength={30}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Button
                          type="button"
                          onClick={() => saveUserProfile(user)}
                        >
                          Save profile
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {users.length === 0 && (
                <p className="p-5 text-sm text-muted-foreground">
                  No user accounts have been created.
                </p>
              )}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
