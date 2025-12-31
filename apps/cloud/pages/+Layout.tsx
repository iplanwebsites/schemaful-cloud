import "@/styles/globals.css";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      {children}
      <Toaster position="bottom-right" />
    </div>
  );
}
