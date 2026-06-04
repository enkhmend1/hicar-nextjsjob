"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Live category list driven by the admin editor (Admin → Сайтын контент).
 *
 * Returns the SAME shape as `GET /api/site-content/categories` —
 * { id, name, iconPath, count } — so consumers can render counts AND
 * also wire up the seller's create-product dropdown to the same source
 * of truth as the homepage.
 *
 * Module-scoped cache: the categories list rarely changes, so the first
 * component that mounts fetches once and every other component that
 * uses the hook gets the cached snapshot. Pages can manually refresh
 * via the returned `reload()` function (e.g. after the admin editor
 * saves a change).
 */
/**
 * One row in a category's no-code attributes schema. Mirrors
 * `back-end/Model/siteContent.model.js` attributeDefinitionSchema.
 */
export interface AttributeDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  required: boolean;
}

export interface SiteCategoryWithCount {
  id: string;
  name: string;
  iconPath: string;
  imageUrl?: string;
  count: number;
  /** Empty when the legacy hardcoded schema still applies (e.g. body/oils). */
  attributesSchema?: AttributeDefinition[];
}

let cache: SiteCategoryWithCount[] | null = null;
let inflight: Promise<SiteCategoryWithCount[]> | null = null;

const fetchCategories = async (): Promise<SiteCategoryWithCount[]> => {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await api.get<{ categories: SiteCategoryWithCount[] }>("/site-content/categories");
      cache = r.categories || [];
      return cache;
    } catch {
      cache = [];
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/** Bust the in-memory cache — used by the admin editor after a save. */
export const invalidateCategoriesCache = () => {
  cache = null;
};

export function useCategories(): {
  categories: SiteCategoryWithCount[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [categories, setCategories] = useState<SiteCategoryWithCount[]>(cache || []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let cancelled = false;
    fetchCategories().then((list) => {
      if (cancelled) return;
      setCategories(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const reload = async () => {
    invalidateCategoriesCache();
    setLoading(true);
    const list = await fetchCategories();
    setCategories(list);
    setLoading(false);
  };

  return { categories, loading, reload };
}
