"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface ApprovalFeedbackBannerProps {
  variationId: string;
  onDismiss: () => void;
}

export function ApprovalFeedbackBanner({
  variationId,
  onDismiss,
}: ApprovalFeedbackBannerProps) {
  const [submitted, setSubmitted] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");

  const submitFeedback = trpc.schedule.submitApprovalFeedback.useMutation({
    onSuccess: () => {
      toast.success("Thanks!");
      setSubmitted(true);
      setTimeout(onDismiss, 1500);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRating = (rating: "good" | "some_edits" | "significant_changes") => {
    if (rating === "good") {
      submitFeedback.mutate({ variationId, rating });
    } else {
      setShowComment(true);
      // Submit rating immediately, comment can follow
      submitFeedback.mutate({ variationId, rating });
    }
  };

  const handleCommentSubmit = () => {
    if (comment.trim()) {
      // Re-submit with comment (the mutation will update)
      submitFeedback.mutate({
        variationId,
        rating: "some_edits",
        comment: comment.trim(),
      });
    }
  };

  if (submitted) return null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
      {!showComment ? (
        <>
          <span className="text-sm text-muted-foreground">
            How did this schedule turn out?
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRating("good")}
              disabled={submitFeedback.isPending}
            >
              Looks good
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRating("some_edits")}
              disabled={submitFeedback.isPending}
            >
              Had edits
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRating("significant_changes")}
              disabled={submitFeedback.isPending}
            >
              Significant changes
            </Button>
          </div>
          <button
            onClick={onDismiss}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      ) : (
        <div className="flex items-center gap-2 w-full">
          <Input
            placeholder="Anything for next time?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCommentSubmit()}
            className="flex-1"
          />
          <Button size="sm" onClick={handleCommentSubmit}>
            Submit
          </Button>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
