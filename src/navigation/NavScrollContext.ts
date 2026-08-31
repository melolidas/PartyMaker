import { createContext } from 'react';

export const NavScrollContext = createContext<(compact: boolean) => void>(() => {});
