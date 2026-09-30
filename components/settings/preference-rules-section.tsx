"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Check, X, Users } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  manager_explicit: "Added by you",
  learned_from_edit: "Suggested by Roster",
  staff_request: "Staff request",
};

const SOURCE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  manager_explicit: "default",
  learned_from_edit: "secondary",
  staff_request: "outline",
};

export function PreferenceRulesSection() {
  const utils = trpc.useUtils();
  const { data: rules, isLoading } = trpc.preferences.list.useQuery();
  const { data: pairDynamics } = trpc.knowledge.listPairDynamics.useQuery();

  const confirmPairMutation = trpc.knowledge.confirmPair.useMutation({
    onSuccess: () => {
      utils.knowledge.listPairDynamics.invalidate();
      toast.success("Pair dynamic confirmed");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const dismissPairMutation = trpc.knowledge.dismissPair.useMutation({
    onSuccess: () => {
      utils.knowledge.listPairDynamics.invalidate();
      toast.success("Pair dynamic dismissed");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createMutation = trpc.preferences.create.useMutation({
    onSuccess: () => {
      utils.preferences.list.invalidate();
      toast.success("Rule added");
      setNewRuleText("");
      setNewRuleExpiry("");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = trpc.preferences.toggleActive.useMutation({
    onSuccess: () => utils.preferences.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const confirmMutation = trpc.preferences.confirm.useMutation({
    onSuccess: () => {
      utils.preferences.list.invalidate();
      toast.success("Rule confirmed");
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = trpc.preferences.reject.useMutation({
    onSuccess: () => {
      utils.preferences.list.invalidate();
      toast.success("Rule rejected");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.preferences.delete.useMutation({
    onSuccess: () => {
      utils.preferences.list.invalidate();
      toast.success("Rule deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  const [newRuleText, setNewRuleText] = useState("");
  const [newRuleType, setNewRuleType] = useState<"soft" | "hard" | "temporary">("soft");
  const [newRuleExpiry, setNewRuleExpiry] = useState("");

  const allRules = (rules ?? []).filter((r) => !r.rejectedAt);
  const pendingReview = allRules.filter(
    (r) => r.source === "learned_from_edit" && !r.active && r.confidence < 0.7,
  );
  const otherRules = allRules.filter(
    (r) => !(r.source === "learned_from_edit" && !r.active && r.confidence < 0.7),
  );

  const summary = isLoading
    ? "Loading..."
    : `${allRules.length} rules · ${allRules.filter((r) => r.active).length} active${pendingReview.length > 0 ? ` · ${pendingReview.length} pending` : ""}`;

  const handleAddRule = () => {
    if (!newRuleText.trim()) return;
    createMutation.mutate({
      ruleText: newRuleText.trim(),
      ruleType: newRuleType,
      expiresAt: newRuleExpiry ? new Date(newRuleExpiry) : undefined,
    });
  };

  return (
    <CollapsibleSection
      title="Preference Rules"
      description="Business scheduling preferences and constraints used by the AI scheduler."
      summary={summary}
    >
      {/* Pending review section */}
      {pendingReview.length > 0 && (
        <div className="space-y-2 mb-4">
          <h4 className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Pending review ({pendingReview.length})
          </h4>
          <div className="space-y-2">
            {pendingReview.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
              >
                <div className="flex-1 space-y-1">
                  <p className="text-sm">{rule.ruleText}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {rule.ruleType}
                    </Badge>
                    <Badge variant={SOURCE_VARIANTS[rule.source] ?? "outline"} className="text-xs">
                      {SOURCE_LABELS[rule.source] ?? rule.source}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirmMutation.mutate({ id: rule.id })}
                    disabled={confirmMutation.isPending}
                    title="Confirm"
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => rejectMutation.mutate({ id: rule.id })}
                    disabled={rejectMutation.isPending}
                    title="Reject"
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pair dynamics review */}
      {pairDynamics && pairDynamics.length > 0 && (
        <div className="space-y-2 mb-4">
          <h4 className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Pair dynamics ({pairDynamics.length})
          </h4>
          <div className="space-y-2">
            {pairDynamics.map((pair: any) => (
              <div
                key={pair.slug}
                className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-600" />
                    <p className="text-sm">{pair.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {pair.type === "friction" ? "Avoid pairing" : "Pairs well"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {pair.evidenceCount} observation{pair.evidenceCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirmPairMutation.mutate({ slug: pair.slug })}
                    disabled={confirmPairMutation.isPending}
                    title="Confirm"
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissPairMutation.mutate({ slug: pair.slug })}
                    disabled={dismissPairMutation.isPending}
                    title="Dismiss"
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-2">
        {otherRules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="flex-1 space-y-1">
              <p className="text-sm">{rule.ruleText}</p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {rule.ruleType}
                </Badge>
                <Badge variant={SOURCE_VARIANTS[rule.source] ?? "outline"} className="text-xs">
                  {SOURCE_LABELS[rule.source] ?? rule.source}
                </Badge>
                {rule.expiresAt && (
                  <span className="text-xs text-muted-foreground">
                    Auto-expires {new Date(rule.expiresAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={rule.active}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ id: rule.id, active: checked })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteMutation.mutate({ id: rule.id })}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        ))}
        {allRules.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Roster learns your preferences automatically from edits you make to generated schedules. You can also add rules manually below.
          </p>
        )}
      </div>

      {/* Add rule form */}
      <div className="mt-4 space-y-3 border-t pt-4">
        <h4 className="text-sm font-medium">Add rule</h4>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Prefer scheduling senior staff during peak hours"
            value={newRuleText}
            onChange={(e) => setNewRuleText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRule()}
            className="flex-1"
          />
          <Select
            value={newRuleType}
            onValueChange={(v) => setNewRuleType(v as "soft" | "hard" | "temporary")}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="soft">Soft</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
              <SelectItem value="temporary">Temporary</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Auto-expires on (optional)</Label>
            <Input
              type="date"
              value={newRuleExpiry}
              onChange={(e) => setNewRuleExpiry(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            onClick={handleAddRule}
            disabled={!newRuleText.trim() || createMutation.isPending}
            size="sm"
          >
            Add Rule
          </Button>
        </div>
      </div>
    </CollapsibleSection>
  );
}
