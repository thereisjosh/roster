"use client";

import { useState } from "react";
import {
  Menu,
  X,
  CalendarDays,
  LayoutDashboard,
  Users,
  CalendarCheck,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarLink } from "@/components/layout/sidebar-link";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/staff", label: "Staff", icon: Users },
  { href: "/availability", label: "Availability", icon: CalendarCheck },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-sidebar shadow-lg animate-in slide-in-from-left duration-200">
            <div className="flex h-14 items-center justify-between border-b px-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                <span className="text-lg font-bold tracking-tight">Roster</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex flex-col gap-1 p-4" aria-label="Main navigation">
              {navItems.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  onClick={() => setOpen(false)}
                >
                  <item.icon className="h-4 w-4" />
                </SidebarLink>
              ))}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
