import Link from "next/link";
import { Hammer } from "lucide-react";

export function Logo({ href = "/" }: { href?: string }) {
  return <Link href={href} className="inline-flex items-center gap-2.5 font-bold tracking-[-0.02em] text-[#173f45]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#dbe9e8]"><Hammer className="h-5 w-5" strokeWidth={2.3} /></span><span className="text-lg">Marion</span></Link>;
}
