"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Trash2, Loader2 } from "lucide-react";
import { formatWeekRange } from "@/lib/date-utils";
import { VariationComparison } from "@/components/schedule/variation-comparison";
import { VariationCard } from "@/components/schedule/variation-card";
import { ScheduleGantt } from "@/components/schedule/schedule-gantt";
import { parseWarnings } from "@/lib/scheduling/parse-warnings";
import { DeleteScheduleDialog } from "@/components/schedule/delete-schedule-dialog";
import { ApprovalFeedbackBanner } from "@/components/schedule/approval-feedback-banner";

const statusStyles: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  generating: { variant: "secondary", className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800" },
  pending_review: { variant: "outline", className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
  approved: { variant: "default", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" },
  finalised: { variant: "default", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" },
  escalated: { variant: "destructive" },
};

function formatVariationType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [feedbackVariationId, setFeedbackVariationId] = useState<string | null>(null);
  const [showFeedbackBanner, setShowFeedbackBanner] = useState(false);

  const { data: run, isLoading } = trpc.schedule.getRunById.useQuery({ id });

  const deleteRun = trpc.schedule.deleteRun.useMutation({
    onSuccess: () => {
      toast.success("Schedule deleted");
      router.push("/schedule");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const approve = trpc.schedule.approveVariation.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Variation approved");
      utils.schedule.getRunById.invalidate({ id });
      setFeedbackVariationId(variables.variationId);
      setShowFeedbackBanner(false);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const finalise = trpc.schedule.finalise.useMutation({
    onSuccess: () => {
      toast.success("Schedule finalised");
      utils.schedule.getRunById.invalidate({ id });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  useEffect(() => {
    if (!feedbackVariationId) {
      setShowFeedbackBanner(false);
      return;
    }
    const timer = setTimeout(() => setShowFeedbackBanner(true), 2000);
    return () => clearTimeout(timer);
  }, [feedbackVariationId]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Link
          href="/schedule"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to Schedules
        </Link>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Link
          href="/schedule"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to Schedules
        </Link>
        <p className="text-muted-foreground">Schedule run not found.</p>
      </div>
    );
  }

  const approvedVariation = run.variations.find((v) => v.approvedAt);
  const style = statusStyles[run.status] ?? { variant: "secondary" as const };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/schedule"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Back to Schedules
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Week of {formatWeekRange(new Date(run.weekStart))}
            </h1>
            <Badge variant={style.variant} className={style.className}>
              {run.status.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Generated{" "}
            {new Date(run.createdAt).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
            })}{" "}
            at{" "}
            {new Date(run.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {run.costUsd != null && ` · LLM cost $${run.costUsd.toFixed(2)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {run.status !== "finalised" && (
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={deleteRun.isPending}
              className="min-w-[6rem]"
            >
              {deleteRun.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Delete
            </Button>
          )}
          {run.status === "approved" && (
            <Button
              onClick={() => finalise.mutate({ runId: run.id })}
              disabled={finalise.isPending}
              className="min-w-[6rem]"
            >
              {finalise.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Finalising...
                </>
              ) : (
                "Finalise"
              )}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* Comparison bar */}
      {run.variations.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <VariationComparison variations={run.variations} />
          </CardContent>
        </Card>
      )}

      {/* Variation tabs */}
      {run.variations.length > 0 && (
        <Tabs defaultValue={run.variations[0].id}>
          <TabsList>
            {run.variations.map((v) => (
              <TabsTrigger
                key={v.id}
                value={v.id}
                className={
                  approvedVariation && approvedVariation.id !== v.id
                    ? "opacity-50"
                    : undefined
                }
              >
                {formatVariationType(v.variationType)}
                {v.approvedAt && (
                  <Check className="ml-1 h-3 w-3" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {run.variations.map((v) => (
            <TabsContent key={v.id} value={v.id} className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <ScheduleGantt
                    assignments={v.assignments}
                    weekStart={new Date(run.weekStart)}
                    warnings={parseWarnings(v.coverageWarnings)}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <VariationCard
                    variation={v}
                    runStatus={run.status}
                    onApprove={() => approve.mutate({ variationId: v.id })}
                    isApproving={approve.isPending}
                  />
                </CardContent>
              </Card>
              {showFeedbackBanner && feedbackVariationId === v.id && (
                <ApprovalFeedbackBanner
                  variationId={v.id}
                  onDismiss={() => {
                    setShowFeedbackBanner(false);
                    setFeedbackVariationId(null);
                  }}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {run.variations.length === 0 && (
        <p className="text-muted-foreground">
          {run.status === "generating"
            ? "Schedule is being generated..."
            : "No variations generated for this run."}
        </p>
      )}

      <DeleteScheduleDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteRun.mutate({ runId: run.id })}
        isPending={deleteRun.isPending}
      />

    </div>
  );
}
