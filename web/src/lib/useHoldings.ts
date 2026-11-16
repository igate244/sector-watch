import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { positions, type Position } from './holdings';

export function usePositions(): Position[] | undefined {
  return useLiveQuery(async () => positions(await db.trades.toArray()), []);
}

/** いま保有している銘柄コードの集合 */
export function useHeldCodes(): Set<string> {
  const ps = usePositions();
  return new Set((ps ?? []).filter((p) => p.qty > 0 && p.code).map((p) => p.code));
}
