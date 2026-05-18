import { type HTMLAttributes } from "react";

const variants = {
  default: "bg-gray-100 text-gray-800",
  success: "bg-green-100 text-green-800",
  warning: "bg-yellow-100 text-yellow-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  purple: "bg-purple-100 text-purple-800",
} as const;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants;
}

export function Badge({ className = "", variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export const statusLabels: Record<string, { label: string; variant: keyof typeof variants }> = {
  brouillon: { label: "Brouillon", variant: "default" },
  soumis: { label: "Soumis", variant: "info" },
  pre_instruction: { label: "Pré-instruction", variant: "warning" },
  incomplet: { label: "Incomplet", variant: "danger" },
  en_instruction: { label: "En instruction", variant: "purple" },
  decision_en_cours: { label: "Décision en cours", variant: "warning" },
  accepte: { label: "Accepté", variant: "success" },
  refuse: { label: "Refusé", variant: "danger" },
  accord_prescription: { label: "Accord avec prescriptions", variant: "warning" },
};
