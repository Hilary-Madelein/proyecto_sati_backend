const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);

/**
 * "SANTO DOMINGO DE LOS TSACHILAS" -> "Santo Domingo de los Tsachilas";
 * "BOLÍVAR (SAGRARIO)" -> "Bolívar (Sagrario)" (también tras un paréntesis).
 * Las fuentes oficiales suelen entregar provincias y cantones en mayúsculas.
 */
export function toTitleCase(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('es')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && LOWERCASE_WORDS.has(word)
        ? word
        : word.replace(/^([("'“]*)(\p{L})/u, (_, opening: string, letter: string) => opening + letter.toLocaleUpperCase('es')),
    )
    .join(' ');
}
