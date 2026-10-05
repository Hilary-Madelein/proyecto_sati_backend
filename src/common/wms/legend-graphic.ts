import type { ColorStop } from '../raster/color-ramp.js';

/** Respuesta de un WMS GetLegendGraphic con FORMAT=application/json (GeoServer). */
export interface LegendGraphicJson {
  Legend?: Array<{
    rules?: Array<{
      symbolizers?: Array<{
        Raster?: { colormap?: { entries?: Array<{ quantity: string; color: string; opacity?: string }> } };
      }>;
    }>;
  }>;
}

/** Paleta de una capa raster a partir de su GetLegendGraphic en JSON. Vacía si no publica una. */
export function colorStopsFromLegendGraphic(data: LegendGraphicJson): ColorStop[] {
  const entries = data.Legend?.[0]?.rules?.[0]?.symbolizers?.[0]?.Raster?.colormap?.entries ?? [];
  return entries.map((entry) => ({
    value: Number.parseFloat(entry.quantity),
    color: entry.color,
    opacity: Number.parseFloat(entry.opacity ?? '1'),
  }));
}
