"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StaffFormData {
  name: string;
  email: string;
  phone: string;
  employmentType: "full_time" | "part_time" | "casual";
  level: number;
  roles: string;
  baseHourlyRate: string;
}

const EMPTY_FORM: StaffFormData = {
  name: "",
  email: "",
  phone: "",
  employmentType: "part_time",
  level: 1,
  roles: "",
  baseHourlyRate: "",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialData?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    employmentType: "full_time" | "part_time" | "casual";
    level: number;
    roles: string[];
    payStructure: {
      baseHourlyRate: number;
    } | null;
  };
}

export function StaffFormDialog({
  open,
  onOpenChange,
  mode,
  initialData,
}: Props) {
  const [form, setForm] = useState<StaffFormData>(EMPTY_FORM);
  const [showPay, setShowPay] = useState(false);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (mode === "edit" && initialData) {
      setForm({
        name: initialData.name,
        email: initialData.email ?? "",
        phone: initialData.phone ?? "",
        employmentType: initialData.employmentType,
        level: initialData.level,
        roles: initialData.roles.join(", "),
        baseHourlyRate: initialData.payStructure
          ? String(initialData.payStructure.baseHourlyRate)
          : "",
      });
      setShowPay(!!initialData.payStructure);
    } else {
      setForm(EMPTY_FORM);
      setShowPay(false);
    }
  }, [mode, initialData, open]);

  const createMutation = trpc.staff.create.useMutation({
    onSuccess: () => {
      utils.staff.list.invalidate();
      toast.success("Staff member created");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.staff.update.useMutation({
    onSuccess: () => {
      utils.staff.list.invalidate();
      toast.success("Staff member updated");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    const roles = form.roles
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    const payStructure =
      showPay && form.baseHourlyRate
        ? {
            baseHourlyRate: parseFloat(form.baseHourlyRate) || 0,
          }
        : undefined;

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      employmentType: form.employmentType,
      level: form.level,
      roles,
      payStructure,
    };

    if (mode === "edit" && initialData) {
      updateMutation.mutate({ id: initialData.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Add Staff Member" : "Edit Staff Member"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Add a new team member to your roster."
                : "Update staff member details."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Employment Type</Label>
              <Select
                value={form.employmentType}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    employmentType: v as StaffFormData["employmentType"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="level">Level</Label>
              <Input
                id="level"
                type="number"
                min={1}
                value={form.level}
                onChange={(e) =>
                  setForm({ ...form, level: Number(e.target.value) || 1 })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="roles">Roles (comma-separated)</Label>
              <Input
                id="roles"
                placeholder="e.g. barista, cashier"
                value={form.roles}
                onChange={(e) => setForm({ ...form, roles: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPay(!showPay)}
              >
                {showPay ? "Hide" : "Show"} Pay Structure
              </Button>

              {showPay && (
                <div className="rounded-md border p-3">
                  <div className="space-y-1">
                    <Label htmlFor="baseRate" className="text-xs">
                      Base Hourly Rate
                    </Label>
                    <Input
                      id="baseRate"
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.baseHourlyRate}
                      onChange={(e) =>
                        setForm({ ...form, baseHourlyRate: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : mode === "create"
                  ? "Add Staff"
                  : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
