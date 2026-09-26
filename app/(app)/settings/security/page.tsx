import { MfaSettings } from '@/components/security/mfa-settings';

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Sécurité</h1>
      <MfaSettings />
    </div>
  );
}
