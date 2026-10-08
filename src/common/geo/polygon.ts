/** Anillo de un polígono: puntos [longitud, latitud]; el último se une con el primero. */
export type Ring = readonly (readonly [number, number])[];

/**
 * Longitudes donde los bordes de los anillos cruzan la latitud `lat`, ordenadas.
 * Calcularlas una vez por fila de una imagen hace que saber si cada píxel está
 * dentro cueste casi nada (ver `isInsideCrossings`).
 */
export function crossingsAtLatitude(rings: readonly Ring[], lat: number): number[] {
  const crossings: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat) crossings.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
    }
  }
  return crossings.sort((a, b) => a - b);
}

/** Regla par-impar: dentro si hay un número impar de cruces a la izquierda de `lng`. */
export function isInsideCrossings(crossings: readonly number[], lng: number): boolean {
  let count = 0;
  for (const x of crossings) {
    if (x >= lng) break;
    count++;
  }
  return count % 2 === 1;
}

/** ¿El punto está dentro de alguno de los anillos? */
export function isInsideRings(rings: readonly Ring[], lng: number, lat: number): boolean {
  return isInsideCrossings(crossingsAtLatitude(rings, lat), lng);
}
