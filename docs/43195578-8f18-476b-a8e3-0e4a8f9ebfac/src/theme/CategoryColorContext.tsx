import React, { useMemo, useState, createContext, useContext } from 'react';
import { leadCategories, type LeadCategoryId } from '../data/inboxData';
type CategoryColors = Record<LeadCategoryId, string>;
interface CategoryColorContextValue {
  colors: CategoryColors;
  setColor: (id: LeadCategoryId, color: string) => void;
}
const seed = Object.fromEntries(
  leadCategories.map((c) => [c.id, c.color])
) as CategoryColors;
const CategoryColorContext = createContext<CategoryColorContextValue>({
  colors: seed,
  setColor: () => undefined
});
export function useCategoryColors(): CategoryColorContextValue {
  return useContext(CategoryColorContext);
}
export function CategoryColorProvider({
  children


}: {children: React.ReactNode;}) {
  const [colors, setColors] = useState<CategoryColors>(seed);
  const value = useMemo(
    () => ({
      colors,
      setColor: (id: LeadCategoryId, color: string) =>
      setColors((prev) => ({
        ...prev,
        [id]: color
      }))
    }),
    [colors]
  );
  return (
    <CategoryColorContext.Provider value={value}>
      {children}
    </CategoryColorContext.Provider>);

}