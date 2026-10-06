import { readFileSync } from 'node:fs';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { latestOisstFile, parseOisstNetcdf } from './oisst-netcdf.js';

/** Archivo con la estructura de OISST v2.1 en miniatura: 4×4 celdas frente a Ecuador, una de tierra. */
function fixture(): ArrayBuffer {
  const buffer = readFileSync(new URL('./__fixtures__/oisst-mini.nc', import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('parseOisstNetcdf', () => {
  it('recorta el recuadro, aplica la escala y deja la fila 0 al norte', () => {
    const field = parseOisstNetcdf(fixture(), [-81, -1, -79, 1]);

    expect(field.time).toBe('2026-10-05T12:00:00.000Z');
    expect(field.sst).toMatchObject({ width: 4, height: 4, bbox: [-80.5, -0.5, -79.5, 0.5] });
    // Fila 0 = latitud 0,375 (la más al norte); columna 0 = longitud -80,375.
    expect(field.sst.values[0]).toBeCloseTo(25.3);
    expect(field.sst.values[12]).toBeCloseTo(25.0);
    expect(field.anomaly.values[1]).toBeCloseTo(0.5);
    expect(field.anomaly.values[0]).toBeCloseTo(-0.5);
  });

  it('las celdas de tierra (-999) quedan sin dato', () => {
    const field = parseOisstNetcdf(fixture(), [-81, -1, -79, 1]);
    expect(field.sst.values[3]).toBeNaN();
    expect(field.anomaly.values[3]).toBeNaN();
  });

  it('solo toma las celdas dentro del recuadro', () => {
    const field = parseOisstNetcdf(fixture(), [-80.5, -0.25, -79.9, 0.25]);
    expect(field.sst).toMatchObject({ width: 2, height: 2 });
  });

  it('rechaza un archivo que no es NetCDF-4 o un recuadro fuera de la grilla', () => {
    expect(() => parseOisstNetcdf(new TextEncoder().encode('<html>error</html>').buffer as ArrayBuffer, [-81, -1, -79, 1])).toThrow(
      UpstreamError,
    );
    expect(() => parseOisstNetcdf(fixture(), [-70, 10, -60, 20])).toThrow('no está en la grilla');
  });
});

describe('latestOisstFile', () => {
  it('elige el día más reciente y, ese día, la versión final sobre la preliminar', () => {
    const html = `
      <a href="oisst-avhrr-v02r01.20261003.nc">…</a>
      <a href="oisst-avhrr-v02r01.20261004_preliminary.nc">…</a>
      <a href="oisst-avhrr-v02r01.20261005_preliminary.nc">…</a>
      <a href="oisst-avhrr-v02r01.20261005.nc">…</a>`;
    expect(latestOisstFile(html)).toBe('oisst-avhrr-v02r01.20261005.nc');
  });

  it('null si la carpeta no tiene archivos', () => {
    expect(latestOisstFile('<html>vacía</html>')).toBeNull();
  });
});
