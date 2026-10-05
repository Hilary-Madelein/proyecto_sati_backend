export interface ColorStop {
  value: number;
  /** "#RRGGBB" */
  color: string;
  /** 0–1 */
  opacity: number;
}

export type Rgba = [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

function toRgba(stop: ColorStop): Rgba {
  const hex = stop.color.replace('#', '');
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    Math.round(stop.opacity * 255),
  ];
}

/**
 * Rampa de colores continua, como el `ColorMap type="ramp"` de GeoServer:
 * interpola entre paradas, debajo de la primera es transparente y por encima
 * de la última usa el último color.
 */
export function createColorRamp(stops: ColorStop[]): (value: number) => Rgba {
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  const colors = sorted.map(toRgba);
  if (sorted.length === 0) return () => TRANSPARENT;

  return (value: number) => {
    if (!Number.isFinite(value) || value < sorted[0].value) return TRANSPARENT;
    const last = sorted.length - 1;
    if (value >= sorted[last].value) return colors[last];

    let upper = 1;
    while (sorted[upper].value < value) upper++;
    const lower = upper - 1;
    const t = (value - sorted[lower].value) / (sorted[upper].value - sorted[lower].value);
    return colors[lower].map((channel, index) => Math.round(channel + (colors[upper][index] - channel) * t)) as Rgba;
  };
}
