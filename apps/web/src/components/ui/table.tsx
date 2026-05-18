import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react";

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full text-sm ${className}`} {...props} />;
}

export function THead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-gray-50 ${className}`} {...props} />;
}

export function TBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`divide-y divide-gray-200 ${className}`} {...props} />;
}

export function Th({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${className}`} {...props} />;
}

export function Td({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 whitespace-nowrap text-gray-700 ${className}`} {...props} />;
}

export function Tr({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`hover:bg-gray-50 transition-colors ${className}`} {...props} />;
}
