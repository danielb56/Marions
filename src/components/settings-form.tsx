"use client";

import { useActionState } from "react";
import { updateTenantSettings } from "@/actions/settings";
import type { ActionState } from "@/actions/types";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type TenantSettings = { name: string; abn: string | null; default_gst_rate: number; retention_years: number; sms_enabled: boolean; mfa_required_for_managers: boolean };
export function SettingsForm({ tenant }: { tenant: TenantSettings }) {
  const [state, action] = useActionState(updateTenantSettings, {} as ActionState);
  return <form action={action} className="space-y-5"><div><Label>Company name</Label><Input name="name" defaultValue={tenant.name} required /></div><div><Label>ABN</Label><Input name="abn" defaultValue={tenant.abn ?? ""} /></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>Default GST rate</Label><Input name="gstRate" type="number" min="0" max="1" step="0.0001" defaultValue={tenant.default_gst_rate} /></div><div><Label>Retention period (years)</Label><Input name="retentionYears" type="number" min="1" max="20" defaultValue={tenant.retention_years} /></div></div><label className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-[#ddd8ce] p-3.5 text-sm font-semibold"><span>Require MFA for managers</span><input type="checkbox" name="mfaRequired" defaultChecked={tenant.mfa_required_for_managers} className="h-5 w-5 accent-[#2f666c]" /></label><label className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-[#ddd8ce] p-3.5 text-sm font-semibold"><span>Enable assignment SMS</span><input type="checkbox" name="smsEnabled" defaultChecked={tenant.sms_enabled} className="h-5 w-5 accent-[#2f666c]" /></label>{state.error && <p className="text-sm text-[#913a31]">{state.error}</p>}{state.message && <p className="text-sm font-semibold text-[#2f6249]">{state.message}</p>}<SubmitButton>Save settings</SubmitButton></form>;
}
