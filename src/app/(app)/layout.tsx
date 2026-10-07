import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name, plan").eq("id", user.id).maybeSingle();
  return (
    <div className="flex min-h-dvh">
      <AppSidebar email={user.email ?? ""} name={profile?.full_name || user.email?.split("@")[0] || ""} plan={profile?.plan ?? "free"} />
      <main className="bg-glow min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8 lg:pt-8 pt-20">{children}</div>
      </main>
    </div>
  );
}
