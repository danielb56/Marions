import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type LogoProps = {
  href?: string;
  className?: string;
  full?: boolean;
  inverse?: boolean;
  priority?: boolean;
};

export function Logo({ href = "/", className, full = false, inverse = false, priority = false }: LogoProps) {
  if (full) {
    return <Link href={href} aria-label="REME Painting Group home" className={cn("block w-40 overflow-hidden rounded-3xl bg-white shadow-[0_18px_60px_rgba(0,35,65,.24)] ring-1 ring-white/70", className)}>
      <Image src="/reme-painting-group-logo.jpg" alt="REME Painting Group Pty Ltd" width={1024} height={1024} priority={priority} className="h-auto w-full" />
    </Link>;
  }

  return <Link href={href} aria-label="REME Painting Group home" className={cn("inline-flex items-center gap-2.5", className)}>
    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-[#c9dce8] bg-white shadow-sm" aria-hidden="true">
      <Image src="/reme-painting-group-logo.jpg" alt="" width={1024} height={1024} priority={priority} className="absolute left-1/2 top-[-15px] h-[124px] w-[124px] max-w-none -translate-x-1/2" />
    </span>
    <span className="leading-none">
      <span className={cn("block text-lg font-black tracking-[.08em] text-[#003f70]", inverse && "text-white")}>REME</span>
      <span className={cn("mt-1 block text-[8px] font-bold tracking-[.16em] text-[#007bb6]", inverse && "text-[#9edcf3]")}>PAINTING GROUP</span>
    </span>
  </Link>;
}
