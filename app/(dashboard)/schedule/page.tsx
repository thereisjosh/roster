"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { Trash2, CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DeleteScheduleDialog } from "@/components/schedule/delete-schedule-dialog";

const statusStyles: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  generating: { variant: "secondary", className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800" },
  pending_review: { variant: "outline", className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
  approved: { variant: "default", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" },
  finalised: { variant: "default", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" },
  escalated: { variant: "destructive" },
};

export default function SchedulePage() {
  const utils = trpc.useUtils();
  const { data: runs, isLoading } = trpc.schedule.listRuns.useQuery();

  const today = new Date();
  const dayOfWeek = today.getUTCDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - diff);
  const defaultWeek = monday.toISOString().slice(0, 10);

  const [weekInput, setWeekInput] = useState(defaultWeek);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const generate = trpc.schedule.generate.useMutation({
    onSuccess: () => {
      utils.schedule.listRuns.invalidate();
    },
  });

  const deleteRun = trpc.schedule.deleteRun.useMutation({
    onSuccess: () => {
      toast.success("Schedule deleted");
      setDeleteTarget(null);
      utils.schedule.listRuns.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function handleGenerate() {
    const weekStart = new Date(weekInput + "T00:00:00Z");
    generate.mutate({ weekStart });
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Schedule Runs</h1>
            <p className="text-muted-foreground mt-1">
              Generate and manage weekly AI-powered schedules.
            </p>
          </div>

          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="week-start" className="text-sm">Week starting</Label>
              <Input
                id="week-start"
                type="date"
                value={weekInput}
                onChange={(e) => setWeekInput(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              onClick={handleGenerate}
              disabled={generate.isPending}
              className="min-w-[10rem]"
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate Schedule"
              )}
            </Button>
          </div>
        </div>
      </div>

      {generate.isError && (
        <p className="text-sm text-destructive">
          {generate.error.message}
        </p>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-20 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !runs?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">
            No schedule runs yet. Pick a week and click &quot;Generate Schedule&quot; to create one.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => {
            const style = statusStyles[run.status] ?? { variant: "secondary" as const };
            return (
              <Link key={run.id} href={`/schedule/${run.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        Week of{" "}
                        {new Date(run.weekStart).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={style.variant} className={style.className}>
                          {run.status.replace("_", " ")}
                        </Badge>
                        {run.status !== "finalised" && (
                          <button
                            className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget(run.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      {run.variations.length} variation
                      {run.variations.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {run.costUsd != null && (
                      <p className="text-sm text-muted-foreground">
                        LLM cost: ${run.costUsd.toFixed(4)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <DeleteScheduleDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) deleteRun.mutate({ runId: deleteTarget }); }}
        isPending={deleteRun.isPending}
      />
    </div>
  );
}
