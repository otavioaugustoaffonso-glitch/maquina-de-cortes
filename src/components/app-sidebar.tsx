"use client";

import { FolderOpen, LayoutDashboard, LogOut, Menu, Plus, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/(auth)/actions";
import { cx, Logo } from "@/components/ui";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projetos", icon: FolderOpen },
  { href: "/settings", label: "Perfil", icon: Settings },
];

export function AppSidebar({ email, name, plan }: { email: string; name: string; plan: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Link href="/dashboard" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <button className="text-muted lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-3">
        <Link
          href="/projects/new"
          onClick={() => setOpen(false)}
          className="mb-4 flex h-10 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-medium text-white shadow-lg shadow-brand/25 transition hover:bg-violet-500"
        >
          <Plus className="size-4" /> Novo projeto
        </Link>
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href) && pathname !== "/projects/new");
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  active ? "bg-white/[0.06] text-fg" : "text-muted hover:bg-white/[0.03] hover:text-fg",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/60 to-brand-2/60 text-xs font-semibold uppercase">
            {name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-subtle">{email}</p>
          </div>
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{plan}</span>
        </div>
        <form action={signOut}>
          <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/[0.03] hover:text-fg">
            <LogOut className="size-4" /> Sair
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} aria-label="Abrir menu" className="text-muted">
          <Menu className="size-5" />
        </button>
      </div>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-line bg-surface/60 lg:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface">{content}</aside>
        </div>
      )}
    </>
  );
}
