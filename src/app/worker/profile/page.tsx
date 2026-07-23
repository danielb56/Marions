import Link from "next/link";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { signOut } from "@/actions/auth";
import { ProfileForm } from "@/components/profile-form";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
export default async function WorkerProfilePage(){const profile=await requireRole("worker");return <><p className="text-xs font-bold uppercase tracking-[.14em] text-[#b44a00]">Account</p><h1 className="mb-5 mt-1 text-3xl font-semibold tracking-[-.04em]">Profile</h1><Card className="p-5"><ProfileForm name={profile.display_name} phone={profile.phone}/></Card><Card className="mt-4 divide-y divide-[#e8e4dc]"><Link href="/forgot-password" className="flex min-h-14 items-center gap-3 px-4 text-sm font-semibold"><KeyRound className="h-5 w-5 text-[#0077a8]"/>Change password</Link><div className="flex min-h-14 items-center gap-3 px-4 text-sm"><ShieldCheck className="h-5 w-5 text-[#2f6249]"/><span>Pricing is never stored in your account or offline cache.</span></div><form action={signOut}><button className="flex min-h-14 w-full items-center gap-3 px-4 text-sm font-semibold text-[#913a31]"><LogOut className="h-5 w-5"/>Sign out</button></form></Card></>}
