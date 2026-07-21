"use client";

import { useActionState } from "react";
import { ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { inviteTeamMember } from "@/actions/team";
import type { ActionState } from "@/actions/types";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AppRole } from "@/lib/domain";
import { initials } from "@/lib/utils";

export type TeamMember = {
  id: string;
  display_name: string;
  email: string;
  phone: string | null;
  role: AppRole;
  is_active: boolean;
};

export function TeamSettings({ members, currentUserId }: { members: TeamMember[]; currentUserId: string }) {
  const [state, action] = useActionState(inviteTeamMember, {} as ActionState);

  return <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e1eee8] text-[#2f6249]"><UsersRound className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold">Team access</h2>
          <p className="mt-1 text-sm leading-6 text-[#707a77]">Everyone with access to this organisation is listed here. Account roles cannot be changed after an invitation.</p>
        </div>
      </div>
      <div className="divide-y divide-[#ebe7df] overflow-hidden rounded-2xl border border-[#e0dcd3]">
        {members.map((member) => <div key={member.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#173f45] text-sm font-bold text-white">{initials(member.display_name)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold">{member.display_name}</p>
              {member.id === currentUserId && <Badge tone="teal">You</Badge>}
            </div>
            <p className="truncate text-sm text-[#707a77]">{member.email}{member.phone ? ` · ${member.phone}` : ""}</p>
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Badge tone={member.role === "manager" ? "purple" : "blue"}>{member.role === "manager" ? "Manager" : "Worker"}</Badge>
            <Badge tone={member.is_active ? "green" : "neutral"}>{member.is_active ? "Enabled" : "Disabled"}</Badge>
          </div>
        </div>)}
        {!members.length && <p className="p-8 text-center text-sm text-[#707a77]">No team members found.</p>}
      </div>
    </div>

    <div className="h-fit rounded-2xl border border-[#e0dcd3] bg-[#faf9f6] p-5">
      <div className="mb-2 flex items-center gap-2"><UserPlus className="h-5 w-5 text-[#2f666c]" /><h2 className="font-semibold">Invite a team member</h2></div>
      <p className="mb-4 text-sm leading-6 text-[#707a77]">They will receive a secure email link and choose their own password.</p>
      <form action={action} className="space-y-3">
        <div><Label htmlFor="team-display-name">Name</Label><Input id="team-display-name" name="displayName" autoComplete="name" maxLength={200} required /></div>
        <div><Label htmlFor="team-email">Email</Label><Input id="team-email" name="email" type="email" autoComplete="email" maxLength={254} required /></div>
        <div><Label htmlFor="team-phone" hint="optional">Mobile</Label><Input id="team-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} /></div>
        <div><Label htmlFor="team-role">Account type</Label><Select id="team-role" name="role" defaultValue="worker"><option value="worker">Worker</option><option value="manager">Manager</option></Select></div>
        <div className="flex gap-2 rounded-xl bg-[#e9f0ef] p-3 text-xs leading-5 text-[#52615e]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2f666c]" /><p><strong>Managers</strong> can access pricing, approvals and settings. <strong>Workers</strong> only see their assigned operational work.</p></div>
        {state.error && <p role="alert" className="text-sm text-[#913a31]">{state.error}</p>}
        {state.message && <p role="status" className="text-sm font-semibold text-[#2f6249]">{state.message}</p>}
        <SubmitButton className="w-full" pendingText="Sending invitation...">Send invitation</SubmitButton>
      </form>
    </div>
  </div>;
}
