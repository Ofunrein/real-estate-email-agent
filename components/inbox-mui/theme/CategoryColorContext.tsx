"use client";
import React, { useMemo, useState, createContext, useContext } from 'react';
import { leadCategories, type LeadCategory, type LeadCategoryId } from '../data/inboxData';

type CategoryColors = Record<LeadCategoryId, string>;

interface CategoryColorContextValue {
  colors: CategoryColors;
  setColor: (id: LeadCategoryId, color: string) => void;
}

const defaultSeed = Object.fromEntries(leadCategories.map((c) => [c.id, c.color])) as CategoryColors;

const CategoryColorContext = createContext<CategoryColorContextValue>({
  colors: defaultSeed,
  setColor: () => undefined,
});

export function useCategoryColors(): CategoryColorContextValue {
  return useContext(CategoryColorContext);
}

export function CategoryColorProvider({
  categories,
  children,
}: {
  categories?: LeadCategory[];
  children: React.ReactNode;
}) {
  const seed = useMemo<CategoryColors>(() => {
    const base = { ...defaultSeed };
    for (const c of categories || leadCategories) base[c.id] = c.color;
    return base;
  }, [categories]);

  const [colors, setColors] = useState<CategoryColors>(seed);
  React.useEffect(() => setColors(seed), [seed]);

  const value = useMemo(
    () => ({
      colors,
      setColor: (id: LeadCategoryId, color: string) =>
        setColors((prev) => ({ ...prev, [id]: color })),
    }),
    [colors],
  );

  return <CategoryColorContext.Provider value={value}>{children}</CategoryColorContext.Provider>;
}
