import type { ReactNode } from "react";
import { cx } from "@/ui/cx";
import type { IconData } from "@/ui/icons/generated";
import { type ShapeName, shapePath } from "@/ui/shapes/shapes";
import { Icon } from "./icon";

const pathCache = new Map<string, string>();

function cachedPath(shape: ShapeName, size: number) {
  const key = `${shape}:${size}`;
  let path = pathCache.get(key);
  if (!path) {
    path = shapePath(shape, size);
    pathCache.set(key, path);
  }
  return path;
}

const AVATAR_SHAPES: ShapeName[] = [
  "cookie9", "clover4", "sunny", "cookie6", "flower", "softBurst", "pentagon", "gem", "cookie4", "clover8", "cookie12", "square",
];

const AVATAR_COLORS = [
  ["fill-primary-container", "text-on-primary-container"],
  ["fill-secondary-container", "text-on-secondary-container"],
  ["fill-tertiary-container", "text-on-tertiary-container"],
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

type ShapeProps = { shape: ShapeName; size: number; className?: string; children?: ReactNode };

/** An M3 Expressive shape with content centered on top. */
export function Shape({ shape, size, className, children }: ShapeProps) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="absolute inset-0" aria-hidden="true">
        <path d={cachedPath(shape, size)} className={className} />
      </svg>
      {children && <span className="relative grid place-items-center">{children}</span>}
    </span>
  );
}

type AvatarProps = { name: string; size?: number; className?: string };

/** Initials inside a shape and color picked consistently from the name. */
export function Avatar({ name, size = 40, className }: AvatarProps) {
  const hash = hashString(name);
  const shape = AVATAR_SHAPES[hash % AVATAR_SHAPES.length];
  const [fill, text] = AVATAR_COLORS[Math.floor(hash / AVATAR_SHAPES.length) % AVATAR_COLORS.length];
  return (
    <span aria-hidden="true" className={cx("inline-grid", className)}>
      <Shape shape={shape} size={size} className={fill}>
        <span className={cx("font-medium", text)} style={{ fontSize: Math.round(size * 0.38), lineHeight: 1 }}>
          {initials(name)}
        </span>
      </Shape>
    </span>
  );
}

type EmptyStateProps = {
  icon: IconData;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  shape?: ShapeName;
  className?: string;
};

export function EmptyState({ icon, title, description, action, shape = "cookie9", className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center gap-4 px-6 py-12 text-center", className)}>
      <span className="relative grid size-32 place-items-center">
        <svg viewBox="0 0 128 128" className="absolute inset-0 animate-[spin_40s_linear_infinite]" aria-hidden="true">
          <path d={cachedPath(shape, 128)} className="fill-primary-container" />
        </svg>
        <Icon icon={icon} size={48} className="relative text-on-primary-container" />
      </span>
      <h2 className="text-headline-sm-em text-on-surface">{title}</h2>
      {description && <p className="max-w-md text-body-lg text-on-surface-variant">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shown above the title, e.g. a back link. */
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, leading, actions, className }: PageHeaderProps) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-4 pb-6 medium:pt-10", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {leading}
        <h1 className="text-headline-lg-em text-on-surface expanded:text-display-sm-em">{title}</h1>
        {subtitle && <p className="text-body-lg text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
