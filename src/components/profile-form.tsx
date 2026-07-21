"use client";
import { useActionState } from "react";
import { updateWorkerProfile } from "@/actions/worker";
import type { ActionState } from "@/actions/types";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
export function ProfileForm({name,phone}:{name:string;phone:string|null}){const[state,action]=useActionState(updateWorkerProfile,{} as ActionState);return <form action={action} className="space-y-4"><div><Label>Name</Label><Input name="displayName" defaultValue={name} required/></div><div><Label>Mobile</Label><Input name="phone" type="tel" defaultValue={phone??""}/></div>{state.error&&<p className="text-sm text-[#913a31]">{state.error}</p>}{state.message&&<p className="text-sm font-semibold text-[#2f6249]">{state.message}</p>}<SubmitButton>Save profile</SubmitButton></form>}
