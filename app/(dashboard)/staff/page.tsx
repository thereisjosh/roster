"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { DeactivateDialog } from "@/components/staff/deactivate-dialog";
import { Check, Copy, Pencil, Plus, UserMinus, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function getTelegramConnectLinkClient(staffId: string): string | null {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!bot) return null;
  return `https://t.me/${bot}?start=link_${staffId}`;
}

export default function StaffPage() {
  const { data: staffList, isLoading } = trpc.staff.list.useQuery();

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editData, setEditData] = useState<
    React.ComponentProps<typeof StaffFormDialog>["initialData"] | undefined
  >(undefined);

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handleAdd = () => {
    setFormMode("create");
    setEditData(undefined);
    setFormOpen(true);
  };

  const handleEdit = (member: NonNullable<typeof staffList>[number]) => {
    setFormMode("edit");
    setEditData({
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      employmentType: member.employmentType,
      level: member.level,
      roles: member.roles,
      payStructure: member.payStructure,
    });
    setFormOpen(true);
  };

  const handleDeactivate = (member: { id: string; name: string }) => {
    setDeactivateTarget(member);
    setDeactivateOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-muted-foreground mt-1">Manage your team members and their roles.</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add Staff
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !staffList?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">
            No staff members yet. Add your first team member to get started.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staffList.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">{member.name}</TableCell>
                <TableCell>{member.email ?? "—"}</TableCell>
                <TableCell>{member.phone ?? "—"}</TableCell>
                <TableCell className="capitalize">
                  {member.employmentType.replace("_", " ")}
                </TableCell>
                <TableCell>
                  {member.telegramChatId ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    (() => {
                      const link = getTelegramConnectLinkClient(member.id);
                      return link ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Copy Telegram connect link"
                          onClick={() => {
                            navigator.clipboard.writeText(link);
                            toast.success("Connect link copied to clipboard");
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      );
                    })()
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={member.isActive ? "default" : "secondary"}>
                    {member.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(member)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {member.isActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeactivate(member)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <StaffFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        initialData={editData}
      />
      <DeactivateDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        staffMember={deactivateTarget}
      />
    </div>
  );
}
