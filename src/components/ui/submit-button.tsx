"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({ children, pendingText = "Saving...", className }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return <Button className={className} type="submit" disabled={pending}>{pending && <LoaderCircle className="h-4 w-4 animate-spin" />}{pending ? pendingText : children}</Button>;
}
