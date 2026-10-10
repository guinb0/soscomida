import { v7 } from 'uuid';

/** UUID v7: ordenável por tempo (bom para índice) e não revela volume como um serial. */
export const newId = (): string => v7();
