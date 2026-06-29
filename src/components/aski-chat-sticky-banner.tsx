'use client';

import { useEffect, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { AskiChatLogo } from "@/components/aski-chat-logo";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "./ui/button";

const STORAGE_KEY = "aski-chat-banner-collapsed";
const ASKI_CHAT_BANNER_URL = "https://aski.chat?utm_source=saas-template-sticky-banner";

export function AskiChatStickyBanner() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Get initial state from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setIsCollapsed(JSON.parse(stored));
    }
    setIsHydrated(true);
  }, []);

  const toggleCollapsed = (value: boolean) => {
    setIsCollapsed(value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  };

  if (!isHydrated) return null; // Prevent flash of content

  return (
    <BannerPositioner isCollapsed={isCollapsed}>
      <BannerPanel
        isCollapsed={isCollapsed}
        onCollapseChange={toggleCollapsed}
      />
    </BannerPositioner>
  );
}

interface BannerPositionerProps {
  children: React.ReactNode;
  isCollapsed: boolean;
}

function BannerPositioner({ children, isCollapsed }: BannerPositionerProps) {
  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-4 z-[100] print:hidden",
        isCollapsed && "pointer-events-none" // Make entire container click-through when collapsed
      )}
    >
      <div
        className={cn(
          "transition-all duration-300 ease-in-out transform",
          isCollapsed ? "translate-x-[calc(100%+1rem)] md:translate-x-[calc(100%+1rem)]" : "translate-x-0"
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface BannerPanelProps {
  isCollapsed: boolean;
  onCollapseChange: (value: boolean) => void;
}

function BannerPanel({ isCollapsed, onCollapseChange }: BannerPanelProps) {
  return (
    <div className="relative flex items-center w-[90vw] md:max-w-[400px]">
      <ExpandButton
        isCollapsed={isCollapsed}
        onExpand={() => onCollapseChange(false)}
      />
      <div className="bg-gray-100 dark:bg-background rounded-lg shadow-xl border-2 relative">
        <CollapseButton onCollapse={() => onCollapseChange(true)} />
        <BannerContent />
      </div>
    </div>
  );
}

interface ExpandButtonProps {
  isCollapsed: boolean;
  onExpand: () => void;
}

function ExpandButton({ isCollapsed, onExpand }: ExpandButtonProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      className={cn(
        "absolute left-0 h-8 w-8 rounded-full shadow-lg -translate-x-full",
        "bg-background hover:bg-background",
        "border-2 hover:border-border",
        isCollapsed ? "opacity-100 pointer-events-auto" : "opacity-0" // Ensure button is clickable when collapsed
      )}
      onClick={onExpand}
    >
      <ChevronLeft className="h-4 w-4" />
    </Button>
  );
}

interface CollapseButtonProps {
  onCollapse: () => void;
}

function CollapseButton({ onCollapse }: CollapseButtonProps) {
  return (
    <Button
      size="icon"
      className="h-6 w-6 absolute -top-3 -right-3 rounded-full shadow-md border border-border"
      onClick={onCollapse}
    >
      <X className="h-4 w-4" />
    </Button>
  );
}

function BannerContent() {
  return (
    <div className="flex items-center flex-col py-3 px-3">
      <a
        href={ASKI_CHAT_BANNER_URL}
        target="_blank"
        rel="noreferrer"
        className="flex flex-col items-center font-medium text-sm hover:text-foreground transition-colors"
      >
        <div className="flex items-center">
          <span className="whitespace-nowrap">Built by</span>
          <AskiChatLogo className="h-7 w-7 mx-1.5" />
          <span className="whitespace-nowrap">Aski.Chat</span>
        </div>

        <div className="text-tiny text-muted-foreground mt-3">
          AI customer support agents that answer visitors, capture leads, and
          surface customer intelligence from every conversation.
        </div>
      </a>
      <a
        href={ASKI_CHAT_BANNER_URL}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ size: "sm", className: "mt-4" })}
      >
        Start with Aski.Chat
      </a>
    </div>
  );
}
