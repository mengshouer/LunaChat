"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Button } from "./button";
import { EyeIcon, EyeOffIcon } from "lucide-react";

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => {
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <div className="relative w-full">
      <Input
        type="text"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        className={cn(
          "pr-10",
          !showPassword && "password-mask",
          className,
        )}
        ref={ref}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
        onClick={() => setShowPassword((prev) => !prev)}
      >
        {showPassword ? (
          <EyeIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <EyeOffIcon className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="sr-only">
          {showPassword ? "Hide password" : "Show password"}
        </span>
      </Button>

      <style>{`
        .password-mask {
          -webkit-text-security: disc;
        }
      `}</style>
    </div>
  );
});

PasswordInput.displayName = "PasswordInput";
