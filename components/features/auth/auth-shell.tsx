import { BrandLogo } from "@/components/ui/brand-logo";
import { AuthBrandPanel } from "@/components/features/auth/auth-brand-panel";

/**
 * Shared two-panel shell for every /(auth) page — logo, title, subtitle
 * on a plain white right panel next to the emerald brand panel. Each
 * page supplies its own form and footer links as children so this stays
 * a layout component, not a form component.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh bg-background">
      <AuthBrandPanel />

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center justify-center lg:justify-start">
            <BrandLogo height={40} priority />
          </div>

          <div className="space-y-1 text-center lg:text-left">
            <h1 className="text-2xl text-foreground">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
