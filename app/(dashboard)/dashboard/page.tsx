import { getServerSession } from "@/lib/auth/get-session";
import { createServerCaller } from "@/lib/trpc/server";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, CalendarDays, CalendarCheck, ArrowRight, Settings } from "lucide-react";

export default async function DashboardPage() {
  const session = await getServerSession();

  let stats = {
    activeStaffCount: 0,
    scheduleRunsThisWeek: 0,
    availabilitySubmissionsThisWeek: 0,
    openCoverRequests: 0,
  };

  try {
    const trpc = await createServerCaller();
    stats = await trpc.dashboard.stats();
  } catch {
    // Business may not be configured yet — show zeros
  }

  const isEmpty =
    stats.activeStaffCount === 0 &&
    stats.scheduleRunsThisWeek === 0 &&
    stats.availabilitySubmissionsThisWeek === 0 &&
    stats.openCoverRequests === 0;

  const statCards = [
    {
      label: "Active Staff",
      value: stats.activeStaffCount,
      description: stats.activeStaffCount === 0 ? "Add staff to get started" : "Currently active members",
      icon: Users,
    },
    {
      label: "Schedules This Week",
      value: stats.scheduleRunsThisWeek,
      description: stats.scheduleRunsThisWeek === 0 ? "No schedule generated yet" : "Schedule runs this week",
      icon: CalendarDays,
    },
    {
      label: "Availability",
      value: stats.availabilitySubmissionsThisWeek,
      description: "Submissions this week",
      icon: CalendarCheck,
    },
    {
      label: "Cover Requests",
      value: stats.openCoverRequests,
      description: "Open requests",
      icon: ArrowRight,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {session?.user?.name ?? "there"}. Here&apos;s an overview of your workforce.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isEmpty && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Get started</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/staff">
              <Card className="cursor-pointer border-dashed hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-primary" />
                    Add your team
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Add staff members with their roles, pay rates, and employment type.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings">
              <Card className="cursor-pointer border-dashed hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Settings className="h-4 w-4 text-primary" />
                    Configure shifts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Set up shift types, coverage requirements, and scheduling rules.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/schedule">
              <Card className="cursor-pointer border-dashed hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    Generate a schedule
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Once your team and shifts are configured, generate your first AI schedule.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
