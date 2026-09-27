import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7: inserts append to InnoDB's clustered index instead of splitting pages. */
export function newId(): string {
  return uuidv7();
}
