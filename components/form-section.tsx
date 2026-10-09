import type { ReactNode } from "react";

/** A form section: title and description on the left, controls on the right. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 border-t py-8 first:border-t-0 first:pt-0 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}
