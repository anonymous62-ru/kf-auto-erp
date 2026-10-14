import { MfaSettings } from '@/components/security/mfa-settings';

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-3">
      <h1 className="page-title">Sécurité</h1>
      <MfaSettings />
    </div>
  );
}
