// Merging Tailwind classes for shadcn components: a later class overrides an earlier one for the same property.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
