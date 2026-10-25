/** Source APIs use an empty value to mean "all"; omit it from category requests. */
export function nonEmptySourceFilters(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}
