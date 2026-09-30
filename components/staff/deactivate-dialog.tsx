"use client";

import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMember: { id: string; name: string } | null;
}

export function DeactivateDialog({ open, onOpenChange, staffMember }: Props) {
  const utils = trpc.useUtils();

  const deactivate = trpc.staff.deactivate.useMutation({
    onSuccess: () => {
      utils.staff.list.invalidate();
      toast.success(`${staffMember?.name} has been deactivated`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate Staff Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to deactivate{" "}
            <span className="font-medium text-foreground">
              {staffMember?.name}
            </span>
            ? They will no longer appear in scheduling.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deactivate.isPending}
            onClick={() => {
              if (staffMember) deactivate.mutate({ id: staffMember.id });
            }}
          >
            {deactivate.isPending ? "Deactivating..." : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
