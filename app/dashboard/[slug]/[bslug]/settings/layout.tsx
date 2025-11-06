import { ReactNode } from "react";
import SettingsSidebar from "@/app/ui/settings/settings-sidebar";
import BackgroundSea from "@/app/ui/background-sea";

export default function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div>
      {/* Full-width, left-anchored grid */}
      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 p-6">
        <BackgroundSea />
        <div className="justify-self-start">
          <SettingsSidebar />
        </div>
        <main className="flex-1 rounded-3xl">
          {children}
        </main>
      </div>
    </div>
  );
}