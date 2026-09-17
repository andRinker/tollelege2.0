"use client";

import { MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RouterProvider } from "react-aria-components";
import { SnackbarProvider } from "@/ui/components/snackbar";

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider navigate={router.push}>
      <MotionConfig reducedMotion="user">
        <SnackbarProvider>{children}</SnackbarProvider>
      </MotionConfig>
    </RouterProvider>
  );
}
