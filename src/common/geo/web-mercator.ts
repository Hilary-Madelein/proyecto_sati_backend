export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** Recuadro [minLng, minLat, maxLng, maxLat] en WGS84. */
export type BBox = [number, number, number, number];

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/** Teselas (esquema XYZ / Web Mercator) que cubren un recuadro a un zoom dado. */
export function tilesCovering([minLng, minLat, maxLng, maxLat]: BBox, z: number): TileCoord[] {
  const max = 2 ** z - 1;
  const clamp = (value: number) => Math.min(Math.max(value, 0), max);
  const [x0, x1] = [clamp(lngToTileX(minLng, z)), clamp(lngToTileX(maxLng, z))];
  const [y0, y1] = [clamp(latToTileY(maxLat, z)), clamp(latToTileY(minLat, z))];

  const tiles: TileCoord[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  return tiles;
}
