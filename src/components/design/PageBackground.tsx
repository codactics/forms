import type { ReactNode } from "react";
import type { PageBackground as PageBackgroundData } from "@/types/theme";

export function PageBackground({
  background,
  className,
  children,
}: {
  background: PageBackgroundData;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative ${className ?? ""}`}
      style={{ backgroundColor: background.color }}
    >
      {background.imageDataUrl && (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${background.imageDataUrl})`,
            opacity: background.opacity / 100,
          }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
