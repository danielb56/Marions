import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(cents: number | null | undefined) {
  if (cents == null) return "-";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function toCents(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

export function calculateGst(subtotalCents: number, gstRate = 0.1) {
  const gstCents = Math.round(subtotalCents * gstRate);
  return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents };
}

export function formatDate(value: string | null | undefined, pattern = "d MMM yyyy") {
  if (!value) return "Not set";
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

export function timeAgo(value: string) {
  try {
    return `${formatDistanceToNowStrict(parseISO(value))} ago`;
  } catch {
    return value;
  }
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
