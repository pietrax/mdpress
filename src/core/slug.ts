export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug || 'template';
}

export function uniqueSlug(base: string, taken: readonly string[]): string {
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base.slice(0, 60).replace(/-+$/, '')}-${n}`;
  return slug;
}
