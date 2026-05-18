import { type HTMLAttributes } from "react";

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string;
  fallback: string;
}

export function Avatar({ src, fallback, className = "", ...props }: AvatarProps) {
  return (
    <div className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-heureka-100 text-sm font-medium text-heureka-700 overflow-hidden ${className}`} {...props}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        fallback.charAt(0).toUpperCase()
      )}
    </div>
  );
}
