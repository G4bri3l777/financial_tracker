"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: "📊" },
  { href: "/budget", label: "Budget", icon: "💰" },
  { href: "/transactions", label: "Transactions", icon: "📋" },
  { href: "/financial-advisor", label: "Financial Advisor", icon: "🤖" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
] as const;

export default function AppSidebar() {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <aside
      className={`flex flex-col border-r border-[#E8ECF0] bg-white transition-all duration-300 ${
        sidebarOpen ? "w-64" : "w-14"
      } shrink-0`}
    >
      {/* Sidebar header */}
      <div className="flex items-center justify-between border-b border-[#E8ECF0] px-4 py-4">
        {sidebarOpen && (
          <p className="text-sm font-bold text-[#1B2A4A]">Menu</p>
        )}
        <button
          type="button"
          onClick={() => setSidebarOpen((p) => !p)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E8ECF0] text-[#9AA5B4] hover:text-[#1B2A4A]"
        >
          {sidebarOpen ? "←" : "→"}
        </button>
      </div>

      {/* Nav menu */}
      {sidebarOpen ? (
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
  );
}
