"use client";

import { useEffect } from "react";
import { loadAccount } from "@/lib/profile/client";

/** Loads the account once per visit and merges favourites/cards between this phone and the account. */
export function AccountSync() {
  useEffect(() => {
    void loadAccount();
  }, []);
  return null;
}
