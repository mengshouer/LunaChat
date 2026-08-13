"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SecurityForm } from "./security-form";

export function SecurityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Security</DialogTitle>
          <DialogDescription>
            Manage global API key encryption and the deployment access token.
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4">
          <SecurityForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
