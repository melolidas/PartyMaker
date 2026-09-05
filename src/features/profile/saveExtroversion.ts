import { normalizeExtroversionLevel } from './extroversion';

type OptimisticExtroversionOptions = {
  currentLevel: number;
  nextLevel: number;
  setLevel: (level: number) => void;
  persist: (level: number) => Promise<number>;
};

export async function saveExtroversionOptimistically({
  currentLevel,
  nextLevel,
  setLevel,
  persist,
}: OptimisticExtroversionOptions): Promise<number> {
  const previousLevel = normalizeExtroversionLevel(currentLevel);
  const optimisticLevel = normalizeExtroversionLevel(nextLevel);
  setLevel(optimisticLevel);

  try {
    const persistedLevel = normalizeExtroversionLevel(
      await persist(optimisticLevel),
    );
    setLevel(persistedLevel);
    return persistedLevel;
  } catch (error: unknown) {
    setLevel(previousLevel);
    throw error;
  }
}
