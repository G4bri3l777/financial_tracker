"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: "📊" },
  { href: "/budget", label: "Budget", icon: "💰" },
  { href: "/transactions", label: "Transactions", icon: "📋" },
  { href: "/financial-advisor", label: "Financial Advisor", icon: "🤖" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
] as const;

export default function AppSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener("sidebar:open", handler);
    return () => window.removeEventListener("sidebar:open", handler);
  }, []);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`
          flex flex-col bg-white border-r border-[#E8ECF0] transition-all duration-300 shrink-0
          fixed top-0 bottom-0 left-0 z-50 w-72
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          lg:relative lg:top-auto lg:bottom-auto lg:left-auto lg:z-auto lg:translate-x-0
          ${collapsed ? "lg:w-14" : "lg:w-64"}
        `}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 border-b border-[#E8ECF0] px-4 py-3 text-sm font-semibold text-[#9AA5B4] hover:text-[#1B2A4A] lg:hidden"
        >
          ✕ Close menu
        </button>

        {/* Desktop collapse toggle */}
        <div className="hidden lg:flex items-center justify-between border-b border-[#E8ECF0] px-4 py-4">
          {!collapsed && (
            <p className="text-sm font-bold text-[#1B2A4A]">Menu</p>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((p) => !p)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E8ECF0] text-[#9AA5B4] hover:text-[#1B2A4A]"
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>

        {/* Nav menu — expanded */}
        {!collapsed ? (
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <div className="space-y-1">
              {NAV_ITEMS.map(({ href, label, icon }) => {
                const isActive =
                  pathname === href ||
                  (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-semibold transition ${
                      isActive
                        ? "bg-[#C9A84C]/15 text-[#1B2A4A]"
                        : "text-[#9AA5B4] hover:bg-[#F4F6FA] hover:text-[#1B2A4A]"
                    }`}
                  >
                    <span className="shrink-0 text-base">{icon}</span>
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : (
          /* Nav menu — collapsed (icon only, desktop only) */
          <div className="flex flex-1 flex-col items-center gap-2 py-4">
            {NAV_ITEMS.map(({ href, label, icon }) => {
              const isActive =
                pathname === href ||
                (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  onClick={() => setMobileOpen(false)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition ${
                    isActive
                      ? "bg-[#C9A84C]/15 text-[#1B2A4A]"
                      : "text-[#9AA5B4] hover:bg-[#F4F6FA] hover:text-[#1B2A4A]"
                  }`}
                >
                  {icon}
                </Link>
              );
            })}
          </div>
        )}
      </aside>
    </>
  );
}
