"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import type { BusinessConfig } from "@/lib/db/schema";
import { getDefaultConfig } from "@/lib/config-defaults";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SchedulingRulesSection } from "@/components/settings/scheduling-rules-section";
import { AvailabilityDeadlinesSection } from "@/components/settings/availability-deadlines-section";
import { ShiftTypesSection } from "@/components/settings/shift-types-section";
import { SchedulingWeightsSection } from "@/components/settings/scheduling-weights-section";
import { BreakRulesSection } from "@/components/settings/break-rules-section";
import { PreferenceRulesSection } from "@/components/settings/preference-rules-section";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";

function getTelegramJoinLinkClient(inviteCode: string): string | null {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!bot) return null;
  return `https://t.me/${bot}?start=join_${inviteCode}`;
}

export default function SettingsPage() {
  const { data: business, isLoading } = trpc.business.getCurrent.useQuery();
  const { data: staffList } = trpc.staff.list.useQuery();
  const uniqueRoles = [...new Set((staffList ?? []).flatMap((s) => s.roles))];
  const [config, setConfig] = useState<BusinessConfig>(getDefaultConfig());
  const [isDirty, setIsDirty] = useState(false);
  const savedConfigRef = useRef<BusinessConfig | null>(null);

  const updateConfig = trpc.business.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuration saved");
      savedConfigRef.current = config;
      setIsDirty(false);
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (business?.config) {
      setConfig(business.config);
      savedConfigRef.current = business.config;
    }
  }, [business]);

  const handleConfigChange = useCallback((newConfig: BusinessConfig) => {
    setConfig(newConfig);
    setIsDirty(true);
  }, []);

  // Warn on browser navigation (close tab, reload)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleSave = () => {
    updateConfig.mutate({ config });
  };

  const handleDiscard = () => {
    if (savedConfigRef.current) {
      setConfig(savedConfigRef.current);
    }
    setIsDirty(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your business rules and scheduling preferences.</p>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your business rules and scheduling preferences.</p>
        </div>
        <p className="text-muted-foreground">No business found.</p>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${isDirty ? "pb-20" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your business rules and scheduling preferences.</p>
        </div>
      </div>

      <InviteCodeCard
        inviteCode={business.inviteCode}
        businessName={business.name}
      />

      <Card>
        <CardHeader>
          <CardTitle>{business.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="hours">
            <TabsList>
              <TabsTrigger value="hours">Hours & Coverage</TabsTrigger>
              <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
            </TabsList>

            <TabsContent value="hours" className="space-y-4">
              <ShiftTypesSection config={config} onChange={handleConfigChange} roles={uniqueRoles} />
              <AvailabilityDeadlinesSection
                config={config}
                onChange={handleConfigChange}
              />
            </TabsContent>

            <TabsContent value="scheduling" className="space-y-4">
              <SchedulingRulesSection config={config} onChange={handleConfigChange} />
              <BreakRulesSection config={config} onChange={handleConfigChange} />
              <SchedulingWeightsSection config={config} onChange={handleConfigChange} />
              <PreferenceRulesSection />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 border-t bg-background/95 backdrop-blur px-6 py-3 z-30 flex items-center justify-between">
          <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
            Unsaved changes
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleDiscard}
              disabled={updateConfig.isPending}
            >
              Discard
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateConfig.isPending}
              className="min-w-[10rem]"
            >
              {updateConfig.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Configuration"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteCodeCard({
  inviteCode,
  businessName,
}: {
  inviteCode: string | null;
  businessName: string;
}) {
  const utils = trpc.useUtils();
  const regenerate = trpc.business.regenerateInviteCode.useMutation({
    onSuccess: () => {
      utils.business.getCurrent.invalidate();
      toast.success("Invite code regenerated");
    },
    onError: (err) => toast.error(err.message),
  });

  const joinLink = inviteCode ? getTelegramJoinLinkClient(inviteCode) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff Telegram Invite</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {inviteCode ? (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Invite Code</label>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteCode} className="font-mono max-w-[10rem]" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(inviteCode);
                    toast.success("Invite code copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {joinLink && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Telegram Join Link</label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={joinLink} className="text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(joinLink);
                      toast.success("Join link copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              {regenerate.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Regenerate Code
            </Button>
            <p className="text-xs text-muted-foreground">
              Regenerating will invalidate all existing invite links.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            No invite code generated yet. Save your settings to generate one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
