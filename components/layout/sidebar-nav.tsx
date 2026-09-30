"use client";

import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CalendarDays,
  Settings,
} from "lucide-react";
import { SidebarLink } from "@/components/layout/sidebar-link";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/staff", label: "Staff", icon: Users },
  { href: "/availability", label: "Availability", icon: CalendarCheck },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  return (
    <nav className="flex flex-col gap-1 p-4" aria-label="Main navigation">
      {navItems.map((item) => (
        <SidebarLink key={item.href} href={item.href} label={item.label}>
          <item.icon className="h-4 w-4" />
        </SidebarLink>
      ))}
    </nav>
  );
}
