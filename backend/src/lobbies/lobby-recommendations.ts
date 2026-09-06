/** Deliberately lexical, locale-independent and bounded by the caller's SQL samples. */
const stopWords = new Set(`
  a an and are as at be been being but by can could did do does for from had has have
  he her here hers him his how i if in into is it its me more most my no not of on or
  our ours out she so some than that the their theirs them then there these they this
  those to too up us very was we were what when where which who why will with would you your yours
  а без был была были было быть в вам вас весь во вот все всего всех вы где да даже для до
  его ее ей ему если есть еще же за здесь и из или им их к как ко когда кто ли либо мне
  может мы на над надо наш не него нее нет ни но ну о об он она они оно от по под при
  про с со так также там те тем то того тоже только том тут ты у уже что чтобы это этот
  эта эти я меня мой моя мои наш наша наши ваш ваша ваши
`.trim().split(/\s+/u));

export function interestWords(text: string): Set<string> {
  return new Set((text.normalize('NFKC').toLowerCase().replace(/ё/gu, 'е').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])
    .filter(word => !stopWords.has(word)));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

type TextSource = { title: string; description: string };
type Candidate = TextSource & { id: string; startsAt: Date };
export function recommendedIds(sources: TextSource[], candidates: Candidate[]): string[] {
  const interests = sources.map(source => interestWords(`${source.title} ${source.description}`));
  return candidates.map(candidate => {
    const words = interestWords(`${candidate.title} ${candidate.description}`);
    const score = Math.max(0, ...interests.map(interest => jaccard(words, interest)));
    return { ...candidate, score };
  }).filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 5).map(candidate => candidate.id);
}
