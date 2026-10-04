const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);

/**
 * "SANTO DOMINGO DE LOS TSACHILAS" -> "Santo Domingo de los Tsachilas".
 * Las fuentes oficiales suelen entregar provincias y cantones en mayúsculas.
 */
export function toTitleCase(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('es')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase('es') + word.slice(1),
    )
    .join(' ');
}
