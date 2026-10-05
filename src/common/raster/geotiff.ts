import { fromArrayBuffer } from 'geotiff';
import type { RasterGrid } from './raster-grid.js';

/**
 * Lee la primera banda de un GeoTIFF (respuesta de un WCS GetCoverage) como
 * grilla. Lanza un error si el contenido no es un GeoTIFF: los GeoServer
 * responden un XML de error con HTTP 200 cuando el paso pedido no existe.
 */
export async function readGeoTiffGrid(buffer: ArrayBuffer): Promise<RasterGrid> {
  const image = await (await fromArrayBuffer(buffer)).getImage();
  const [band] = await image.readRasters();
  const [west, south, east, north] = image.getBoundingBox();
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bbox: [west, south, east, north],
    values: Float64Array.from(band as ArrayLike<number>),
    noData: image.getGDALNoData(),
  };
}
