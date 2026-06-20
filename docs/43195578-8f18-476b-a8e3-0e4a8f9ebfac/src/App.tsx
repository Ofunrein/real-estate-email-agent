import React from 'react';
import { ColorModeProvider } from './theme/ColorModeContext';
import { CategoryColorProvider } from './theme/CategoryColorContext';
import { InboxPage } from './pages/InboxPage';
export function App() {
  return (
    <ColorModeProvider>
      <CategoryColorProvider>
        <InboxPage />
      </CategoryColorProvider>
    </ColorModeProvider>);

}