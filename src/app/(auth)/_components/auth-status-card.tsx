"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthStatusCardProps {
  title: string;
  description: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
  headerContent?: ReactNode;
  headerClassName?: string;
  contentClassName?: string;
}

export function AuthStatusCard({
  title,
  description,
  actionLabel,
  onAction,
  children,
  headerContent,
  headerClassName,
  contentClassName,
}: AuthStatusCardProps) {
  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader className={headerClassName}>
          {headerContent}
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {(children || actionLabel) && (
          <CardContent className={contentClassName}>
            {children}
            {actionLabel && onAction && (
              <Button
                variant="outline"
                className="w-full"
                onClick={onAction}
              >
                {actionLabel}
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
